// Global App State
let permits = [];
let selectedPermit = null;
let map = null;
let polygonLayers = {};
let kkopLayers = [];
let countdownInterval = null;
let currentYearFilter = 'All';

// Flight evaluation global states
let satelliteLayer = null;
let streetLayer = null;
let activeTileMode = 'streets';
let flightLogData = null;
let flightPathPolyline = null;
let activeCharts = [];

// Web browser fallback mock for local testing outside Electron main process
if (typeof window !== 'undefined' && !window.api) {
  window.api = {
    loadPermits: async () => {
      try {
        const response = await fetch('data/permits.json');
        return await response.json();
      } catch (err) {
        console.warn("Fallback to local fetch failed, using mock data", err);
        return [];
      }
    },
    openPDF: async (fileName, year) => {
      console.log(`Mock Open PDF: ${fileName} for year ${year}`);
      return { success: true };
    },
    savePermit: async (permitData) => {
      console.log("Mock Save Permit:", permitData);
      return { success: true };
    }
  };
}

// Fallback coordinate mappings for known regions in Sumatra (OTBAN Region VI)
const LOCATION_COORDS = {
  "ogan komering ilir": [-3.30, 104.80],
  "palembang": [-2.99, 104.76],
  "jambi": [-1.61, 103.61],
  "bungo": [-1.50, 102.10],
  "belitung": [-2.73, 107.82],
  "belitung timur": [-2.88, 108.15],
  "bangka": [-2.10, 106.10],
  "muara enim": [-3.65, 103.77],
  "swp": [-2.80, 108.05],
  "bulian jaya": [-1.65, 103.25],
  "sumatera selatan": [-3.20, 104.20],
  "padang": [-0.94, 100.35],
  "kota padang": [-0.94, 100.35],
  "supreme-thermal": [-4.05, 103.58],
  "kayu agung": [-3.39, 104.83],
  "gelam": [-1.55, 103.70],
  "dayung": [-2.05, 104.05],
  "sambar": [-2.15, 104.10],
  "sumpal": [-2.30, 103.95],
  "rebon jaro": [-2.20, 103.85],
  "pl bayung": [-2.05, 103.68],
  "pl muaro jambi": [-1.61, 103.61],
  "pl kaos": [-1.43, 103.20],
  "pl sekernan": [-1.40, 103.64],
  "pl jabung": [-1.28, 104.18],
  "pl ro grissik": [-2.35, 103.65]
};

function getCoordsFromLocation(locStr) {
  if (!locStr) return null;
  const normalized = locStr.toLowerCase().trim();
  if (LOCATION_COORDS[normalized]) return LOCATION_COORDS[normalized];
  
  for (const [key, coords] of Object.entries(LOCATION_COORDS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return coords;
    }
  }
  return null;
}

function getEmergencyTower(locationStr) {
  if (!locationStr) {
    return { name: "AirNav Padang Tower", phone: "+62 (751) 81920" };
  }
  const loc = locationStr.toLowerCase();
  if (loc.includes('jambi') || loc.includes('sekernan') || loc.includes('bungo') || loc.includes('kaos') || loc.includes('jabung')) {
    return { name: "AirNav Jambi Tower", phone: "+62 (741) 57321" };
  }
  if (loc.includes('bengkulu')) {
    return { name: "AirNav Bengkulu Tower", phone: "+62 (736) 21014" };
  }
  if (loc.includes('palembang') || loc.includes('ogan komering') || loc.includes('oki') || loc.includes('muara enim') || loc.includes('kayu agung') || loc.includes('sumsel') || loc.includes('sumatera selatan') || loc.includes('musi hutan') || loc.includes('gelam') || loc.includes('dayung') || loc.includes('sambar') || loc.includes('sumpal') || loc.includes('rebon jaro') || loc.includes('bayung') || loc.includes('witmas')) {
    return { name: "AirNav Palembang Tower", phone: "+62 (711) 385006" };
  }
  if (loc.includes('belitung') || loc.includes('swp')) {
    return { name: "AirNav Tanjung Pandan Tower", phone: "+62 (719) 21010" };
  }
  if (loc.includes('bangka') || loc.includes('pangkal pinang')) {
    return { name: "AirNav Pangkal Pinang Tower", phone: "+62 (717) 422081" };
  }
  return { name: "AirNav Padang Tower", phone: "+62 (751) 81920" };
}

// Critical Airports in Region VI (Padang jurisdiction) for KKOP visualization
const REGION_AIRPORTS = [
  { name: "Bandar Udara Internasional Minangkabau (PDG)", lat: -0.787999, lng: 100.28677, code: "PDG" },
  { name: "Bandar Udara Rokot (RKI)", lat: -2.0991, lng: 99.7058, code: "RKI" },
  { name: "Bandar Udara Fatmawati Soekarno (BKS)", lat: -3.86128, lng: 102.33967, code: "BKS" },
  { name: "Bandar Udara Sultan Thaha (DJB)", lat: -1.63506, lng: 103.64601, code: "DJB" },
  { name: "Bandar Udara Internasional Sultan Mahmud Badaruddin II (PLM)", lat: -2.89615, lng: 104.70697, code: "PLM" },
  { name: "Bandar Udara Depati Amir (PGK)", lat: -2.16063, lng: 106.14173, code: "PGK" }
];

// Initialize application when loaded
window.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadAndRenderData();
  setupEventListeners();

  // Report Modal button event listeners
  const btnCloseModal = document.getElementById('close-report-modal');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeReportModal);
  }

  const btnExportPdf = document.getElementById('btn-export-pdf');
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', exportReportToPDF);
  }
});

// 1. GIS Map Canvas Setup
function initMap() {
  // Center near Padang, West Sumatra (OTBAN Region VI main area)
  map = L.map('map', {
    zoomControl: false
  }).setView([-1.5, 101.5], 7);

  // Add zoom control at bottom right
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Load sleek light theme map tiles from CartoDB Positron
  streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Load satellite tiles
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 20
  });

  // Map Tile Toggle
  const mapToggle = document.getElementById('map-toggle-satellite');
  const mapToggleText = document.getElementById('map-toggle-text');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      if (activeTileMode === 'streets') {
        map.removeLayer(streetLayer);
        satelliteLayer.addTo(map);
        activeTileMode = 'satellite';
        mapToggleText.textContent = "Street Map";
        mapToggle.classList.add('text-[#0071e3]');
      } else {
        map.removeLayer(satelliteLayer);
        streetLayer.addTo(map);
        activeTileMode = 'streets';
        mapToggleText.textContent = "Satellite Map";
        mapToggle.classList.remove('text-[#0071e3]');
      }
    });
  }

  // Plot KKOP Airport Safety zones (red border rings)
  REGION_AIRPORTS.forEach(airport => {
    // 5km Ring (No Fly Zone buffer)
    const nfzRing = L.circle([airport.lat, airport.lng], {
      color: '#ef4444',
      fillColor: '#ef4444',
      fillOpacity: 0.1,
      weight: 1.5,
      dashArray: '4, 4',
      radius: 5000 // 5 kilometers
    }).addTo(map);

    // Bind basic popup info
    nfzRing.bindPopup(`<strong class="text-red-400 font-bold">${airport.name}</strong><br/>
      <span class="text-xs text-gray-400">KKOP Critical Buffer: Strict Drone Restriction Zone (5 km)</span>`);
    
    kkopLayers.push(nfzRing);
  });
}

