# PUTA-Monitor — AI Context & System Guide
**Last Updated:** 2026-06-09 | **Version:** post-cleanup (commit `aefa693`)
**Repo:** https://github.com/luke231204/PUTA-Drone_Project

---

## 1. What This App Is

**PUTA-Monitor** is an Electron desktop dashboard for **Kantor Otoritas Bandar Udara Wilayah VI Padang** (Airport Authority Region VI, Indonesia). It visualizes drone operation permits (PUTA = Pesawat Udara Tanpa Awak) on a Leaflet GIS map and performs regulatory compliance auditing against Indonesian aviation regulations.

**Stack:** Electron + Vanilla JS + Leaflet.js + Chart.js + TailwindCSS CDN + html2canvas. No build step. Run with `npm start` (electron .)

---

## 2. File Map

| File | Role | Size |
|------|------|------|
| `main.js` | Electron main process: creates window, fs.watch on permits.json, IPC handlers | ~185 lines |
| `preload.js` | Context bridge: exposes `window.api` to renderer | 10 lines |
| `renderer.js` | All UI logic, maps, charts, compliance checks | ~2,450 lines |
| `index.html` | HTML skeleton + CDN imports + modal markup | ~625 lines |
| `style.css` | Vanilla CSS: CSS vars, glassmorphism, Leaflet overrides, custom scrollbar, pulse animation | 125 lines |
| `data/permits.json` | Permit database (auto-reloads app via fs.watch when changed) |
| `sync-pdf.py` | Scans Google Drive PDFs, OCRs scanned docs, writes permits.json |
| `convert_to_kml.py` | IPC-called Python script: converts PDF/image → KML |

---

## 3. IPC Bridge (`preload.js` → `main.js`)

| `window.api.*` | IPC Channel | What It Does |
|----------------|-------------|--------------|
| `loadPermits()` | `load-permits` | Reads `data/permits.json`, returns array |
| `openPDF(fileName, year)` | `open-pdf` | Opens permit PDF from Google Drive folder via `shell.openPath` |
| `savePermit(obj)` | `save-permit` | Appends new permit object to `data/permits.json` |
| `convertToKml(filePath)` | `convert-to-kml` | Runs `convert_to_kml.py` via `execFile('python', ...)`, returns JSON |
| `loadAirportKml()` | `load-airport-kml` | Reads KML files from `Airport/Depati Amir/` dir |

---

## 4. Permit Data Schema (`data/permits.json`)

```json
{
  "permit_id": "0006/APPROVAL-PUTA/DNP-2026",
  "operator_name": "PT Transportasi Gas Indonesia",
  "location": "Pl Sekernan",
  "year": 2026,
  "date_start": "2026-01-15",
  "date_end": "2026-12-31",
  "time_start": "07.00 WIB",
  "time_end": "17.30 WIB",
  "max_altitude_ft": 400,
  "coordinates": [[-1.40, 103.64], [-1.41, 103.65]],
  "pilot_name": ["Ahmad Rizky", "Budi Santoso"],
  "puta_registry": ["PUTA-1029"],
  "file_name": "(2) Persetujuan PT TGI di Pl Sekernan (150126).pdf"
}
```

- `coordinates`: polygon points as `[lat, lng]`. If empty array, a 6km fallback circle is drawn using `LOCATION_COORDS` lookup.
- `time_start`/`time_end` format: `"HH.MM WIB"` — cleaned by `(t) => t.split(' ')[0].replace('.', ':')` before parsing.

---

## 5. Key Global State Variables (`renderer.js`)

