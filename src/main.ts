// src/main.ts - Robust & Stable WatchDog Pro Backend
import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, exec } from 'child_process';
import log from 'electron-log';
import psList from 'ps-list';

// Constants
const IS_DEV = process.env.VITE_DEV_SERVER_URL !== undefined;
const CONFIG_FILE = 'watchdog-config.json';
const LOGS_FILE = 'watchdog-logs.json';

// Paths
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, CONFIG_FILE);
const logsPath = path.join(userDataPath, LOGS_FILE);

interface AppEntry {
    id: string;
    name: string;
    path: string;
    autoRestart: boolean;
    status: 'running' | 'stopped' | 'restarted' | 'checking';
    lastRestartTime?: number; // To prevent spamming
    restartCount: number;
    memoryLimitEnabled: boolean;
    memoryLimitMB: number;
    currentMemoryUsage?: number;
}

interface WatchDogConfig {
    apps: AppEntry[];
    interval: number;
    logRetentionDays: number;
    startMinimized: boolean;
    runOnStartup: boolean;
}

let config: WatchDogConfig = { apps: [], interval: 5, logRetentionDays: 1, startMinimized: false, runOnStartup: false };
let mainWindow: BrowserWindow | null = null;
let monitorTimer: NodeJS.Timeout | null = null;
let isChecking = false; // Prevent overlapping checks
let tray: Tray | null = null;

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            config = { ...config, ...JSON.parse(data) };
            if (!config.interval) config.interval = 5;
            if (config.logRetentionDays === undefined) config.logRetentionDays = 1;
            if (config.startMinimized === undefined) config.startMinimized = false;
            if (config.runOnStartup === undefined) config.runOnStartup = false;
        } else {
            saveConfig();
        }
    } catch (err) {
        log.error('Failed to load config', err);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
        log.error('Failed to save config', err);
    }
}

function addLogEntry(appId: string, appName: string, event: string) {
    try {
        const now = Date.now();
        const timestamp = new Date().toLocaleString();
        const entry = { timestamp, rawTime: now, appId, appName, event };

        let logs = [];
        if (fs.existsSync(logsPath)) {
            try {
                logs = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
            } catch { logs = []; }
        }

        logs.unshift(entry);

        const retentionMs = config.logRetentionDays * 24 * 60 * 60 * 1000;
        logs = logs.filter((l: any) => {
            if (!l.rawTime) return true;
            return (now - l.rawTime) < retentionMs;
        });

        if (logs.length > 500) logs = logs.slice(0, 500);

        fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2));
        mainWindow?.webContents.send('logs-updated', logs);
    } catch (err) {
        log.error('Failed to write log', err);
    }
}

async function isProcessRunning(appPath: string): Promise<{ running: boolean, memoryMB?: number }> {
    const basename = path.basename(appPath).toLowerCase();
    try {
        const processes = await psList();
        const proc = processes.find(p => p.name.toLowerCase() === basename || (p.cmd && p.cmd.toLowerCase().includes(basename)));
        if (proc) {
            return {
                running: true,
                memoryMB: typeof proc.memory === 'number' ? Math.round(proc.memory / (1024 * 1024)) : 0
            };
        }
        return { running: false };
    } catch (e) {
        log.error('psList error:', e);
        // Fallback to tasklist if ps-list fails in packaged environment
        return new Promise((resolve) => {
            exec(`tasklist /FI "IMAGENAME eq ${basename}" /NH`, (err, stdout) => {
                if (!err && stdout.toLowerCase().includes(basename)) {
                    resolve({ running: true, memoryMB: 0 });
                } else {
                    resolve({ running: false });
                }
            });
        });
    }
}

function launchApp(appItem: AppEntry) {
    try {
        const appDir = path.dirname(appItem.path);
        log.info(`Launching ${appItem.name}...`);
        appItem.lastRestartTime = Date.now();

        if (process.platform === 'win32') {
            const command = `start "" "${appItem.path}"`;
            exec(command, { cwd: appDir }, (err) => {
                if (err) log.error(`Launch failed: ${appItem.name}`, err);
            });
        } else {
            const child = spawn(appItem.path, [], {
                detached: true,
                stdio: 'ignore',
                cwd: appDir
            });
            child.unref();
        }
    } catch (err) {
        log.error(`Critical launch error: ${appItem.name}`, err);
    }
}

