# Project PUTA-Monitor: Drone Flight Permit Visualizer & Airspace Dashboard
### Kantor Otoritas Bandar Udara Wilayah VI (Padang)

**PUTA-Monitor** (*Pesawat Udara Tanpa Awak Monitor*) is a desktop-based application designed for the **Kantor Otoritas Bandar Udara Wilayah VI (Airport Authority Region VI, Padang)** under the Indonesian Ministry of Transportation (Kemenhub). It modernizes, digitizes, and visualizes drone flight permissions and actual flight telemetry logs to ensure compliance with civil aviation safety regulations.

---

## 1. Background & Problem Statement
Under Indonesian aviation frameworks (e.g., PM 37 Tahun 2020), drone operations near aerodromes and controlled airspaces require strict flight authorizations. Historically, these permissions exist in paper-heavy forms or static PDFs, making real-time validation difficult. 

**PUTA-Monitor** bridges this gap by:
1. Converting administrative permit files into interactive geofenced zones.
2. Cross-referencing drone flight paths with airport safety boundary zones (KKOP / *Kawasan Keselamatan Operasi Penerbangan*).
3. Analyzing physical PX4 flight log telemetry files against approved coordinates to ensure pilots did not violate their permit boundaries.

---

## 2. Key Features & Capabilities

### 🗺️ Geospatial Geofence Mapping
* Plots coordinate-based single and MultiPolygons directly from flight permits onto an interactive Leaflet map.
* **Airspace Focus & Isolation Mode**: Isolate active flight permits by hiding or subtly dimming adjacent overlapping airspaces to prevent visual confusion during inspection.
* **Custom Airspace Styling Engine**: Personalize and distinguish operational airspaces using 7 high-contrast aviation presets or custom hex colors with automatic persistence and sidebar synchronization.
* Displays maximum altitude ceilings (standard cap of 400 ft / 120 m AGL) with color-coded safety indicators.
* Integrates airfield KML buffers (e.g., Depati Amir Airport zones) to visualize intersections between flight requests and restricted airport airspace (KKOP 5km/25km zones).

### 📝 Smart Permit Parser & Standardizer
* **Automated PDF Parsing**: Utilizes a Python-based coordinator tool to parse permit documents and map coordinate layouts.
* **Standardized File Synchronization**: Renames and reorganizes uploaded permit PDFs into a clean directory hierarchy by year (e.g., `2024/` and `2025/`) on Google Drive/local networks.

### 📊 Telemetry Log Converter (`.ulg` to CSV/KML/GPX)
* Integrates a dedicated PX4 ULog parser (`ulg_converter.py`) to process flight telemetry logs from drones.
* Extracts critical fields (GPS positions, altitude, battery, IMU telemetry) and exports them to **CSV**, **KML** (Google Earth), or **GPX** tracks.
* Enables inspectors to overlay the actual flight path on top of the approved permit polygon to detect visual border violations.

### ☁️ Cloud Sync & Offline-First Resilience
* Powered by a secure hybrid sync architecture:
  * **Online Mode**: Dynamically fetches and uploads permits and PDF files to **Supabase Database & Storage Buckets**.
  * **Offline Mode**: Automatic fallback to local caching (`permits.json`), allowing inspectors to view registered permits and use tools without an internet connection.
  * Uses **Electron SafeStorage** to encrypt session tokens locally.

### 🔐 Role-Based Security & Management
* Secure Inspector registration and authentication.
* Inspector actions require approval, overseen by system developers/administrators to prevent unauthorized permit alterations.

---

## 3. Technology Stack

### Frontend & Desktop Runtime
* **Electron JS**: Desktop environment enabling native OS integration, local file system read/write, and cross-platform builds.
* **HTML5, Vanilla CSS3, & ES6+ JavaScript**: Lightweight, framework-free frontend designed with modern, sleek dark-mode dashboards and responsive grids.
* **Leaflet.js**: Lightweight open-source map engine for rendering coordinate buffers and flight vectors.

### Backend & Cloud Infrastructure
* **Supabase (PostgreSQL)**: Relational storage for permit metadata, user accounts, and audit profiles.
* **Supabase Storage**: Object storage for secure backups of permit PDF files.
* **Row Level Security (RLS)**: Enforces access control at the database level.

### Data Processing Engines (Python)
* **Python 3**: Back-end scripting engine triggered through Electron IPC (Inter-Process Communication).
* **`pyulog`**: Industry-standard parser library to parse binary drone telemetry logs.
* **Custom KML Generator**: Generates geospatial boundary coordinates for mapping layers.

---

## 4. Key Workflows

```
1. Upload & Parse Permit PDF ──> 2. Standardize & Sync (Google Drive + Supabase) 
                                           │
                                           ▼
3. Import Drone Log (.ulg)   ──> 4. Analyze & Compare (Map Geofence vs. Flight Path)
```

1. **Permit Registration**: An inspector uploads a drone permit. The application parses it, standardizes the filename, copies it to the synced network folder, and pushes it to Supabase.
2. **Geospatial Review**: The map highlights where the drone is permitted to fly alongside local airport KKOP buffers.
3. **Flight Log Audit**: Once the operation is complete, the pilot submits their `.ulg` telemetry file. The inspector parses it to check if the drone stayed within the approved limits (both horizontally and vertically).

---

## 5. Value Proposition
* **Compliance & Safety**: Proactively mitigates unauthorized drone incursions into airport airspaces.
* **Administrative Efficiency**: Eliminates paper storage clutter and speeds up permit lookup using a digital database.
* **Post-Flight Auditability**: Provides hard telemetry evidence of whether a drone stayed within its permitted parameters.
