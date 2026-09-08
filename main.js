const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Chromium Cache & GPU Lock Fix ─────────────────────────────────────────────
// Disable GPU shader cache to eliminate Windows (0x5) "Access is denied"
// race conditions caused when Chromium instances initialize disk caches.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
// ─────────────────────────────────────────────────────────────────────────────

function createWindow() {
  const iconPath = path.join(__dirname, 'Logo', 'logo drone new.png');

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "PUTA-Monitor (Airport Authority Region VI)",
    icon: iconPath,
    backgroundColor: '#0f172a', // sleek tailwind slate-900 background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load the dashboard layout
  mainWindow.loadFile('index.html');


  // Open devtools so we can debug auth issues
  // mainWindow.webContents.openDevTools();

  // Add F12 / Ctrl+Shift+I shortcuts to toggle DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      const isF12 = input.key === 'F12';
      const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i';
      if (isF12 || isCtrlShiftI) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    }
  });
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

// Session Storage Helper (secure encryption fallback)
const SESSION_FILE = path.join(__dirname, 'data', 'session.json');
let activeSession = null;

function saveSession(sessionData) {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const raw = JSON.stringify(sessionData);
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(raw);
      fs.writeFileSync(SESSION_FILE, encrypted);
    } else {
      fs.writeFileSync(SESSION_FILE, raw, 'utf8');
    }
  } catch (err) {
    console.error("Failed to save session:", err);
  }
}

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encrypted = fs.readFileSync(SESSION_FILE);
        try {
          const decrypted = safeStorage.decryptString(encrypted);
          return JSON.parse(decrypted);
        } catch (decryptErr) {
          console.warn("[Session] Stored session belongs to a different device or encryption key changed. Clearing old session.");
          clearSession();
          return null;
        }
      } else {
        const raw = fs.readFileSync(SESSION_FILE, 'utf8');
        return JSON.parse(raw);
      }
    }
  } catch (err) {
    console.error("Failed to load session:", err);
  }
  return null;
}

function clearSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch (err) {
    console.error("Failed to clear session:", err);
  }
}

function getSupabaseHeaders(authRequired = false) {
  loadEnv();
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    'apikey': supabaseKey,
    'Content-Type': 'application/json'
  };
  if (authRequired && activeSession && activeSession.access_token) {
    headers['Authorization'] = `Bearer ${activeSession.access_token}`;
  } else if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    headers['Authorization'] = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
  } else {
    headers['Authorization'] = `Bearer ${supabaseKey}`;
  }
  return headers;
}