async function checkApps() {
    if (isChecking) return;
    isChecking = true;

    let changed = false;
    const now = Date.now();

    for (const appItem of config.apps) {
        const { running, memoryMB } = await isProcessRunning(appItem.path);
        const oldStatus = appItem.status;
        appItem.currentMemoryUsage = memoryMB || 0;

        if (running && appItem.memoryLimitEnabled && memoryMB && memoryMB > appItem.memoryLimitMB) {
            log.warn(`${appItem.name} exceeded memory limit (${memoryMB}MB > ${appItem.memoryLimitMB}MB). Restarting...`);
            addLogEntry(appItem.id, appItem.name, `Memory limit exceeded (${memoryMB}MB > ${appItem.memoryLimitMB}MB). Restarting...`);

            const killer = process.platform === 'win32' ? `taskkill /F /IM "${path.basename(appItem.path)}"` : `pkill -f "${path.basename(appItem.path)}"`;
            exec(killer);

            appItem.status = 'restarted';
            launchApp(appItem);
            changed = true;
            continue;
        }

        if (appItem.lastRestartTime && (now - appItem.lastRestartTime < 10000)) {
            if (running) {
                appItem.lastRestartTime = 0;
                appItem.status = 'running';
                changed = true;
            }
            continue;
        }

        if (!running) {
            if (appItem.status === 'running') {
                log.warn(`${appItem.name} closed/crashed.`);
                addLogEntry(appItem.id, appItem.name, 'Detected CLOSED');
            }

            if (appItem.autoRestart) {
                if (appItem.status !== 'restarted') {
                    appItem.restartCount = (appItem.restartCount || 0) + 1;
                    addLogEntry(appItem.id, appItem.name, `Auto-Restarting... (Count: ${appItem.restartCount})`);
                    launchApp(appItem);
                    appItem.status = 'restarted';
                    changed = true;
                    saveConfig();
                }
            } else {
                appItem.status = 'stopped';
                if (oldStatus !== 'stopped') changed = true;
            }
        } else {
            if (appItem.status !== 'running') {
                appItem.status = 'running';
                appItem.lastRestartTime = 0;
                changed = true;
            }
        }
    }

    if (changed) {
        mainWindow?.webContents.send('status-update', config.apps);
    }
    isChecking = false;
}

function startMonitoring() {
    if (monitorTimer) clearInterval(monitorTimer);
    checkApps();
    monitorTimer = setInterval(checkApps, config.interval * 1000);
}

function createWindow() {
    const iconPath = IS_DEV
        ? path.join(process.cwd(), 'public', 'logo.png')
        : path.join(__dirname, '..', 'dist', 'logo.png');

    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        title: 'WatchDog Pro',
        autoHideMenuBar: true,
        show: !config.startMinimized,
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (IS_DEV) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    mainWindow.setMenu(null);

    mainWindow.on('minimize', (event: any) => {
        event.preventDefault();
        mainWindow?.hide();
        if (tray) {
            tray.displayBalloon({
                title: 'WatchDog Pro',
                content: 'Active in background. Double-click tray icon to restore.',
                iconType: 'info'
            });
        }
    });

    mainWindow.on('close', (event) => {
        if (!(app as any).isQuiting) {
            event.preventDefault();
            mainWindow?.hide();
            if (tray) {
                tray.displayBalloon({
                    title: 'WatchDog Pro',
                    content: 'Minimized to tray. Monitoring continues.',
                    iconType: 'info'
                });
            }
        }
        return false;
    });

    createTray();
}

function createTray() {
    if (tray) return;

    // Improved icon path logic for both dev and prod
    const iconName = 'logo.png';
    const iconPath = IS_DEV
        ? path.join(process.cwd(), 'public', iconName)
        : path.join(__dirname, '..', 'dist', iconName);

    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'WatchDog Pro', enabled: false },
        { type: 'separator' },
        { label: 'Show App', click: () => mainWindow?.show() },
        {
            label: 'Quit', click: () => {
                (app as any).isQuiting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('WatchDog Pro Monitoring');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
        mainWindow?.show();
        mainWindow?.restore();
        mainWindow?.focus();
    });
}