```javascript
let permits = [];              // All loaded permit objects
let selectedPermit = null;     // Currently selected permit
let map = null;                // Leaflet main map instance
let polygonLayers = {};        // { permit_id: LeafletLayer }
let kkopLayers = [];           // KKOP red ring circle layers
let countdownInterval = null;  // setInterval handle for the live timer
let currentYearFilter = 'All'; // 'All' | 2024 | 2025 | 2026
let currentStatusFilter = 'All'; // 'All' | 'ACTIVE' | 'PENDING' | 'EXPIRED'

// Telemetry Analyzer
let uploadedCsvData = null;    // Parsed CSV: { timeData, speedData, aglData, amslData, coords, maxSpeed, maxAgl, ... }
let uploadedKmlCoords = null;  // Parsed KML: [[lat,lng], ...]
let flightLogData = null;      // Inspector panel log: { permit_id, points, maxAltitude, maxSpeed, altCompliant, speedCompliant, geofenceCompliant, kkopBreached, ... }
let telemetryLimitAgl = 1150;  // Custom AGL limit for Telemetry Analyzer chart lines
let telemetryLimitAmsl = 1150; // Custom AMSL limit
let telemetryLimitSpeed = 100; // Custom speed limit
let telemetryAltLimitMode = 'agl'; // 'agl' | 'amsl'

// Telemetry Analyzer Chart.js instances
let telemetryChartCombinedInstance = null;
let telemetryChartAltitudeInstance = null;
let telemetryChartAmslInstance = null;
let telemetryChartSpeedInstance = null;
let currentActiveTelemetryTab = 'combined';
let telemetryAnalyzerMap = null; // Leaflet map inside Telemetry Analyzer modal
```

---

## 6. Core Function Index (`renderer.js`)

| Function | Lines (approx) | Purpose |
|----------|----------------|---------|
| `initMap()` | ~163 | Create Leaflet map, add CartoDB Positron + ESRI satellite tiles, draw KKOP rings, wire satellite toggle |
| `loadAndRenderData()` | ~227 | IPC call to load permits, sort by year desc, call `renderDashboard()` |
| `getPermitStatus(permit)` | ~246 | Returns `'ACTIVE'` / `'PENDING'` / `'EXPIRED'` based on current local date/time vs permit window |
| `setupEventListeners()` | ~277 | Wire search debounce (300ms), year filter tabs, **status filter tabs**, Add Permit modal buttons |
| `renderDashboard()` | ~318 | Rebuild permit card list + map polygon layers + stats counters. Applies year/status/search filters |
| `selectPermitCard(permit)` | ~477 | Set selectedPermit, re-render dashboard + inspector, fly map to permit bounds |
| `renderInspector()` | ~493 | Build full right-panel HTML for selected permit: status badge, countdown timer, altitude gauge, pilot details, flight log uploader, emergency contacts |
| `startCountdown(permit)` | ~751 | `setInterval` clock that ticks down to permit end (or up to start) |
| `showToast(message, type)` | ~824 | Apple-style slide-in toast notification. types: `'info'` / `'success'` / `'error'` |
| `openAddPermitModal()` | ~875 | Open the Add Permit form modal with defaults |
| `handleAddPermitSubmit(e)` | ~913 | Validate + parse form, call `window.api.savePermit()`, show toast |
| `handleFlightLogUpload(event)` | ~1011 | Read uploaded CSV/KML file, call `parseLogData()`, `runComplianceChecks()`, `plotFlightPath()`, `updateEvaluationStatusUI()` |
| `parseKmlCoordinates(text)` | ~1072 | **Shared helper** — parses KML text, returns longest `<coordinates>` block content. Used by both `parseLogData()` and `processTelemetryKml()` |
| `parseLogData(text, ext)` | ~1105 | Parse CSV or KML flight log into `{ points, maxAltitude, maxSpeed, altitudes, speeds, timestamps }`. Downsamples 1:20 for CSVs |
| `runComplianceChecks()` | ~1207 | Runs 5 checks against `flightLogData`: (1) altitude vs permit ceiling, (2) speed vs 87 knots, (3) geofence polygon/circle, (4) KKOP 5km buffer proximity, (5) daylight + permit time-window |
| `parseTimeToLocal(timeVal)` | ~1348 | Parses `"YYYY-MM-DD HH:MM:SS"` UTC or `"HH:MM"` time strings into local `Date` objects |
| `isPointInCircle(pt, center, r)` | ~1375 | Haversine formula distance check |
| `isPointInPolygon(pt, vs)` | ~1390 | Ray-casting algorithm for polygon containment |
| `plotFlightPath()` | ~1403 | Draw amber dashed polyline on main Leaflet map from `flightLogData.points` |
| `updateEvaluationStatusUI()` | ~1424 | Fill `#log-evaluation-status` DOM with color-coded compliance results |
| `openTelemetryAnalyzer()` | ~1480 | Open Telemetry Analyzer modal |
| `switchTelemetryTab(name)` | ~1508 | Show/hide chart wrapper divs, update active tab button styles |
| `processTelemetryCsv(file)` | ~1617 | Parse DJI/Airdata CSV: detects column indexes, converts units, filters pre-flight rows, calls `renderTelemetryChart()` |
| `processTelemetryKml(file)` | ~1825 | Parse KML path using `parseKmlCoordinates()`, plot on main map, update analyzer UI |
| `handleTelemetryLimitChange()` | ~1891 | Read limit control inputs, update globals, call `updateTelemetryChartsLimits()` |
| `renderTelemetryChart(...)` | ~2020 | Create/destroy 4 Chart.js instances (Combined, AGL, AMSL, Speed) with limit threshold lines |
| `exportTelemetryChart()` | ~2335 | Use html2canvas to export active chart wrapper as HD PNG download |
| `initTelemetryAnalyzerMap()` | ~2358 | Lazy-init Leaflet map inside Telemetry Analyzer modal, plot KML + CSV coordinate layers |
| `updateTelemetryAnalyzerUI()` | ~2437 | Show/hide chart tabs based on what data has been loaded (CSV only, KML only, or both) |

