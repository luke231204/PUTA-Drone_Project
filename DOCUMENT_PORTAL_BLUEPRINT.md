# 📚 Educational Document Portal (Doc-Gatherer)
## Implementation Blueprint & Development Guide v1.0

This document is a comprehensive, self-contained blueprint for creating a document-gathering desktop/web application that matches the architecture, security patterns, and premium **Sage & Forest** UI/UX design system of the `puta-monitor` system.

---

## 🗺️ System Architecture Overview

The app is built using the same lightweight, high-performance stack:
1. **Frontend**: Pure HTML5, Vanilla JavaScript, Tailwind CSS (via CDN) for utility styling, and custom Vanilla CSS for the theme/components.
2. **Backend/Desktop Wrapper**: Electron (using secure Context Bridge IPC handlers).
3. **Database & Storage**: Supabase (utilizing native HTTPS REST API requests in the main process to minimize dependencies and boost security).
4. **Data Sync**: Real-time cloud-first storage with local fallback caching (`data/documents.json`).

---

## 🗄️ 1. Database Architecture (Supabase SQL & Storage)

Run the following SQL queries in your Supabase SQL Editor to set up the necessary tables, triggers, and Row-Level Security (RLS) policies.

### A. SQL Schema: Profiles & Documents Tables
```sql
-- Enable UUID Generator
create extension if not exists "uuid-ossp";

-- 1. Profiles Table (Tracks user registration and authorization roles)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  role text default 'regular'::text check (role in ('regular', 'inspector', 'dev')),
  approved boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Documents Table (Tracks file metadata and search indexing)
create table if not exists public.documents (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  category text not null check (category in ('Monitoring Kelas', 'Journal Absen', 'Bank Soal')),
  description text,
  year integer not null,
  file_name text not null,
  file_path text not null,
  uploaded_by text not null,
  tags text[] default '{}'::text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexing for high-performance searches and filtering
create index if not exists idx_documents_category on public.documents(category);
create index if not exists idx_documents_year on public.documents(year);
create index if not exists idx_documents_title on public.documents(title);

-- 3. Automatic Profile Creation Trigger
-- Automatically inserts a new profile row when a user registers
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'regular'),
    case 
      -- Dev/Admin emails are auto-approved. Others require manual approval.
      when new.email like '%admin%' or new.email like '%dev%' or new.email = 'lukmanyudand@gmail.com' then true
      else false
    end
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### B. Row-Level Security (RLS) Policies
Enable RLS on tables and storage to restrict modifications to approved accounts only:

```sql
-- Enable RLS
alter table public.profiles enable row level security;
alter table public.documents enable row level security;

-- Profiles Policies
create policy "Allow public read access to approved profiles"
  on public.profiles for select using (true);

create policy "Allow system/dev to update profiles"
  on public.profiles for update using (true);

-- Documents Policies
create policy "Allow all users to read documents"
  on public.documents for select using (true);

create policy "Allow approved inspectors & devs to insert documents"
  on public.documents for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and approved = true and role in ('inspector', 'dev')
    )
  );

create policy "Allow approved inspectors & devs to delete documents"
  on public.documents for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and approved = true and role in ('inspector', 'dev')
    )
  );
```

### C. Storage Bucket Setup
1. In the Supabase Dashboard, go to **Storage**.
2. Create a new **Public Bucket** named `document-files`.
3. Configure RLS Policies for the bucket:
   * **Select (Read)**: Allow anyone (`anon` and `authenticated`) to read.
   * **Insert (Upload)**: Restrict to `authenticated` users where their profile is approved with role `inspector` or `dev`.
   * **Delete**: Restrict to `authenticated` users with `inspector` or `dev` role.
```

---

## 🎨 2. Design System & CSS Stylesheet (`style.css`)

Copy these variables and classes into your stylesheet. It provides the signature **frosted-glass panels, macOS style soft shadows, and Sage & Forest green highlights**:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800&display=swap');