// 2. Load permits from Electron Preload IPC and render Dashboard
async function loadAndRenderData() {
  try {
    // Pull permit JSON via the electron IPC bridge
    permits = await window.api.loadPermits();
    
    // Sort permits by year desc, then permit ID
    permits.sort((a, b) => b.year - a.year || a.permit_id.localeCompare(b.permit_id));
    
    renderDashboard();
  } catch (error) {
    console.error("Failed to load permits data:", error);
    document.getElementById('permits-list-container').innerHTML = `
      <div class="p-6 text-center text-red-600 border border-red-200 rounded-2xl bg-red-50 text-xs">
        Failed to fetch permits database. Make sure data/permits.json exists.
      </div>`;
  }
}

// State engine: Calculates if permit is ACTIVE, PENDING or EXPIRED based on local time window
function getPermitStatus(permit) {
  const now = new Date();
  
  // Format local date today as ISO string YYYY-MM-DD
  const offset = now.getTimezoneOffset();
  const localNow = new Date(now.getTime() - (offset * 60 * 1000));
  const todayStr = localNow.toISOString().split('T')[0];
  
  if (todayStr < permit.date_start) return 'PENDING';
  if (todayStr > permit.date_end) return 'EXPIRED';
  
  // Clean time strings (remove GMT / timezone additions)
  const cleanTime = (t) => t.split(' ')[0].replace('.', ':');
  const tStart = cleanTime(permit.time_start);
  const tEnd = cleanTime(permit.time_end);

  const [startH, startM] = tStart.split(':').map(Number);
  const [endH, endM] = tEnd.split(':').map(Number);
  
  const startTime = new Date(now);
  startTime.setHours(startH, startM, 0, 0);
  
  const endTime = new Date(now);
  endTime.setHours(endH, endM, 0, 0);
  
  if (now < startTime) return 'PENDING';
  if (now > endTime) return 'EXPIRED';
  return 'ACTIVE';
}

// Setup filters and searches
function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', renderDashboard);

  const tabs = ['all', '2026', '2025', '2024'];
  tabs.forEach(tab => {
    const btn = document.getElementById(`tab-${tab}`);
    btn.addEventListener('click', () => {
      // Toggle styles
      tabs.forEach(t => {
        const otherBtn = document.getElementById(`tab-${t}`);
        otherBtn.className = "flex-1 py-1.5 rounded-xl hover:text-[#1d1d1f] transition-colors";
      });
      btn.className = "flex-1 py-1.5 rounded-xl bg-white text-[#1d1d1f] shadow-sm";
      
      currentYearFilter = tab === 'all' ? 'All' : parseInt(tab);
      renderDashboard();
    });
  });

  // Add Permit modal listeners
  const btnAdd = document.getElementById('btn-add-permit');
  if (btnAdd) btnAdd.addEventListener('click', openAddPermitModal);

  const btnClose = document.getElementById('close-add-modal');
  if (btnClose) btnClose.addEventListener('click', closeAddPermitModal);

  const btnCancel = document.getElementById('btn-cancel-modal');
  if (btnCancel) btnCancel.addEventListener('click', closeAddPermitModal);

  const form = document.getElementById('add-permit-form');
  if (form) form.addEventListener('submit', handleAddPermitSubmit);
}

