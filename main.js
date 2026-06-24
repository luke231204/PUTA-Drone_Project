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

function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, 'data', 'Cred.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const index = trimmed.indexOf('=');
          const key = trimmed.substring(0, index).trim();
          const val = trimmed.substring(index + 1).trim().replace(/^['"]|['"]$/g, '');
          process.env[key] = val;
        }
      });
      break;
    }
  }
}

// IPC Handler to open PDF reference files
ipcMain.handle('open-pdf', async (event, fileName, year) => {
  try {
    const gdriveBase = findGDriveFolder();
    if (gdriveBase) {
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
      if (fs.existsSync(fullPath)) {
        const err = await shell.openPath(fullPath);
        if (!err) {
          return { success: true, openedLocally: true };
        }
        console.warn(`Local file open failed: ${err}, trying cloud URL...`);
      }
    }

    // Fallback: Open Cloud URL
    loadEnv();
    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl) {
      const sanitizedUrl = supabaseUrl.replace(/\/$/, '');
      const cloudUrl = `${sanitizedUrl}/storage/v1/object/public/permit-pdfs/${year}/${encodeURIComponent(fileName)}`;
      await shell.openExternal(cloudUrl);
      return { success: true, openedLocally: false };
    }

    return { 
      success: false, 
      error: "PDF not found locally, and cloud storage (Supabase) is not configured." 
    };
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

// IPC Handler to convert PDF/Image to KML
ipcMain.handle('convert-to-kml', async (event, filePath) => {
  const { execFile } = require('child_process');
  const pythonScript = path.join(__dirname, 'convert_to_kml.py');

  return new Promise((resolve) => {
    execFile('python', [pythonScript, filePath], (error, stdout, stderr) => {
      if (stderr) {
        console.error("Python stderr:", stderr);
      }
      if (error) {
        console.error("Exec error:", error);
        resolve({ success: false, error: stderr || error.message });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (err) {
        console.error("Failed to parse Python stdout:", stdout, err);
        resolve({ success: false, error: "Parser output was not valid JSON: " + stdout });
      }
    });
  });
});

// IPC Handler to convert ULG (PX4 drone log) to CSV/KML/GPX
ipcMain.handle('convert-ulg', async (event, filePath, outputDir, formats) => {
  const { execFile } = require('child_process');
  const pythonScript = path.join(__dirname, 'ulg_converter.py');
  const args = [pythonScript, filePath];
  if (outputDir) args.push(outputDir);
  if (formats && formats.length) args.push(formats.join(','));

  return new Promise((resolve) => {
    execFile('python', args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (stderr) console.error('ULG converter stderr:', stderr);
      if (error) {
        console.error('ULG converter error:', error);
        resolve({ success: false, error: stderr || error.message });
        return;
      }
      try {
        // Find last JSON line (in case there's progress output)
        const lines = stdout.trim().split('\n');
        const lastJson = lines.reverse().find(l => l.trim().startsWith('{'));
        const result = JSON.parse(lastJson || stdout.trim());
        resolve(result);
      } catch (err) {
        resolve({ success: false, error: 'Could not parse converter output: ' + stdout.substring(0, 500) });
      }
    });
  });
});

// IPC Handler to load airport KML files
ipcMain.handle('load-airport-kml', async () => {
  const airportDir = path.join(__dirname, 'Airport', 'Depati Amir');
  try {
    if (fs.existsSync(airportDir)) {
      const files = fs.readdirSync(airportDir);
      const kmlFiles = files.filter(f => f.toLowerCase().endsWith('.kml'));
      const results = kmlFiles.map(filename => {
        const fullPath = path.join(airportDir, filename);
        const content = fs.readFileSync(fullPath, 'utf8');
        return { filename, content };
      });
      return { success: true, files: results };
    }
    return { success: false, error: "Airport/Depati Amir directory not found." };
  } catch (error) {
    console.error("Failed to load airport KML files:", error);
    return { success: false, error: error.message };
  }
});