:root {
  /* ---- Colors ---- */
  --bg-app:        #f5f6f4;   /* Soft warm sage off-white */
  --bg-sidebar:    rgba(255, 255, 255, 0.85); /* Frosted glass sidebar */
  --bg-card:       #ffffff;   /* Pure white cards */
  --bg-input:      #ffffff;
  --bg-hover:      #dfe6dc;   /* Light sage hover */
  --bg-selected:   #e8eee5;   /* Selection tint */

  /* ---- Brand Accents ---- */
  --blue:          #4a5d3e;   /* Primary Sage Accent */
  --blue-light:    #e8eee5;   /* Accent selection bg */
  --blue-dark:     #2c3b26;   /* Active state/Hover accent */
  
  --text-primary:   #2a2334;   /* Deep charcoal brand text */
  --text-secondary: #464255;   /* Slate body text */
  --text-tertiary:  #738b68;   /* Cool sage green details */
  
  --border:        rgba(74, 93, 62, 0.12);  /* Fine border line */
  --border-strong: rgba(74, 93, 62, 0.22);
  --border-focus:  #4a5d3e;

  /* ---- Geometry ---- */
  --radius-sm:     10px;
  --radius-md:     14px;
  --radius-lg:     20px;
  
  /* ---- Shadows ---- */
  --shadow-sm:     0 2px 8px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02);
  --shadow-md:     0 4px 16px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.02);
  --shadow-lg:     0 8px 32px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.03);
  --shadow-focus:  0 0 0 3px rgba(74, 93, 62, 0.25);

  --font-family:   'Outfit', 'Inter', -apple-system, sans-serif;
  --ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1); /* Spring transition */
}

body {
  font-family: var(--font-family);
  background-color: var(--bg-app);
  color: var(--text-primary);
  margin: 0;
  overflow: hidden;
}

/* Frosted glass utilities */
.glass-panel {
  background: var(--bg-sidebar);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.glass-panel:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-lg);
}

/* Active navigation buttons inside sidebar */
.nav-item-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  border-left: 4px solid transparent;
}
.nav-item-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}
.nav-item-btn.active {
  background-color: var(--blue-light);
  color: var(--blue);
  border-left: 4px solid var(--blue);
}

/* Card hover animation */
.card-hover-lift {
  transition: transform 0.25s var(--ease-spring), box-shadow 0.22s ease, border-color 0.22s ease;
}
.card-hover-lift:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-strong);
}
```

---

## 🛠️ 3. Electron Backend Core Config

### A. Preload Script (`preload.js`)
Expose the safe wrapper methods to the DOM:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Authentication IPCs
  signUp: (email, password, role) => ipcRenderer.invoke('auth-sign-up', email, password, role),
  signIn: (email, password) => ipcRenderer.invoke('auth-sign-in', email, password),
  getSession: () => ipcRenderer.invoke('auth-get-session'),
  logout: () => ipcRenderer.invoke('auth-logout'),
  
  // Documents Management IPCs
  loadDocs: () => ipcRenderer.invoke('load-docs'),
  saveDoc: (docData, localFilePath) => ipcRenderer.invoke('save-doc', docData, localFilePath),
  deleteDoc: (docId, fileName) => ipcRenderer.invoke('delete-doc', docId, fileName),
  openFile: (fileName) => ipcRenderer.invoke('open-file', fileName)
});
```

### B. IPC Database REST Handlers (`main.js`)
These handlers run in the Node main process and interact directly with Supabase via `fetch`:

```javascript
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let activeSession = null;
const CACHE_FILE = path.join(__dirname, 'data', 'documents.json');
const SESSION_FILE = path.join(__dirname, 'data', 'session.json');

// Initialize Environment Variables
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
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
  }
}
loadEnv();

function getSupabaseHeaders(authRequired = false) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const headers = { 'apikey': key, 'Content-Type': 'application/json' };
  if (authRequired && activeSession && activeSession.access_token) {
    headers['Authorization'] = `Bearer ${activeSession.access_token}`;
  } else {
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}

// 1. SIGN IN
ipcMain.handle('auth-sign-in', async (event, email, password) => {
  const url = `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getSupabaseHeaders(),
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.message || "Login failed");

    // Fetch user profile role
    const profUrl = `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}`;
    const profRes = await fetch(profUrl, { method: 'GET', headers: getSupabaseHeaders() });
    let profile = null;
    if (profRes.ok) {
      const profs = await profRes.json();
      if (profs.length > 0) profile = profs[0];
    }
    
    if (!profile) {
      profile = { id: data.user.id, email: data.user.email, role: 'regular', approved: false };
    }

    activeSession = { access_token: data.access_token, user: data.user, profile };
    
    // Save locally encrypted session
    fs.writeFileSync(SESSION_FILE, JSON.stringify(activeSession));
    return { success: true, session: activeSession };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2. LOAD DOCUMENTS
