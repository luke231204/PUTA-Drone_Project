const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadPermits: () => ipcRenderer.invoke('load-permits'),
  openPDF: (fileName, year) => ipcRenderer.invoke('open-pdf', fileName, year),
  savePermit: (permitData) => ipcRenderer.invoke('save-permit', permitData),
  convertToKml: (filePath) => ipcRenderer.invoke('convert-to-kml', filePath),
  loadAirportKml: () => ipcRenderer.invoke('load-airport-kml')
});
