// src/main.ts - Robust & Stable WatchDog Pro Backend
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
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
}

interface WatchDogConfig {
    apps: AppEntry[];
    interval: number;
    logRetentionDays: number;
}

let config: WatchDogConfig = { apps: [], interval: 5, logRetentionDays: 1 };
let mainWindow: BrowserWindow | null = null;
let monitorTimer: NodeJS.Timeout | null = null;
let isChecking = false; // Prevent overlapping checks

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            config = JSON.parse(data);
            if (!config.interval) config.interval = 5;
            if (config.logRetentionDays === undefined) config.logRetentionDays = 1;
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

        // Prune logs older than config.logRetentionDays
        const retentionMs = config.logRetentionDays * 24 * 60 * 60 * 1000;
        logs = logs.filter((l: any) => {
            // If it doesn't have rawTime (legacy), we keep it for now but it will eventually be pushed out if we had a count limit
            // But better to just keep it if we can't tell, or use the 50 limit as fallback
            if (!l.rawTime) return true;
            return (now - l.rawTime) < retentionMs;
        });

        // Also keep a hard limit of 500 logs to prevent file bloat even with long retention
        if (logs.length > 500) logs = logs.slice(0, 500);

        fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2));
        mainWindow?.webContents.send('logs-updated', logs);
    } catch (err) {
        log.error('Failed to write log', err);
    }
}

/**
 * Check if a process is running with high precision
 */
async function isProcessRunning(appPath: string): Promise<boolean> {
    const basename = path.basename(appPath).toLowerCase();

    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            // Use CSV format to get full names without truncation
            exec(`tasklist /FO CSV /NH /FI "IMAGENAME eq ${basename}"`, (err, stdout) => {
                if (err) {
                    resolve(true);
                    return;
                }
                // CSV format wraps in "votes". If running, output will contain "basename"
                const isRunning = stdout.toLowerCase().includes(basename);
                resolve(isRunning);
            });
        });
    }

    try {
        const processes = await psList();
        return processes.some(p => p.name.toLowerCase() === basename);
    } catch (e) {
        return true;
    }
}

/**
 * Launch an app and mark it as "Recently Restarted" to prevent double-starts
 */
function launchApp(appItem: AppEntry) {
    try {
        const appDir = path.dirname(appItem.path);
        log.info(`Launching ${appItem.name}...`);

        appItem.lastRestartTime = Date.now(); // Mark time of restart

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
        const running = await isProcessRunning(appItem.path);
        const oldStatus = appItem.status;

        // SAFETY: If we JUST restarted this app (within 10 seconds), skip checking it.
        // This gives the app time to appear in the task list.
        if (appItem.lastRestartTime && (now - appItem.lastRestartTime < 10000)) {
            if (running) {
                appItem.lastRestartTime = 0; // App is up, clear cooldown
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
                // Double check to prevent overlapping restart triggers
                if (appItem.status !== 'restarted') {
                    appItem.restartCount = (appItem.restartCount || 0) + 1;
                    addLogEntry(appItem.id, appItem.name, `Auto-Restarting... (Count: ${appItem.restartCount})`);
                    launchApp(appItem);
                    appItem.status = 'restarted';
                    changed = true;
                    saveConfig(); // Persist the new count
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
    // Check every 2 seconds for high responsiveness, but our logic prevents spam
    monitorTimer = setInterval(checkApps, config.interval * 1000);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        title: 'WatchDog Pro',
        autoHideMenuBar: true,
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

app.whenReady().then(() => {
    loadConfig();
    pruneLogs();
    createWindow();
    startMonitoring();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

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
        restartCount: 0
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
    // Notify renderer that logs might have changed
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
