"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("watchdog", {
  getConfig: () => electron.ipcRenderer.invoke("get-config"),
  getLogs: () => electron.ipcRenderer.invoke("get-logs"),
  browseFile: () => electron.ipcRenderer.invoke("browse-file"),
  addApp: (app) => electron.ipcRenderer.invoke("add-app", app),
  removeApp: (id) => electron.ipcRenderer.invoke("remove-app", id),
  toggleAutoRestart: (data) => electron.ipcRenderer.invoke("toggle-auto-restart", data),
  updateInterval: (interval) => electron.ipcRenderer.invoke("update-interval", interval),
  updateLogRetention: (days) => electron.ipcRenderer.invoke("update-log-retention", days),
  openConfigFolder: () => electron.ipcRenderer.invoke("open-config-folder"),
  onStatusUpdate: (callback) => {
    const subscription = (_event, apps) => callback(apps);
    electron.ipcRenderer.on("status-update", subscription);
    return () => electron.ipcRenderer.removeListener("status-update", subscription);
  },
  onLogsUpdated: (callback) => {
    const subscription = (_event, logs) => callback(logs);
    electron.ipcRenderer.on("logs-updated", subscription);
    return () => electron.ipcRenderer.removeListener("logs-updated", subscription);
  }
});
