# Telemetry CSV → Speed/Altitude Graph Converter
## Implementation Blueprint v1.0

> **Project:** PUTA-Monitor (Electron + Vanilla JS)  
> **Purpose:** This document is a self-contained blueprint for implementing the Telemetry Analyzer
> feature as described in `Telemetry_Feature_Specification_v2.md`.  
> Use this document to continue work even if context is lost.

---

## 1. Current State of the Codebase

### What Already Exists (Do NOT re-create)
| Thing | Where |
|---|---|
| `Chart.js` CDN | `index.html` line 18 — already loaded |
| `html2canvas` CDN | `index.html` line 20 — already loaded |
| `jsPDF` CDN | `index.html` line 19 — already loaded |
| MapLibre GL JS map | `renderer.js` — `initMap()` and all map layers |
| Existing CSV parser | `renderer.js` — `parseLogData(text, extension)` — handles CSV + KML |
| Existing flight path overlay | `renderer.js` — `plotFlightPath()` — draws on MapLibre source |
| `activeCharts` global array | `renderer.js` line 18 — used to store Chart.js instances for cleanup |

### What Does NOT Exist Yet (Must Be Built)
- A dedicated **Telemetry Analyzer** tab/panel in the UI
- A **drag-and-drop CSV upload zone** separate from the per-permit inspector
- **Real time-axis** parsing (`time(millisecond)` column → decimal minutes)
- **Pre-flight ground filter** (skip rows where speed=0 AND altitude≤0)
- **Dual-axis Chart.js chart** (altitude LEFT axis, speed RIGHT axis, time X-axis)
- **Hover tooltips** on chart data points
- **"Export as PNG"** button for the chart

---

## 2. Files to Modify

| File | What to Add |
|---|---|
| `index.html` | New modal/panel HTML for Telemetry Analyzer tab |
| `renderer.js` | New JS functions for parsing, charting, exporting |

No new files. No new npm packages. No new CDN scripts needed.

---

## 3. Step-by-Step Implementation Plan

---

### STEP 1 — Add the Nav Tab Button in `index.html`

**Where:** Inside the `<header>` element, in the right-side button group (near the existing action buttons).

Add a new button that opens the Telemetry Analyzer modal:

```html
<!-- Add this button inside the header's right-side button cluster -->
<button
  onclick="openTelemetryAnalyzer()"
  id="btn-telemetry-analyzer"
  class="flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs px-4 py-2 rounded-2xl hover:bg-indigo-100 transition-colors"
>
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
  </svg>
  Telemetry Analyzer
</button>
```

---

### STEP 2 — Add the Modal HTML in `index.html`

**Where:** Before the closing `</body>` tag (same place as other modals in the file).

```html
<!-- ============================================================ -->
<!-- TELEMETRY ANALYZER MODAL                                      -->
<!-- ============================================================ -->
<div id="telemetry-modal"
  class="hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[9000] flex items-center justify-center p-4 opacity-0 transition-opacity duration-300">
  
  <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden scale-95 transition-transform duration-300">

    <!-- Modal Header -->
    <div class="px-6 py-4 border-b border-black/5 flex items-center justify-between shrink-0">
      <div>
        <h2 class="text-base font-bold text-[#1d1d1f]">Telemetry Analyzer</h2>
        <p class="text-[11px] text-gray-400 mt-0.5">Upload a drone telemetry CSV to generate a speed & altitude profile</p>
      </div>
      <button onclick="closeTelemetryAnalyzer()" class="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors">
        <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- Modal Body (scrollable) -->
    <div class="flex-1 overflow-y-auto p-6 space-y-5">

      <!-- Drag & Drop Upload Zone -->
      <div id="telemetry-drop-zone"
        class="border-2 border-dashed border-indigo-200 rounded-2xl p-8 text-center bg-indigo-50/50 hover:bg-indigo-50 transition-colors cursor-pointer"
        onclick="document.getElementById('telemetry-csv-input').click()"
        ondragover="event.preventDefault(); this.classList.add('border-indigo-400')"
        ondragleave="this.classList.remove('border-indigo-400')"
        ondrop="handleTelemetryDrop(event)">
        
        <svg class="w-10 h-10 text-indigo-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        <p class="text-sm font-bold text-indigo-600">Drop your CSV telemetry log here</p>
        <p class="text-xs text-gray-400 mt-1">or click to browse — supports Airdata / DJI export format</p>
        <input type="file" id="telemetry-csv-input" accept=".csv" class="hidden" onchange="handleTelemetryCsvUpload(event)">
      </div>

      <!-- File Info Badge (hidden until file loaded) -->
      <div id="telemetry-file-info" class="hidden flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
        <svg class="w-5 h-5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <div class="flex-1 min-w-0">
          <div id="telemetry-filename" class="text-xs font-bold text-indigo-700 truncate"></div>
          <div id="telemetry-stats" class="text-[10px] text-gray-400 mt-0.5"></div>
        </div>
        <button onclick="resetTelemetryAnalyzer()" class="text-[10px] text-gray-400 hover:text-red-500 font-bold transition-colors">Clear</button>
      </div>

      <!-- Chart Canvas Area (hidden until data loaded) -->
      <div id="telemetry-chart-area" class="hidden space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-gray-600">Flight Telemetry Profile — Speed & Altitude</span>
          <button onclick="exportTelemetryChart()"
            class="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Export PNG
          </button>
        </div>

        <!-- The Chart.js canvas -->
        <div id="telemetry-chart-container" class="bg-white border border-black/5 rounded-2xl p-4 shadow-sm">
          <canvas id="telemetry-chart" height="300"></canvas>
        </div>

        <!-- Summary Stats Row -->
        <div id="telemetry-summary-row" class="grid grid-cols-4 gap-3">
          <!-- Filled dynamically by JS -->
        </div>
      </div>

    </div>
  </div>
</div>
```