// 3. Render list, stats and update map polygons
function renderDashboard() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const listContainer = document.getElementById('permits-list-container');
  listContainer.innerHTML = '';

  // Clear previous workspace layers
  Object.values(polygonLayers).forEach(layer => map.removeLayer(layer));
  polygonLayers = {};

  let activeCount = 0;
  let pendingCount = 0;
  let expiredCount = 0;
  let displayedCount = 0;

  permits.forEach(permit => {
    const status = getPermitStatus(permit);
    
    // Update Global Statistics
    if (status === 'ACTIVE') activeCount++;
    else if (status === 'PENDING') pendingCount++;
    else if (status === 'EXPIRED') expiredCount++;

    // Apply Year Filter
    if (currentYearFilter !== 'All' && permit.year !== currentYearFilter) return;

    // Apply Search Filter
    const matchesSearch = 
      permit.operator_name.toLowerCase().includes(query) ||
      permit.permit_id.toLowerCase().includes(query) ||
      permit.location.toLowerCase().includes(query);
    if (!matchesSearch) return;

    displayedCount++;
    
    // Draw Permit shapes on Leaflet Map (Polygon or Fallback Circle)
    const color = status === 'ACTIVE' ? '#10b981' : (status === 'PENDING' ? '#f59e0b' : '#8e9aa6');
    let mapShape = null;
    let isFallback = false;

    if (permit.coordinates && permit.coordinates.length > 0) {
      mapShape = L.polygon(permit.coordinates, {
        color: color,
        fillColor: color,
        fillOpacity: 0.2,
        weight: selectedPermit && selectedPermit.permit_id === permit.permit_id ? 3 : 1.5
      });
    } else {
      // Fallback location lookup
      const fallbackCoords = getCoordsFromLocation(permit.location);
      if (fallbackCoords) {
        isFallback = true;
        mapShape = L.circle(fallbackCoords, {
          color: color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: selectedPermit && selectedPermit.permit_id === permit.permit_id ? 3.5 : 1.5,
          radius: 6000 // 6 kilometers approximate radius
        });
      }
    }

    if (mapShape) {
      mapShape.addTo(map);

      // Popup content
      mapShape.bindPopup(`
        <div class="text-xs space-y-1">
          <div class="font-bold text-[#1d1d1f]">${permit.operator_name}</div>
          <div class="text-[10px] text-gray-500 font-mono">ID: ${permit.permit_id}</div>
          ${isFallback ? '<div class="text-[9px] text-amber-600 font-bold mt-1">Approximate Area Fallback</div>' : ''}
          <div class="flex items-center gap-1.5 mt-1">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${color}"></span>
            <span class="font-bold uppercase tracking-wider text-[9px]" style="color: ${color}">${status}</span>
          </div>
        </div>
      `);
      
      polygonLayers[permit.permit_id] = mapShape;
      
      // Select permit when clicking its map shape
      mapShape.on('click', () => selectPermitCard(permit));
    }

    // Append Permit Card to list
    const card = document.createElement('div');
    const isSelected = selectedPermit && selectedPermit.permit_id === permit.permit_id;
    
    let statusBadgeColor = 'bg-gray-100 text-gray-600 border-gray-200';
    let statusDot = 'bg-gray-400';
    let pulseClass = '';

    if (status === 'ACTIVE') {
      statusBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      statusDot = 'bg-emerald-500';
      pulseClass = 'w-1.5 h-1.5 rounded-full pulse-active bg-emerald-500';
    } else if (status === 'PENDING') {
      statusBadgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
      statusDot = 'bg-amber-500';
    }

    card.className = `p-4 border rounded-2xl cursor-pointer transition-all duration-300 ${
      isSelected 
        ? 'bg-white border-[#0071e3]/60 shadow-lg shadow-black/[0.02]' 
        : 'bg-white/70 border-black/5 hover:bg-white hover:shadow-sm'
    }`;

    const pilotVal = Array.isArray(permit.pilot_name) && permit.pilot_name.length > 0
      ? permit.pilot_name.join(', ')
      : (typeof permit.pilot_name === 'string' && permit.pilot_name ? permit.pilot_name : "Unknown Pilot");
      
    const registryVal = Array.isArray(permit.puta_registry) && permit.puta_registry.length > 0
      ? permit.puta_registry.join(', ')
      : (typeof permit.puta_registry === 'string' && permit.puta_registry ? permit.puta_registry : "Unknown Registry");

    card.innerHTML = `
      <div class="flex justify-between items-start gap-2">
        <span class="text-[10px] font-mono text-gray-400 tracking-tight select-all">${permit.permit_id}</span>
        <span class="border px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest flex items-center gap-1 ${statusBadgeColor}">
          <span class="${pulseClass || 'w-1.5 h-1.5 rounded-full ' + statusDot}"></span>
          ${status}
        </span>
      </div>
      <h3 class="text-sm font-bold text-gray-800 mt-2 truncate">${permit.operator_name}</h3>
      <p class="text-xs text-gray-500 font-medium flex items-center gap-1 mt-1">
        <svg class="w-3.5 h-3.5 text-[#0071e3] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
        </svg>
        ${permit.location}
      </p>
      <div class="mt-2 text-[10px] text-gray-500 flex flex-col gap-0.5 border-t border-black/5 pt-2 font-medium">
        <span class="truncate" title="${pilotVal}"><strong>Pilot PUTA:</strong> ${pilotVal}</span>
        <span class="truncate" title="${registryVal}"><strong>PUTA Registry:</strong> ${registryVal}</span>
      </div>
      <div class="flex justify-between text-[10px] text-gray-400 mt-2 pt-2 border-t border-black/5 font-semibold">
        <span>Year: ${permit.year}</span>
        <span>Alt Limit: ${permit.max_altitude_ft} ft</span>
      </div>
    `;

    card.addEventListener('click', () => selectPermitCard(permit));
    listContainer.appendChild(card);
  });

  // Update Statistics UI
  document.getElementById('stat-active').textContent = activeCount;
  document.getElementById('stat-pending').textContent = pendingCount;
  document.getElementById('stat-expired').textContent = expiredCount;

  if (displayedCount === 0) {
    listContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-center text-gray-500 text-xs">
        No drone permits match the current criteria.
      </div>`;
  }
}

// 4. Select Card and Pan Map to Coordinates
function selectPermitCard(permit) {
  selectedPermit = permit;
  renderDashboard(); // Updates list styles and map weights
  renderInspector();  // Fills inspector panel details

  // Fly to the coordinates bounds if they exist (or fallback bounds)
  if ((permit.coordinates && permit.coordinates.length > 0) || getCoordsFromLocation(permit.location)) {
    const poly = polygonLayers[permit.permit_id];
    if (poly) {
      map.fitBounds(poly.getBounds(), { padding: [50, 50], maxZoom: 12 });
      poly.openPopup();
    }
  }
}

// 5. Build selected permit inspection details & countdown timers
function renderInspector() {
  const panel = document.getElementById('inspector-panel');
  if (clearInterval) clearInterval(countdownInterval);

  // Clear flight log data when permit selection changes (if the log was for a different permit)
  if (selectedPermit && (!flightLogData || flightLogData.permit_id !== selectedPermit.permit_id)) {
    flightLogData = null;
    if (flightPathPolyline) {
      map.removeLayer(flightPathPolyline);
      flightPathPolyline = null;
    }
  }

  if (!selectedPermit) {
    panel.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 gap-3">
        <p class="text-sm font-semibold text-gray-400">No Permit Selected</p>
      </div>`;
    return;
  }

  const permit = selectedPermit;
  const status = getPermitStatus(permit);
  const tower = getEmergencyTower(permit.location);

  const pilotVal = Array.isArray(permit.pilot_name) && permit.pilot_name.length > 0
    ? permit.pilot_name.join(', ')
    : (typeof permit.pilot_name === 'string' && permit.pilot_name ? permit.pilot_name : "Unknown Pilot");
    
  const registryVal = Array.isArray(permit.puta_registry) && permit.puta_registry.length > 0
    ? permit.puta_registry.join(', ')
    : (typeof permit.puta_registry === 'string' && permit.puta_registry ? permit.puta_registry : "Unknown Registry");

  // Formatting date string nicely
  const formatDateString = (isoStr) => {
    if (!isoStr) return "";
    const [y, m, d] = isoStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d} ${months[parseInt(m) - 1]} ${y}`;
  };

  const formattedDate = formatDateString(permit.date_start);

  let statusBadgeColor = 'bg-gray-100 border-gray-200 text-gray-600';
  let gaugeColor = 'bg-gray-400';
  
  if (status === 'ACTIVE') {
    statusBadgeColor = 'bg-emerald-50 border-emerald-200 text-emerald-700';
    gaugeColor = 'bg-emerald-500';
  } else if (status === 'PENDING') {
    statusBadgeColor = 'bg-amber-50 border-amber-200 text-amber-700';
    gaugeColor = 'bg-amber-500';
  }

  panel.innerHTML = `
    <!-- Top Details Title -->
    <div class="p-6 border-b border-black/5 space-y-4">
      <div class="flex justify-between items-start">
        <span class="border px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest ${statusBadgeColor}">
          ${status}
        </span>
        <button id="close-inspector" class="text-gray-400 hover:text-gray-600 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div>
        <h2 class="text-base font-bold text-gray-900">${permit.operator_name}</h2>
        <span class="text-[10px] font-mono text-gray-400 block mt-1">${permit.permit_id}</span>
      </div>
    </div>

    <!-- Live Timer Window -->
    <div class="p-6 border-b border-black/5 bg-sky-50/20 space-y-2">
      <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Live Time Remaining</div>
      <div id="countdown-timer" class="text-2xl font-bold font-mono tracking-tight text-[#0071e3]">
        --:--:--
      </div>
      <div class="flex justify-between text-[10px] text-gray-500 font-semibold pt-1">
        <span>Start: ${permit.time_start}</span>
        <span>End: ${permit.time_end}</span>
      </div>
    </div>

    <!-- Workspace Properties -->
    <div class="p-6 border-b border-black/5 space-y-4">
      <h3 class="text-[10px] uppercase font-extrabold text-gray-400 tracking-wider">Operation Metrics</h3>
      
      <!-- Altitude Limit Gauge -->
      <div class="flex gap-4 items-center">
        <div class="w-8 h-28 bg-[#e8e8ed] border border-black/5 rounded-lg flex flex-col justify-end p-0.5 relative shrink-0">
          <!-- Maximum line visual -->
          <div class="absolute inset-x-0 bottom-[100%] h-0 border-t border-red-500/50 mb-[-1px]"></div>
          <!-- Current level filled -->
          <div class="w-full ${gaugeColor} rounded-md transition-all duration-500" style="height: ${Math.min((permit.max_altitude_ft / 500) * 100, 100)}%"></div>
        </div>
        <div class="flex-1 space-y-1">
          <div class="text-[10px] text-gray-400 font-bold uppercase">Vertical Ceiling</div>
          <div class="text-xl font-extrabold text-gray-800">${permit.max_altitude_ft} <span class="text-xs font-semibold text-gray-500">ft (AGL)</span></div>
          <div class="text-[10px] text-gray-400 font-semibold">Standard Indonesian regulatory cap is 400ft / 120m.</div>
        </div>
      </div>
      
      <!-- Operational Dates -->
      <div class="grid grid-cols-2 gap-3 text-xs bg-gray-50 p-3.5 rounded-2xl border border-black/5">
        <div>
          <span class="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Start Date</span>
          <span class="font-bold text-gray-700">${formatDateString(permit.date_start)}</span>
        </div>
        <div>
          <span class="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">End Date</span>
          <span class="font-bold text-gray-700">${formatDateString(permit.date_end)}</span>
        </div>
      </div>
    </div>

    <!-- Pilot & Credentials Panel -->
    <div class="p-6 border-b border-black/5 space-y-3">
      <h3 class="text-[10px] uppercase font-extrabold text-gray-400 tracking-wider">Pilot & Aircraft Details</h3>
      <div class="space-y-2">
        <div class="flex justify-between items-start text-xs">
          <span class="text-gray-500 font-semibold shrink-0">Pilot PUTA</span>
          <span class="text-gray-700 font-bold text-right ml-4">${pilotVal}</span>
        </div>
        <div class="flex justify-between items-start text-xs">
          <span class="text-gray-500 font-semibold shrink-0">PUTA Registry</span>
          <span class="font-mono text-gray-700 font-bold text-right ml-4 select-all">${registryVal}</span>
        </div>
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500 font-semibold">RPC Credentials</span>
          <span class="font-mono text-gray-400 font-semibold">SIDOPI-VERIFIED</span>
        </div>
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500 font-semibold">Location Area</span>
          <span class="text-gray-700 font-bold text-right">${permit.location}</span>
        </div>
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500 font-semibold">Attachment Reference</span>
          <span id="pdf-reference-link" class="text-[#0071e3] font-semibold hover:underline cursor-pointer truncate max-w-[200px]" title="${permit.file_name}">${permit.file_name}</span>
        </div>
      </div>
    </div>

    <!-- Flight Log Evaluation Panel -->
    <div class="p-6 border-b border-black/5 space-y-3">
      <h3 class="text-[10px] uppercase font-extrabold text-gray-400 tracking-wider">Flight Log Evaluation</h3>
      <input type="file" id="flight-log-input" accept=".csv,.kml" class="hidden">
      <button id="btn-upload-log" class="w-full py-2 bg-[#f5f5f7] hover:bg-black/5 text-[#1d1d1f] font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 border border-black/5">
        <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
        </svg>
        Upload Flight Log (.csv / .kml)
      </button>
      
      <!-- Log Evaluation Status (hidden until uploaded) -->
      <div id="log-evaluation-status" class="hidden space-y-2 pt-2 text-xs">
        <div class="bg-sky-50/50 border border-sky-100 p-3 rounded-2xl flex flex-col gap-2">
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">Log File:</span>
            <span id="log-filename" class="font-mono text-gray-700 font-bold max-w-[150px] truncate"></span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">Max Altitude:</span>
            <span id="log-max-alt" class="font-bold"></span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">Max Speed:</span>
            <span id="log-max-speed" class="font-bold"></span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">Geofence:</span>
            <span id="log-geofence" class="font-bold"></span>
          </div>
        </div>
        <button id="btn-preview-report" class="w-full py-2.5 bg-[#0071e3] hover:bg-[#0077ed] text-white font-bold rounded-2xl text-xs transition-all shadow-md shadow-[#0071e3]/15 flex items-center justify-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          Preview & Cetak Laporan (PDF)
        </button>
      </div>
    </div>

    <!-- AirNav Towers Region VI Emergency contacts -->
    <div class="p-6 border-b border-black/5 space-y-3">
      <h3 class="text-[10px] uppercase font-extrabold text-red-500 tracking-wider">Emergency Communications</h3>
      <div class="bg-red-50 border border-red-200 p-3.5 rounded-2xl space-y-2 text-xs">
        <div class="flex justify-between items-center">
          <span class="font-bold text-red-700">${tower.name}</span>
          <span class="font-mono text-gray-600 select-all font-semibold">${tower.phone}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="font-bold text-red-700">Otoritas Bandar Udara VI</span>
          <span class="font-mono text-gray-600 select-all font-semibold">+62 (751) 81925</span>
        </div>
      </div>
    </div>

    <!-- Safety Action Checklist -->
    <div class="p-6 space-y-3">
      <h3 class="text-[10px] uppercase font-extrabold text-gray-400 tracking-wider">Emergency Checklist</h3>
      <ul class="text-xs text-gray-500 space-y-2.5 font-medium">
        <li class="flex items-start gap-2.5">
          <span class="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0"></span>
          <span>Initiate immediate <strong>Return-To-Home (RTH)</strong> if link drops for &gt;15s.</span>
        </li>
        <li class="flex items-start gap-2.5">
          <span class="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0"></span>
          <span>Contact AirNav Padang tower immediately if drone breaches max ceiling limits.</span>
        </li>
      </ul>
    </div>
  `;

  // Close inspector button handler
  document.getElementById('close-inspector').addEventListener('click', () => {
    selectedPermit = null;
    renderDashboard();
    renderInspector();
  });

  // Open PDF attachment event handler
  const pdfLink = document.getElementById('pdf-reference-link');
  if (pdfLink) {
    pdfLink.addEventListener('click', async () => {
      showToast(`Opening PDF: ${permit.file_name}...`, 'info');
      const res = await window.api.openPDF(permit.file_name, permit.year);
      if (res && !res.success) {
        showToast(res.error || "Failed to open PDF reference", 'error');
      }
    });
  }

  // Wire up log upload click trigger
  const btnUpload = document.getElementById('btn-upload-log');
  const logInput = document.getElementById('flight-log-input');
  if (btnUpload && logInput) {
    btnUpload.addEventListener('click', () => logInput.click());
    logInput.addEventListener('change', handleFlightLogUpload);
  }

  // Preview report click handler
  const btnPreview = document.getElementById('btn-preview-report');
  if (btnPreview) {
    btnPreview.addEventListener('click', openReportModal);
  }

  // Maintain UI persistence if a log was already parsed for this permit
  if (flightLogData && flightLogData.permit_id === permit.permit_id) {
    updateEvaluationStatusUI();
  }

  // Countdown timer clock cycle loop
  startCountdown(permit, status);
}

// 6. Clock cycle helper counting down active limits
function startCountdown(permit, initialStatus) {
  const timerElement = document.getElementById('countdown-timer');
  
  const updateTimer = () => {
    const now = new Date();
    
    // Check clean times
    const cleanTime = (t) => t.split(' ')[0].replace('.', ':');
    const tStart = cleanTime(permit.time_start);
    const tEnd = cleanTime(permit.time_end);

    const [startH, startM] = tStart.split(':').map(Number);
    const [endH, endM] = tEnd.split(':').map(Number);
    
    const startTime = new Date(now);
    startTime.setHours(startH, startM, 0, 0);
    
    const endTime = new Date(now);
    endTime.setHours(endH, endM, 0, 0);

    let diff = 0;
    let label = "";

    const status = getPermitStatus(permit);

    if (status === 'ACTIVE') {
      diff = endTime - now;
      label = "REMAINING: ";
      timerElement.className = "text-2xl font-bold font-mono tracking-tight text-emerald-600";
    } else if (status === 'PENDING') {
      // Check if starts later today
      if (now < startTime) {
        diff = startTime - now;
        label = "STARTS IN: ";
        timerElement.className = "text-2xl font-bold font-mono tracking-tight text-amber-600";
      } else {
        label = "SCHEDULED FUTURE";
        timerElement.className = "text-lg font-bold font-mono tracking-tight text-amber-600";
        timerElement.textContent = label;
        return;
      }
    } else {
      label = "PERMIT EXPIRED";
      timerElement.className = "text-lg font-bold font-mono tracking-tight text-gray-400";
      timerElement.textContent = label;
      return;
    }

    if (diff <= 0) {
      timerElement.textContent = "00:00:00";
      renderDashboard(); // Status change triggers full re-render
      return;
    }

    // Convert milliseconds to HH:MM:SS
    const secs = Math.floor((diff / 1000) % 60);
    const mins = Math.floor((diff / 1000 / 60) % 60);
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    
    const displayTime = [
      hours.toString().padStart(2, '0'),
      mins.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0')
    ].join(':');

    timerElement.textContent = label + displayTime;
  };

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

// Helper to show Apple-style notification toasts
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  
  let bgClass = 'bg-white/95 border-black/5 text-[#1d1d1f]';
  let icon = `
    <svg class="w-4 h-4 text-sky-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
  `;

  if (type === 'success') {
    bgClass = 'bg-emerald-50/95 border-emerald-200 text-emerald-800';
    icon = `
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
      </svg>
    `;
  } else if (type === 'error') {
    bgClass = 'bg-red-50/95 border-red-200 text-red-800';
    icon = `
      <svg class="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
    `;
  }

  toast.className = `flex items-center gap-2.5 px-4 py-3 border rounded-2xl shadow-xl backdrop-blur-md transition-all duration-300 transform translate-y-[-20px] opacity-0 pointer-events-auto ${bgClass}`;
  toast.innerHTML = `
    ${icon}
    <span class="text-xs font-bold">${message}</span>
  `;

  container.appendChild(toast);

  // Trigger animation next tick
  requestAnimationFrame(() => {
    toast.className = toast.className.replace('translate-y-[-20px] opacity-0', 'translate-y-0 opacity-100');
  });

  // Remove toast after 4 seconds
  setTimeout(() => {
    toast.className = toast.className.replace('translate-y-0 opacity-100', 'translate-y-[-20px] opacity-0');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

function openAddPermitModal() {
  const modal = document.getElementById('add-permit-modal');
  const modalBox = modal.querySelector('div');
  const form = document.getElementById('add-permit-form');
  
  // Clear any errors and reset form
  form.reset();
  document.getElementById('form-error-alert').classList.add('hidden');
  
  // Set default values
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('input-date-start').value = todayStr;
  document.getElementById('input-date-end').value = todayStr;
  document.getElementById('input-time-start').value = "07.00 WIB";
  document.getElementById('input-time-end').value = "17.30 WIB";
  document.getElementById('input-altitude').value = "400";
  
  modal.classList.remove('hidden');
  // Animate in
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    modalBox.classList.remove('scale-95');
  }, 10);
}

function closeAddPermitModal() {
  const modal = document.getElementById('add-permit-modal');
  const modalBox = modal.querySelector('div');
  
  modal.classList.add('opacity-0');
  modalBox.classList.add('scale-95');
  
  // Wait for transition before hiding
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
}

async function handleAddPermitSubmit(e) {
  e.preventDefault();
  
  const permitId = document.getElementById('input-permit-id').value.trim();
  const year = parseInt(document.getElementById('input-year').value);
  const operatorName = document.getElementById('input-operator').value.trim();
  const location = document.getElementById('input-location').value.trim();
  const dateStart = document.getElementById('input-date-start').value;
  const dateEnd = document.getElementById('input-date-end').value;
  const timeStart = document.getElementById('input-time-start').value.trim();
  const timeEnd = document.getElementById('input-time-end').value.trim();
  const maxAltitudeFt = parseInt(document.getElementById('input-altitude').value) || 400;
  const coordsInput = document.getElementById('input-coords').value.trim();
  const pilotsInput = document.getElementById('input-pilots').value.trim();
  const registryInput = document.getElementById('input-registry').value.trim();
  const fileName = document.getElementById('input-filename').value.trim();
  
  const errorAlert = document.getElementById('form-error-alert');
  
  // Basic Validations
  if (!permitId || !operatorName || !location || !dateStart || !dateEnd || !timeStart || !timeEnd || !fileName) {
    errorAlert.textContent = "Please fill in all required fields.";
    errorAlert.classList.remove('hidden');
    return;
  }
  
  if (dateEnd < dateStart) {
    errorAlert.textContent = "End date cannot be earlier than start date.";
    errorAlert.classList.remove('hidden');
    return;
  }
  
  // Parse coordinates if provided
  let coordinates = [];
  if (coordsInput) {
    try {
      const points = coordsInput.split(';');
      for (const p of points) {
        if (!p.trim()) continue;
        const parts = p.split(',');
        if (parts.length !== 2) {
          throw new Error("Invalid coordinate pair format. Use lat,lng.");
        }
        const lat = parseFloat(parts[0].trim());
        const lng = parseFloat(parts[1].trim());
        if (isNaN(lat) || isNaN(lng)) {
          throw new Error("Coordinate values must be valid numbers.");
        }
        coordinates.push([lat, lng]);
      }
    } catch (err) {
      errorAlert.textContent = `Coordinates Error: ${err.message}`;
      errorAlert.classList.remove('hidden');
      return;
    }
  }
  
  // Parse pilot names and registries as arrays
  const pilot_name = pilotsInput 
    ? pilotsInput.split(',').map(s => s.trim()).filter(s => s.length > 0)
    : [];
  
  const puta_registry = registryInput
    ? registryInput.split(',').map(s => s.trim()).filter(s => s.length > 0)
    : [];
  
  const newPermit = {
    permit_id: permitId,
    operator_name: operatorName,
    location: location,
    year: year,
    date_start: dateStart,
    date_end: dateEnd,
    time_start: timeStart,
    time_end: timeEnd,
    max_altitude_ft: maxAltitudeFt,
    coordinates: coordinates,
    pilot_name: pilot_name,
    puta_registry: puta_registry,
    file_name: fileName
  };
  
  // Save permit via IPC
  showToast("Saving new permission...", "info");
  const res = await window.api.savePermit(newPermit);
  
  if (res && res.success) {
    showToast("Permit saved successfully! Reloading...", "success");
    closeAddPermitModal();
  } else {
    errorAlert.textContent = res.error || "Failed to save new permit.";
    errorAlert.classList.remove('hidden');
    showToast("Failed to save permit", "error");
  }
}

// 7. Flight Log Evaluation & PDF Reporting Helper Functions

function handleFlightLogUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const extension = file.name.split('.').pop().toLowerCase();
    
    try {
      showToast(`Parsing ${file.name}...`, 'info');
      const parsed = parseLogData(text, extension);
      
      if (!parsed || parsed.points.length === 0) {
        throw new Error("No coordinate data found in log file.");
      }
      
      // Save parsed data locally linked to selectedPermit
      flightLogData = {
        permit_id: selectedPermit.permit_id,
        filename: file.name,
        points: parsed.points,      // array of [lat, lng, alt_ft, speed_knots, timestamp]
        maxAltitude: parsed.maxAltitude,
        maxSpeed: parsed.maxSpeed,
        altitudes: parsed.altitudes,
        speeds: parsed.speeds,
        timestamps: parsed.timestamps
      };
      
      // Check compliance
      runComplianceChecks();
      
      // Plot path on map
      plotFlightPath();
      
      // Update inspector DOM
      updateEvaluationStatusUI();
      
      showToast("Flight log evaluated successfully!", "success");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Failed to evaluate log file", "error");
    }
  };
  reader.readAsText(file);
}

function parseLogData(text, extension) {
  let points = []; 
  let maxAltitude = 0;
  let maxSpeed = 0;
  
  let altitudes = [];
  let speeds = [];
  let timestamps = [];

  if (extension === 'kml') {
    const parser = new DOMParser();
    const kml = parser.parseFromString(text, 'text/xml');
    const coordinatesNodes = kml.getElementsByTagName('coordinates');
    
    if (coordinatesNodes.length === 0) {
      throw new Error("No coordinate data tags in KML file.");
    }
    
    // Find the coordinates node containing the actual flight line
    let coordText = "";
    for (let i = 0; i < coordinatesNodes.length; i++) {
      const val = coordinatesNodes[i].textContent;
      if (val.trim().split(/\s+/).length > coordText.trim().split(/\s+/).length) {
        coordText = val;
      }
    }
    
    const lines = coordText.trim().split(/\s+/);
    lines.forEach((line, index) => {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        let altM = parts.length >= 3 ? parseFloat(parts[2]) : 0;
        let altFt = altM * 3.28084; // Convert meters to feet
        
        // Approximate speed / default values since KML holds coordinates only
        points.push([lat, lng, altFt, 0, index]);
        
        // Downsample slightly to prevent rendering bottlenecks (take 1 of every 5 points)
        if (index % 5 === 0) {
          altitudes.push(altFt);
          speeds.push(0);
          timestamps.push(`Pt ${index}`);
          if (altFt > maxAltitude) maxAltitude = altFt;
        }
      }
    });
  } else if (extension === 'csv') {
    const lines = text.split('\n');
    if (lines.length < 2) {
      throw new Error("CSV file is empty or corrupted.");
    }
    
    const header = lines[0].split(',');
    
    // Find column indexes with robust lower-casing
    const latIndex = header.findIndex(h => h.toLowerCase().trim() === 'latitude');
    const lngIndex = header.findIndex(h => h.toLowerCase().trim() === 'longitude');
    
    let heightIndex = header.findIndex(h => h.toLowerCase().trim().includes('height_above_takeoff'));
    if (heightIndex === -1) {
      heightIndex = header.findIndex(h => h.toLowerCase().trim().includes('height_above_ground'));
    }
    if (heightIndex === -1) {
      heightIndex = header.findIndex(h => h.toLowerCase().trim() === 'altitude(feet)' || h.toLowerCase().trim() === 'altitude');
    }
    
    let speedIndex = header.findIndex(h => h.toLowerCase().trim().includes('speed') && !h.toLowerCase().trim().includes('max'));
    const timeIndex = header.findIndex(h => h.toLowerCase().trim().includes('datetime') || h.toLowerCase().trim().includes('time'));
    
    if (latIndex === -1 || lngIndex === -1) {
      throw new Error("CSV log must contain 'latitude' and 'longitude' columns.");
    }
    
    let pointCount = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = lines[i].split(',');
      if (row.length < header.length) continue;
      
      const lat = parseFloat(row[latIndex]);
      const lng = parseFloat(row[lngIndex]);
      
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;
      
      let altFt = heightIndex !== -1 ? parseFloat(row[heightIndex]) : 0;
      if (isNaN(altFt)) altFt = 0;
      
      let speedMph = speedIndex !== -1 ? parseFloat(row[speedIndex]) : 0;
      if (isNaN(speedMph)) speedMph = 0;
      let speedKnots = speedMph * 0.868976; // convert mph to knots
      
      // Clean noise readings
      if (altFt < -100 || altFt > 10000) altFt = 0;
      if (speedKnots < 0 || speedKnots > 300) speedKnots = 0;
      
      let timeVal = timeIndex !== -1 ? row[timeIndex].trim() : `Point ${pointCount}`;
      
      // Downsample log data (take 1 point every 20 records to keep PDF size small and charts readable)
      pointCount++;
      if (pointCount % 20 === 0) {
        points.push([lat, lng, altFt, speedKnots, timeVal]);
        
        altitudes.push(altFt);
        speeds.push(speedKnots);
        
        let formattedTime = timeVal;
        if (timeVal.includes(' ')) {
          formattedTime = timeVal.split(' ')[1]; 
        }
        timestamps.push(formattedTime);
        
        if (altFt > maxAltitude) maxAltitude = altFt;
        if (speedKnots > maxSpeed) maxSpeed = speedKnots;
      }
    }
  }
  
  return {
    points,
    maxAltitude,
    maxSpeed,
    altitudes,
    speeds,
    timestamps
  };
}

function runComplianceChecks() {
  if (!flightLogData || !selectedPermit) return;
  
  const points = flightLogData.points;
  const limitAlt = selectedPermit.max_altitude_ft || 400;
  const limitSpeed = 87; // civil aviation safety limit in knots
  
  // 1. Altitude Compliance
  flightLogData.altCompliant = flightLogData.maxAltitude <= limitAlt;
  
  // 2. Speed Compliance
  flightLogData.speedCompliant = flightLogData.maxSpeed <= limitSpeed;
  
  // 3. Geofence Boundary Compliance
  let geofenceBreached = false;
  let breachCount = 0;
  
  const polygon = selectedPermit.coordinates;
  
  if (polygon && polygon.length > 0) {
    // Check points inside boundary polygon
    for (const pt of points) {
      const isInside = isPointInPolygon([pt[0], pt[1]], polygon);
      if (!isInside) {
        geofenceBreached = true;
        breachCount++;
      }
    }
  } else {
    // Fallback circle radius check
    const center = getCoordsFromLocation(selectedPermit.location);
    if (center) {
      const radius = 6000; // 6km fallback radius
      for (const pt of points) {
        const isInside = isPointInCircle([pt[0], pt[1]], center, radius);
        if (!isInside) {
          geofenceBreached = true;
          breachCount++;
        }
      }
    }
  }
  
  flightLogData.geofenceCompliant = !geofenceBreached;
  flightLogData.breachCount = breachCount;
}

function isPointInCircle(point, center, radiusM) {
  const lat1 = point[0], lon1 = point[1];
  const lat2 = center[0], lon2 = center[1];
  
  const R = 6371e3; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c <= radiusM;
}

function isPointInPolygon(point, vs) {
  const lat = point[0], lng = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][1], yi = vs[i][0]; // xi = longitude, yi = latitude
    const xj = vs[j][1], yj = vs[j][0]; // xj = longitude, yj = latitude
    const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function plotFlightPath() {
  if (!flightLogData || !map) return;
  
  // Clean previous path overlay
  if (flightPathPolyline) {
    map.removeLayer(flightPathPolyline);
  }
  
  const latlngs = flightLogData.points.map(pt => [pt[0], pt[1]]);
  
  // Render bold dotted yellow flight path line
  flightPathPolyline = L.polyline(latlngs, {
    color: '#f59e0b',
    weight: 3,
    opacity: 0.85,
    dashArray: '5, 5'
  }).addTo(map);
  
  map.fitBounds(flightPathPolyline.getBounds(), { padding: [40, 40] });
}

function updateEvaluationStatusUI() {
  const statusContainer = document.getElementById('log-evaluation-status');
  if (!statusContainer || !flightLogData) return;
  
  statusContainer.classList.remove('hidden');
  document.getElementById('log-filename').textContent = flightLogData.filename;
  
  const altEl = document.getElementById('log-max-alt');
  altEl.innerHTML = `${Math.round(flightLogData.maxAltitude)} ft <span class="text-[9px] text-gray-400">/ ${selectedPermit.max_altitude_ft} ft limit</span>`;
  altEl.className = flightLogData.altCompliant ? "font-bold text-emerald-600" : "font-bold text-red-600 animate-pulse";
  
  const speedEl = document.getElementById('log-max-speed');
  speedEl.innerHTML = `${Math.round(flightLogData.maxSpeed)} knots <span class="text-[9px] text-gray-400">/ 87 limit</span>`;
  speedEl.className = flightLogData.speedCompliant ? "font-bold text-emerald-600" : "font-bold text-red-600 animate-pulse";
  
  const geoEl = document.getElementById('log-geofence');
  geoEl.textContent = flightLogData.geofenceCompliant ? "Compliant (100% in bounds)" : `Breached (${flightLogData.breachCount} points out)`;
  geoEl.className = flightLogData.geofenceCompliant ? "font-bold text-emerald-600" : "font-bold text-red-600 animate-pulse";
}

function openReportModal() {
  const modal = document.getElementById('report-preview-modal');
  const modalBox = modal.querySelector('div');
  
  if (!selectedPermit || !flightLogData) return;
  
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    modalBox.classList.remove('scale-95');
  }, 10);
  
  // Fill report text fields
  document.getElementById('report-nota-num').textContent = `45/06/02/PUPB-${selectedPermit.year}`;
  
  const opNames = document.querySelectorAll('#report-meta-op-name, #report-meta-op-name2, #report-tbl-operator');
  opNames.forEach(el => el.textContent = selectedPermit.operator_name);
  
  const locations = document.querySelectorAll('#report-meta-location, #report-tbl-location');
  locations.forEach(el => el.textContent = selectedPermit.location);
  
  document.getElementById('report-meta-permit-id').textContent = selectedPermit.permit_id;
  
  const formatDateString = (isoStr) => {
    if (!isoStr) return "";
    const [y, m, d] = isoStr.split('-');
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${d} ${months[parseInt(m) - 1]} ${y}`;
  };
  
  document.getElementById('report-meta-date').textContent = formatDateString(new Date().toISOString().split('T')[0]);
  document.getElementById('report-tbl-time').textContent = `${formatDateString(selectedPermit.date_start)} s.d ${formatDateString(selectedPermit.date_end)}`;
  
  const registries = Array.isArray(selectedPermit.puta_registry) ? selectedPermit.puta_registry.join(', ') : selectedPermit.puta_registry;
  document.getElementById('report-tbl-registry').textContent = registries || "None";
  
  const pilots = Array.isArray(selectedPermit.pilot_name) ? selectedPermit.pilot_name.join(', ') : selectedPermit.pilot_name;
  document.getElementById('report-tbl-pilots').textContent = pilots || "None";
  
  // Metric evaluations
  document.getElementById('report-eval-max-alt').textContent = Math.round(flightLogData.maxAltitude);
  document.getElementById('report-eval-limit-alt').textContent = selectedPermit.max_altitude_ft;
  
  const altStatusEl = document.getElementById('report-eval-alt-status');
  if (flightLogData.altCompliant) {
    altStatusEl.textContent = "memenuhi syarat (berada di bawah)";
    altStatusEl.className = "font-bold text-emerald-600";
  } else {
    altStatusEl.textContent = "MELANGGAR SYARAT (berada di atas)";
    altStatusEl.className = "font-bold text-red-600";
  }
  
  document.getElementById('report-eval-max-speed').textContent = Math.round(flightLogData.maxSpeed);
  document.getElementById('report-eval-max-speed-kmh').textContent = Math.round(flightLogData.maxSpeed * 1.852);
  
  const speedStatusEl = document.getElementById('report-eval-max-speed');
  speedStatusEl.className = flightLogData.speedCompliant ? "font-bold text-emerald-600" : "font-bold text-red-600";
  
  document.getElementById('report-eval-total-points').textContent = flightLogData.points.length;
  
  const breachPointsEl = document.getElementById('report-eval-breach-points');
  if (flightLogData.geofenceCompliant) {
    breachPointsEl.textContent = "0 (100% Compliant)";
    breachPointsEl.className = "font-bold text-emerald-600";
    document.getElementById('report-eval-geofence-status').textContent = "100% berada di dalam";
    document.getElementById('report-eval-geofence-status').className = "font-bold text-emerald-600";
  } else {
    breachPointsEl.textContent = `${flightLogData.breachCount} titik melanggar (Breach)`;
    breachPointsEl.className = "font-bold text-red-600";
    document.getElementById('report-eval-geofence-status').textContent = "MELANGGAR BATAS (terdapat titik di luar)";
    document.getElementById('report-eval-geofence-status').className = "font-bold text-red-600";
  }
  
  // Update Conclusion block colors & texts
  const conclusionTextEl = document.querySelector('#report-paper-container div.bg-emerald-50, #report-paper-container div.bg-red-50');
  const conclusionInnerEl = document.getElementById('report-conclusion-op').parentElement;
  document.getElementById('report-conclusion-op').textContent = selectedPermit.operator_name;
  
  const allCompliant = flightLogData.altCompliant && flightLogData.speedCompliant && flightLogData.geofenceCompliant;
  
  if (allCompliant) {
    if (conclusionTextEl) {
      conclusionTextEl.className = "p-4 bg-emerald-50 border border-emerald-200 rounded-2xl mt-4";
    }
    conclusionInnerEl.innerHTML = `Secara keseluruhan, operasi pengoperasian PUTA oleh <span class="font-bold">${selectedPermit.operator_name}</span> dinyatakan <strong>MEMENUHI SYARAT KESELAMATAN (COMPLIANT)</strong>. Tidak ditemukan adanya pelanggaran batas ketinggian, batas kecepatan, maupun batas koordinat geofencing. Rekomendasi diberikan untuk melanjutkan operasi dengan tetap mematuhi koordinasi AirNav Indonesia.`;
    conclusionInnerEl.className = "text-emerald-700 leading-relaxed text-justify m-0";
  } else {
    if (conclusionTextEl) {
      conclusionTextEl.className = "p-4 bg-red-50 border border-red-200 rounded-2xl mt-4";
    }
    conclusionInnerEl.innerHTML = `Secara keseluruhan, operasi pengoperasian PUTA oleh <span class="font-bold">${selectedPermit.operator_name}</span> dinyatakan <strong>TIDAK MEMENUHI SYARAT KESELAMATAN (NON-COMPLIANT)</strong>. Ditemukan adanya pelanggaran parameter batas izin pengoperasian drone (lihat rincian data evaluasi di atas). Disarankan untuk menangguhkan sementara operasi penerbangan dan meminta klarifikasi tertulis dari operator.`;
    conclusionInnerEl.className = "text-red-700 leading-relaxed text-justify m-0";
  }
  
  // Render Chart.js charts
  buildReportCharts();
}

