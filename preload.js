// preload.js - expose safe IPC to renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('watchdog', {
    getApps: () => ipcRenderer.invoke('get-apps'),
    setAutoRestart: (name, autoRestart) => ipcRenderer.invoke('set-auto-restart', { name, autoRestart }),
    onAppStatusUpdated: (callback) => ipcRenderer.on('app-status-updated', (event, data) => callback(data))
});
