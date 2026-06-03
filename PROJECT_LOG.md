# Project Development Log & System Guide
**PUTA-Monitor: Region VI Drone Permission Visualizer & Airspace Dashboard**

This document serves as the project log and system guide. It details the system architecture, directory sync heuristics, database schema, custom overrides, and coordinate mappings to optimize future token consumption and developer onboarding.

---

## 1. System Architecture

The application is built as an isolated desktop dashboard (Electron + Node.js + HTML5/Vanilla CSS + Leaflet GIS).

```text
  [ syncer: sync-pdf.py ] ──(updates)──> [ data/permits.json ]
                                                    │
                                             (fs.watch auto-reload)
                                                    ▼
 [ renderer.js ] <──(IPC Bridge)── [ main.js (Electron Main Process) ]
       │
       ├─► Render Sidebar Cards (Permit ID, Operator, Location, Pilot, Registry)
       ├─► Render Dynamic Inspector (Countdown timer, CEILING gauge, nearest Tower)
       └─► Render Leaflet Maps (KKOP Safety Buffers, Flight Polygons/Workspace circles)
```

* **[main.js](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/main.js):** Launches Electron and watches `data/permits.json` via `fs.watch`. When the database changes (e.g. from syncer script), the browser window auto-reloads.
* **[renderer.js](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/renderer.js):** Coordinates stats, search, Leaflet layers, and renders details inside `inspector-panel`.
* **[index.html](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/index.html):** Sleek, white Apple-themed layout with Tailwind CSS support.

---

## 2. Sync Engine Heuristics (`sync-pdf.py`)

The [sync-pdf.py](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/sync-pdf.py) script scans folders in Google Drive (`6. KOBU VI - PADANG` with directories `2024`, `2025` and root for `2026`) and parses administrative parameters:

1. **Scanned PDF Detection:** If standard extraction fetches $< 100$ characters, the script triggers a native Windows Media OCR pipeline (`ocr_scanned_pdf`) using Python `winrt` modules.
2. **Dynamic Operator Corrections:** Normalizes parsed operator names (e.g., `PT Timah Tbk`, `PT Agrinas Palma Nusantara`).
3. **Filename Fallback Strategy:** If text/OCR extraction returns empty or matches column layout-shifted garbage headers (e.g., location field gets horizontal columns merged like *"Maksud dan Tujuan Waktu PIC"*), the parser extracts the operator and location directly from the PDF filename (e.g. `(2) Persetujuan PT. Timah Tbk di Pulau Bangka (050825).pdf` maps to Operator: `PT Timah Tbk`, Location: `Pulau Bangka`).
4. **Indonesian Pilot List Splitter:** Splits text by Indonesian date patterns (`18 Desember 2025`) and extracts names preceding `Berlaku sampai`.
5. **Pilot Blocklist Exception:** Standalone filter `'al'` was removed from the blocklist to prevent skipping Indonesian names containing "Al" (e.g. `Al Amin Surya Rahmat`).

---

## 3. Database Schema (`data/permits.json`)

Each permit record contains the following properties:
* `permit_id`: DJPU permit ID (e.g. `0006/APPROVAL-PUTA/DNP-2026`).
* `operator_name`: Cleaned operator name.
* `location`: Operating location (compressor station, province, or area).
* `year`: Operating year (2024, 2025, or 2026).
* `date_start` / `date_end`: Date limits (YYYY-MM-DD).
* `time_start` / `time_end`: Operating hours (e.g. `07:00 WIB`).
* `max_altitude_ft`: Regulatory flight ceiling AGL.
* `coordinates`: Coordinate polygons list. If empty, fallback circles are drawn on map.
* `pilot_name`: Array of verified pilots.
* `puta_registry`: Array of verified aircraft registrations.
* `file_name`: Basename of source PDF.

---

## 4. Custom System Overrides

