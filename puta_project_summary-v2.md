# Project PUTA-Monitor (Kantor Otoritas Bandar Udara Wilayah VI)
### Electron-Based Drone Permission Visualizer & Airspace Dashboard

An interactive, desktop-based monitoring dashboard engineered for **Kantor Otoritas Bandar Udara Wilayah VI (Airport Authority Region VI)**. This application digitizes, structures, and visualizes physical PUTA (*Pesawat Udara Tanpa Awak* / Unmanned Aircraft System) flight permits against active airspace restrictions, ensuring enhanced safety compliance under Indonesian Ministry of Transportation (Kemenhub) frameworks.

---

## 1. Project Overview & Motivation
Managing drone operations within the jurisdiction of Airport Authority Region VI requires strict adherence to aviation safety protocols, including **KKOP** (*Kawasan Keselamatan Operasi Penerbangan*) zones and Ministry regulations (e.g., PM 37 Tahun 2020). 

Currently, flight permissions are processed as text-heavy physical papers or static documents. **PUTA-Monitor** bridges this operational gap by translating raw administrative data—such as geographic coordinates, flight time windows, maximum altitudes, and operator licensing—into a scannable, real-time visual desktop dashboard.

### Core Objectives
* **Administrative Digitization:** Transition physical permit parameters into reliable, local digital data sets (JSON/SQLite).
* **Geospatial Visualization:** Plot polygon-based flight zones and maximum altitudes on an interactive map.
* **Active Monitoring:** Dynamically flag permits as *Pending*, *Active*, or *Expired* based on the local time window.
* **Airport Safety Alignment:** Overlay flight paths against critical local airport buffer zones in Region VI.

---

## 2. Technical Architecture & Tech Stack

The application is architected utilizing a modular, local-first paradigm suited for secure airport authority environments.

```text
       +--------------------------------------------+
       |         Electron Main Process              |
       |  (Node.js OS Access / Local File System)   |
       +--------------------------------------------+
                             │
                  IPC (Inter-Process Comm.)
                             │
       +--------------------------------------------+
       |       Electron Renderer Process            |
       |  (Antigravity Framework / Vue / React)     |
       +--------------------------------------------+
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
  [Tailwind UI]       [Leaflet/Mapbox]     [Local Database]
Dashboard Panels     Geospatial Overlays    SQLite / JSON
```

### Stack Components
* **Runtime Environment:** `Electron` (for native cross-platform desktop execution)
* **Frontend Core & App Framework:** `Antigravity` Web Project Stack (HTML5, CSS3, Modern ES6+ JavaScript)
* **Styling Engine:** `TailwindCSS` (for a highly scannable, clean, dark/light grid dashboard layout)
* **Geospatial Engine:** `Leaflet.js` or `Mapbox GL JS` (for polygon coordinates rendering and map layering)
* **Data Tier:** Local structured `JSON` or embedded `SQLite` database (isolated, requiring no complex external server architecture)

---

## 3. Core Dashboard Modules

### A. Operational Map Canvas
* **Interactive Geofencing:** Visualizes authorized operational boundaries using latitude/longitude polygon coordinates.
* **Altitude Mapping:** Color-coded 3D-like status indicators or vertical gauges tracking maximum permitted altitude (e.g., standard ceiling cap of 400 ft / 120 m AGL).
* **Buffer Inclusions:** Pre-rendered reference vectors for local aerodrome restrictions and KKOP zones under Wilayah VI jurisdiction.

### B. Live Permit Status Ticker
* **Temporal Tracking:** Converts the permit's explicit validity period into a dynamic countdown timer.
* **State Machine Indicators:**
    * `🟢 ACTIVE` : Current time falls precisely within authorized flight windows.
    * `🟡 PENDING` : Approved upcoming flights scheduled for a future time slot.
    * `🔴 EXPIRED / VIOLATION` : Current time exceeds authorized limits or operation falls out of boundaries.

### C. Pilot & Drone Verification Panel
* **Credentials Validation:** Rapid assessment profile displaying the Remote Pilot Certificate (RPC) data and SIDOPI registration numbers.
* **Hardware Specifications:** Categorizes drone specifications (e.g., weight classes < 25 kg) to automate safety rule compliance matching.

### D. Emergency Action Interface
* **Unified Communications:** Instant visibility of essential contacts, including AirNav Indonesia (LPPNPI) towers and local military/coordinating authorities.
* **Protocol Checklist:** Step-by-step emergency instructions extracted directly from the physical permit conditions for rapid response scenario mitigation.

---

## 4. Next Steps for Implementation

1. **Populate the Antigravity Wireframe:** Design a comprehensive triple-panel dashboard grid layout using responsive container configurations.
2. **Draft the Data Schema:** Model the physical paper elements into a clean JavaScript object scheme (`permit_id`, `operator_name`, `rpc_number`, `coordinates[]`, `max_altitude`, `start_time`, `end_time`).
3. **Integrate Map Layering:** Wire up the coordinate arrays to draw boundaries automatically onto the map viewport.
4. **IPC Setup:** Connect Electron main IPC channels to save and retrieve the digital permission logs locally on the machine.