// IPC Handler to load permits (cloud-first with local fallback cache)
ipcMain.handle('load-permits', async () => {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  const permitsPath = path.join(__dirname, 'data', 'permits.json');

  if (activeSession && supabaseUrl) {
    const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/permits?select=*`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: getSupabaseHeaders(true),
        signal: AbortSignal.timeout(3000) // Fast 3s timeout to prevent UI lag on network delay
      });
      if (res.ok) {
        const data = await res.json();
        // Update local file cache
        const dir = path.dirname(permitsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(permitsPath, JSON.stringify(data, null, 2), 'utf8');
        return data;
      }
    } catch (err) {
      console.warn("Failed to fetch permits from Supabase, loading from local cache:", err);
    }
  }

  // Fallback to local cache
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

// IPC Auth Handlers
ipcMain.handle('auth-sign-up', async (event, email, password, role) => {
  console.log(`[IPC] auth-sign-up called: email=${email}, role=${role}`);
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[IPC] auth-sign-up failed: Supabase not configured");
    return { success: false, error: "Supabase not configured." };
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/signup`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getSupabaseHeaders(),
      body: JSON.stringify({
        email,
        password,
        data: { role }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.message || `Status ${res.status}`);
    console.log(`[IPC] auth-sign-up successful for ${email}`);
    return { success: true, data };
  } catch (err) {
    console.error("[IPC] auth-sign-up error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth-sign-in', async (event, email, password) => {
  console.log(`[IPC] auth-sign-in called: email=${email}`);
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[IPC] auth-sign-in failed: Supabase not configured");
    return { success: false, error: "Supabase not configured." };
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getSupabaseHeaders(),
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || `Status ${res.status}`);

    console.log(`[IPC] auth-sign-in token acquired for ${email}. Fetching profile...`);

    // Fetch Profile from DB (if it exists)
    const profileUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?id=eq.${data.user.id}`;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    const profRes = await fetch(profileUrl, {
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });

    let profile = null;
    if (profRes.ok) {
      const profData = await profRes.json();
      if (profData && profData.length > 0) {
        profile = profData[0];
        console.log(`[IPC] Profile loaded from DB: role=${profile.role}, approved=${profile.approved}`);
      }
    }

    // Fallback profile if database triggers are missing or RLS prevents fetching
    if (!profile) {
      console.log(`[IPC] Profile not found in database. Reconstructing from metadata fallback...`);
      const metaRole = data.user.user_metadata ? data.user.user_metadata.role : 'regular';

      // Auto-bootstrap any admin/dev email as dev, others get metadata role
      const assignedRole = (email === 'admin@puta.com' || email === 'lukmanyudand@gmail.com' || email.includes('admin') || email.includes('dev')) ? 'dev' : metaRole;
      profile = { id: data.user.id, email: data.user.email, role: assignedRole, approved: true };
      console.log(`[IPC] Fallback profile generated: role=${assignedRole}, approved=true`);
    } else if (email === 'lukmanyudand@gmail.com') {
      profile.role = 'dev';
      profile.approved = true;
    }

    activeSession = {
      access_token: data.access_token,
      user: data.user,
      profile: profile
    };

    saveSession(activeSession);
    console.log(`[IPC] auth-sign-in success for ${email}!`);
    return { success: true, session: activeSession };
  } catch (err) {
    console.error("[IPC] auth-sign-in error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth-get-session', async () => {
  console.log("[IPC] auth-get-session called");
  if (activeSession) {
    console.log("[IPC] auth-get-session: active session in-memory");
    return { success: true, session: activeSession };
  }
  const saved = loadSession();
  if (saved && saved.access_token) {
    // If the saved session already contains a valid profile, return it INSTANTLY (0ms delay)
    // so the app feels snappy and doesn't block UI waiting for network timeouts.
    if (saved.profile) {
      console.log(`[IPC] auth-get-session: instant restore from local cache for ${saved.user?.email || 'user'}`);
      activeSession = saved;
      
      // Background non-blocking profile sync (fire and forget)
      loadEnv();
      const supabaseUrl = process.env.SUPABASE_URL;
      if (supabaseUrl && saved.user?.id) {
        const profileUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?id=eq.${saved.user.id}`;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        fetch(profileUrl, {
          method: 'GET',
          headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
          signal: AbortSignal.timeout(2000)
        }).then(res => res.ok ? res.json() : null)
          .then(profData => {
            if (profData && profData.length > 0) {
              saved.profile = profData[0];
              if (saved.user.email === 'lukmanyudand@gmail.com') {
                saved.profile.role = 'dev';
                saved.profile.approved = true;
              }
              activeSession = saved;
              saveSession(activeSession);
              console.log("[IPC] Background profile sync completed.");
            }
          }).catch(() => {});
      }
      return { success: true, session: activeSession };
    }

    // Fallback only if saved session somehow has no profile yet
    console.log("[IPC] auth-get-session: generating fallback profile for saved session...");
    const metaRole = saved.user?.user_metadata ? saved.user.user_metadata.role : 'regular';
    const assignedRole = (saved.user?.email === 'admin@puta.com' || saved.user?.email === 'lukmanyudand@gmail.com' || saved.user?.email?.includes('admin') || saved.user?.email?.includes('dev')) ? 'dev' : metaRole;
    saved.profile = { id: saved.user?.id, email: saved.user?.email, role: assignedRole, approved: true };
    activeSession = saved;
    saveSession(activeSession);
    return { success: true, session: activeSession };
  }
  console.log("[IPC] auth-get-session: no active or saved session found");
  return { success: false };
});