---

### STEP 3 — Add JavaScript Functions in `renderer.js`

Add all functions at the **bottom** of `renderer.js`, after the last existing function.

#### 3A. Global State Variable
Add this at the top of `renderer.js` with the other global variables:
```js
let telemetryChartInstance = null; // Stores active Chart.js instance for cleanup
```

#### 3B. Modal Open/Close Functions
```js
function openTelemetryAnalyzer() {
  const modal = document.getElementById('telemetry-modal');
  const box = modal.querySelector('div');
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    box.classList.remove('scale-95');
  }, 10);
}

function closeTelemetryAnalyzer() {
  const modal = document.getElementById('telemetry-modal');
  const box = modal.querySelector('div');
  modal.classList.add('opacity-0');
  box.classList.add('scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

function resetTelemetryAnalyzer() {
  document.getElementById('telemetry-file-info').classList.add('hidden');
  document.getElementById('telemetry-chart-area').classList.add('hidden');
  document.getElementById('telemetry-drop-zone').classList.remove('hidden');
  document.getElementById('telemetry-csv-input').value = '';
  if (telemetryChartInstance) {
    telemetryChartInstance.destroy();
    telemetryChartInstance = null;
  }
}
```

#### 3C. File Input Handlers
```js
function handleTelemetryDrop(event) {
  event.preventDefault();
  document.getElementById('telemetry-drop-zone').classList.remove('border-indigo-400');
  const file = event.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    processTelemetryCsv(file);
  } else {
    showToast('Please drop a valid .csv file.', 'error');
  }
}

function handleTelemetryCsvUpload(event) {
  const file = event.target.files[0];
  if (file) processTelemetryCsv(file);
}
```