function closeReportModal() {
  const modal = document.getElementById('report-preview-modal');
  const modalBox = modal.querySelector('div');
  
  modal.classList.add('opacity-0');
  modalBox.classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
}

function buildReportCharts() {
  // Clear previous chart instances
  activeCharts.forEach(chart => chart.destroy());
  activeCharts = [];
  
  const altCtx = document.getElementById('chart-report-altitude').getContext('2d');
  const speedCtx = document.getElementById('chart-report-speed').getContext('2d');
  
  const limitAlt = selectedPermit.max_altitude_ft || 400;
  
  const altLimitLine = Array(flightLogData.altitudes.length).fill(limitAlt);
  const speedLimitLine = Array(flightLogData.speeds.length).fill(87); // 87 knots civil cap
  
  // Altitude Chart
  const altChart = new Chart(altCtx, {
    type: 'line',
    data: {
      labels: flightLogData.timestamps,
      datasets: [
        {
          label: 'Ketinggian Terbang PUTA (ft)',
          data: flightLogData.altitudes,
          borderColor: '#0071e3',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'Batas Ketinggian Izin (ft)',
          data: altLimitLine,
          borderColor: '#ef4444',
          borderWidth: 1.5,
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 9 } } }
      },
      scales: {
        x: { display: false },
        y: {
          ticks: { font: { size: 8 } },
          title: { display: true, text: 'Ketinggian (feet)', font: { size: 9 } }
        }
      }
    }
  });
  activeCharts.push(altChart);
  
  // Speed Chart
  const speedChart = new Chart(speedCtx, {
    type: 'line',
    data: {
      labels: flightLogData.timestamps,
      datasets: [
        {
          label: 'Kecepatan Terbang PUTA (knots)',
          data: flightLogData.speeds,
          borderColor: '#10b981',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'Batas Kecepatan Izin (87 knots)',
          data: speedLimitLine,
          borderColor: '#ef4444',
          borderWidth: 1.5,
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 9 } } }
      },
      scales: {
        x: { display: false },
        y: {
          ticks: { font: { size: 8 } },
          title: { display: true, text: 'Kecepatan (knots)', font: { size: 9 } }
        }
      }
    }
  });
  activeCharts.push(speedChart);
}