ipcMain.handle('auth-logout', async () => {
  activeSession = null;
  clearSession();
  return { success: true };
});

ipcMain.handle('auth-get-pending', async () => {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return { success: false, error: "Supabase not configured." };
  if (!activeSession || activeSession.profile.role !== 'dev') {
    return { success: false, error: "Unauthorized access." };
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?role=eq.inspector&approved=eq.false&select=*`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getSupabaseHeaders(true)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Status ${res.status}`);
    return { success: true, list: data };
  } catch (err) {
    console.error("Get pending inspectors error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth-approve-inspector', async (event, userId) => {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return { success: false, error: "Supabase not configured." };
  if (!activeSession || activeSession.profile.role !== 'dev') {
    return { success: false, error: "Unauthorized access." };
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?id=eq.${userId}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: getSupabaseHeaders(true),
      body: JSON.stringify({ approved: true })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || `Status ${res.status}`);
    }
    return { success: true };
  } catch (err) {
    console.error("Approve inspector error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth-get-all-profiles', async () => {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return { success: false, error: "Supabase not configured." };

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?select=*`;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Status ${res.status}`);
    return { success: true, list: data };
  } catch (err) {
    console.error("Get all profiles error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth-update-profile', async (event, userId, updates) => {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return { success: false, error: "Supabase not configured." };

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?id=eq.${userId}`;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || `Status ${res.status}`);
    }
    return { success: true };
  } catch (err) {
    console.error("Update profile error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sys-get-diagnostics', async () => {
  loadEnv();
  const gdrive = findGDriveFolder();
  const permitsPath = path.join(__dirname, 'data', 'permits.json');
  let cacheSize = 0;
  if (fs.existsSync(permitsPath)) {
    cacheSize = fs.statSync(permitsPath).size;
  }
  return {
    success: true,
    gdrivePath: gdrive || "Not found",
    supabaseUrl: process.env.SUPABASE_URL || "Not configured",
    hasServiceKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY),
    cacheSize: cacheSize
  };
});

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

function cleanFilenameStr(s) {
  return s.replace(/[\/*?:"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

async function syncToSupabase(newPermit, localFilePath) {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.warn("Supabase credentials not configured, skipping real-time cloud sync.");
    return;
  }

  const sanitizedUrl = supabaseUrl.replace(/\/$/, '');

  // 1. Upload Database Record
  try {
    const dbUrl = `${sanitizedUrl}/rest/v1/permits`;
    const dbResponse = await fetch(dbUrl, {
      method: 'POST',
      headers: getSupabaseHeaders(true),
      body: JSON.stringify([newPermit])
    });
    if (!dbResponse.ok) {
      const errText = await dbResponse.text();
      console.error("Database sync failed:", errText);
      throw new Error(`Database sync returned status ${dbResponse.status}: ${errText}`);
    }
    console.log("Database record synced successfully.");
  } catch (err) {
    console.error("Error syncing database record:", err);
    throw err;
  }

  // 2. Upload PDF file to Storage Bucket
  try {
    const fileBuffer = fs.readFileSync(localFilePath);
    const storagePath = `${newPermit.year}/${encodeURIComponent(newPermit.file_name)}`;
    const storageUrl = `${sanitizedUrl}/storage/v1/object/permit-pdfs/${storagePath}`;
    const storageResponse = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(true),
        'Content-Type': 'application/pdf',
        'x-upsert': 'true'
      },
      body: fileBuffer
    });
    if (!storageResponse.ok) {
      const errText = await storageResponse.text();
      console.error("Storage sync failed:", errText);
      throw new Error(`Storage upload returned status ${storageResponse.status}: ${errText}`);
    }
    console.log("PDF file uploaded to Storage successfully.");
  } catch (err) {
    console.error("Error uploading PDF to Storage:", err);
    throw err;
  }
}

// IPC Handler to save a new permit into permits.json
ipcMain.handle('save-permit', async (event, newPermit, localFilePath) => {
  const permitsPath = path.join(__dirname, 'data', 'permits.json');
  try {
    // 1. Auto-generate standardized filename
    const opClean = cleanFilenameStr(newPermit.operator_name || 'Unknown');
    const locClean = cleanFilenameStr(newPermit.location || 'Unknown');
    const numClean = cleanFilenameStr((newPermit.permit_id || 'Unknown').split('/')[0]);
    const standardizedName = `${newPermit.year} - ${opClean} - ${locClean} - ${numClean}.pdf`;

    newPermit.file_name = standardizedName;

    // 2. Copy physical file locally to GDrive or fallback local folder
    const gdrive = findGDriveFolder();
    let targetPath = '';

    if (gdrive) {
      let relDir = '';
      if (newPermit.year === 2024) relDir = '2024';
      else if (newPermit.year === 2025) relDir = '2025';
      targetPath = path.join(gdrive, relDir, standardizedName);
      fs.copyFileSync(localFilePath, targetPath);
      console.log(`Copied new PDF to local Google Drive: ${targetPath}`);
    } else {
      const fallbackDir = path.join(__dirname, '6. KOBU VI - PADANG');
      let relDir = '';
      if (newPermit.year === 2024) relDir = '2024';
      else if (newPermit.year === 2025) relDir = '2025';
      const targetDir = path.join(fallbackDir, relDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      targetPath = path.join(targetDir, standardizedName);
      fs.copyFileSync(localFilePath, targetPath);
      console.log(`Copied new PDF to local fallback folder: ${targetPath}`);
    }

    // 3. Update local permits.json cache
    let permits = [];
    if (fs.existsSync(permitsPath)) {
      const rawData = fs.readFileSync(permitsPath, 'utf8');
      permits = JSON.parse(rawData);
    }
    permits.push(newPermit);
    fs.writeFileSync(permitsPath, JSON.stringify(permits, null, 2), 'utf8');
    console.log("Updated local permits.json.");

    // 4. Perform real-time sync with Supabase (Database & Storage)
    await syncToSupabase(newPermit, localFilePath);

    return { success: true, fileName: standardizedName };
  } catch (error) {
    console.error("Failed to save new permit:", error);
    return { success: false, error: error.message };
  }
});

// Helper function to sync NOTAM to Supabase Cloud
async function syncNotamToSupabase(permit, notamFilePath) {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.warn("Supabase credentials not configured, skipping NOTAM cloud sync.");
    return;
  }

  const sanitizedUrl = supabaseUrl.replace(/\/$/, '');

  // 1. Upload NOTAM PDF to 'notam-pdfs' storage bucket
  try {
    const fileBuffer = fs.readFileSync(notamFilePath);
    const storagePath = encodeURIComponent(permit.notam_file);
    const storageUrl = `${sanitizedUrl}/storage/v1/object/notam-pdfs/${storagePath}`;
    const uploadRes = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true'
      },
      body: fileBuffer
    });
    if (!uploadRes.ok) {
      console.warn("NOTAM Storage upload warning:", await uploadRes.text());
    } else {
      console.log(`Uploaded NOTAM ${permit.notam_file} to Supabase notam-pdfs storage bucket.`);
    }
  } catch (err) {
    console.warn("Failed to upload NOTAM to Storage:", err.message);
  }

  // 2. Update Database Record in 'permits' table
  try {
    const dbUrl = `${sanitizedUrl}/rest/v1/permits?permit_id=eq.${encodeURIComponent(permit.permit_id)}`;
    const updateBody = {
      notam_file: permit.notam_file,
      notam_reference: permit.notam_reference,
      coordinates: permit.coordinates,
      max_altitude_ft: permit.max_altitude_ft,
      altitude_ceiling_note: permit.altitude_ceiling_note
    };
    const patchRes = await fetch(dbUrl, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updateBody)
    });
    if (!patchRes.ok) {
      console.warn("Permit NOTAM PATCH warning:", await patchRes.text());
    } else {
      console.log(`Updated permit ${permit.permit_id} in Supabase with NOTAM metadata.`);
    }
  } catch (err) {
    console.warn("Failed to update permit in Supabase:", err.message);
  }
}

// IPC Handler to attach a NOTAM PDF to an existing permit
ipcMain.handle('attach-notam', async (event, permitId, localFilePath) => {
  try {
    const permitsPath = path.join(__dirname, 'data', 'permits.json');
    if (!fs.existsSync(permitsPath)) {
      throw new Error("permits.json does not exist.");
    }
    const permits = JSON.parse(fs.readFileSync(permitsPath, 'utf8'));
    const permitIndex = permits.findIndex(p => p.permit_id === permitId);
    if (permitIndex === -1) {
      throw new Error(`Permit with ID ${permitId} not found.`);
    }

    // 1. Parse NOTAM to extract real coordinates, NOTAM ID & altitude ceiling
    const { execFile } = require('child_process');
    const pythonScript = path.join(__dirname, 'convert_to_kml.py');
    const parsedData = await new Promise((resolve) => {
      execFile('python', [pythonScript, localFilePath], (error, stdout, stderr) => {
        if (error) {
          console.warn("Could not parse NOTAM geometry:", stderr || error.message);
          resolve(null);
          return;
        }
        try {
          const trimmed = stdout.trim();
          const s = trimmed.indexOf('{');
          const e = trimmed.lastIndexOf('}');
          if (s !== -1 && e !== -1) {
            resolve(JSON.parse(trimmed.substring(s, e + 1)));
          } else {
            resolve(null);
          }
        } catch (err) {
          resolve(null);
        }
      });
    });

    // 2. Standardized File Naming: e.g. "B0598_26 NOTAMN - PT Timah Tbk - 0015.pdf"
    const permit = permits[permitIndex];
    const rawNotamCode = (parsedData && parsedData.permit_id) ? parsedData.permit_id : 'NOTAM';
    const notamCodeClean = cleanFilenameStr(rawNotamCode);
    const opClean = cleanFilenameStr(permit.operator_name || 'Operator');
    const numClean = cleanFilenameStr((permit.permit_id || 'Unknown').split('/')[0]);
    const standardizedNotamName = `${notamCodeClean} - ${opClean} - ${numClean}.pdf`;

    // 3. Save copy to project Notam directory with standardized name
    const notamDir = path.join(__dirname, 'Notam');
    if (!fs.existsSync(notamDir)) {
      fs.mkdirSync(notamDir, { recursive: true });
    }
    const destPath = path.join(notamDir, standardizedNotamName);
    fs.copyFileSync(localFilePath, destPath);

    // 4. Update permit fields
    permit.notam_file = standardizedNotamName;
    if (parsedData && parsedData.success) {
      permit.notam_reference = parsedData.permit_id || rawNotamCode;
      if (parsedData.coordinates && parsedData.coordinates.length > 0) {
        // If permit has location Belitung or Bangka, pick the matching area if multi-area
        if (parsedData.areas && parsedData.areas.length > 1) {
          const locLower = (permit.location || '').toLowerCase();
          let matchedArea = parsedData.areas.find(a => locLower.includes(a.name.toLowerCase().replace(' area', '')));
          if (matchedArea) {
            permit.coordinates = matchedArea.coordinates;
          } else {
            permit.coordinates = parsedData.areas[0].coordinates;
          }
        } else {
          permit.coordinates = parsedData.coordinates;
        }
      }
      if (parsedData.max_altitude_ft) {
        permit.max_altitude_ft = parsedData.max_altitude_ft;
      }
      if (parsedData.upper_limit) {
        permit.altitude_ceiling_note = parsedData.upper_limit;
      }
    } else {
      permit.notam_reference = notamCodeClean;
    }

    permits[permitIndex] = permit;
    fs.writeFileSync(permitsPath, JSON.stringify(permits, null, 2), 'utf8');

    // 4. Automatic Cloud Sync to Supabase (Database & notam-pdfs Storage Bucket)
    await syncNotamToSupabase(permit, destPath);

    return {
      success: true,
      notam_file: permit.notam_file,
      notam_reference: permit.notam_reference,
      coordinates_count: permit.coordinates ? permit.coordinates.length : 0,
      max_altitude_ft: permit.max_altitude_ft
    };
  } catch (error) {
    console.error("Failed to attach NOTAM:", error);
    return { success: false, error: error.message };
  }
});

// IPC Handler to open attached NOTAM file
ipcMain.handle('open-notam', async (event, notamFile) => {
  try {
    const notamPath = path.join(__dirname, 'Notam', notamFile);
    if (fs.existsSync(notamPath)) {
      const err = await shell.openPath(notamPath);
      if (!err) return { success: true, openedLocally: true };
    }

    // Cloud fallback from Supabase Storage
    loadEnv();
    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl) {
      const sanitizedUrl = supabaseUrl.replace(/\/$/, '');
      const cloudUrl = `${sanitizedUrl}/storage/v1/object/public/notam-pdfs/${encodeURIComponent(notamFile)}`;
      await shell.openExternal(cloudUrl);
      return { success: true, openedLocally: false };
    }

    return { success: false, error: "NOTAM file not found locally or in cloud." };
  } catch (err) {
    return { success: false, error: err.message };
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
        const trimmed = stdout.trim();
        const jsonStart = trimmed.indexOf('{');
        const jsonEnd = trimmed.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error("No JSON object found in stdout");
        }
        const cleanJson = trimmed.substring(jsonStart, jsonEnd + 1);
        const result = JSON.parse(cleanJson);
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

const { parseDjiLog } = require('./dji_parser');

// IPC Handler to convert & parse DJI Flight Logs (.txt)
ipcMain.handle('convert-dji', async (event, filePath, apiKey, outputDir, formats) => {
  return await parseDjiLog(filePath, apiKey, outputDir, formats);
});

// Universal Smart Autodetect Flight Log Parser (ULog or DJI)
ipcMain.handle('parse-flight-log', async (event, filePath, apiKey, outputDir, formats) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File path not provided or does not exist.' };
    }

    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath).toLowerCase();

    // Check if file is DJI (either .txt extension, or DJIFlightRecord name prefix)
    if (ext === '.txt' || baseName.startsWith('djiflightrecord')) {
      return await parseDjiLog(filePath, apiKey, outputDir, formats);
    }

    // Default to PX4 / Wingtra ULog converter
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
          const lines = stdout.trim().split('\n');
          const lastJson = lines.reverse().find(l => l.trim().startsWith('{'));
          const result = JSON.parse(lastJson || stdout.trim());
          result.drone_brand = 'PX4 / Wingtra';
          resolve(result);
        } catch (err) {
          resolve({ success: false, error: 'Could not parse converter output: ' + stdout.substring(0, 500) });
        }
      });
    });
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

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

// IPC Handler for native file selection dialog (bypasses Electron webUtils file.path security issues)
ipcMain.handle('dialog-select-file', async (event, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    title: options.title || 'Select File'
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  const stats = fs.statSync(filePath);
  return {
    canceled: false,
    filePath: filePath,
    name: path.basename(filePath),
    size: stats.size
  };
});