#### 3D. Core CSV Parser
```js
function processTelemetryCsv(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = e.target.result;
      const rows = text.trim().split('\n');
      if (rows.length < 2) throw new Error('CSV file appears empty.');

      const header = rows[0].split(',').map(h => h.trim().toLowerCase());

      // --- Column Index Detection ---
      // Time column
      const timeIdx = header.findIndex(h => h.includes('time(millisecond)') || h === 'time(ms)' || h === 'time');

      // Speed column (prefer mph, fall back to m/s)
      let speedIdx = header.findIndex(h => h.includes('speed(mph)'));
      let speedUnit = 'mph';
      if (speedIdx === -1) {
        speedIdx = header.findIndex(h => h.includes('speed(m/s)') || h.includes('speed'));
        speedUnit = 'm/s';
      }

      // Altitude column (prefer AGL height above takeoff, fall back to AMSL)
      let altIdx = header.findIndex(h => h.includes('height_above_takeoff(feet)') || h.includes('height_above_ground(feet)'));
      let altLabel = 'Alt AGL (ft)';
      if (altIdx === -1) {
        altIdx = header.findIndex(h => h.includes('altitude_above_sealevel(feet)') || h.includes('altitude(feet)') || h.includes('altitude'));
        altLabel = 'Alt AMSL (ft)';
      }

      if (timeIdx === -1) throw new Error("Could not find a 'time(millisecond)' column.");
      if (speedIdx === -1) throw new Error("Could not find a 'speed' column.");
      if (altIdx === -1) throw new Error("Could not find an 'altitude' column.");

      // --- Parse Rows ---
      const timeData = [];
      const speedData = [];
      const altData = [];
      let filteredPreFlight = 0;

      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        const cols = rows[i].split(',');

        const timeMs = parseFloat(cols[timeIdx]);
        let speed = parseFloat(cols[speedIdx]);
        const alt = parseFloat(cols[altIdx]);

        if (isNaN(timeMs) || isNaN(speed) || isNaN(alt)) continue;

        // Convert m/s → mph if needed
        if (speedUnit === 'm/s') speed = speed * 2.23694;

        // SPEC: Pre-Flight Ground Filter — skip rows where speed=0 AND height≤0
        if (speed === 0 && alt <= 0) {
          filteredPreFlight++;
          continue;
        }

        // SPEC: Convert ms → decimal minutes for X-axis
        const timeMinutes = timeMs / 60000.0;

        timeData.push(timeMinutes.toFixed(3));
        speedData.push(parseFloat(speed.toFixed(2)));
        altData.push(parseFloat(alt.toFixed(1)));
      }

      if (timeData.length === 0) throw new Error('No valid flight data found after filtering.');

      // Calculate summary stats
      const maxSpeed = Math.max(...speedData).toFixed(1);
      const maxAlt = Math.max(...altData).toFixed(0);
      const flightDuration = parseFloat(timeData[timeData.length - 1]).toFixed(2);
      const avgSpeed = (speedData.reduce((a, b) => a + b, 0) / speedData.length).toFixed(1);

      // Show results in UI
      showTelemetryFileInfo(file.name, timeData.length, filteredPreFlight, maxSpeed, maxAlt, flightDuration, avgSpeed, altLabel);
      renderTelemetryChart(timeData, speedData, altData, altLabel);

    } catch (err) {
      console.error('Telemetry parse error:', err);
      showToast(err.message || 'Failed to parse CSV file.', 'error');
    }
  };
  reader.readAsText(file);
}
```

#### 3E. UI Update — File Info Display
```js
function showTelemetryFileInfo(filename, points, filtered, maxSpeed, maxAlt, duration, avgSpeed, altLabel) {
  // Hide drop zone, show info
  document.getElementById('telemetry-drop-zone').classList.add('hidden');
  const infoEl = document.getElementById('telemetry-file-info');
  infoEl.classList.remove('hidden');

  document.getElementById('telemetry-filename').textContent = filename;
  document.getElementById('telemetry-stats').textContent =
    `${points.toLocaleString()} data points plotted · ${filtered} pre-flight rows filtered`;

  // Summary stats row
  const summaryRow = document.getElementById('telemetry-summary-row');
  summaryRow.innerHTML = `
    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-3 text-center">
      <div class="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Flight Duration</div>
      <div class="text-lg font-bold text-indigo-700 mt-1">${duration}</div>
      <div class="text-[9px] text-gray-400">minutes</div>
    </div>
    <div class="bg-orange-50 border border-orange-100 rounded-2xl p-3 text-center">
      <div class="text-[10px] font-bold text-orange-400 uppercase tracking-wider">Max Speed</div>
      <div class="text-lg font-bold text-orange-600 mt-1">${maxSpeed}</div>
      <div class="text-[9px] text-gray-400">mph</div>
    </div>
    <div class="bg-sky-50 border border-sky-100 rounded-2xl p-3 text-center">
      <div class="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Max Altitude</div>
      <div class="text-lg font-bold text-sky-600 mt-1">${maxAlt}</div>
      <div class="text-[9px] text-gray-400">ft</div>
    </div>
    <div class="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
      <div class="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Avg Speed</div>
      <div class="text-lg font-bold text-emerald-600 mt-1">${avgSpeed}</div>
      <div class="text-[9px] text-gray-400">mph</div>
    </div>
  `;
}
```