---

## 7. Static Data Constants

### `LOCATION_COORDS` — fallback map coordinates for known locations
Key locations (lowercase string → `[lat, lng]`):
- PT TGI pipeline stations: `"pl bayung"`, `"pl muaro jambi"`, `"pl kaos"`, `"pl sekernan"`, `"pl jabung"`, `"pl ro grissik"`
- Major cities: `"jambi"`, `"palembang"`, `"bengkulu"`, `"padang"`, `"bangka"`, `"belitung"`, `"bungo"`, etc.

### `REGION_AIRPORTS` — All 13 airports under OTBAN Wilayah VI authority
| Code | Name | Province | Lat | Lng |
|------|------|----------|-----|-----|
| PDG | Minangkabau Intl | Sumatera Barat | -0.787999 | 100.28677 |
| RKI | Rokot Sipora | Sumatera Barat | -2.09910 | 99.70580 |
| KRC | Depati Parbo, Kerinci | Sumatera Barat | -2.09222 | 101.46806 |
| MPC | Muko-Muko | Bengkulu | -2.53972 | 101.08778 |
| BKS | Fatmawati Soekarno, Bengkulu | Bengkulu | -3.86128 | 102.33967 |
| ENE | Enggano | Bengkulu | -5.85972 | 102.39444 |
| DJB | Sultan Thaha, Jambi | Jambi | -1.63506 | 103.64601 |
| BUU | Muara Bungo | Jambi | -1.12778 | 102.13472 |
| PLM | SMB II, Palembang | Sumatera Selatan | -2.89615 | 104.70697 |
| PXA | Atung Bungsu, Pagar Alam | Sumatera Selatan | -4.02750 | 103.25000 |
| LLJ | Silampari, Lubuk Linggau | Sumatera Selatan | -3.26278 | 103.12028 |
| PGK | Depati Amir, Pangkal Pinang | Babel | -2.16063 | 106.14173 |
| TJQ | H.AS. Hanandjoeddin, Tanjung Pandan | Babel | -2.74528 | 107.75472 |

Each drawn as a **5 km red dashed ring** on the Leaflet map. All 13 are checked in `runComplianceChecks()` for KKOP proximity.