ipcMain.handle('load-docs', async () => {
  const url = `${process.env.SUPABASE_URL}/rest/v1/documents?select=*`;
  try {
    const res = await fetch(url, { method: 'GET', headers: getSupabaseHeaders(true) });
    if (res.ok) {
      const data = await res.json();
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2)); // update cache
      return data;
    }
  } catch (err) {
    console.warn("Could not sync from Supabase, loading from cache...", err);
  }
  
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
  return [];
});

// 3. UPLOAD & SAVE DOCUMENT
ipcMain.handle('save-doc', async (event, docData, localFilePath) => {
  try {
    // Standardized file naming: Category - Year - Clean Title.pdf
    const cleanTitle = docData.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const standardName = `${docData.category} - ${docData.year} - ${cleanTitle}.pdf`;
    docData.file_name = standardName;
    docData.file_path = `document-files/${standardName}`;
    docData.uploaded_by = activeSession ? activeSession.user.email : 'Unknown';

    // A. Sync to Supabase Table
    const dbUrl = `${process.env.SUPABASE_URL}/rest/v1/documents`;
    const dbRes = await fetch(dbUrl, {
      method: 'POST',
      headers: getSupabaseHeaders(true),
      body: JSON.stringify([docData])
    });
    if (!dbRes.ok) throw new Error("Supabase Database Sync failed: " + await dbRes.text());

    // B. Copy Physical File to Storage Bucket
    const fileBuffer = fs.readFileSync(localFilePath);
    const storageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/document-files/${encodeURIComponent(standardName)}`;
    const storageRes = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(true),
        'Content-Type': 'application/pdf',
        'x-upsert': 'true'
      },
      body: fileBuffer
    });
    if (!storageRes.ok) throw new Error("Supabase Storage upload failed: " + await storageRes.text());

    return { success: true, doc: docData };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 4. DELETE DOCUMENT
ipcMain.handle('delete-doc', async (event, docId, fileName) => {
  try {
    // A. Delete from Supabase Table
    const dbUrl = `${process.env.SUPABASE_URL}/rest/v1/documents?id=eq.${docId}`;
    const dbRes = await fetch(dbUrl, {
      method: 'DELETE',
      headers: getSupabaseHeaders(true)
    });
    if (!dbRes.ok) throw new Error("Supabase DB delete failed.");

    // B. Delete from Storage Bucket
    const storageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/document-files`;
    const storageRes = await fetch(storageUrl, {
      method: 'DELETE',
      headers: getSupabaseHeaders(true),
      body: JSON.stringify({ prefixes: [fileName] })
    });
    if (!storageRes.ok) throw new Error("Supabase Storage file delete failed.");

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 5. VIEW FILE (Local or Cloud Web Stream)
ipcMain.handle('open-file', async (event, fileName) => {
  const cloudUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/document-files/${encodeURIComponent(fileName)}`;
  await shell.openExternal(cloudUrl);
  return { success: true };
});
```

---

## 🏛️ 4. Layout Interface (`index.html`)

Here is the modular structure defining the App Shell. It features the **Auth Gate login screens**, a **main Portal grid** with 3 educational categories, and the **operational view shell**:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Educational Document Portal</title>
  
  <link rel="stylesheet" href="style.css" />
  <!-- Tailwind CSS Utility styling CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="h-screen flex flex-col bg-[#f5f6f4] text-[#2a2334]">

  <!-- ================= AUTH GATE ================= -->
  <div id="auth-gate" class="fixed inset-0 bg-[#f5f6f4] z-[9999] flex items-center justify-center p-6 transition-all duration-300">
    <div class="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-black/5 flex flex-col space-y-6">
      <div class="flex flex-col items-center text-center">
        <div class="w-16 h-16 rounded-[20px] bg-[#4a5d3e]/10 flex items-center justify-center text-3xl mb-4">📚</div>
        <h2 class="text-2xl font-bold tracking-tight">Access Document Hub</h2>
        <p class="text-xs text-gray-500 mt-1">Sign in to manage academic records.</p>
      </div>

      <div id="auth-alert" class="hidden p-3 text-xs font-semibold rounded-2xl border"></div>

      <form id="auth-form" class="space-y-4 text-xs font-semibold text-gray-500" onsubmit="return false;">
        <div class="space-y-1">
          <label class="text-[9px] uppercase font-bold tracking-wider text-gray-400">Email Address</label>
          <input type="email" id="auth-email" class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2.5 text-gray-800 border-none focus:outline-none focus:ring-2 focus:ring-[#4a5d3e]/20" />
        </div>
        <div class="space-y-1">
          <label class="text-[9px] uppercase font-bold tracking-wider text-gray-400">Password</label>
          <input type="password" id="auth-password" class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2.5 text-gray-800 border-none focus:outline-none focus:ring-2 focus:ring-[#4a5d3e]/20" />
        </div>
        <button id="auth-submit-btn" onclick="handleAuthSubmit()" class="w-full py-3 bg-[#4a5d3e] hover:bg-[#2c3b26] text-white font-bold rounded-xl transition-all shadow-md">
          Sign In
        </button>
      </form>
    </div>
  </div>

  <!-- ================= MAIN PORTAL LANDING ================= -->
  <div id="portal-container" class="flex-1 flex flex-col overflow-hidden hidden select-none">
    <!-- Top Nav Header -->
    <nav class="h-14 bg-white/85 backdrop-blur-md border-b border-black/[0.06] px-8 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <span class="text-xl">🏫</span>
        <span class="text-sm font-bold tracking-tight">Doc-Gatherer</span>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right">
          <div id="user-email" class="text-[10px] font-bold text-gray-700">-</div>
          <div id="user-role" class="text-[8px] font-extrabold uppercase text-[#4a5d3e] tracking-wider">-</div>
        </div>
        <button onclick="handleLogout()" class="px-2.5 py-1 text-[10px] font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Logout</button>
      </div>
    </nav>

    <!-- Welcome Hero -->
    <div class="flex flex-col items-center pt-16 pb-8 px-6 text-center">
      <h1 class="text-4xl font-extrabold tracking-tight text-[#2a2334] mb-3">Academic Documentation</h1>
      <p class="text-sm text-[#464255] max-w-md">Retrieve, filter, and modify academic archives in a single secured portal.</p>
    </div>

    <!-- 3 Category Menu Grid -->
    <div class="flex-1 overflow-y-auto px-6 pb-8">
      <div class="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <!-- Category 1: Monitoring Kelas -->
        <div onclick="openWorkspace('Monitoring Kelas')" class="card-hover-lift glass-panel rounded-2xl p-6 cursor-pointer flex flex-col justify-between h-48">
          <div class="space-y-3">
            <div class="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 text-2xl">📈</div>
            <h3 class="text-lg font-bold">Monitoring Kelas</h3>
            <p class="text-xs text-gray-500">Track and view daily class evaluations, learning logs, and progress reports.</p>
          </div>
          <span class="text-xs font-bold text-[#4a5d3e] tracking-wider uppercase">Open Category &rarr;</span>
        </div>

        <!-- Category 2: Journal Absen -->
        <div onclick="openWorkspace('Journal Absen')" class="card-hover-lift glass-panel rounded-2xl p-6 cursor-pointer flex flex-col justify-between h-48">
          <div class="space-y-3">
            <div class="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 text-2xl">📋</div>
            <h3 class="text-lg font-bold">Journal Absen</h3>
            <p class="text-xs text-gray-500">Access student daily roll-calls, attendance records, and leave requests.</p>
          </div>
          <span class="text-xs font-bold text-[#4a5d3e] tracking-wider uppercase">Open Category &rarr;</span>
        </div>

        <!-- Category 3: Bank Soal -->
        <div onclick="openWorkspace('Bank Soal')" class="card-hover-lift glass-panel rounded-2xl p-6 cursor-pointer flex flex-col justify-between h-48">
          <div class="space-y-3">
            <div class="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 text-2xl">🗂️</div>
            <h3 class="text-lg font-bold">Bank Soal</h3>
            <p class="text-xs text-gray-500">Store and download question papers, exam patterns, and assessment keys.</p>
          </div>
          <span class="text-xs font-bold text-[#4a5d3e] tracking-wider uppercase">Open Category &rarr;</span>
        </div>

      </div>
    </div>
  </div>

  <!-- ================= OPERATIONS WORKSPACE PANEL ================= -->
  <div id="workspace-container" class="flex-1 flex flex-col overflow-hidden hidden">
    <!-- Workspace Header -->
    <header class="h-16 border-b border-black/5 bg-white px-6 flex items-center justify-between shrink-0 shadow-sm">
      <div class="flex items-center gap-3">
        <button onclick="backToPortal()" class="px-3 py-1.5 rounded-xl border text-xs font-bold hover:bg-gray-50 flex items-center gap-1">
          <span>&larr;</span> Back to Portal
        </button>
        <span class="w-px h-5 bg-gray-200"></span>
        <h2 id="active-category-title" class="text-base font-extrabold text-gray-800">Monitoring Kelas</h2>
      </div>
      <div>
        <button id="btn-add-doc" onclick="openAddDocModal()" class="bg-[#4a5d3e] hover:bg-[#2c3b26] text-white px-4 py-2 rounded-xl text-xs font-bold hidden flex items-center gap-1.5">
          <span>+</span> Add Document
        </button>
      </div>
    </header>

    <!-- Side-by-Side Panel -->
    <div class="flex-1 flex overflow-hidden">
      <!-- A. Frosted Sidebar list (w-96) -->
      <aside class="w-96 border-r border-black/5 bg-white/70 backdrop-blur-md flex flex-col shrink-0">
        <!-- Search -->
        <div class="p-4 border-b border-black/5">
          <input type="text" id="search-input" oninput="filterDocuments()" placeholder="Search documents or tags..." class="w-full bg-[#e8eee5]/80 rounded-xl px-3 py-2 text-xs text-[#2a2334] placeholder-gray-500 focus:outline-none focus:bg-[#e8eee5] font-semibold" />
        </div>
        <!-- Scrollable list of docs -->
        <div id="docs-list" class="flex-grow overflow-y-auto p-4 space-y-2">
          <!-- Populated programmatically -->
        </div>
      </aside>

      <!-- B. Middle Area: Document PDF iframe viewer -->
      <main id="viewer-canvas" class="flex-grow bg-[#dfe6dc]/30 relative flex flex-col items-center justify-center p-6 border-r border-black/5">
        <div class="text-center text-gray-400 select-none">
          <div class="text-4xl mb-2">📄</div>
          <p class="text-xs font-bold">Select a document from the list to view it</p>
        </div>
      </main>

      <!-- C. Right Area: Metadata Inspector (w-80) -->
      <aside class="w-80 bg-white flex flex-col shrink-0 overflow-y-auto p-5 space-y-5 border-l border-black/5">
        <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest border-b pb-2">Document Details</h3>
        <div id="inspector-content" class="text-xs space-y-4 font-semibold text-gray-600">
          <p class="text-gray-400 italic">No details selected.</p>
        </div>
        <div id="inspector-actions" class="pt-4 border-t border-black/5 hidden">
          <button id="btn-delete-doc" class="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl font-bold transition-all text-xs border border-red-200">
            Delete Document
          </button>
        </div>
      </aside>
    </div>
  </div>

  <!-- ================= ADD DOCUMENT MODAL ================= -->
  <div id="add-doc-modal" class="fixed inset-0 bg-black/30 backdrop-blur-sm z-[99999] flex items-center justify-center hidden">
    <div class="bg-white rounded-3xl w-[500px] max-h-[85vh] shadow-2xl border border-black/5 flex flex-col overflow-hidden">
      <div class="p-6 border-b border-black/5 flex items-center justify-between">
        <h2 class="text-base font-bold">Upload Documentation</h2>
        <button onclick="closeAddDocModal()" class="text-gray-400 font-bold hover:text-black">X</button>
      </div>

      <form id="add-doc-form" class="p-6 space-y-4 text-xs font-semibold text-gray-500 overflow-y-auto flex-1" onsubmit="return false;">
        <div class="space-y-1">
          <label class="text-[9px] uppercase font-bold text-gray-400">Document Title *</label>
          <input type="text" id="input-doc-title" required class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2 border-none text-gray-800" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label class="text-[9px] uppercase font-bold text-gray-400">Year *</label>
            <input type="number" id="input-doc-year" value="2026" required class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2 border-none text-gray-800" />
          </div>
          <div class="space-y-1">
            <label class="text-[9px] uppercase font-bold text-gray-400">Category *</label>
            <input type="text" id="input-doc-category" readonly class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2 border-none text-gray-400 select-none" />
          </div>
        </div>
        <div class="space-y-1">
          <label class="text-[9px] uppercase font-bold text-gray-400">Description / Subject</label>
          <textarea id="input-doc-desc" rows="3" class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2 border-none text-gray-800"></textarea>
        </div>
        <div class="space-y-1">
          <label class="text-[9px] uppercase font-bold text-gray-400">Tags (Comma-separated)</label>
          <input type="text" id="input-doc-tags" placeholder="e.g. UTS, Matematika, Kelas X" class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2 border-none text-gray-800" />
        </div>
        <div class="space-y-1">
          <label class="text-[9px] uppercase font-bold text-gray-400">Select PDF File *</label>
          <input type="file" id="input-doc-file" accept="application/pdf" required class="w-full bg-[#f5f6f4] rounded-xl px-3 py-2 border-none" />
        </div>
        <button onclick="submitDocForm()" class="w-full py-3 bg-[#4a5d3e] text-white font-bold rounded-xl hover:bg-[#2c3b26]">
          Save & Sync
        </button>
      </form>
    </div>
  </div>

</body>
</html>
```

---

## 💻 5. Frontend Interaction Script (`renderer.js`)

Copy this core script to orchestrate views, authenticate user accounts, render categories, search documents, and trigger insertions and deletions:

```javascript
let documents = [];
let filteredDocuments = [];
let selectedDocument = null;
let currentCategory = '';
let activeSession = null;

// On Load: Bootstrap session
window.addEventListener('DOMContentLoaded', async () => {
  const sessionRes = await window.api.getSession();
  if (sessionRes && sessionRes.success) {
    activeSession = sessionRes.session;
    showPortal();
  }
});

// Authentication Handling
async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const alertBox = document.getElementById('auth-alert');

  if (!email || !password) {
    alertBox.className = "p-3 text-xs font-semibold rounded-2xl bg-red-50 text-red-600 block";
    alertBox.textContent = "Please fill in all fields.";
    return;
  }

  const res = await window.api.signIn(email, password);
  if (res && res.success) {
    activeSession = res.session;
    document.getElementById('auth-gate').classList.add('hidden');
    showPortal();
  } else {
    alertBox.className = "p-3 text-xs font-semibold rounded-2xl bg-red-50 text-red-600 block";
    alertBox.textContent = res.error || "Authentication failed.";
  }
}

function showPortal() {
  document.getElementById('auth-gate').classList.add('hidden');
  document.getElementById('portal-container').classList.remove('hidden');
  document.getElementById('workspace-container').classList.add('hidden');
  
  document.getElementById('user-email').textContent = activeSession.user.email;
  document.getElementById('user-role').textContent = activeSession.profile.role;
}

async function handleLogout() {
  await window.api.logout();
  activeSession = null;
  document.getElementById('auth-gate').classList.remove('hidden');
  document.getElementById('portal-container').classList.add('hidden');
  document.getElementById('workspace-container').classList.add('hidden');
}

// Switching view categories
async function openWorkspace(categoryName) {
  currentCategory = categoryName;
  document.getElementById('portal-container').classList.add('hidden');
  document.getElementById('workspace-container').classList.remove('hidden');
  document.getElementById('active-category-title').textContent = categoryName;
  
  // Show "Add Document" button only for approved inspectors/devs
  const isInspector = activeSession.profile.role === 'inspector' || activeSession.profile.role === 'dev';
  const isApproved = activeSession.profile.approved === true;
  
  const addBtn = document.getElementById('btn-add-doc');
  if (isInspector && isApproved) {
    addBtn.classList.remove('hidden');
  } else {
    addBtn.classList.add('hidden');
  }

  // Fetch document cache
  documents = await window.api.loadDocs();
  renderDocumentsList();
}

function backToPortal() {
  document.getElementById('portal-container').classList.remove('hidden');
  document.getElementById('workspace-container').classList.add('hidden');
  document.getElementById('viewer-canvas').innerHTML = `
    <div class="text-center text-gray-400 select-none">
      <div class="text-4xl mb-2">📄</div>
      <p class="text-xs font-bold">Select a document from the list to view it</p>
    </div>`;
  selectedDocument = null;
  document.getElementById('inspector-content').innerHTML = `<p class="text-gray-400 italic">No details selected.</p>`;
  document.getElementById('inspector-actions').classList.add('hidden');
}

// Rendering Sidebar list & searching
function renderDocumentsList() {
  const listContainer = document.getElementById('docs-list');
  listContainer.innerHTML = '';
  
  const query = document.getElementById('search-input').value.toLowerCase();
  
  filteredDocuments = documents.filter(doc => {
    const matchCat = doc.category === currentCategory;
    const matchQuery = doc.title.toLowerCase().includes(query) || 
                       (doc.description && doc.description.toLowerCase().includes(query)) ||
                       (doc.tags && doc.tags.some(t => t.toLowerCase().includes(query)));
    return matchCat && matchQuery;
  });

  if (filteredDocuments.length === 0) {
    listContainer.innerHTML = `<div class="text-center text-xs text-gray-400 py-8">No documents found.</div>`;
    return;
  }

  filteredDocuments.forEach(doc => {
    const item = document.createElement('div');
    item.className = `p-3 rounded-xl border border-black/5 hover:bg-[#e8eee5] cursor-pointer transition-colors ${selectedDocument && selectedDocument.id === doc.id ? 'bg-[#e8eee5] border-[#4a5d3e]/20' : 'bg-white'}`;
    item.innerHTML = `
      <div class="font-bold text-xs text-gray-800 truncate">${doc.title}</div>
      <div class="flex items-center justify-between mt-1 text-[9px] text-gray-400 font-bold">
        <span>Year: ${doc.year}</span>
        <span>By: ${doc.uploaded_by.split('@')[0]}</span>
      </div>
    `;
    item.onclick = () => selectDocument(doc);
    listContainer.appendChild(item);
  });
}

function filterDocuments() {
  renderDocumentsList();
}

// Displaying a document
function selectDocument(doc) {
  selectedDocument = doc;
  
  // Highlighting in Sidebar list
  renderDocumentsList();

  // Load PDF inside the iframe
  const cloudUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/document-files/${encodeURIComponent(doc.file_name)}`;
  const canvas = document.getElementById('viewer-canvas');
  canvas.innerHTML = `
    <iframe src="${cloudUrl}" class="w-full h-full rounded-2xl border-none shadow-sm" type="application/pdf"></iframe>
  `;

  // Render Metadata in Inspector
  const inspector = document.getElementById('inspector-content');
  inspector.innerHTML = `
    <div class="space-y-1">
      <span class="text-[9px] text-gray-400 uppercase">Title</span>
      <div class="text-xs text-gray-800 font-bold">${doc.title}</div>
    </div>
    <div class="space-y-1">
      <span class="text-[9px] text-gray-400 uppercase">Category</span>
      <div class="text-xs text-gray-800 font-bold">${doc.category}</div>
    </div>
    <div class="space-y-1">
      <span class="text-[9px] text-gray-400 uppercase">Academic Year</span>
      <div class="text-xs text-gray-800 font-bold">${doc.year}</div>
    </div>
    <div class="space-y-1">
      <span class="text-[9px] text-gray-400 uppercase">Uploaded By</span>
      <div class="text-xs text-gray-800 font-bold">${doc.uploaded_by}</div>
    </div>
    <div class="space-y-1">
      <span class="text-[9px] text-gray-400 uppercase">Description</span>
      <div class="text-xs text-gray-600">${doc.description || '-'}</div>
    </div>
    <div class="space-y-1">
      <span class="text-[9px] text-gray-400 uppercase">Keywords</span>
      <div class="flex flex-wrap gap-1 mt-1">
        ${doc.tags.map(t => `<span class="bg-[#e8eee5] text-[#4a5d3e] text-[9px] px-2 py-0.5 rounded-full font-bold border border-[#4a5d3e]/10">${t}</span>`).join('')}
      </div>
    </div>
  `;

  // Show delete button only if current user is approved creator/dev
  const isAuthorized = activeSession.profile.role === 'inspector' || activeSession.profile.role === 'dev';
  const isApproved = activeSession.profile.approved === true;
  
  const actionsPanel = document.getElementById('inspector-actions');
  if (isAuthorized && isApproved) {
    actionsPanel.classList.remove('hidden');
    const deleteBtn = document.getElementById('btn-delete-doc');
    deleteBtn.onclick = () => handleDelete(doc);
  } else {
    actionsPanel.classList.add('hidden');
  }
}

// Adding & Uploading Documents
function openAddDocModal() {
  document.getElementById('input-doc-category').value = currentCategory;
  document.getElementById('add-doc-modal').classList.remove('hidden');
}

function closeAddDocModal() {
  document.getElementById('add-doc-modal').classList.add('hidden');
  document.getElementById('add-doc-form').reset();
}

async function submitDocForm() {
  const title = document.getElementById('input-doc-title').value.trim();
  const year = parseInt(document.getElementById('input-doc-year').value);
  const description = document.getElementById('input-doc-desc').value.trim();
  const tagsStr = document.getElementById('input-doc-tags').value.trim();
  const fileInput = document.getElementById('input-doc-file');

  if (!title || !year || fileInput.files.length === 0) {
    alert("Please fill all required fields (*) and pick a PDF file.");
    return;
  }

  const file = fileInput.files[0];
  const localFilePath = file.path; // Electron file path property
  const tags = tagsStr ? tagsStr.split(',').map(s => s.trim()) : [];

  const newDoc = { title, year, category: currentCategory, description, tags };
  
  // Call main process to copy and upload
  const res = await window.api.saveDoc(newDoc, localFilePath);
  if (res && res.success) {
    closeAddDocModal();
    // Reload documents list
    documents = await window.api.loadDocs();
    renderDocumentsList();
  } else {
    alert("Error uploading document: " + (res.error || "Unknown error"));
  }
}

// Deleting Document
async function handleDelete(doc) {
  const confirmed = confirm(`Are you sure you want to permanently delete: "${doc.title}"?`);
  if (!confirmed) return;

  const res = await window.api.deleteDoc(doc.id, doc.file_name);
  if (res && res.success) {
    backToPortal();
    documents = await window.api.loadDocs();
    renderDocumentsList();
  } else {
    alert("Delete failed: " + (res.error || "Unknown error"));
  }
}
```

---

## 📋 6. Step-by-Step Installation Checklist

1. **Verify Environment Configuration**:
   Create a `.env` file in the root workspace folder with your project credentials:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-anon-public-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-for-admin-privileges
   ```
2. **Execute Database Setup**:
   Copy and execute the [SQL Schema](#a-sql-schema-profiles--documents-tables) statements directly in your Supabase SQL Editor.
3. **Configure Storage Policy**:
   Open **Supabase Storage Dashboard**, create the `document-files` bucket, and configure policies for the `inspector` & `dev` roles to allow files to be created and purged.
4. **Deploy Application Files**:
   Replace your local code files with the provided [index.html](#4-layout-interface-indexhtml), [style.css](#2-design-system--css-stylesheet-stylecss), [preload.js](#a-preload-script-preloadjs), [main.js](#b-ipc-database-rest-handlers-mainjs), and [renderer.js](#5-frontend-interaction-script-rendererjs) templates.
5. **Run the Portal locally**:
   Open a terminal and launch the desktop Electron framework:
   ```bash
   npm run start
   ```