### A. Ismanto Location Override
* **File:** [sync-pdf.py](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/sync-pdf.py)
* **Rule:** If the operator name is `"Ismanto"` and location parsed from PDF is `"Pl Jabung"`, the parser overrides it to `"Pl Sekernan"`.
* **Reason:** Aligning the permit ID `0036/APPROVAL-PUTA/DNP-2026` coordinates and display mapping with the physical operation area.

### B. Dynamic Emergency Tower Contact Routing
* **File:** [renderer.js](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/renderer.js)
* **Rule:** Maps the permit's `location` string to the nearest AirNav Tower and direct telephone contact:
  * **Jambi / Sekernan / Tungkal / Jabung / Kaos / Bungo:** AirNav Jambi Tower (`+62 (741) 57321`)
  * **Bengkulu:** AirNav Bengkulu Tower (`+62 (736) 21014`)
  * **South Sumatra / Palembang / OKI / Muara Enim / Musi Hutan:** AirNav Palembang Tower (`+62 (711) 385006`)
  * **Belitung:** AirNav Tanjung Pandan Tower (`+62 (719) 21010`)
  * **Bangka / Pangkal Pinang:** AirNav Pangkal Pinang Tower (`+62 (717) 422081`)
  * **West Sumatra / Default:** AirNav Padang Tower (`+62 (751) 81920`)

### C. Workspace Location Coordinates Mapping
* **File:** [renderer.js](file:///c:/Users/lukma/Downloads/Project%20Latsar%20PUTA/renderer.js)
* **Rule:** Added direct geographic mapping for PT TGI pipeline compressor stations to draw precise 6km approximate workspace circles:
  * `"pl bayung"`: `[-2.05, 103.68]`
  * `"pl muaro jambi"`: `[-1.61, 103.61]`
  * `"pl kaos"`: `[-1.43, 103.20]`
  * `"pl sekernan"`: `[-1.40, 103.64]`
  * `"pl jabung"`: `[-1.28, 104.18]`
  * `"pl ro grissik"`: `[-2.35, 103.65]`

---

## 5. Online/Shared Database Setup Guide

To share the database across multiple installations on different laptops, select one of the following architectural approaches:

### Option A: Shared Google Drive / Synced Network Folder (Simple & Free)
If your team uses a synced cloud folder (like Google Drive for Desktop) or a shared network folder in the office:
1. Store the `data/permits.json` file inside the shared directory.
2. In `main.js` and `renderer.js`, change the file loading/saving path to point to that directory (e.g. `G:\\My Drive\\6. KOBU VI - PADANG\\data\\permits.json` or `\\\\192.168.1.100\\share\\permits.json`).
3. Since `main.js` watches the database file, any additions or modifications from one user will automatically sync and reload the dashboard across all running apps instantly.

### Option B: Database-as-a-Service (Supabase / Firebase)
If you require real-time remote updates without local drive syncing:
1. **Supabase (PostgreSQL Backend):**
   * Create a free project at [supabase.com](https://supabase.com).
   * Create a table `permits` with columns matching the fields in `data/permits.json` (JSON columns for coordinates, pilot_name, and puta_registry).
   * Integrate the `@supabase/supabase-js` client library inside `preload.js`/`renderer.js`.
   * Replace local file operations in `main.js` with simple query requests:
     ```javascript
     // Fetch from cloud DB
     const { data, error } = await supabase.from('permits').select('*');
     ```
2. **Firebase Firestore:**
   * Create a Firestore project on Firebase Console.
   * Add a `permits` collection.
   * Use the Firestore web client to query and write records directly from `renderer.js`.

### Option C: Central REST API Server
If you want to host your own dedicated server:
1. Build a basic Express.js server:
   * Endpoint `GET /api/permits`: returns permits from a database.
   * Endpoint `POST /api/permits`: inserts a new permit and returns success.
2. In `main.js`/`renderer.js`, replace the `fs` module reading/writing with standard `fetch('http://your-server-ip/api/permits')` requests.