function pruneLogs() {
    try {
        if (!fs.existsSync(logsPath)) return;
        const now = Date.now();
        const data = fs.readFileSync(logsPath, 'utf-8');
        let logs = JSON.parse(data);
        const retentionMs = config.logRetentionDays * 24 * 60 * 60 * 1000;
        const initialLength = logs.length;
        logs = logs.filter((l: any) => {
            if (!l.rawTime) return true;
            return (now - l.rawTime) < retentionMs;
        });
        if (logs.length !== initialLength) {
            fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2));
            log.info(`Pruned ${initialLength - logs.length} old log entries.`);
        }
    } catch (err) {
        log.error('Failed to prune logs', err);
    }
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    // Show a warning to the user before quitting
    app.whenReady().then(() => {
        dialog.showErrorBox(
            'WatchDog Pro - Instance Already Running',
            'WatchDog Pro is already running. Please check your system tray (bottom-right icons) to access it.'
        );
        app.quit();
    });
} else {
    // Important for Windows Notifications in production
    app.setAppUserModelId('com.gowinda.watchdog');

    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        loadConfig();
        pruneLogs();
        createWindow();
        startMonitoring();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('get-config', () => config);
ipcMain.handle('get-logs', () => {
    try {
        return fs.existsSync(logsPath) ? JSON.parse(fs.readFileSync(logsPath, 'utf-8')) : [];
    } catch { return []; }
});

ipcMain.handle('browse-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [{ name: 'Executables', extensions: ['exe'] }]
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('add-app', (event, { name, path: appPath }) => {
    const entry: AppEntry = {
        id: Date.now().toString(),
        name,
        path: appPath,
        autoRestart: true,
        status: 'checking',
        lastRestartTime: 0,
        restartCount: 0,
        memoryLimitEnabled: false,
        memoryLimitMB: 500
    };
    config.apps.push(entry);
    saveConfig();
    return entry;
});

ipcMain.handle('remove-app', (event, id) => {
    config.apps = config.apps.filter(a => a.id !== id);
    saveConfig();
    return true;
});

ipcMain.handle('toggle-auto-restart', (event, { id, value }) => {
    const appEntry = config.apps.find(a => a.id === id);
    if (appEntry) {
        appEntry.autoRestart = value;
        saveConfig();
        return true;
    }
    return false;
});

ipcMain.handle('update-interval', (event, interval) => {
    config.interval = interval;
    saveConfig();
    startMonitoring();
    return true;
});

ipcMain.handle('update-log-retention', (event, days) => {
    config.logRetentionDays = days;
    saveConfig();
    pruneLogs();
    try {
        if (fs.existsSync(logsPath)) {
            const logs = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
            mainWindow?.webContents.send('logs-updated', logs);
        }
    } catch { }
    return true;
});

ipcMain.handle('open-config-folder', () => {
    shell.openPath(userDataPath);
});

ipcMain.handle('toggle-memory-protection', (event, { id, value }) => {
    const appEntry = config.apps.find(a => a.id === id);
    if (appEntry) {
        appEntry.memoryLimitEnabled = value;
        saveConfig();
        return true;
    }
    return false;
});

ipcMain.handle('update-memory-limit', (event, { id, value }) => {
    const appEntry = config.apps.find(a => a.id === id);
    if (appEntry) {
        appEntry.memoryLimitMB = value;
        saveConfig();
        return true;
    }
    return false;
});

ipcMain.handle('update-start-minimized', (event, value) => {
    config.startMinimized = value;
    saveConfig();
    return true;
});

ipcMain.handle('update-run-on-startup', (event, value) => {
    config.runOnStartup = value;
    saveConfig();
    app.setLoginItemSettings({
        openAtLogin: value,
        path: app.getPath('exe')
    });
    return true;
});

ipcMain.handle('create-desktop-shortcut', async () => {
    try {
        const desktopPath = app.getPath('desktop');
        const shortcutPath = path.join(desktopPath, 'WatchDog Pro.lnk');
        const exePath = app.getPath('exe');

        // Use writeShortcutLink for modern Electron
        const success = (shell as any).writeShortcutLink(shortcutPath, {
            target: exePath,
            description: 'WatchDog Pro - Application Monitoring Utility',
            icon: exePath,
            iconIndex: 0
        });

        return success;
    } catch (err) {
        log.error('Failed to create shortcut', err);
        return false;
    }
});