async function exportReportToPDF() {
  const element = document.getElementById('report-paper-container');
  if (!element) return;
  
  showToast("Rendering PDF document, please wait...", "info");
  
  const dividers = element.querySelectorAll('.page-break-divider');
  dividers.forEach(el => el.style.opacity = '0'); // hide dividers in print output
  
  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });
    
    // Restore dividers in UI
    dividers.forEach(el => el.style.opacity = '1');
    
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    
    const pageHeightCanvas = (imgWidth / pdfWidth) * pdfHeight;
    let heightLeft = imgHeight;
    let position = 0;
    
    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, (imgHeight * pdfWidth) / imgWidth);
    heightLeft -= pageHeightCanvas;
    
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position * (pdfWidth / imgWidth), pdfWidth, (imgHeight * pdfWidth) / imgWidth);
      heightLeft -= pageHeightCanvas;
    }
    
    const sanitizedId = selectedPermit.permit_id.replace(/[\/\\?%*:|"<>\s]/g, '_');
    pdf.save(`Laporan_Pengawasan_PUTA_${sanitizedId}.pdf`);
    
    showToast("PDF report saved successfully!", "success");
  } catch (error) {
    console.error("PDF Export error:", error);
    showToast("Failed to render PDF report.", "error");
    dividers.forEach(el => el.style.opacity = '1');
  }
}