### `getEmergencyTower(location)` — AirNav tower routing
Maps location string to nearest tower + phone:
- Jambi/Sekernan/Bungo/Kaos/Jabung → AirNav Jambi `+62 (741) 57321`
- Bengkulu → AirNav Bengkulu `+62 (736) 21014`
- Palembang/OKI/Muara Enim/Bayung/Gelam/Dayung/Sumpal → AirNav Palembang `+62 (711) 385006`
- Belitung/SWP → AirNav Tanjung Pandan `+62 (719) 21010`
- Bangka/Pangkal Pinang → AirNav Pangkal Pinang `+62 (717) 422081`
- Default → AirNav Padang `+62 (751) 81920`

---

## 8. Compliance Rules Implemented (from PM 37/2020 + PM 63/2021)

| Check | Rule | Implementation |
|-------|------|---------------|
| Altitude ceiling | Max altitude ≤ permit's `max_altitude_ft` | `flightLogData.altCompliant` |
| Speed limit | Max speed ≤ 87 knots (CASR Part 107) | `flightLogData.speedCompliant` |
| Geofence | All points inside permit polygon or 6km fallback circle | `flightLogData.geofenceCompliant` |
| KKOP corridor | No flight points within 5km of an airport UNLESS inside permit boundary | `flightLogData.kkopBreached` |
| Daylight | All timestamps between 06:00–18:00 local time | `flightLogData.daylightBreached` |
| Permit window | All timestamps within permit's `time_start`–`time_end` | `flightLogData.permitTimeBreached` |

---

## 9. Known Overrides / Custom Business Logic

- **Ismanto location override** (`sync-pdf.py`): If operator=`"Ismanto"` and parsed location=`"Pl Jabung"`, override to `"Pl Sekernan"` (permit 0036/DNP-2026).
- **CSV downsampling**: Inspector panel log upload takes 1 point per 20 rows for performance.
- **Telemetry Analyzer CSV downsampling**: Chart data capped at 600 points max (step-filtered if more).
- **Pre-flight ground filter** (Telemetry Analyzer): Rows with `speed=0 AND agl≤0` are skipped.
- **KML altitude**: KML coordinates have altitude in meters → converted to feet (`× 3.28084`).

---

## 10. Sync Engine (`sync-pdf.py`)

Scans `6. KOBU VI - PADANG/2024`, `/2025`, and root for 2026. For each PDF:
1. Tries standard text extraction. If < 100 chars → triggers WinRT OCR pipeline.
2. Normalizes operator names via correction dict.
3. If text extraction returns garbage → falls back to parsing operator+location from **filename**.
4. Splits pilot names by Indonesian date patterns (e.g. `"18 Desember 2025"`).
5. Blocklist filter strips titles/noise from pilot names, but `'al'` was removed to preserve names like `"Al Amin"`.

---

## 11. Current Clean State (post-cleanup commit `aefa693`)

**Bugs fixed:**
- ✅ `clearInterval` guard was checking function existence (always true) → now checks handle
- ✅ Timezone offset applied wrong direction in `getPermitStatus()` → now uses `toLocaleDateString('en-CA')`
- ✅ Removed ghost listeners for non-existent `#close-report-modal` and `#btn-export-pdf` elements

**Dead code removed:**
- ✅ MapLibre GL JS (was loaded but never used — ~800KB)
- ✅ "3D Viewport" button (no listener)
- ✅ "Show Approach Paths" button (no listener)
- ✅ Hardcoded `c:\Users\lukma\` personal path in `main.js`

**Improvements:**
- ✅ Permit Status filter tabs (All/Active/Pending/Expired) are now fully wired and functional
- ✅ Search input debounced 300ms (was firing on every keystroke)
- ✅ Shared `parseKmlCoordinates()` helper — eliminated duplicate 35-line KML parsing block

---

## 12. How to Start Each New Session Efficiently

Start your message with:
```
@[PROJECT_LOG.md] — [your request here]
```

This gives me full architecture, function index, data schema, compliance rules, and current state in one shot — no need to re-read source files.
