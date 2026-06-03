const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "PUTA-Monitor (Airport Authority Region VI)",
    backgroundColor: '#0f172a', // sleek tailwind slate-900 background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load the dashboard layout
  mainWindow.loadFile('index.html');
  
  // Watch for permits.json changes and reload window automatically
  const permitsPath = path.join(__dirname, 'data', 'permits.json');
  let watchTimeout;
  if (fs.existsSync(permitsPath)) {
    fs.watch(permitsPath, (eventType) => {
      if (eventType === 'change') {
        clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
          console.log("permits.json updated on disk. Reloading Electron browser window...");
          mainWindow.reload();
        }, 500); // 500ms debounce
      }
    });
  }

  // Open devtools in development (optional, uncomment if needed)
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Helper to find Google Drive directory
function findGDriveFolder() {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\lukma';
  const candidates = [
    "G:\\My Drive\\6. KOBU VI - PADANG",
    "G:\\Drive Saya\\6. KOBU VI - PADANG",
    path.join(userProfile, "Google Drive\\My Drive\\6. KOBU VI - PADANG"),
    path.join(userProfile, "Google Drive\\Drive Saya\\6. KOBU VI - PADANG"),
    path.join(userProfile, "OneDrive\\Documents\\Project Latsar\\6. KOBU VI - PADANG"),
    "c:\\Users\\lukma\\Downloads\\6. KOBU VI - PADANG",
    path.join(__dirname, "6. KOBU VI - PADANG"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// IPC Handler to load permits.json safely
ipcMain.handle('load-permits', async () => {
  const permitsPath = path.join(__dirname, 'data', 'permits.json');
  try {
    if (fs.existsSync(permitsPath)) {
      const rawData = fs.readFileSync(permitsPath, 'utf8');
      return JSON.parse(rawData);
    }
    return [];
  } catch (error) {
    console.error("Failed to load permits.json:", error);
    return [];
  }
});

// IPC Handler to open PDF reference files
ipcMain.handle('open-pdf', async (event, fileName, year) => {
  try {
    const gdriveBase = findGDriveFolder();
    if (!gdriveBase) {
      return { success: false, error: "Google Drive folder '6. KOBU VI - PADANG' not found on this computer." };
    }

    let relativePath = '';
    const parsedYear = parseInt(year);
    if (parsedYear === 2024) {
      relativePath = path.join('2024', fileName);
    } else if (parsedYear === 2025) {
      relativePath = path.join('2025', fileName);
    } else {
      relativePath = fileName;
    }

    const fullPath = path.join(gdriveBase, relativePath);
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${relativePath}` };
    }

    const err = await shell.openPath(fullPath);
    if (err) {
      return { success: false, error: `Could not open file: ${err}` };
    }
    return { success: true };
  } catch (error) {
    console.error("Error opening PDF:", error);
    return { success: false, error: error.message };
  }
});

// IPC Handler to save a new permit into permits.json
ipcMain.handle('save-permit', async (event, newPermit) => {
  const permitsPath = path.join(__dirname, 'data', 'permits.json');
  try {
    let permits = [];
    if (fs.existsSync(permitsPath)) {
      const rawData = fs.readFileSync(permitsPath, 'utf8');
      permits = JSON.parse(rawData);
    }
    permits.push(newPermit);
    fs.writeFileSync(permitsPath, JSON.stringify(permits, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    console.error("Failed to save new permit:", error);
    return { success: false, error: error.message };
  }
});
