// main.js - Electron main process for WatchDog
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const psList = require('ps-list');
const log = require('electron-log');

// Path to the apps configuration file
const configPath = path.join(__dirname, 'apps.json');
let appsConfig = [];
let mainWindow; // reference to the main BrowserWindow

function loadConfig() {
    try {
        const data = fs.readFileSync(configPath, 'utf-8');
        appsConfig = JSON.parse(data);
        log.info('Loaded apps configuration');
    } catch (err) {
        log.error('Failed to load apps configuration', err);
        appsConfig = [];
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        autoHideMenuBar: true, // This hides the menu bar but allows Alt to show it, or we can use setMenu(null)
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.setMenu(null);
    win.loadFile('index.html');
    return win;
}

async function isProcessRunning(appPath) {
    const basename = path.basename(appPath).toLowerCase();
    const processes = await psList();
    return processes.some(p => p.name.toLowerCase() === basename);
}

function launchApp(appPath) {
    try {
        const child = spawn(appPath, [], { detached: true, stdio: 'ignore' });
        child.unref();
        log.info(`Launched ${appPath}`);
    } catch (err) {
        log.error(`Failed to launch ${appPath}`, err);
    }
}

function monitorApps() {
    setInterval(async () => {
        for (const appInfo of appsConfig) {
            const running = await isProcessRunning(appInfo.path);
            if (!running && appInfo.autoRestart) {
                log.info(`${appInfo.name} is not running – restarting...`);
                launchApp(appInfo.path);
                // Notify renderer about state change
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('app-status-updated', { name: appInfo.name, status: 'restarted' });
                }
            } else {
                // Notify renderer about current state
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('app-status-updated', { name: appInfo.name, status: running ? 'running' : 'stopped' });
                }
            }
        }
    }, 5000); // 5‑second interval
}

app.whenReady().then(() => {
    loadConfig();
    mainWindow = createWindow();
    monitorApps();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Expose a simple API to renderer for fetching the config
ipcMain.handle('get-apps', async () => {
    return appsConfig;
});

// Listen for renderer requests to toggle auto‑restart flag
ipcMain.handle('set-auto-restart', async (event, { name, autoRestart }) => {
    const appEntry = appsConfig.find(a => a.name === name);
    if (appEntry) {
        appEntry.autoRestart = autoRestart;
        fs.writeFileSync(configPath, JSON.stringify(appsConfig, null, 2), 'utf-8');
        log.info(`Set autoRestart=${autoRestart} for ${name}`);
        return { success: true };
    }
    return { success: false, error: 'App not found' };
});
