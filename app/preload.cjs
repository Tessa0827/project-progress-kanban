'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kanbanDesktop', {
  platform: process.platform,
  setView: view => ipcRenderer.invoke('kanban:set-view', view),
  onViewChanged: handler => {
    const listener = (_event, view) => handler(view);
    ipcRenderer.on('kanban:view-changed', listener);
    return () => ipcRenderer.removeListener('kanban:view-changed', listener);
  },
  loadState: () => ipcRenderer.sendSync('kanban:load'),
  saveState: (state, recover = false) => ipcRenderer.sendSync('kanban:save', state, recover),
  chooseFiles: () => ipcRenderer.invoke('kanban:choose-files'),
  droppedFiles: files => {
    const paths = Array.from(files, file => webUtils.getPathForFile(file)).filter(Boolean);
    return ipcRenderer.invoke('kanban:describe-files', paths);
  },
  openFile: (taskId, refId) => ipcRenderer.invoke('kanban:open-file', taskId, refId),
  revealFile: (taskId, refId) => ipcRenderer.invoke('kanban:reveal-file', taskId, refId),
  importData: () => ipcRenderer.invoke('kanban:import'),
  exportData: state => ipcRenderer.invoke('kanban:export', state),
  revealData: () => ipcRenderer.invoke('kanban:reveal-data')
});

ipcRenderer.on('kanban:menu', (_event, action) => {
  if (action === 'import') document.getElementById('openBtn')?.click();
  if (action === 'export') document.getElementById('saveBtn')?.click();
});
