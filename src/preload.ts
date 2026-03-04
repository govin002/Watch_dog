import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('watchdog', {
    getConfig: () => ipcRenderer.invoke('get-config'),
    getLogs: () => ipcRenderer.invoke('get-logs'),
    browseFile: () => ipcRenderer.invoke('browse-file'),
    addApp: (app: { name: string, path: string }) => ipcRenderer.invoke('add-app', app),
    removeApp: (id: string) => ipcRenderer.invoke('remove-app', id),
    toggleAutoRestart: (data: { id: string, value: boolean }) => ipcRenderer.invoke('toggle-auto-restart', data),
    updateInterval: (interval: number) => ipcRenderer.invoke('update-interval', interval),
    updateLogRetention: (days: number) => ipcRenderer.invoke('update-log-retention', days),
    openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),

    onStatusUpdate: (callback: (apps: any[]) => void) => {
        const subscription = (_event: IpcRendererEvent, apps: any[]) => callback(apps);
        ipcRenderer.on('status-update', subscription);
        return () => ipcRenderer.removeListener('status-update', subscription);
    },

    onLogsUpdated: (callback: (logs: any[]) => void) => {
        const subscription = (_event: IpcRendererEvent, logs: any[]) => callback(logs);
        ipcRenderer.on('logs-updated', subscription);
        return () => ipcRenderer.removeListener('logs-updated', subscription);
    },
});
