const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xingyuanPet', {
  close: () => ipcRenderer.send('xingyuan-pet:close'),
  minimize: () => ipcRenderer.send('xingyuan-pet:minimize'),
  menu: () => ipcRenderer.send('xingyuan-pet:menu'),
  reportAction: action => ipcRenderer.send('xingyuan-pet:action-state', action),
  getSettings: () => ipcRenderer.invoke('xingyuan-pet:settings-get'),
  setSettings: patch => ipcRenderer.invoke('xingyuan-pet:settings-set', patch),
  settingsCommand: (command, value) => ipcRenderer.invoke('xingyuan-pet:settings-command', command, value),
  closeSettings: () => ipcRenderer.send('xingyuan-pet:settings-close'),
  onSettingsChanged: callback => ipcRenderer.on('xingyuan-pet:settings-changed', (_event, state) => callback(state)),
  dragStart: (grab) => ipcRenderer.send('xingyuan-pet:drag-start', grab),
  dragEnd: () => ipcRenderer.send('xingyuan-pet:drag-end'),
  setInputBusy: (busy) => ipcRenderer.send('xingyuan-pet:input-busy', busy),
  pointerResult: (result) => ipcRenderer.send('xingyuan-pet:pointer-result', result),
  pointerMove: (result) => ipcRenderer.send('xingyuan-pet:pointer-move', result),
  getSize: () => ipcRenderer.invoke('xingyuan-pet:get-size'),
  getBehaviour: () => ipcRenderer.invoke('xingyuan-pet:get-behaviour'),
  setSize: (size) => ipcRenderer.invoke('xingyuan-pet:set-size', size),
  closeSizePanel: () => ipcRenderer.send('xingyuan-pet:size-panel-close'),
  getQuota: () => ipcRenderer.invoke('xingyuan-pet:quota-get'),
  setQuota: (options) => ipcRenderer.invoke('xingyuan-pet:quota-set', options),
  refreshQuota: () => ipcRenderer.invoke('xingyuan-pet:quota-refresh'),
  onQuotaChanged: (callback) => {
    ipcRenderer.on('xingyuan-pet:quota-changed', (_event, state) => callback(state));
  },
  onAction: (callback) => {
    ipcRenderer.on('xingyuan-pet:action', (_event, action) => callback(action));
  },
  onSizeChanged: (callback) => {
    ipcRenderer.on('xingyuan-pet:size-changed', (_event, size) => callback(size));
  },
  onHoverChanged: (callback) => {
    ipcRenderer.on('xingyuan-pet:hover-changed', (_event, isInside) => callback(Boolean(isInside)));
  },
  onBehaviourChanged: (callback) => {
    ipcRenderer.on('xingyuan-pet:behaviour-changed', (_event, state) => callback(state));
  },
  onPointerProbe: (callback) => {
    ipcRenderer.on('xingyuan-pet:pointer-probe', (_event, probe) => callback(probe));
  },
});
