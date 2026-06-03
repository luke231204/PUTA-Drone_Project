// Global App State
let permits = [];
let selectedPermit = null;
let map = null;
let polygonLayers = {};
let kkopLayers = [];
let countdownInterval = null;
let currentYearFilter = 'All';

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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

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