#### 3F. Chart.js Dual-Axis Render
```js
function renderTelemetryChart(timeData, speedData, altData, altLabel) {
  // Destroy previous chart instance if exists
  if (telemetryChartInstance) {
    telemetryChartInstance.destroy();
    telemetryChartInstance = null;
  }

  // Show chart area
  document.getElementById('telemetry-chart-area').classList.remove('hidden');

  const ctx = document.getElementById('telemetry-chart').getContext('2d');

  // Downsample if too many points (keep max 500 for performance)
  let labels = timeData;
  let speeds = speedData;
  let alts = altData;
  if (timeData.length > 500) {
    const step = Math.ceil(timeData.length / 500);
    labels = timeData.filter((_, i) => i % step === 0);
    speeds = speedData.filter((_, i) => i % step === 0);
    alts = altData.filter((_, i) => i % step === 0);
  }

  telemetryChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: altLabel,
          data: alts,
          borderColor: '#3b82f6',       // Blue
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,               // No dots (too many points)
          pointHoverRadius: 5,
          yAxisID: 'yAlt',
        },
        {
          label: 'Ground Speed (mph)',
          data: speeds,
          borderColor: '#f97316',       // Orange
          backgroundColor: 'rgba(249, 115, 22, 0.06)',
          fill: true,
          tension: 0.3,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          yAxisID: 'ySpeed',
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        mode: 'index',          // Hover shows BOTH datasets at same X
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 11, weight: 'bold' }, boxWidth: 14 }
        },
        tooltip: {
          callbacks: {
            title: (items) => `T+${items[0].label} min`,
            label: (item) => {
              const unit = item.datasetIndex === 0 ? ' ft' : ' mph';
              return ` ${item.dataset.label}: ${item.formattedValue}${unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Elapsed Time (minutes)',
            font: { size: 11, weight: 'bold' },
            color: '#6b7280'
          },
          ticks: {
            maxTicksLimit: 12,
            font: { size: 10 },
            color: '#9ca3af'
          },
          grid: { color: 'rgba(0,0,0,0.04)' }
        },
        yAlt: {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: altLabel,
            font: { size: 11, weight: 'bold' },
            color: '#3b82f6'
          },
          ticks: { color: '#3b82f6', font: { size: 10 } },
          grid: { color: 'rgba(59,130,246,0.07)' }
        },
        ySpeed: {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Ground Speed (mph)',
            font: { size: 11, weight: 'bold' },
            color: '#f97316'
          },
          ticks: { color: '#f97316', font: { size: 10 } },
          grid: { drawOnChartArea: false }  // Don't overlap altitude grid
        }
      }
    }
  });
}
```

#### 3G. PNG Export Function
```js
async function exportTelemetryChart() {
  const container = document.getElementById('telemetry-chart-container');
  if (!container) return;
  try {
    showToast('Generating chart image...', 'info');
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `PUTA_Telemetry_Profile_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Chart exported successfully!', 'success');
  } catch (err) {
    console.error('Export error:', err);
    showToast('Failed to export chart.', 'error');
  }
}
```

---

## 4. Integration Checklist

Work through these in order:

- [ ] **1.** Add the "Telemetry Analyzer" button in `index.html` header
- [ ] **2.** Add the full modal HTML block in `index.html` before `</body>`
- [ ] **3.** Add `let telemetryChartInstance = null;` at top of `renderer.js` global vars
- [ ] **4.** Add `openTelemetryAnalyzer()`, `closeTelemetryAnalyzer()`, `resetTelemetryAnalyzer()` to `renderer.js`
- [ ] **5.** Add `handleTelemetryDrop()`, `handleTelemetryCsvUpload()` to `renderer.js`
- [ ] **6.** Add `processTelemetryCsv()` to `renderer.js` (core parser)
- [ ] **7.** Add `showTelemetryFileInfo()` to `renderer.js`
- [ ] **8.** Add `renderTelemetryChart()` to `renderer.js`
- [ ] **9.** Add `exportTelemetryChart()` to `renderer.js`
- [ ] **10.** Run `npm start` and test with an Airdata CSV export file

---

## 5. CSV Column Name Reference

The parser tries these column name variants (case-insensitive):

| Data | Primary Header | Fallback Headers |
|---|---|---|
| Time | `time(millisecond)` | `time(ms)`, `time` |
| Speed | `speed(mph)` | `speed(m/s)`, `speed` |
| Altitude | `height_above_takeoff(feet)` | `height_above_ground(feet)`, `altitude_above_sealevel(feet)`, `altitude` |

If your CSV uses different headers, update the `findIndex()` calls in `processTelemetryCsv()`.

---

## 6. No New Dependencies Needed

| Library | Status | Where |
|---|---|---|
| Chart.js | ✅ Already in `index.html` line 18 | CDN |
| html2canvas | ✅ Already in `index.html` line 20 | CDN |
| FileReader API | ✅ Built-in browser API | Native |
| MapLibre GL JS | ✅ Already in `index.html` | CDN |

---

## 7. Future Enhancements (Optional, After Core Works)

- Mark the **overspeed moment** with a red vertical line on the chart (where `speed > 87 knots / 100 mph`)
- Show a **"compliance badge"** on the chart (COMPLIANT / BREACH) based on permit `max_altitude_ft`
- Link to a **selected permit** from the sidebar to auto-fill the altitude compliance limit
- Add a **speed unit toggle** button (mph ↔ knots) that re-renders the chart

---

*Blueprint created: 2026-06-04 | PUTA-Monitor v1.0 | Region VI OTBAN Padang*
