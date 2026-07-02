const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadPermits: () => ipcRenderer.invoke('load-permits'),
  openPDF: (fileName, year) => ipcRenderer.invoke('open-pdf', fileName, year),
  savePermit: (permitData, localFilePath) => ipcRenderer.invoke('save-permit', permitData, localFilePath),
  convertToKml: (filePath) => ipcRenderer.invoke('convert-to-kml', filePath),
  loadAirportKml: () => ipcRenderer.invoke('load-airport-kml'),
  convertUlg: (filePath, outputDir, formats) => ipcRenderer.invoke('convert-ulg', filePath, outputDir, formats),
  signUp: (email, password, role) => ipcRenderer.invoke('auth-sign-up', email, password, role),
  signIn: (email, password) => ipcRenderer.invoke('auth-sign-in', email, password),
  getSession: () => ipcRenderer.invoke('auth-get-session'),
  logout: () => ipcRenderer.invoke('auth-logout'),
  getPendingInspectors: () => ipcRenderer.invoke('auth-get-pending'),
  approveInspector: (userId) => ipcRenderer.invoke('auth-approve-inspector', userId),
  getAllProfiles: () => ipcRenderer.invoke('auth-get-all-profiles'),
  updateProfile: (userId, updates) => ipcRenderer.invoke('auth-update-profile', userId, updates),
  getDiagnostics: () => ipcRenderer.invoke('sys-get-diagnostics'),
});
