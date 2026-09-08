// Global App State
let permits = [];
let selectedPermit = null;
let map = null;
let polygonLayers = {};
let kkopLayers = [];
let selectedAirport = null;
let currentNearAirportFilter = null;
let airportLayers = {};
let countdownInterval = null;
let currentYearFilter = 'All';
let currentStatusFilter = 'All'; // 'All', 'ACTIVE', 'PENDING', or 'EXPIRED'
let isFocusMode = false;
let customPermitColors = {};
try {
  const savedColors = localStorage.getItem('puta_custom_permit_colors');
  if (savedColors) customPermitColors = JSON.parse(savedColors);
} catch (e) {
  console.warn('Failed to parse saved permit colors', e);
}

// Multi-Flight Sortie Management State
let permitFlightSorties = {};
try {
  const savedSorties = localStorage.getItem('puta_permit_flight_sorties');
  if (savedSorties) permitFlightSorties = JSON.parse(savedSorties);
} catch (e) {
  console.warn('Failed to parse saved permit flight sorties', e);
}
let activeSortieMapLayers = {};
let isShowingAllSorties = false;
let currentHighlightedSortieId = null;

function saveSortiesToStorage() {
  try {
    localStorage.setItem('puta_permit_flight_sorties', JSON.stringify(permitFlightSorties));
  } catch (e) {
    console.warn('Failed to save permit flight sorties to localStorage:', e);
  }
}

function getPermitSorties(permitId) {
  if (!permitId) return [];
  return permitFlightSorties[permitId] || [];
}

async function bootstrapSampleSorties() {
  const sampleKey = '0016/APPROVAL-PUTA/DNP-2026';
  // If already loaded with high-fidelity points (>= 2000 points in both main track and studioData), keep it
  if (permitFlightSorties[sampleKey] && permitFlightSorties[sampleKey].length > 0) {
    const existing = permitFlightSorties[sampleKey][0];
    if (existing && existing.map_points && existing.map_points.length >= 2000 &&
        existing.studioData && existing.studioData.map_points && existing.studioData.map_points.length >= 2000) {
      return;
    }
  }
  try {
    const res = await fetch('data/sample_sorties.json');
    if (res.ok) {
      const data = await res.json();
      if (data && data[sampleKey]) {
        permitFlightSorties[sampleKey] = data[sampleKey];
        saveSortiesToStorage();
        console.log('Bootstrapped high-fidelity flight sortie for PT Timah Bangka (~2,935 points)');
      }
    }
  } catch (err) {
    console.warn('Could not bootstrap sample sorties from data/sample_sorties.json', err);
  }
}

function updateFocusModeUI() {
  const btn = document.getElementById('map-toggle-focus');
  const txt = document.getElementById('map-toggle-focus-text');
  if (!btn || !txt) return;

  if (isFocusMode) {
    btn.className = "flex items-center gap-1.5 cursor-pointer text-indigo-600 font-bold transition-colors";
    txt.textContent = "Focus Active: ON";
    const icon = btn.querySelector('svg');
    if (icon) {
      icon.classList.remove('text-gray-500');
      icon.classList.add('text-indigo-600');
    }
  } else {
    btn.className = "flex items-center gap-1.5 cursor-pointer text-gray-600 hover:text-indigo-600 transition-colors";
    txt.textContent = "Focus Active Only";
    const icon = btn.querySelector('svg');
    if (icon) {
      icon.classList.remove('text-indigo-600');
      icon.classList.add('text-gray-500');
    }
  }
}

function setPermitColor(permitId, color) {
  if (!color) {
    delete customPermitColors[permitId];
  } else {
    customPermitColors[permitId] = color;
  }
  try {
    localStorage.setItem('puta_custom_permit_colors', JSON.stringify(customPermitColors));
  } catch (e) {
    console.warn('Failed to save permit colors', e);
  }

  const poly = polygonLayers[permitId];
  if (poly) {
    const status = selectedPermit ? getPermitStatus(selectedPermit) : 'ACTIVE';
    const defaultColor = status === 'ACTIVE' ? '#10b981' : (status === 'PENDING' ? '#f59e0b' : '#8e9aa6');
    const effectiveColor = color || defaultColor;
    poly.setStyle({
      color: effectiveColor,
      fillColor: effectiveColor
    });
  }

  renderDashboard();
  renderInspector();
  showToast(color ? `Airspace color updated: ${color}` : "Color reset to default status color", "info");
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Auth Action — called directly from button onclick in HTML
// This bypasses ALL event listener setup to guarantee the button always works.
// ─────────────────────────────────────────────────────────────────────────────
window.doAuthAction = async function () {
  const email = (document.getElementById('auth-email') ? document.getElementById('auth-email').value : '').trim();
  const password = document.getElementById('auth-password') ? document.getElementById('auth-password').value : '';
  const alertBox = document.getElementById('auth-alert');
  const submitBtn = document.getElementById('auth-submit-btn');

  console.log(`[Auth] doAuthAction called: tab=${activeAuthTab}, email=${email}`);

  if (!email || !password) {
    if (alertBox) {
      alertBox.className = "p-3 text-xs font-semibold rounded-2xl border bg-red-50 border-red-200 text-red-700 block";
      alertBox.textContent = "Please enter your email and password.";
    }
    return;
  }

  if (alertBox) { alertBox.classList.add('hidden'); alertBox.textContent = ''; }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = activeAuthTab === 'login' ? 'Signing In...' : 'Registering...';
  }

  try {
    if (activeAuthTab === 'login') {
      console.log('[Auth] Calling window.api.signIn...');
      const res = await window.api.signIn(email, password);
      console.log('[Auth] signIn result:', res);
      if (res && res.success) {
        await checkAuthStatus();
      } else {
        throw new Error((res && res.error) || 'Invalid credentials');
      }
    } else {
      const roleRadio = document.querySelector('input[name="auth-role"]:checked');
      const role = roleRadio ? roleRadio.value : 'regular';
      console.log('[Auth] Calling window.api.signUp...');
      const res = await window.api.signUp(email, password, role);
      console.log('[Auth] signUp result:', res);
      if (res && res.success) {
        if (alertBox) {
          alertBox.className = "p-3 text-xs font-semibold rounded-2xl border bg-emerald-50 border-emerald-200 text-emerald-700 block";
          alertBox.textContent = role === 'inspector'
            ? "Registration successful! Inspector accounts must be approved before login."
            : "Registration successful! You can now log in.";
        }
        activeAuthTab = 'login';
        const tabLogin = document.getElementById('auth-tab-login');
        if (tabLogin) tabLogin.click();
      } else {
        throw new Error((res && res.error) || 'Registration failed');
      }
    }
  } catch (err) {
    console.error('[Auth] doAuthAction error:', err);
    if (alertBox) {
      alertBox.className = "p-3 text-xs font-semibold rounded-2xl border bg-red-50 border-red-200 text-red-700 block";
      alertBox.textContent = err.message || "An authentication error occurred.";
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = activeAuthTab === 'login' ? 'Sign In' : 'Register';
    }
  }
};

// Flight evaluation global states
let satelliteLayer = null;
let streetLayer = null;
let darkLayer = null;
let telemetryMapTileLayer = null;
let activeTileMode = 'streets';
let flightLogData = null;
let flightPathPolyline = null;
let activeCharts = [];

// Telemetry limits state
let telemetryLimitAgl = 1150;
let telemetryLimitAmsl = 1150;
let telemetryLimitSpeed = 100;
let telemetryLimitEnabled = true;
let telemetryAveragesEnabled = true;
let telemetryAltLimitMode = 'agl'; // 'agl' or 'amsl'

// Parsed telemetry file structures
let uploadedCsvFile = null;
let uploadedKmlFile = null;
let uploadedCsvData = null;  // Object with flight stats and points
let uploadedKmlCoords = null; // List of [lng, lat] for flight path map

// Telemetry Analyzer chart instances
let telemetryChartCombinedInstance = null;
let telemetryChartAltitudeInstance = null;
let telemetryChartAmslInstance = null;
let telemetryChartSpeedInstance = null;
let currentActiveTelemetryTab = 'combined';

// Telemetry Analyzer map states
let telemetryAnalyzerMap = null;
let telemetryAnalyzerPolylineKml = null;
let telemetryAnalyzerPolylineCsv = null;
let telemetryAnalyzerMarkerTakeoff = null;

// ADS-B Live Monitor state
let adsbMap = null;
let adsbMapTile = null;
let adsbMarkers = {}; // icao24 -> L.marker
let adsbFlightData = []; // latest fetched flight array
let adsbPollingInterval = null;
let adsbCountdownInterval = null;
let adsbCountdownSeconds = 12;
let adsbSelectedIcao = null;
let adsbSearchQuery = '';
let isAdsbModalOpen = false;
let isAdsbOnMainMap = false;
let adsbFlightDetailsCache = {}; // Cache: icao24 -> { aircraft: ..., route: ..., loading: boolean, error: boolean }


// OpenSky Network REST API — Sumatra bounding box
const OPENSKY_URL = 'https://opensky-network.org/api/states/all?lamin=-6.0&lomin=95.0&lamax=6.0&lomax=109.0';
const ADSB_REFRESH_INTERVAL = 12000; // 12 seconds (respects OpenSky anonymous rate limit)


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
  "pl ro grissik": [-2.35, 103.65],
  "surveillance sinarmas": [-2.50, 104.00],
  "musi hutan persada": [-3.58, 103.95],
  "candi muaro jambi": [-1.477, 103.67],
  "pt aks": [-2.73, 107.82],
  "pt ama": [-2.73, 107.82],
  "jalan tol kayu agung": [-3.39, 104.83],
  "pematang panggang": [-3.97, 104.93],
  "indralaya": [-3.21, 104.65],
  "pulau bangka": [-2.10, 106.10],
  "pulau belitung": [-2.73, 107.82],
  "pipa tgi": [-1.61, 103.61],
  "pt. prima alumga": [-3.30, 104.80],
  "pt. pinang witmas sejati": [-2.30, 103.95],
  "pt skytech indonesia_pt. bmh": [-3.20, 104.20],
  "sumsel, bengkulu dan lampung": [-3.50, 103.50],
  "sengeti": [-1.40, 103.60],
  "merlung": [-1.26, 103.04],
  "pesisir selatan": [-1.35, 100.57],
  "tanjung enim": [-3.75, 103.80],
  "mukomuko": [-2.58, 101.12],
  "muko muko": [-2.58, 101.12],
  "air manjunto": [-2.54, 101.14],
  "pangkal pinang": [-2.13, 106.11]
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

  // Jambi jurisdiction
  if (loc.includes('jambi') || loc.includes('sekernan') || loc.includes('bungo') ||
    loc.includes('kaos') || loc.includes('jabung') || loc.includes('muara bungo')) {
    return { name: "AirNav Jambi Tower", phone: "+62 (741) 57321" };
  }
  // Bengkulu jurisdiction (includes Muko-Muko and Enggano which are in Bengkulu province)
  if (loc.includes('bengkulu') || loc.includes('muko') || loc.includes('enggano')) {
    return { name: "AirNav Bengkulu Tower", phone: "+62 (736) 21014" };
  }
  // Palembang / South Sumatra jurisdiction (includes Pagar Alam and Lubuk Linggau)
  if (loc.includes('palembang') || loc.includes('ogan komering') || loc.includes('oki') ||
    loc.includes('muara enim') || loc.includes('kayu agung') || loc.includes('sumsel') ||
    loc.includes('sumatera selatan') || loc.includes('musi hutan') || loc.includes('gelam') ||
    loc.includes('dayung') || loc.includes('sambar') || loc.includes('sumpal') ||
    loc.includes('rebon jaro') || loc.includes('bayung') || loc.includes('witmas') ||
    loc.includes('pagar alam') || loc.includes('lubuk linggau') || loc.includes('lahat') ||
    loc.includes('baturaja') || loc.includes('ogan ilir')) {
    return { name: "AirNav Palembang Tower", phone: "+62 (711) 385006" };
  }
  // Belitung / Bangka Belitung jurisdiction
  if (loc.includes('belitung') || loc.includes('swp') || loc.includes('tanjung pandan')) {
    return { name: "AirNav Tanjung Pandan Tower", phone: "+62 (719) 21010" };
  }
  // Bangka / Pangkal Pinang jurisdiction
  if (loc.includes('bangka') || loc.includes('pangkal pinang')) {
    return { name: "AirNav Pangkal Pinang Tower", phone: "+62 (717) 422081" };
  }
  // West Sumatra jurisdiction (Padang, Kerinci, Rokot Sipora, Muko-Muko — default)
  return { name: "AirNav Padang Tower", phone: "+62 (751) 81920" };
}

// All airports under OTBAN Wilayah VI authority — for KKOP visualization and compliance checks
// Coordinates verified against resmi kemenhub.go.id (Indonesian Directorate General of Civil Aviation)
const REGION_AIRPORTS = [
  // --- Sumatera Barat ---
  {
    name: "Bandar Udara Internasional Minangkabau (PDG)",
    lat: -0.786670,
    lng: 100.28056,
    code: "PDG",
    icao: "WIEE",
    province: "Sumatera Barat",
    runway: "Runway 15/33, 3,000m x 45m, Asphalt",
    elevation: "16 ft (5 m) AMSL",
    operator: "PT Angkasa Pura II",
    frequency: "Minangkabau Tower: 118.1 MHz",
    emergencyName: "AirNav Padang Tower",
    emergencyPhone: "+62 (751) 81920",
    class: "Class I International"
  },
  {
    name: "Bandar Udara Rokot Sipora (RKI)",
    lat: -2.099058,
    lng: 99.705758,
    code: "RKI",
    icao: "WIEB",
    province: "Sumatera Barat",
    runway: "Runway 12/30, 1,500m x 30m, Asphalt",
    elevation: "26 ft (8 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Sipora Radio: 122.3 MHz",
    emergencyName: "AirNav Padang Tower",
    emergencyPhone: "+62 (751) 81920",
    class: "Class III Domestic"
  },
  {
    name: "Bandar Udara Kerinci / Depati Parbo (KRC)",
    lat: -2.094231,
    lng: 101.470808,
    code: "KRC",
    icao: "WIJI",
    province: "Jambi",
    runway: "Runway 12/30, 1,800m x 30m, Asphalt",
    elevation: "2,607 ft (795 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Kerinci Radio: 122.2 MHz",
    emergencyName: "AirNav Jambi Tower",
    emergencyPhone: "+62 (741) 57321",
    class: "Class III Domestic"
  },
  {
    name: "Bandar Udara Muko-Muko (MPC)",
    lat: -2.541092,
    lng: 101.088678,
    code: "MPC",
    icao: "WIGM",
    province: "Bengkulu",
    runway: "Runway 16/34, 1,400m x 30m, Asphalt",
    elevation: "27 ft (8 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Muko-Muko Radio: 122.3 MHz",
    emergencyName: "AirNav Bengkulu Tower",
    emergencyPhone: "+62 (736) 21014",
    class: "Class III Domestic"
  },
  // --- Bengkulu ---
  {
    name: "Bandar Udara Fatmawati Soekarno (BKS)",
    lat: -3.861280,
    lng: 102.339670,
    code: "BKS",
    icao: "WIGG",
    province: "Bengkulu",
    runway: "Runway 13/31, 2,239m x 45m, Asphalt",
    elevation: "50 ft (15 m) AMSL",
    operator: "PT Angkasa Pura II",
    frequency: "Fatmawati Tower: 118.1 MHz",
    emergencyName: "AirNav Bengkulu Tower",
    emergencyPhone: "+62 (736) 21014",
    class: "Class I Domestic"
  },
  {
    name: "Bandar Udara Enggano (ENG)",
    lat: -5.306639,
    lng: 102.189564,
    code: "ENG",
    icao: "WIGE",
    province: "Bengkulu",
    runway: "Runway 11/29, 1,600m x 30m, Asphalt",
    elevation: "47 ft (14 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Enggano Radio: 122.1 MHz",
    emergencyName: "AirNav Bengkulu Tower",
    emergencyPhone: "+62 (736) 21014",
    class: "Class III Domestic / Satker"
  },
  // --- Jambi ---
  {
    name: "Bandar Udara Sultan Thaha (DJB)",
    lat: -1.635060,
    lng: 103.646010,
    code: "DJB",
    icao: "WIJJ",
    province: "Jambi",
    runway: "Runway 13/31, 2,602m x 45m, Asphalt",
    elevation: "85 ft (26 m) AMSL",
    operator: "PT Angkasa Pura II",
    frequency: "Sultan Thaha Tower: 118.1 MHz",
    emergencyName: "AirNav Jambi Tower",
    emergencyPhone: "+62 (741) 57321",
    class: "Class I Domestic"
  },
  {
    name: "Bandar Udara Muara Bungo (BUU)",
    lat: -1.543333,
    lng: 102.178611,
    code: "BUU",
    icao: "WIJB",
    province: "Jambi",
    runway: "Runway 13/31, 2,100m x 30m, Asphalt",
    elevation: "195 ft (59 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Bungo Radio: 122.4 MHz",
    emergencyName: "AirNav Jambi Tower",
    emergencyPhone: "+62 (741) 57321",
    class: "Class III Domestic"
  },
  // --- Sumatera Selatan ---
  {
    name: "Bandar Udara Internasional Sultan Mahmud Badaruddin II (PLM)",
    lat: -2.896150,
    lng: 104.706970,
    code: "PLM",
    icao: "WIPP",
    province: "Sumatera Selatan",
    runway: "Runway 11/29, 3,000m x 45m, Asphalt",
    elevation: "33 ft (10 m) AMSL",
    operator: "PT Angkasa Pura II",
    frequency: "Palembang Tower: 118.1 MHz",
    emergencyName: "AirNav Palembang Tower",
    emergencyPhone: "+62 (711) 385006",
    class: "Class I International"
  },
  {
    name: "Bandar Udara Atung Bungsu / Pagar Alam (PXA)",
    lat: -4.024300,
    lng: 103.379170,
    code: "PXA",
    icao: "WIPY",
    province: "Sumatera Selatan",
    runway: "Runway 06/24, 1,500m x 30m, Asphalt",
    elevation: "2,093 ft (638 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Atung Bungsu Radio: 122.3 MHz",
    emergencyName: "AirNav Palembang Tower",
    emergencyPhone: "+62 (711) 385006",
    class: "Class III Domestic"
  },
  {
    name: "Bandar Udara Silampari / Lubuk Linggau (LLJ)",
    lat: -3.280000,
    lng: 102.917200,
    code: "LLJ",
    icao: "WIPB",
    province: "Sumatera Selatan",
    runway: "Runway 02/20, 2,220m x 30m, Asphalt",
    elevation: "410 ft (125 m) AMSL",
    operator: "UPT Ditjen Hubud (Kemenhub)",
    frequency: "Silampari Radio: 122.2 MHz",
    emergencyName: "AirNav Palembang Tower",
    emergencyPhone: "+62 (711) 385006",
    class: "Class III Domestic"
  },
  // --- Kepulauan Bangka Belitung ---
  {
    name: "Bandar Udara Depati Amir / Pangkal Pinang (PGK)",
    lat: -2.160630,
    lng: 106.141730,
    code: "PGK",
    icao: "WIKK",
    province: "Kepulauan Bangka Belitung",
    runway: "Runway 16/34, 2,250m x 45m, Asphalt",
    elevation: "108 ft (33 m) AMSL",
    operator: "PT Angkasa Pura II",
    frequency: "Depati Amir Tower: 118.1 MHz",
    emergencyName: "AirNav Pangkal Pinang Tower",
    emergencyPhone: "+62 (717) 422081",
    class: "Class I Domestic"
  },
  {
    name: "Bandar Udara H.AS. Hanandjoeddin / Tanjung Pandan (TJQ)",
    lat: -2.745280,
    lng: 107.753060,
    code: "TJQ",
    icao: "WIKT",
    province: "Kepulauan Bangka Belitung",
    runway: "Runway 15/33, 2,400m x 45m, Asphalt",
    elevation: "161 ft (49 m) AMSL",
    operator: "PT Angkasa Pura II",
    frequency: "Hanandjoeddin Tower: 118.2 MHz",
    emergencyName: "AirNav Tanjung Pandan Tower",
    emergencyPhone: "+62 (719) 21010",
    class: "Class I Domestic"
  }
];




// Authentication & Session State
let currentUser = null; // { user, profile }
let activeAuthTab = 'login'; // 'login' or 'register'

async function checkAuthStatus() {
  const gate = document.getElementById('auth-gate');
  const alertBox = document.getElementById('auth-alert');
  const pendingView = document.getElementById('auth-pending-view');
  const form = document.getElementById('auth-form');
  const tabs = document.getElementById('auth-tabs');

  try {
    const res = await window.api.getSession();
    console.log('[Auth] getSession result:', res);

    if (res && res.success && res.session) {
      currentUser = res.session;
      const isApproved = currentUser.profile ? currentUser.profile.approved : false;

      if (isApproved) {
        // Hide the gate
        if (gate) {
          gate.style.pointerEvents = 'none';
          gate.classList.add('opacity-0');
          setTimeout(() => gate.classList.add('hidden'), 300);
        }
        updateUserDisplay();
        await loadAndRenderData();
      } else {
        // User exists but is NOT approved (e.g. pending inspector)
        if (gate) {
          gate.style.pointerEvents = '';
          gate.classList.remove('hidden');
          requestAnimationFrame(() => gate.classList.remove('opacity-0'));
        }
        if (form) form.classList.add('hidden');
        if (tabs) tabs.classList.add('hidden');
        if (pendingView) pendingView.classList.remove('hidden');
        updateUserDisplay();
      }
    } else {
      // No session
      currentUser = null;
      if (gate) {
        gate.style.pointerEvents = '';
        gate.classList.remove('hidden');
        requestAnimationFrame(() => gate.classList.remove('opacity-0'));
      }
      if (form) form.classList.remove('hidden');
      if (tabs) tabs.classList.remove('hidden');
      if (pendingView) pendingView.classList.add('hidden');

      // Clear input fields when showing the gate
      const emailInput = document.getElementById('auth-email');
      const passwordInput = document.getElementById('auth-password');
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (alertBox) {
        alertBox.classList.add('hidden');
        alertBox.textContent = '';
      }
      updateUserDisplay();
    }
  } catch (err) {
    console.error('[Auth] checkAuthStatus error:', err);
    currentUser = null;
    if (gate) {
      gate.style.pointerEvents = '';
      gate.classList.remove('hidden');
      requestAnimationFrame(() => gate.classList.remove('opacity-0'));
    }
    if (form) form.classList.remove('hidden');
    if (tabs) tabs.classList.remove('hidden');
    if (pendingView) pendingView.classList.add('hidden');
    updateUserDisplay();
  }
}

function updateUserDisplay() {
  const emailEl = document.getElementById('user-display-email');
  const roleEl = document.getElementById('user-display-role');
  const addPermitBtn = document.getElementById('btn-add-permit');
  const adminCard = document.getElementById('portal-card-admin');
  const portalLogoutBtn = document.getElementById('btn-portal-logout');
  const headerLogoutBtn = document.getElementById('btn-header-logout');

  if (!currentUser) {
    if (emailEl) emailEl.textContent = "Guest";
    if (roleEl) roleEl.textContent = "Read-Only";
    if (addPermitBtn) addPermitBtn.classList.add('hidden');
    if (adminCard) adminCard.classList.add('hidden');
    if (portalLogoutBtn) portalLogoutBtn.classList.add('hidden');
    if (headerLogoutBtn) headerLogoutBtn.classList.add('hidden');
    return;
  }

  if (emailEl) emailEl.textContent = currentUser.user.email;
  if (roleEl) {
    const roleName = currentUser.profile ? currentUser.profile.role : 'regular';
    roleEl.textContent = roleName.charAt(0).toUpperCase() + roleName.slice(1);
  }

  const isReadWrite = currentUser.profile ? (currentUser.profile.approved && (currentUser.profile.role === 'inspector' || currentUser.profile.role === 'dev')) : false;
  if (addPermitBtn) {
    if (isReadWrite) addPermitBtn.classList.remove('hidden');
    else addPermitBtn.classList.add('hidden');
  }

  if (adminCard) {
    const isDev = currentUser.profile ? (currentUser.profile.role === 'dev') : false;
    if (isDev) adminCard.classList.remove('hidden');
    else adminCard.classList.add('hidden');
  }

  if (portalLogoutBtn) portalLogoutBtn.classList.remove('hidden');
  if (headerLogoutBtn) headerLogoutBtn.classList.remove('hidden');
}

// --- Unified Admin & System Control Panel ---
let activeAdminTab = 'users';
let allAdminProfiles = [];

window.openAdminModal = async function () {
  const modal = document.getElementById('admin-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.remove('opacity-0'));

  // Set default tab
  switchAdminTab('users');
};

window.closeAdminModal = function () {
  const modal = document.getElementById('admin-modal');
  if (!modal) return;
  modal.classList.add('opacity-0');
  setTimeout(() => modal.classList.add('hidden'), 300);
};

window.switchAdminTab = function (tabName) {
  activeAdminTab = tabName;
  const tabs = ['users', 'system', 'cache'];

  tabs.forEach(t => {
    const btn = document.getElementById(`admin-tab-${t}`);
    const panel = document.getElementById(`admin-panel-${t}`);

    if (btn) {
      if (t === tabName) {
        btn.className = "pb-2.5 border-b-2 border-indigo-600 text-indigo-600 focus:outline-none transition-all";
      } else {
        btn.className = "pb-2.5 border-b-2 border-transparent hover:text-[#2a2334] focus:outline-none transition-all";
      }
    }

    if (panel) {
      if (t === tabName) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    }
  });

  if (tabName === 'users') {
    refreshAdminProfiles();
  } else if (tabName === 'system') {
    refreshAdminDiagnostics();
  }
};

async function refreshAdminProfiles() {
  const list = document.getElementById('admin-users-list');
  const loading = document.getElementById('admin-users-loading');
  if (!list || !loading) return;

  list.classList.add('hidden');
  loading.classList.remove('hidden');
  loading.textContent = "Loading database profiles...";

  const res = await window.api.getAllProfiles();
  if (res && res.success && res.list) {
    allAdminProfiles = res.list;
    renderAdminProfilesList();
  } else {
    loading.textContent = `Error loading profiles: ${res ? res.error : "Unknown error"}`;
  }
}

window.renderAdminProfilesList = function () {
  const list = document.getElementById('admin-users-list');
  const loading = document.getElementById('admin-users-loading');
  const searchInput = document.getElementById('admin-users-search');
  const query = searchInput ? searchInput.value.toLowerCase() : "";
  if (!list || !loading) return;

  loading.classList.add('hidden');
  list.classList.remove('hidden');

  const filtered = allAdminProfiles.filter(p => p.email && p.email.toLowerCase().includes(query));

  if (filtered.length === 0) {
    list.innerHTML = `<div class="text-center py-8 text-gray-400 text-xs font-semibold">No profiles match the search.</div>`;
    return;
  }

  list.innerHTML = filtered.map(user => {
    const isCurrentUser = currentUser && currentUser.user && currentUser.user.email === user.email;
    return `
      <div class="flex items-center justify-between p-3.5 rounded-2xl bg-gray-50 border border-black/[0.03] text-xs font-bold gap-3">
        <div class="space-y-0.5 min-w-0 flex-1">
          <p class="font-extrabold text-[#2a2334] truncate">${user.email} ${isCurrentUser ? '<span class="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100/50">You</span>' : ''}</p>
          <div class="flex items-center gap-1.5 mt-1 text-[9px] text-gray-400 uppercase tracking-wide">
            <span>Status:</span>
            <span class="${user.approved ? 'text-emerald-600 font-extrabold' : 'text-amber-500 font-extrabold'}">
              ${user.approved ? 'Approved' : 'Pending Approval'}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2.5 shrink-0">
          <!-- Role Selector -->
          <select onchange="updateUserProfile('${user.id}', { role: this.value })" class="bg-white border border-black/10 rounded-xl px-2 py-1 text-[11px] font-bold text-gray-700 focus:outline-none">
            <option value="regular" ${user.role === 'regular' ? 'selected' : ''}>Regular</option>
            <option value="inspector" ${user.role === 'inspector' ? 'selected' : ''}>Inspector</option>
            <option value="dev" ${user.role === 'dev' ? 'selected' : ''}>Developer</option>
          </select>
          <!-- Approved Switch -->
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" ${user.approved ? 'checked' : ''} onchange="updateUserProfile('${user.id}', { approved: this.checked })" class="sr-only peer" ${isCurrentUser ? 'disabled' : ''}>
            <div class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </div>
    `;
  }).join('');
};

window.updateUserProfile = async function (userId, updates) {
  showToast("Updating user profile...", "info");
  const res = await window.api.updateProfile(userId, updates);
  if (res && res.success) {
    showToast("Profile updated successfully!", "success");
    // Update local cache of profiles
    allAdminProfiles = allAdminProfiles.map(p => p.id === userId ? { ...p, ...updates } : p);
    // If the updated user is the active user, refresh active session details
    if (currentUser && currentUser.user && currentUser.user.id === userId) {
      if (currentUser.profile) {
        currentUser.profile = { ...currentUser.profile, ...updates };
      }
      updateUserDisplay();
    }
  } else {
    showToast(`Failed to update profile: ${res ? res.error : "Unknown error"}`, "error");
    refreshAdminProfiles(); // reload to reset UI controls
  }
};

async function refreshAdminDiagnostics() {
  const res = await window.api.getDiagnostics();
  if (res && res.success) {
    const el = (id) => document.getElementById(id);
    if (el('diag-supabase-url')) el('diag-supabase-url').textContent = res.supabaseUrl;
    if (el('diag-gdrive-path')) el('diag-gdrive-path').textContent = res.gdrivePath;

    // Cache size formatting
    const sizeKB = (res.cacheSize / 1024).toFixed(1);
    if (el('diag-cache-size')) el('diag-cache-size').textContent = `${sizeKB} KB (${res.cacheSize} bytes)`;

    // Active session details
    if (el('diag-active-session')) {
      el('diag-active-session').textContent = currentUser ? currentUser.user.email : "No active session";
    }

    // Google Drive indicator
    const gdIndicator = el('diag-gdrive-indicator');
    const gdStatus = el('diag-gdrive-status');
    if (gdIndicator && gdStatus) {
      if (res.gdrivePath && res.gdrivePath !== "Not found") {
        gdIndicator.className = "w-2.5 h-2.5 rounded-full bg-emerald-500";
        gdStatus.textContent = "Detected";
      } else {
        gdIndicator.className = "w-2.5 h-2.5 rounded-full bg-red-500";
        gdStatus.textContent = "Sync Folder Not Found";
      }
    }
  }
}

window.triggerAdminSync = async function () {
  const btn = document.getElementById('admin-btn-sync');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Syncing...";
  }
  showToast("Force-synchronizing permits cache...", "info");
  try {
    // Calling loadAndRenderData pulls the latest records from Supabase Rest API and updates the local cache
    await loadAndRenderData();
    showToast("Permits synchronized with Cloud DB!", "success");
    refreshAdminDiagnostics();
  } catch (err) {
    showToast("Sync failed: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Sync Permits Database";
    }
  }
};

window.triggerAdminCacheReset = async function () {
  const confirmReset = confirm("CRITICAL WARNING:\nAre you sure you want to clear local cache, delete session tokens, and log out? This will completely reset the application state.");
  if (!confirmReset) return;

  showToast("Clearing local storage cache and session...", "info");
  try {
    await window.api.logout();
    currentUser = null;
    await checkAuthStatus();
    closeAdminModal();
    showToast("Cache cleared! Please sign in again.", "success");
  } catch (err) {
    showToast("Reset failed: " + err.message, "error");
  }
};

// Initialize application when loaded
window.addEventListener('DOMContentLoaded', async () => {
  try {
    initDarkMode();
  } catch (err) {
    console.error("Failed to initialize dark mode:", err);
  }

  try {
    initMap();
  } catch (err) {
    console.error("Failed to initialize Leaflet map:", err);
  }

  // Setup event listeners FIRST (before checkAuthStatus) so auth buttons
  // are always clickable as soon as the gate is shown
  try {
    setupEventListeners();
  } catch (err) {
    console.error("Failed to setup event listeners:", err);
  }

  try {
    await checkAuthStatus();
  } catch (err) {
    console.error("Failed to check auth status:", err);
  }
});

// 1. GIS Map Canvas Setup
function initMap() {
  if (typeof L === 'undefined') {
    console.warn("Leaflet (L) library is not defined. Map display will be disabled.");
    return;
  }
  // Center near Padang, West Sumatra (OTBAN Region VI main area)
  map = L.map('map', {
    zoomControl: false
  }).setView([-1.5, 101.5], 7);

  // Add zoom control at bottom right
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Load sleek street theme map tiles from OpenStreetMap
  streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  });

  // Load dark theme map tiles from Carto Dark Matter without subdomains / with OpenStreetMap fallback
  darkLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'dark-map-tiles'
  });

  // Load satellite tiles
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 20
  });

  // Add initial street or dark layer based on current theme preference
  const isDarkModeInit = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
  if (isDarkModeInit) {
    darkLayer.addTo(map);
  } else {
    streetLayer.addTo(map);
  }

  // Map Tile Toggle
  const mapToggle = document.getElementById('map-toggle-satellite');
  const mapToggleText = document.getElementById('map-toggle-text');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      if (activeTileMode === 'streets') {
        const isCurrentDark = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
        if (isCurrentDark) {
          map.removeLayer(darkLayer);
        } else {
          map.removeLayer(streetLayer);
        }
        satelliteLayer.addTo(map);
        activeTileMode = 'satellite';
        mapToggleText.textContent = "Street Map";
        mapToggle.classList.add('text-[#4a5d3e]');
      } else {
        map.removeLayer(satelliteLayer);
        const isCurrentDark = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
        if (isCurrentDark) {
          darkLayer.addTo(map);
        } else {
          streetLayer.addTo(map);
        }
        activeTileMode = 'streets';
        mapToggleText.textContent = "Satellite Map";
        mapToggle.classList.remove('text-[#4a5d3e]');
      }
    });
  }

  // ADS-B Live Flights Toggle
  const adsbToggleBtn = document.getElementById('map-toggle-adsb');
  const adsbToggleText = document.getElementById('map-toggle-adsb-text');
  if (adsbToggleBtn) {
    adsbToggleBtn.addEventListener('click', () => {
      isAdsbOnMainMap = !isAdsbOnMainMap;
      if (isAdsbOnMainMap) {
        adsbToggleText.textContent = "Hide Live Flights";
        adsbToggleBtn.classList.add('text-sky-600');
        showToast("Live ADS-B Flight monitoring enabled on main map", "info");
      } else {
        adsbToggleText.textContent = "Show Live Flights";
        adsbToggleBtn.classList.remove('text-sky-600');
        // Instantly remove all plane markers from the main map
        for (const marker of Object.values(adsbMarkers)) {
          if (map && map.hasLayer(marker)) {
            map.removeLayer(marker);
          }
        }
      }
      updateAdsbPolling();
    });
  }

  // Focus Active Airspace Toggle
  const focusToggleBtn = document.getElementById('map-toggle-focus');
  if (focusToggleBtn) {
    focusToggleBtn.addEventListener('click', () => {
      isFocusMode = !isFocusMode;
      updateFocusModeUI();
      renderDashboard();
      if (selectedPermit) {
        renderInspector();
        showToast(isFocusMode ? "Focus Mode: Only active permit airspace is displayed" : "Focus Mode: All regional airspaces restored", "info");
      } else {
        showToast(isFocusMode ? "Focus Mode enabled. Select a permit to isolate its airspace." : "Focus Mode disabled", "info");
      }
    });
  }
  updateFocusModeUI();

  // Plot KKOP Airport Safety zones (indigo border rings) & Interactive IATA code badges
  REGION_AIRPORTS.forEach(airport => {
    // 5km Ring (No Fly Zone buffer)
    const nfzRing = L.circle([airport.lat, airport.lng], {
      color: '#4f46e5',
      fillColor: '#4f46e5',
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: '4, 4',
      radius: 5000 // 5 kilometers
    }).addTo(map);

    // Create a beautiful custom HTML marker with the 3-letter IATA code
    const airportIcon = L.divIcon({
      html: `
        <div class="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-[9px] shadow-md shadow-indigo-600/20 border border-white hover:scale-110 active:scale-95 transition-all cursor-pointer">
          ${airport.code}
        </div>`,
      className: 'custom-airport-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([airport.lat, airport.lng], { icon: airportIcon }).addTo(map);

    const handleAirportClick = (e) => {
      L.DomEvent.stopPropagation(e);
      selectAirport(airport);
    };

    marker.on('click', handleAirportClick);
    nfzRing.on('click', handleAirportClick);

    airportLayers[airport.code] = { ring: nfzRing, marker: marker };

    kkopLayers.push(nfzRing);
    kkopLayers.push(marker);
  });
}

// 2. Load permits from Electron Preload IPC and render Dashboard
async function loadAndRenderData() {
  try {
    // Pull permit JSON via the electron IPC bridge
    permits = await window.api.loadPermits();

    // Bootstrap sample sorties (e.g. PT Timah Bangka) if not already loaded
    await bootstrapSampleSorties();

    // Sort permits by year desc, then permit ID
    permits.sort((a, b) => b.year - a.year || a.permit_id.localeCompare(b.permit_id));

    renderDashboard();
    // Pre-populate portal stats so they're ready when portal is shown
    setTimeout(updatePortalStats, 100);
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

  // Format local date today as YYYY-MM-DD in the local timezone (not UTC)
  const todayStr = now.toLocaleDateString('en-CA'); // returns YYYY-MM-DD in local time

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
  // Dark mode button handler
  const btnDarkMode = document.getElementById('btn-toggle-dark-mode');
  if (btnDarkMode) {
    btnDarkMode.addEventListener('click', toggleDarkMode);
  }

  // Debounced search input — avoids re-rendering on every single keypress
  const searchInput = document.getElementById('search-input');
  let searchDebounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(renderDashboard, 300);
    });
  }

  // Year filter tabs
  const yearTabs = ['all', '2026', '2025', '2024'];
  yearTabs.forEach(tab => {
    const btn = document.getElementById(`tab-${tab}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      yearTabs.forEach(t => {
        const otherBtn = document.getElementById(`tab-${t}`);
        if (otherBtn) otherBtn.className = "flex-1 py-1.5 rounded-xl hover:text-[#2a2334] transition-colors";
      });
      btn.className = "flex-1 py-1.5 rounded-xl bg-white text-[#2a2334] shadow-sm";
      currentYearFilter = tab === 'all' ? 'All' : parseInt(tab);
      renderDashboard();
    });
  });

  // Status filter tabs
  const statusTabs = ['all', 'active', 'pending', 'expired'];
  statusTabs.forEach(status => {
    const btn = document.getElementById(`status-${status}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      statusTabs.forEach(s => {
        const otherBtn = document.getElementById(`status-${s}`);
        if (otherBtn) otherBtn.className = "flex-1 py-1.5 rounded-xl hover:text-[#2a2334] transition-colors";
      });
      btn.className = "flex-1 py-1.5 rounded-xl bg-white text-[#2a2334] shadow-sm";
      currentStatusFilter = status === 'all' ? 'All' : status.toUpperCase();
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

  // PDF file selector button handlers
  const btnSelectPdf = document.getElementById('btn-select-pdf');
  const inputPdfFile = document.getElementById('input-pdf-file');
  const selectedPdfName = document.getElementById('selected-pdf-name');
  if (btnSelectPdf && inputPdfFile) {
    btnSelectPdf.addEventListener('click', () => inputPdfFile.click());
    inputPdfFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedPdfName.textContent = file.name;
        selectedPdfName.classList.remove('italic', 'text-gray-500');
        selectedPdfName.classList.add('text-gray-800', 'font-bold');
      } else {
        selectedPdfName.textContent = "No file chosen";
        selectedPdfName.classList.add('italic', 'text-gray-500');
        selectedPdfName.classList.remove('text-gray-800', 'font-bold');
      }
    });
  }

  // Back to Portal / Home button
  const btnHome = document.getElementById('btn-back-to-portal');
  if (btnHome) {
    btnHome.addEventListener('click', showPortal);
  }

  // Interactive Portal Status Card click listeners
  const statCardActive = document.getElementById('portal-stat-card-active');
  if (statCardActive) {
    statCardActive.addEventListener('click', () => {
      showDashboard();
      const tabActive = document.getElementById('status-active');
      if (tabActive) {
        tabActive.click();
      }
    });
  }

  const statCardPending = document.getElementById('portal-stat-card-pending');
  if (statCardPending) {
    statCardPending.addEventListener('click', () => {
      showDashboard();
      const tabPending = document.getElementById('status-pending');
      if (tabPending) {
        tabPending.click();
      }
    });
  }

  const statCardExpired = document.getElementById('portal-stat-card-expired');
  if (statCardExpired) {
    statCardExpired.addEventListener('click', () => {
      showDashboard();
      const tabExpired = document.getElementById('status-expired');
      if (tabExpired) {
        tabExpired.click();
      }
    });
  }

  // Portal Card Click Listeners
  const cardGis = document.getElementById('portal-card-gis');
  if (cardGis) {
    cardGis.addEventListener('click', showDashboard);
  }

  // Portal Tools Card Click Listeners
  const toolTelemetry = document.getElementById('portal-tool-telemetry');
  if (toolTelemetry) {
    toolTelemetry.addEventListener('click', () => {
      showDashboard();
      openTelemetryAnalyzer();
    });
  }

  const toolKml = document.getElementById('portal-tool-kml');
  if (toolKml) {
    toolKml.addEventListener('click', () => {
      showDashboard();
      openConverterModal();
    });
  }

  const toolUlg = document.getElementById('portal-tool-ulg');
  if (toolUlg) {
    toolUlg.addEventListener('click', () => {
      showDashboard();
      openUlgConverterModal();
    });
  }

  // Workspace Tools Dropdown logic
  const btnToolsDropdown = document.getElementById('btn-tools-dropdown');
  const toolsDropdownMenu = document.getElementById('tools-dropdown-menu');
  if (btnToolsDropdown && toolsDropdownMenu) {
    btnToolsDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      toolsDropdownMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!toolsDropdownMenu.classList.contains('hidden')) {
        toolsDropdownMenu.classList.add('hidden');
      }
    });
  }

  // Workspace Header Dropdown Item Listeners
  const menuItemTelemetry = document.getElementById('menu-item-telemetry');
  if (menuItemTelemetry) {
    menuItemTelemetry.addEventListener('click', () => {
      openTelemetryAnalyzer();
    });
  }

  const menuItemKml = document.getElementById('menu-item-kml');
  if (menuItemKml) {
    menuItemKml.addEventListener('click', () => {
      openConverterModal();
    });
  }

  const menuItemUlg = document.getElementById('menu-item-ulg');
  if (menuItemUlg) {
    menuItemUlg.addEventListener('click', () => {
      openUlgConverterModal();
    });
  }

  const cardRegulations = document.getElementById('portal-card-regulations');
  if (cardRegulations) {
    cardRegulations.addEventListener('click', openRegulationsLibrary);
  }

  const cardAdsb = document.getElementById('portal-card-adsb');
  if (cardAdsb) {
    cardAdsb.addEventListener('click', openAdsbMonitor);
  }

  const cardAdmin = document.getElementById('portal-card-admin');
  if (cardAdmin) {
    cardAdmin.addEventListener('click', openAdminModal);
  }

  // Admin Panel Tab Switchers
  const tabAdminUsers = document.getElementById('admin-tab-users');
  if (tabAdminUsers) tabAdminUsers.addEventListener('click', () => switchAdminTab('users'));

  const tabAdminSystem = document.getElementById('admin-tab-system');
  if (tabAdminSystem) tabAdminSystem.addEventListener('click', () => switchAdminTab('system'));

  const tabAdminCache = document.getElementById('admin-tab-cache');
  if (tabAdminCache) tabAdminCache.addEventListener('click', () => switchAdminTab('cache'));

  // Admin Panel User Search
  const adminUsersSearch = document.getElementById('admin-users-search');
  if (adminUsersSearch) {
    adminUsersSearch.addEventListener('input', () => {
      renderAdminProfilesList();
    });
  }

  // Author card and footer profile listeners
  const cardAuthor = document.getElementById('portal-card-author');
  if (cardAuthor) {
    cardAuthor.addEventListener('click', openAuthorModal);
  }

  const btnFooterAuthor = document.getElementById('btn-footer-author');
  if (btnFooterAuthor) {
    btnFooterAuthor.addEventListener('click', openAuthorModal);
  }

  const btnSidebarAuthor = document.getElementById('btn-sidebar-author');
  if (btnSidebarAuthor) {
    btnSidebarAuthor.addEventListener('click', openAuthorModal);
  }

  // Close author modal if clicking on the background overlay
  const authorModal = document.getElementById('author-modal');
  if (authorModal) {
    authorModal.addEventListener('click', (e) => {
      if (e.target === authorModal) {
        closeAuthorModal();
      }
    });
  }

  // KML Converter Modal listeners
  const btnOpenConverter = document.getElementById('btn-open-converter');
  if (btnOpenConverter) btnOpenConverter.addEventListener('click', openConverterModal);

  const btnCloseConv1 = document.getElementById('close-converter-modal');
  if (btnCloseConv1) btnCloseConv1.addEventListener('click', closeConverterModal);

  const btnCloseConv2 = document.getElementById('btn-close-converter');
  if (btnCloseConv2) btnCloseConv2.addEventListener('click', closeConverterModal);

  const converterDropZone = document.getElementById('converter-drop-zone');
  const converterFileInput = document.getElementById('converter-file-input');

  if (converterDropZone && converterFileInput) {
    converterDropZone.addEventListener('click', () => converterFileInput.click());
    converterFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) processConverterFile(file);
    });

    converterDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      converterDropZone.classList.add('border-indigo-400');
    });

    converterDropZone.addEventListener('dragleave', () => {
      converterDropZone.classList.remove('border-indigo-400');
    });

    converterDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      converterDropZone.classList.remove('border-indigo-400');
      const file = e.dataTransfer.files[0];
      if (file) processConverterFile(file);
    });
  }

  const btnDownloadKml = document.getElementById('btn-download-conv-kml');
  if (btnDownloadKml) btnDownloadKml.addEventListener('click', downloadConvertedKml);

  const btnViewConvMap = document.getElementById('btn-view-conv-map');
  if (btnViewConvMap) btnViewConvMap.addEventListener('click', viewConvertedPolygonsOnMap);

  // ==========================================
  // Auth and Role Management Event Listeners
  // ==========================================

  // Bind to form submit (in case Enter key or native form trigger is used)
  const authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.doAuthAction();
    });
  }



  // Auth tabs switching
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const roleSelection = document.getElementById('auth-role-selection');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('auth-submit-btn');

  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
      activeAuthTab = 'login';
      tabLogin.className = "flex-1 py-2 rounded-xl bg-white text-[#2a2334] shadow-sm";
      tabRegister.className = "flex-1 py-2 rounded-xl hover:text-[#2a2334] transition-colors";
      if (roleSelection) roleSelection.classList.add('hidden');
      if (authTitle) authTitle.textContent = "Access PUTA-Monitor";
      if (authSubtitle) authSubtitle.textContent = "Enter your credentials to access the airspace visualizer.";
      if (submitBtn) submitBtn.textContent = "Sign In";
    });

    tabRegister.addEventListener('click', () => {
      activeAuthTab = 'register';
      tabRegister.className = "flex-1 py-2 rounded-xl bg-white text-[#2a2334] shadow-sm";
      tabLogin.className = "flex-1 py-2 rounded-xl hover:text-[#2a2334] transition-colors";
      if (roleSelection) roleSelection.classList.remove('hidden');
      if (authTitle) authTitle.textContent = "Create Account";
      if (authSubtitle) authSubtitle.textContent = "Join PUTA-Monitor to track regional Sumatra airspace.";
      if (submitBtn) submitBtn.textContent = "Register";
    });
  }

  // Role selections click visual updates
  const roleRadios = document.querySelectorAll('input[name="auth-role"]');
  roleRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      roleRadios.forEach(r => {
        const label = r.closest('label');
        if (label) {
          if (r.checked) {
            label.className = "flex flex-col p-2.5 rounded-xl border border-[#4a5d3e]/40 bg-white cursor-pointer transition-all select-none ring-2 ring-[#4a5d3e]/10";
          } else {
            label.className = "flex flex-col p-2.5 rounded-xl border border-black/5 bg-[#f5f6f4] cursor-pointer hover:bg-white hover:border-[#4a5d3e]/40 transition-all select-none";
          }
        }
      });
    });
  });

  // Logout buttons
  const logoutButtons = [
    document.getElementById('btn-portal-logout'),
    document.getElementById('btn-header-logout'),
    document.getElementById('auth-pending-logout-btn')
  ];
  logoutButtons.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', async () => {
        const confirmLogout = confirm("Are you sure you want to log out?");
        if (!confirmLogout) return;
        await window.api.logout();
        currentUser = null;
        await checkAuthStatus();
      });
    }
  });

  // Pending read-only button
  const btnReadonly = document.getElementById('auth-pending-readonly-btn');
  if (btnReadonly) {
    btnReadonly.addEventListener('click', () => {
      const gate = document.getElementById('auth-gate');
      if (gate) {
        gate.style.pointerEvents = 'none';
        gate.classList.add('opacity-0');
        setTimeout(() => gate.classList.add('hidden'), 300);
      }
      updateUserDisplay();
      loadAndRenderData();
    });
  }
}


// Calculate distance in meters between two lat/lng coordinates (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}

function countCoordinatesVertices(coords) {
  if (!coords || !Array.isArray(coords) || coords.length === 0) return 0;
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
    return coords.reduce((acc, ring) => acc + (Array.isArray(ring) ? ring.length : 0), 0);
  }
  if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
    return coords.length;
  }
  return 0;
}

function isPermitNearAirport(permit, airport) {
  let coords = null;
  if (permit.coordinates && permit.coordinates.length > 0) {
    if (Array.isArray(permit.coordinates[0]) && Array.isArray(permit.coordinates[0][0])) {
      coords = permit.coordinates[0][0];
    } else if (Array.isArray(permit.coordinates[0]) && typeof permit.coordinates[0][0] === 'number') {
      coords = permit.coordinates[0];
    }
  }
  if (!coords) {
    coords = getCoordsFromLocation(permit.location);
  }
  if (!coords) return false;

  const dist = getDistance(coords[0], coords[1], airport.lat, airport.lng);
  return dist <= 25000; // 25 km radius
}

window.clearNearAirportFilter = function () {
  currentNearAirportFilter = null;
  const banner = document.getElementById('active-filters-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
  renderDashboard();
};

function getPermitFirstCoordinate(permit) {
  if (permit.coordinates && permit.coordinates.length > 0) {
    if (Array.isArray(permit.coordinates[0]) && Array.isArray(permit.coordinates[0][0])) {
      return permit.coordinates[0][0];
    } else if (Array.isArray(permit.coordinates[0]) && typeof permit.coordinates[0][0] === 'number') {
      return permit.coordinates[0];
    }
  }
  return getCoordsFromLocation(permit.location);
}

function getPermitPolygonCoords(permit) {
  if (!permit) return [];
  if (permit.coordinates && permit.coordinates.length >= 3) {
    if (Array.isArray(permit.coordinates[0]) && Array.isArray(permit.coordinates[0][0])) {
      return permit.coordinates[0];
    }
    return permit.coordinates;
  }
  return [];
}

// Check if two line segments (p1-p2 and p3-p4) intersect
function lineSegmentsIntersect(p1, p2, p3, p4) {
  function ccw(A, B, C) {
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
  }
  return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
}

// Check if two permit airspaces overlap (point-in-polygon or edge intersection)
function checkAirspaceConflict(permitA, permitB) {
  const polyA = getPermitPolygonCoords(permitA);
  const polyB = getPermitPolygonCoords(permitB);
  const hasPolyA = polyA.length >= 3;
  const hasPolyB = polyB.length >= 3;

  // Case 1: Both have full official NOTAM polygons
  if (hasPolyA && hasPolyB) {
    // Check if any vertex of A is inside B
    for (const pt of polyA) {
      if (isPointInPolygon([pt[0], pt[1]], polyB)) {
        return { isOverlap: true, isPotential: false, label: 'DIRECT OVERLAP' };
      }
    }
    // Check if any vertex of B is inside A
    for (const pt of polyB) {
      if (isPointInPolygon([pt[0], pt[1]], polyA)) {
        return { isOverlap: true, isPotential: false, label: 'DIRECT OVERLAP' };
      }
    }
    // Check if any polygon boundary segments cross
    for (let i = 0; i < polyA.length; i++) {
      const a1 = polyA[i], a2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j++) {
        const b1 = polyB[j], b2 = polyB[(j + 1) % polyB.length];
        if (lineSegmentsIntersect(a1, a2, b1, b2)) {
          return { isOverlap: true, isPotential: false, label: 'DIRECT OVERLAP' };
        }
      }
    }
    return { isOverlap: false, isPotential: false };
  }

  // Case 2: One has official polygon, the other only has fallback default circle/location
  const coordA = getPermitFirstCoordinate(permitA);
  const coordB = getPermitFirstCoordinate(permitB);

  if (hasPolyA && coordB) {
    if (isPointInPolygon(coordB, polyA)) {
      return {
        isOverlap: true,
        isPotential: true,
        label: 'POTENTIAL OVERLAP',
        note: `Target has no published NOTAM polygon yet (estimated from default ~6km circle for ${permitB.location})`
      };
    }
  }
  if (hasPolyB && coordA) {
    if (isPointInPolygon(coordA, polyB)) {
      return {
        isOverlap: true,
        isPotential: true,
        label: 'POTENTIAL OVERLAP',
        note: `Current permit uses default location circle for ${permitA.location} (NOTAM polygon pending)`
      };
    }
  }

  // Case 3: Both rely on fallback approximate coordinate circle (< 12km mutual radius overlap)
  if (coordA && coordB) {
    const dist = getDistance(coordA[0], coordA[1], coordB[0], coordB[1]);
    if (dist <= 12000) {
      return {
        isOverlap: true,
        isPotential: true,
        label: 'POTENTIAL PROXIMITY',
        note: 'Both operations use default location buffers'
      };
    }
  }

  return { isOverlap: false, isPotential: false };
}

function getPermitToPermitDistance(permitA, permitB) {
  const polyA = getPermitPolygonCoords(permitA);
  const polyB = getPermitPolygonCoords(permitB);

  // If both have polygons, find minimum distance between any vertices
  if (polyA.length >= 3 && polyB.length >= 3) {
    let minDist = Infinity;
    for (const a of polyA) {
      for (const b of polyB) {
        const d = getDistance(a[0], a[1], b[0], b[1]);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  }

  const coordA = getPermitFirstCoordinate(permitA);
  const coordB = getPermitFirstCoordinate(permitB);
  if (!coordA || !coordB) return 99999999;
  return getDistance(coordA[0], coordA[1], coordB[0], coordB[1]);
}

function computeSpatialConflictMatrix(permit) {
  const coord = getPermitFirstCoordinate(permit);
  if (!coord) {
    return {
      badgeClass: 'bg-gray-100 text-gray-500 border border-gray-200',
      badgeText: 'NO GEOMETRY',
      kkopText: 'Location undefined',
      kkopClass: 'text-gray-500',
      trafficText: 'Unknown',
      trafficClass: 'text-gray-500',
      advisorySummary: 'Attach NOTAM or coordinates to calculate spatial proximity risks.',
      hasConflict: false,
      conflictList: []
    };
  }

  // 1. Check proximity to 9 regional airports (KKOP)
  let nearestAirport = null;
  let minAirportDist = Infinity;
  for (const ap of REGION_AIRPORTS) {
    const d = getDistance(coord[0], coord[1], ap.lat, ap.lng);
    if (d < minAirportDist) {
      minAirportDist = d;
      nearestAirport = ap;
    }
  }

  let kkopStatus = 'Clear (>25km)';
  let kkopClass = 'text-emerald-600 font-semibold';
  let severity = 'clear';

  if (minAirportDist <= 5000) {
    kkopStatus = `⚠️ Inside 5km NFZ (${nearestAirport.code})`;
    kkopClass = 'text-red-600 font-extrabold animate-pulse';
    severity = 'critical';
  } else if (minAirportDist <= 25000) {
    const km = (minAirportDist / 1000).toFixed(1);
    kkopStatus = `Inside 25km TMA (${nearestAirport.code}, ${km}km)`;
    kkopClass = 'text-amber-600 font-bold';
    severity = 'advisory';
  } else {
    const km = (minAirportDist / 1000).toFixed(0);
    kkopStatus = `Clear of Aerodromes (${nearestAirport.code} is ${km}km away)`;
    kkopClass = 'text-emerald-600 font-semibold';
  }

  // 2. Check concurrent airspace operations with other active permits (Spatial & Temporal)
  const concurrentOps = [];
  const directOverlapOps = [];
  const potentialOverlapOps = [];
  const pStart = new Date(permit.date_start || '1970-01-01');
  const pEnd = new Date(permit.date_end || '2099-12-31');

  if (Array.isArray(permits)) {
    for (const other of permits) {
      if (!other || other.permit_id === permit.permit_id) continue;
      const oStart = new Date(other.date_start || '1970-01-01');
      const oEnd = new Date(other.date_end || '2099-12-31');
      const datesOverlap = (pStart <= oEnd) && (pEnd >= oStart);

      if (datesOverlap) {
        const conflict = checkAirspaceConflict(permit, other);
        const dist = getPermitToPermitDistance(permit, other);

        if (conflict.isOverlap) {
          const item = {
            operator: other.operator_name,
            permit_id: other.permit_id,
            location: other.location,
            dateRange: `${other.date_start} - ${other.date_end}`,
            distanceKm: '0.0',
            isDirectOverlap: !conflict.isPotential,
            isPotential: conflict.isPotential,
            badgeLabel: conflict.label || (conflict.isPotential ? 'POTENTIAL OVERLAP' : 'DIRECT OVERLAP'),
            note: conflict.note || (conflict.isPotential ? 'Estimated from default location radius' : 'Official published NOTAM boundary intersection')
          };
          if (conflict.isPotential) {
            potentialOverlapOps.push(item);
          } else {
            directOverlapOps.push(item);
          }
        } else if (dist <= 30000) {
          concurrentOps.push({
            operator: other.operator_name,
            permit_id: other.permit_id,
            location: other.location,
            dateRange: `${other.date_start} - ${other.date_end}`,
            distanceKm: (dist / 1000).toFixed(1),
            isDirectOverlap: false,
            isPotential: false,
            badgeLabel: `${(dist / 1000).toFixed(1)} km`,
            note: `Adjacent concurrent airspace (~${(dist / 1000).toFixed(1)}km lateral separation)`
          });
        }
      }
    }
  }

  const allConflicts = [...directOverlapOps, ...potentialOverlapOps, ...concurrentOps];
  const hasDirectConflict = directOverlapOps.length > 0;
  const hasPotentialConflict = potentialOverlapOps.length > 0;

  let trafficText = 'Isolated (No nearby concurrent permits)';
  let trafficClass = 'text-emerald-600 font-semibold';
  if (hasDirectConflict) {
    trafficText = `⚠️ DIRECT OVERLAP: ${directOverlapOps.length} confirmed NOTAM conflict(s)!`;
    trafficClass = 'text-red-600 font-extrabold animate-pulse';
  } else if (hasPotentialConflict) {
    trafficText = `⚠️ POTENTIAL OVERLAP: ${potentialOverlapOps.length} operator(s) in default location zone`;
    trafficClass = 'text-amber-600 font-bold';
  } else if (concurrentOps.length > 0) {
    trafficText = `${concurrentOps.length} concurrent operator(s) within 30km`;
    trafficClass = 'text-indigo-600 font-bold';
  }

  let badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  let badgeText = 'CLEAR AIRSPACE';
  let advisorySummary = 'Pre-flight planning indicates clear airspace with standard 400ft ceiling cap.';

  if (hasDirectConflict) {
    badgeClass = 'bg-rose-50 text-rose-700 border border-rose-300 shadow-sm ring-1 ring-rose-300';
    badgeText = 'SPATIAL CONFLICT DETECTED';
    advisorySummary = `⚠️ Airspace geometry directly intersects with ${directOverlapOps[0].operator} (${directOverlapOps[0].permit_id}). Strict flight scheduling / deconfliction required!`;
  } else if (hasPotentialConflict) {
    badgeClass = 'bg-amber-50 text-amber-800 border border-amber-300 shadow-sm';
    badgeText = 'POTENTIAL CONFLICT DETECTED';
    advisorySummary = `⚠️ Potential overlap with ${potentialOverlapOps[0].operator} (${potentialOverlapOps[0].permit_id}) based on approximate default location circle (~6km). Official NOTAM polygon pending.`;
  } else if (severity === 'critical') {
    badgeClass = 'bg-red-50 text-red-700 border border-red-200 shadow-sm';
    badgeText = 'CRITICAL PROXIMITY';
    advisorySummary = `Encroaches within 5km runway buffer of ${nearestAirport.name}. Prior AirNav ATC clearance is mandatory.`;
  } else if (severity === 'advisory' || concurrentOps.length > 0) {
    badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200';
    badgeText = 'AIRSPACE ADVISORY';
    if (severity === 'advisory' && concurrentOps.length > 0) {
      advisorySummary = `Operation within ${nearestAirport.code} 25km controlled buffer alongside ${concurrentOps.length} nearby concurrent flight permit(s).`;
    } else if (severity === 'advisory') {
      advisorySummary = `Operation within ${nearestAirport.code} 25km controlled airspace buffer. Maintain standard 2-way tower coordination.`;
    } else {
      advisorySummary = `Notice: ${concurrentOps[0].operator} also authorized in this vicinity (${concurrentOps[0].distanceKm}km away). Flight logs verify actual trajectory separation.`;
    }
  }

  return {
    badgeClass,
    badgeText,
    kkopText: kkopStatus,
    kkopClass,
    trafficText,
    trafficClass,
    advisorySummary,
    concurrentOps,
    directOverlapOps,
    hasDirectConflict,
    hasConflict: allConflicts.length > 0,
    conflictList: allConflicts
  };
}

// 3. Render list, stats and update map polygons
function renderDashboard() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const listContainer = document.getElementById('permits-list-container');
  listContainer.innerHTML = '';

  // Clear previous workspace layers
  if (map) {
    Object.values(polygonLayers).forEach(layer => map.removeLayer(layer));
  }
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

    // Apply Status Filter
    if (currentStatusFilter !== 'All' && status !== currentStatusFilter) return;

    // Apply Proximity Filter if active
    if (currentNearAirportFilter) {
      if (!isPermitNearAirport(permit, currentNearAirportFilter)) return;
    }

    // Apply Search Filter
    const matchesSearch =
      permit.operator_name.toLowerCase().includes(query) ||
      permit.permit_id.toLowerCase().includes(query) ||
      permit.location.toLowerCase().includes(query);
    if (!matchesSearch) return;

    displayedCount++;

    // Draw Permit shapes on Leaflet Map (Polygon or Fallback Circle)
    const isSelected = selectedPermit && selectedPermit.permit_id === permit.permit_id;
    const defaultColor = status === 'ACTIVE' ? '#10b981' : (status === 'PENDING' ? '#f59e0b' : '#8e9aa6');
    const color = customPermitColors[permit.permit_id] || defaultColor;

    let mapShape = null;
    let isFallback = false;
    const totalVertices = countCoordinatesVertices(permit.coordinates);

    if (typeof L !== 'undefined' && map) {
      // If Focus Mode is enabled AND a permit is selected, isolate active permit and skip other polygons
      if (isFocusMode && selectedPermit && !isSelected) {
        // Skip unselected permits on the map to prevent visual confusion
      } else {
        const isDimmed = selectedPermit && !isSelected;
        const fillOpacity = isSelected ? 0.35 : (isDimmed ? 0.04 : 0.2);
        const strokeOpacity = isSelected ? 1.0 : (isDimmed ? 0.25 : 0.8);
        const weight = isSelected ? 3.5 : (isDimmed ? 1 : 1.5);

        if (totalVertices >= 3) {
          mapShape = L.polygon(permit.coordinates, {
            color: color,
            fillColor: color,
            fillOpacity: fillOpacity,
            opacity: strokeOpacity,
            weight: weight
          });
        } else {
          // Fallback location lookup
          const fallbackCoords = getCoordsFromLocation(permit.location);
          if (fallbackCoords) {
            isFallback = true;
            mapShape = L.circle(fallbackCoords, {
              color: color,
              fillColor: color,
              fillOpacity: isSelected ? 0.25 : (isDimmed ? 0.03 : 0.15),
              opacity: strokeOpacity,
              weight: weight,
              radius: 6000 // 6 kilometers approximate radius
            });
          }
        }

        if (mapShape) {
          mapShape.addTo(map);

          // Popup content
          let coordBadge = '';
          if (totalVertices >= 3) {
            if (permit.notam_reference) {
              coordBadge = `<div class="text-[9px] text-indigo-600 font-bold mt-1">Airspace: NOTAM Polygon (${totalVertices} pts)</div>`;
            } else {
              const srcName = permit.coordinate_source || 'Permit Attachment';
              coordBadge = `<div class="text-[9px] text-emerald-600 font-bold mt-1">Airspace: ${srcName} (${totalVertices} pts)</div>`;
            }
          } else if (isFallback) {
            coordBadge = '<div class="text-[9px] text-amber-600 font-bold mt-1">Approximate Area Fallback</div>';
          }

          mapShape.bindPopup(`
            <div class="text-xs space-y-1">
              <div class="font-bold text-[#2a2334]">${permit.operator_name}</div>
              <div class="text-[10px] text-gray-500 font-mono">ID: ${permit.permit_id}</div>
              ${coordBadge}
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
      }
    }

    // Append Permit Card to list
    const card = document.createElement('div');

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

    card.className = `p-4 border rounded-2xl cursor-pointer transition-all duration-300 ${isSelected
        ? 'active-permit-card'
        : 'bg-white/70 border-black/5 hover:bg-white hover:shadow-sm text-gray-800'
      }`;

    if (customPermitColors[permit.permit_id]) {
      card.style.borderLeftWidth = '4px';
      card.style.borderLeftColor = customPermitColors[permit.permit_id];
    }

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
        <svg class="w-3.5 h-3.5 text-[#4a5d3e] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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

// New functions for airport selection and highlighting
function selectAirport(airport) {
  selectedAirport = airport;
  selectedPermit = null; // Clear selected permit

  // Highlight selected airport on map
  highlightAirportOnMap(airport ? airport.code : null);

  renderDashboard(); // Updates dashboard list/map styles
  renderInspector();  // Fills inspector panel with airport details

  if (airport && map) {
    map.setView([airport.lat, airport.lng], 11, { animate: true, duration: 1 });
  }
}

function highlightAirportOnMap(airportCode) {
  // Reset all airport ring styles first
  REGION_AIRPORTS.forEach(ap => {
    const layers = airportLayers[ap.code];
    if (layers) {
      const isSelected = airportCode && ap.code === airportCode;
      layers.ring.setStyle({
        color: isSelected ? '#b45309' : '#4f46e5', // brand gold when selected, indigo otherwise
        fillColor: isSelected ? '#b45309' : '#4f46e5',
        fillOpacity: isSelected ? 0.2 : 0.08,
        weight: isSelected ? 3 : 1.5,
        dashArray: isSelected ? '0' : '4, 4'
      });

      const markerEl = layers.marker.getElement();
      if (markerEl) {
        const div = markerEl.querySelector('.flex');
        if (div) {
          if (isSelected) {
            div.className = "flex items-center justify-center w-9 h-9 rounded-full bg-[#b45309] text-white font-extrabold text-[10px] shadow-lg shadow-amber-700/40 border border-white scale-110 transition-all cursor-pointer";
          } else {
            div.className = "flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-[9px] shadow-md shadow-indigo-600/20 border border-white hover:scale-110 active:scale-95 transition-all cursor-pointer";
          }
        }
      }
    }
  });
}

// 4. Select Card and Pan Map to Coordinates
function selectPermitCard(permit) {
  selectedPermit = permit;
  selectedAirport = null; // Clear selected airport
  highlightAirportOnMap(null); // Reset airport highlights
  clearSortieMapLayers();

  renderDashboard(); // Updates list styles and map weights
  renderInspector();  // Fills inspector panel details

  // Fly to the coordinates bounds if they exist (or fallback bounds)
  const totalVerts = countCoordinatesVertices(permit.coordinates);
  if (totalVerts >= 3 || getCoordsFromLocation(permit.location)) {
    const poly = polygonLayers[permit.permit_id];
    if (poly && map && poly.getBounds && poly.getBounds().isValid()) {
      map.fitBounds(poly.getBounds(), { padding: [50, 50], maxZoom: 12 });
      poly.openPopup();
    }
  }
}

function renderAirportInspector(airport) {
  const panel = document.getElementById('inspector-panel');
  panel.innerHTML = `
    <!-- Top Details Title -->
    <div class="p-6 border-b border-black/5 space-y-4">
      <div class="flex justify-between items-start gap-1">
        <div class="flex flex-wrap gap-1">
          <span class="border border-[#b45309]/20 bg-amber-50 text-[#b45309] px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
            OTBAN Wilayah VI
          </span>
          <span class="border border-red-200 bg-red-50 text-red-700 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
            KKOP 5km Zone
          </span>
        </div>
        <button id="close-airport-inspector" class="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div>
        <h2 class="text-base font-extrabold text-gray-900">${airport.name}</h2>
        <div class="flex items-center gap-2 mt-1">
          <span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md text-xs font-mono font-bold">IATA: ${airport.code}</span>
          <span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md text-xs font-mono font-bold">ICAO: ${airport.icao}</span>
        </div>
      </div>
    </div>

    <!-- Details Content Scroll Area -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6">
      <!-- Specification Table Grid -->
      <div class="space-y-3">
        <h3 class="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Technical Specifications</h3>
        <div class="bg-gray-50 rounded-2xl p-4 border border-black/5 space-y-3 text-xs">
          <div class="flex justify-between">
            <span class="text-gray-400 font-medium">Operator</span>
            <span class="font-bold text-gray-800 text-right">${airport.operator}</span>
          </div>
          <div class="border-t border-black/5 pt-2 flex justify-between">
            <span class="text-gray-400 font-medium">Classification</span>
            <span class="font-bold text-gray-800 text-right">${airport.class}</span>
          </div>
          <div class="border-t border-black/5 pt-2 flex justify-between">
            <span class="text-gray-400 font-medium">Runway</span>
            <span class="font-bold text-gray-800 text-right">${airport.runway}</span>
          </div>
          <div class="border-t border-black/5 pt-2 flex justify-between">
            <span class="text-gray-400 font-medium">Elevation</span>
            <span class="font-bold text-gray-800 text-right">${airport.elevation}</span>
          </div>
          <div class="border-t border-black/5 pt-2 flex justify-between">
            <span class="text-gray-400 font-medium">Coordinates</span>
            <span class="font-mono font-bold text-gray-700 text-right">${airport.lat.toFixed(6)}, ${airport.lng.toFixed(6)}</span>
          </div>
        </div>
      </div>

      <!-- Communications & Contacts -->
      <div class="space-y-3">
        <h3 class="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Communications & Support</h3>
        <div class="bg-indigo-50/50 border border-indigo-500/10 rounded-2xl p-4 space-y-3 text-xs">
          <div class="flex justify-between items-center">
            <span class="text-indigo-600/70 font-semibold">Radio / Tower</span>
            <span class="font-extrabold text-indigo-950">${airport.frequency}</span>
          </div>
          <div class="border-t border-indigo-500/10 pt-2 flex justify-between items-center">
            <span class="text-indigo-600/70 font-semibold">Emergency Tower</span>
            <span class="font-extrabold text-indigo-950">${airport.emergencyName || 'AirNav Tower'}</span>
          </div>
          <div class="border-t border-indigo-500/10 pt-2 flex justify-between items-center">
            <span class="text-indigo-600/70 font-semibold">Contact Phone</span>
            <a href="tel:${airport.emergencyPhone.replace(/\s+/g, '')}" class="font-extrabold text-indigo-700 hover:underline flex items-center gap-1 select-all">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
              </svg>
              ${airport.emergencyPhone}
            </a>
          </div>
        </div>
      </div>

      <!-- KKOP Notice -->
      <div class="p-4 bg-red-50/60 border border-red-500/10 rounded-2xl text-xs space-y-1.5">
        <h4 class="font-bold text-red-800 flex items-center gap-1">
          <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          KKOP Safety Regulation Zone
        </h4>
        <p class="text-red-700/80 leading-relaxed font-medium">
          Drones are strictly prohibited inside the 5 km lateral buffer zone without prior official approval from the Ministry of Transportation (KKOP compliance PM 37/2020). Unauthorized operations constitute an airspace safety breach.
        </p>
      </div>

      <!-- Quick Actions -->
      <div class="space-y-3 pt-2">
        <h3 class="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Quick GIS Actions</h3>
        <div class="flex flex-col gap-2">
          <button id="btn-focus-airport" class="w-full bg-[#f5f6f4] hover:bg-black/5 text-[#2a2334] font-bold py-2.5 rounded-2xl text-xs border border-black/5 transition-all active:scale-95 flex items-center justify-center gap-1.5">
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
            Focus & Zoom on Map
          </button>
          
          <button id="btn-filter-near-permits" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-2xl text-xs shadow-md shadow-emerald-600/10 transition-all active:scale-95 flex items-center justify-center gap-1.5">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>
            </svg>
            Filter Permits Nearby (25 km)
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners for airport actions
  const btnCloseAp = document.getElementById('close-airport-inspector');
  if (btnCloseAp) {
    btnCloseAp.addEventListener('click', () => {
      selectAirport(null);
    });
  }

  const btnFocusAp = document.getElementById('btn-focus-airport');
  if (btnFocusAp) {
    btnFocusAp.addEventListener('click', () => {
      map.setView([airport.lat, airport.lng], 14, { animate: true, duration: 1.5 });
    });
  }

  const btnFilterNear = document.getElementById('btn-filter-near-permits');
  if (btnFilterNear) {
    btnFilterNear.addEventListener('click', () => {
      currentNearAirportFilter = airport;
      const banner = document.getElementById('active-filters-banner');
      if (banner) {
        banner.innerHTML = `
          <span>Filtered near <strong>${airport.code}</strong> (25km)</span>
          <button onclick="clearNearAirportFilter()" class="hover:text-red-500 font-extrabold uppercase text-[9px] tracking-wider transition-colors ml-2 shrink-0">Clear</button>
        `;
        banner.classList.remove('hidden');
      }
      renderDashboard();
    });
  }
}

// 5. Build selected permit inspection details & countdown timers
function renderInspector() {
  const panel = document.getElementById('inspector-panel');
  if (countdownInterval) clearInterval(countdownInterval);

  if (!selectedPermit && !selectedAirport) {
    panel.classList.add('translate-x-full');
    panel.classList.remove('translate-x-0');
    setTimeout(() => {
      if (!selectedPermit && !selectedAirport) {
        panel.innerHTML = `
          <div class="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 gap-3">
            <svg class="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L16 4m0 13V4m0 0L9 7"></path>
            </svg>
            <p class="text-sm font-bold text-gray-500">No Target Selected</p>
            <p class="text-xs text-gray-400">Select a drone permit from the sidebar, or click an airport on the map to inspect safety specifications.</p>
          </div>`;
      }
    }, 350);
    return;
  }

  // Slide drawer in
  panel.classList.remove('translate-x-full');
  panel.classList.add('translate-x-0');

  if (selectedAirport) {
    renderAirportInspector(selectedAirport);
    return;
  }

  // Clear flight log data when permit selection changes (if the log was for a different permit)
  if (selectedPermit && (!flightLogData || flightLogData.permit_id !== selectedPermit.permit_id)) {
    flightLogData = null;
    if (flightPathPolyline) {
      map.removeLayer(flightPathPolyline);
      flightPathPolyline = null;
    }
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

  const currentPermitColor = customPermitColors[permit.permit_id] || (status === 'ACTIVE' ? '#10b981' : (status === 'PENDING' ? '#f59e0b' : '#8e9aa6'));
  const colorPresets = [
    { name: 'Emerald', hex: '#10b981' },
    { name: 'Sky Blue', hex: '#0284c7' },
    { name: 'Indigo', hex: '#6366f1' },
    { name: 'Purple', hex: '#9333ea' },
    { name: 'Amber', hex: '#f59e0b' },
    { name: 'Crimson', hex: '#ef4444' },
    { name: 'Neon Lime', hex: '#84cc16' }
  ];

  const spatialMatrix = computeSpatialConflictMatrix(permit);
  const sorties = getPermitSorties(permit.permit_id);
  const sortieAudit = computeSortieAuditSummary(permit);

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
      <div id="countdown-timer" class="text-2xl font-bold font-mono tracking-tight text-[#4a5d3e]">
        --:--:--
      </div>
      <div class="flex justify-between text-[10px] text-gray-500 font-semibold pt-1">
        <span>Start: ${permit.time_start}</span>
        <span>End: ${permit.time_end}</span>
      </div>
    </div>

    <!-- Airspace Focus & Styling Control Panel -->
    <div class="p-6 border-b border-black/5 space-y-3 bg-gradient-to-br from-indigo-50/30 to-purple-50/30">
      <div class="flex items-center justify-between">
        <h3 class="text-[10px] uppercase font-extrabold text-indigo-700 tracking-wider flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" stroke-width="2"></circle>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h2m14 0h2M12 3v2m0 14v2"></path>
          </svg>
          Airspace Focus & Styling
        </h3>
        <span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full ${isFocusMode ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}">
          ${isFocusMode ? 'ISOLATED' : 'ALL VISIBLE'}
        </span>
      </div>

      <!-- Isolate / Show All Toggle Button -->
      <button id="btn-toggle-isolate" class="w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${isFocusMode ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 shadow-md shadow-indigo-600/20' : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm'}">
        <svg class="w-4 h-4 ${isFocusMode ? 'text-white' : 'text-gray-500'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" stroke-width="2"></circle>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h2m14 0h2M12 3v2m0 14v2"></path>
        </svg>
        <span>${isFocusMode ? 'Focus Active: Other Polygons Hidden' : 'Isolate This Airspace (Hide Others)'}</span>
      </button>

      <!-- Color Palette Picker -->
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center justify-between text-[10px] font-bold text-gray-500">
          <span>Airspace Color:</span>
          ${customPermitColors[permit.permit_id] ? `
            <button id="btn-reset-color" class="text-[10px] text-red-500 hover:text-red-700 transition-colors font-bold flex items-center gap-0.5" title="Reset to standard status color">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              Reset Color
            </button>` : `<span class="text-[9px] text-gray-400 font-normal">Default Status Color</span>`}
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${colorPresets.map(cp => `
            <button type="button" class="color-preset-chip w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 active:scale-95 ${currentPermitColor.toLowerCase() === cp.hex.toLowerCase() ? 'ring-2 ring-indigo-600 ring-offset-2 scale-110 border-white' : 'border-white shadow-sm'}" data-color="${cp.hex}" style="background-color: ${cp.hex};" title="${cp.name} (${cp.hex})"></button>
          `).join('')}
          <label class="relative w-6 h-6 rounded-full border-2 border-dashed border-gray-300 hover:border-indigo-400 cursor-pointer flex items-center justify-center overflow-hidden transition-colors" title="Custom Hex Color Picker">
            <input type="color" id="permit-color-input" value="${currentPermitColor}" class="opacity-0 absolute inset-0 cursor-pointer w-full h-full">
            <span class="text-[10px] font-bold text-gray-500">+</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Workspace Properties -->
    <div class="p-6 border-b border-black/5 space-y-4">
      <h3 class="text-[10px] uppercase font-extrabold text-gray-400 tracking-wider">Operation Metrics</h3>
      <!-- Altitude Limit Gauge (Circular Radial Progress) -->
      <div class="flex gap-4 items-center bg-gray-50 dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5">
        <div class="radial-gauge-wrapper shrink-0">
          <svg viewBox="0 0 160 160" class="radial-svg">
            <circle class="radial-bg" cx="80" cy="80" r="70" fill="none" stroke-width="14"></circle>
            <circle class="radial-fill" id="radial-fill-bar" cx="80" cy="80" r="70" fill="none" stroke-width="14" stroke-dasharray="440" stroke-dashoffset="440" stroke-linecap="round"></circle>
          </svg>
          <div class="radial-text">
            <span class="radial-percent" id="radial-percent-val">0%</span>
            <span class="radial-label">Ceiling</span>
          </div>
        </div>
        <div class="flex-grow space-y-1">
          <div class="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Vertical Ceiling Limit</div>
          <div class="text-lg font-extrabold text-gray-800 dark:text-white">${permit.max_altitude_ft} <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">ft (AGL)</span></div>
          <div class="text-[10px] text-gray-500 dark:text-gray-400 leading-normal font-medium">
            Representing <span id="radial-percent-desc" class="font-bold text-[var(--blue)]">0%</span> of standard 400ft Indonesian regulatory limit.
          </div>
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
          <span id="pdf-reference-link" class="text-[#4a5d3e] font-semibold hover:underline cursor-pointer truncate max-w-[200px]" title="${permit.file_name}">${permit.file_name}</span>
        </div>
        ${permit.notam_reference ? `
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500 font-semibold">NOTAM Reference</span>
          <span class="font-mono text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">${permit.notam_reference}</span>
        </div>` : ''}
        ${permit.notam_file ? `
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500 font-semibold">Attached NOTAM</span>
          <span id="notam-reference-link" class="text-indigo-600 font-semibold hover:underline cursor-pointer truncate max-w-[180px]" title="${permit.notam_file}">${permit.notam_file}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- NOTAM Airspace Attachment Panel -->
    <div class="p-6 border-b border-black/5 space-y-3 bg-indigo-50/20">
      <div class="flex items-center justify-between">
        <h3 class="text-[10px] uppercase font-extrabold text-indigo-600 tracking-wider">AirNav NOTAM Airspace</h3>
        ${permit.notam_reference ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">LINKED</span>' : '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">NO NOTAM</span>'}
      </div>
      <input type="file" id="notam-attach-input" accept=".pdf" class="hidden">
      <button id="btn-attach-notam" class="w-full py-2 bg-white hover:bg-indigo-50 text-indigo-700 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 border border-indigo-200 shadow-sm">
        <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
        ${permit.notam_file ? 'Update Attached NOTAM (.pdf)' : 'Attach NOTAM PDF (.pdf)'}
      </button>
      ${permit.notam_reference ? `
      <div class="text-[10px] text-gray-500 bg-white p-2.5 rounded-xl border border-black/5 space-y-1">
        <div class="flex justify-between font-medium"><span>NOTAM:</span> <b class="text-gray-800">${permit.notam_reference}</b></div>
        <div class="flex justify-between font-medium"><span>Airspace Ceiling:</span> <b class="text-indigo-600">${permit.altitude_ceiling_note || permit.max_altitude_ft + ' ft'}</b></div>
        <div class="flex justify-between font-medium"><span>Boundary Vertices:</span> <b class="text-emerald-600">${countCoordinatesVertices(permit.coordinates)} points</b></div>
      </div>` : (countCoordinatesVertices(permit.coordinates) >= 3 ? `
      <div class="text-[10px] text-emerald-800 bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-200/60 space-y-1">
        <div class="flex justify-between font-medium"><span>Boundary Polygon:</span> <b class="text-emerald-900">${permit.coordinate_source || 'Permit Attachment'}</b></div>
        <div class="flex justify-between font-medium"><span>Airspace Ceiling:</span> <b class="text-emerald-700">${permit.altitude_ceiling_note || permit.max_altitude_ft + ' ft'}</b></div>
        <div class="flex justify-between font-medium"><span>Boundary Vertices:</span> <b class="text-emerald-700">${countCoordinatesVertices(permit.coordinates)} points (From Permit)</b></div>
        <div class="text-[9px] text-emerald-600 italic mt-0.5">AirNav NOTAM pending. You can still attach NOTAM PDF above when published.</div>
      </div>` : '')}
    </div>

    <!-- Real-Time Spatial Conflict Matrix -->
    <div class="p-6 border-b border-black/5 space-y-3 bg-gradient-to-br from-slate-50 to-indigo-50/20">
      <div class="flex items-center justify-between">
        <h3 class="text-[10px] uppercase font-extrabold text-indigo-700 tracking-wider flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          Spatial Conflict Matrix
        </h3>
        <span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full ${spatialMatrix.badgeClass}">
          ${spatialMatrix.badgeText}
        </span>
      </div>

      <!-- Pre-Flight Airspace Proximity -->
      <div class="bg-white p-3 rounded-2xl border border-black/5 space-y-2 text-xs shadow-xs">
        <div class="text-[9px] font-bold uppercase text-gray-400 tracking-wider">1. Pre-Flight Airspace Advisory</div>
        <div class="flex justify-between items-center">
          <span class="text-gray-500 font-semibold">Aerodrome Buffer:</span>
          <span class="text-right ${spatialMatrix.kkopClass}">${spatialMatrix.kkopText}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-gray-500 font-semibold">Concurrent Traffic:</span>
          <span class="text-right ${spatialMatrix.trafficClass}">${spatialMatrix.trafficText}</span>
        </div>
        <div class="text-[10px] text-gray-500 italic bg-gray-50 p-2 rounded-xl border border-black/5">
          ${spatialMatrix.advisorySummary}
        </div>

        ${spatialMatrix.hasConflict ? `
        <!-- Inter-Permit Conflicting Operations List -->
        <div class="pt-2 border-t border-gray-100 space-y-1.5">
          <div class="text-[9px] font-extrabold uppercase tracking-wider text-rose-700 flex items-center gap-1">
            <svg class="w-3 h-3 text-rose-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            Conflicting Concurrent Operations
          </div>
          ${spatialMatrix.conflictList.map(c => `
          <div class="p-2.5 rounded-xl border ${c.isDirectOverlap ? 'bg-rose-50/70 border-rose-200' : (c.isPotential ? 'bg-amber-50/70 border-amber-300' : 'bg-slate-50 border-gray-200')} text-[10px] space-y-1.5">
            <div class="flex items-center justify-between font-bold gap-2">
              <span class="text-gray-900 truncate" title="${c.operator}">${c.operator}</span>
              <span class="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase shrink-0 ${c.isDirectOverlap ? 'bg-red-600 text-white' : (c.isPotential ? 'bg-amber-600 text-white shadow-xs' : 'bg-gray-600 text-white')}">
                ${c.badgeLabel}
              </span>
            </div>
            <div class="flex justify-between text-gray-500 text-[9px]">
              <span>Permit: <b class="font-mono text-gray-700">${c.permit_id}</b></span>
              <span>${c.dateRange}</span>
            </div>
            <div class="text-[9px] ${c.isPotential ? 'text-amber-800 bg-amber-100/60 p-1.5 rounded-lg border border-amber-200' : 'text-gray-600 italic'}">
              ${c.isPotential ? `<strong>Notice:</strong> ${c.note}` : c.note}
            </div>
            <button class="btn-compare-conflict w-full mt-1 py-1 rounded-lg text-[9px] font-bold transition-all flex items-center justify-center gap-1 border ${c.isDirectOverlap ? 'bg-white hover:bg-rose-100 text-rose-700 border-rose-300' : 'bg-white hover:bg-amber-100 text-amber-800 border-amber-300'}" data-permit-id="${c.permit_id}">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              View Airspace on Map
            </button>
          </div>
          `).join('')}
        </div>` : ''}
      </div>

      <!-- Post-Flight Telemetry Breach Audit -->
      <div class="bg-white p-3 rounded-2xl border border-black/5 space-y-2 text-xs shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-[9px] font-bold uppercase text-gray-400 tracking-wider">2. Post-Flight Fleet Audit</span>
          <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${sortieAudit.badgeClass}">${sortieAudit.badgeText}</span>
        </div>
        ${sortieAudit.hasSorties ? `
        <div class="space-y-1.5 pt-1">
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">Geofence Compliance:</span>
            <span class="font-bold ${sortieAudit.geoBreaches === 0 ? 'text-emerald-600' : 'text-red-600 animate-pulse'}">
              ${sortieAudit.geoBreaches === 0 ? '100% Within Boundaries' : `${sortieAudit.geoBreaches} Perimeter Breach Event(s)`}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">Ceiling Compliance:</span>
            <span class="font-bold ${sortieAudit.altBreaches === 0 ? 'text-emerald-600' : 'text-red-600 animate-pulse'}">
              ${sortieAudit.altBreaches === 0 ? `Compliant (Max ${Math.round(sortieAudit.maxAgl)} ft)` : `Breached (Max ${Math.round(sortieAudit.maxAgl)} ft > ${permit.max_altitude_ft || 400} ft)`}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-500 font-semibold">KKOP Separation:</span>
            <span class="font-bold ${sortieAudit.kkopBreaches === 0 ? 'text-emerald-600' : 'text-red-600 animate-pulse'}">
              ${sortieAudit.kkopBreaches === 0 ? 'Safe Corridor Clear' : `${sortieAudit.kkopBreaches} Zone Penetrations`}
            </span>
          </div>
          <div class="text-[10px] text-gray-500 pt-1 border-t border-gray-100">
            ${sortieAudit.summaryText}
          </div>
        </div>` : `
        <div class="text-[10px] text-gray-400 italic py-1">
          Attach flight logs below to compute post-flight geofence and altitude verification.
        </div>`}
      </div>
    </div>

    <!-- Multi-Flight Sortie Management Panel -->
    <div class="p-6 border-b border-black/5 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-[10px] uppercase font-extrabold text-gray-700 tracking-wider">Flight Sorties & Operations</h3>
          <span class="text-[9px] text-gray-400">Multi-log telemetry & 4D trajectory tracking</span>
        </div>
        <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full ${sorties.length > 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-gray-100 text-gray-500'}">
          ${sorties.length} Sortie${sorties.length !== 1 ? 's' : ''}
        </span>
      </div>

      ${sortieAudit.hasSorties ? `
      <!-- Cumulative Fleet Telemetry Card -->
      <div class="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-2xl p-3.5 shadow-md space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></div>
            <span class="text-[9px] font-extrabold uppercase tracking-wider text-indigo-200">Cumulative Fleet Telemetry</span>
          </div>
          <span class="text-[8px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-cyan-200 font-mono">${sortieAudit.totalPoints.toLocaleString()} GPS Pts</span>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center pt-1 border-t border-white/10">
          <div>
            <span class="text-[8px] font-bold text-indigo-300 uppercase block">Total Flight Time</span>
            <span class="text-xs font-extrabold text-white">${sortieAudit.totalDurationFormatted}</span>
          </div>
          <div>
            <span class="text-[8px] font-bold text-indigo-300 uppercase block">Distance Traveled</span>
            <span class="text-xs font-extrabold text-cyan-300">${sortieAudit.totalDistanceKm} km</span>
          </div>
          <div>
            <span class="text-[8px] font-bold text-indigo-300 uppercase block">Total Sorties</span>
            <span class="text-xs font-extrabold text-emerald-300">${sortieAudit.totalSorties} Sorties</span>
          </div>
        </div>
      </div>` : ''}

      <!-- Action Buttons -->
      <div class="space-y-2">
        <input type="file" id="sortie-upload-input" accept=".ulg,.txt,.dat,.csv,.kml" class="hidden">
        <button id="btn-upload-sortie" class="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm shadow-indigo-600/20 active:scale-98">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
          Attach Flight Log (.ulg, .txt, .dat, .csv, .kml)
        </button>

        ${sorties.length > 1 ? `
        <button id="btn-toggle-all-sorties" class="w-full py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 border ${isShowingAllSorties ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'}">
          <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
          ${isShowingAllSorties ? 'Hide All Tracks from Map' : 'Show All Tracks on Map (Multi-Track)'}
        </button>` : ''}
      </div>

      <!-- Sortie Items List -->
      ${sorties.length === 0 ? `
      <div class="text-center py-6 px-4 border border-dashed border-gray-200 rounded-2xl bg-gray-50/50 space-y-1.5">
        <svg class="w-8 h-8 text-gray-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <p class="text-xs font-bold text-gray-600">No Sortie Logs Attached</p>
        <p class="text-[10px] text-gray-400">Upload PX4 (.ulg), DJI (.txt, .dat) or telemetry (.kml, .csv) to verify flight compliance.</p>
      </div>` : `
      <div class="space-y-3">
        ${sorties.map((s) => {
          const isHighlighted = currentHighlightedSortieId === s.id && !isShowingAllSorties;
          const altOk = s.compliance ? s.compliance.alt_compliant : true;
          const geoOk = s.compliance ? s.compliance.geofence_compliant : true;
          const kkopOk = s.compliance ? s.compliance.kkop_compliant : true;

          return `
          <div class="bg-white border ${isHighlighted ? 'border-cyan-500 shadow-md ring-2 ring-cyan-400/20' : 'border-black/5 shadow-xs'} rounded-2xl p-3.5 space-y-2.5 transition-all">
            <!-- Title & Format Badges -->
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 uppercase font-mono">${s.file_type || 'LOG'}</span>
                  <span class="text-[10px] font-bold text-gray-800 truncate" title="${s.sortie_name}">${s.sortie_name}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5">${s.date_time || 'Recorded'} · ${(s.file_size_mb || 0.5).toFixed(1)} MB</div>
              </div>
              <button class="btn-delete-sortie text-gray-300 hover:text-rose-500 transition-colors p-1" data-sortie-id="${s.id}" title="Remove Sortie">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>

            <!-- Stats Grid -->
            <div class="grid grid-cols-3 gap-2 bg-gray-50/80 p-2 rounded-xl text-center">
              <div>
                <span class="text-[8px] font-bold text-gray-400 uppercase block">Duration</span>
                <span class="text-[11px] font-bold text-gray-700">${s.stats?.duration_formatted || '--'}</span>
              </div>
              <div>
                <span class="text-[8px] font-bold text-gray-400 uppercase block">Max AGL</span>
                <span class="text-[11px] font-bold ${altOk ? 'text-emerald-600' : 'text-red-600'}">${s.stats?.max_agl_ft || 0} ft</span>
              </div>
              <div>
                <span class="text-[8px] font-bold text-gray-400 uppercase block">Max Speed</span>
                <span class="text-[11px] font-bold text-gray-700">${s.stats?.max_speed_kts || 0} kts</span>
              </div>
            </div>

            <!-- Compliance Pills -->
            <div class="flex items-center gap-1.5 flex-wrap text-[9px] font-bold">
              <span class="px-2 py-0.5 rounded-md ${altOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}">
                Ceiling: ${altOk ? 'OK' : 'BREACH'}
              </span>
              <span class="px-2 py-0.5 rounded-md ${geoOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}">
                Geofence: ${geoOk ? 'OK' : 'BREACH'}
              </span>
              <span class="px-2 py-0.5 rounded-md ${kkopOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}">
                KKOP: ${kkopOk ? 'OK' : 'BREACH'}
              </span>
            </div>

            <!-- Action Buttons -->
            <div class="grid grid-cols-2 gap-2 pt-1">
              <button class="btn-view-sortie py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 border ${isHighlighted ? 'bg-cyan-600 text-white border-cyan-600 shadow-sm' : 'bg-white hover:bg-cyan-50 text-cyan-700 border-cyan-200'}" data-sortie-id="${s.id}">
                <svg class="w-3.5 h-3.5 ${isHighlighted ? 'text-white' : 'text-cyan-600'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
                ${isHighlighted ? 'Hide Track' : 'View on Map'}
              </button>

              <button class="btn-studio-sortie py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200" data-sortie-id="${s.id}">
                <svg class="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                Universal Studio
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>`}
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

  // Airspace Focus & Isolation toggle handler
  const isolateBtn = document.getElementById('btn-toggle-isolate');
  if (isolateBtn) {
    isolateBtn.addEventListener('click', () => {
      isFocusMode = !isFocusMode;
      updateFocusModeUI();
      renderDashboard();
      renderInspector();
      showToast(isFocusMode ? "Airspace isolated: all other polygons hidden" : "All regional airspaces restored", "info");
    });
  }

  // Preset color chips handlers
  document.querySelectorAll('.color-preset-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const chosenColor = e.currentTarget.getAttribute('data-color');
      setPermitColor(permit.permit_id, chosenColor);
    });
  });

  // Custom hex color picker handler
  const colorInput = document.getElementById('permit-color-input');
  if (colorInput) {
    colorInput.addEventListener('change', (e) => {
      setPermitColor(permit.permit_id, e.target.value);
    });
  }

  // Reset color button handler
  const resetColorBtn = document.getElementById('btn-reset-color');
  if (resetColorBtn) {
    resetColorBtn.addEventListener('click', () => {
      setPermitColor(permit.permit_id, null);
    });
  }

  // Close inspector button handler
  document.getElementById('close-inspector').addEventListener('click', () => {
    selectedPermit = null;
    clearSortieMapLayers();
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

  // Open Attached NOTAM PDF event handler
  const notamLink = document.getElementById('notam-reference-link');
  if (notamLink && permit.notam_file) {
    notamLink.addEventListener('click', async () => {
      showToast(`Opening NOTAM: ${permit.notam_file}...`, 'info');
      const res = await window.api.openNotam(permit.notam_file);
      if (res && !res.success) {
        showToast(res.error || "Failed to open NOTAM document", 'error');
      }
    });
  }

  // Wire up NOTAM upload click trigger
  const btnAttachNotam = document.getElementById('btn-attach-notam');
  const notamInput = document.getElementById('notam-attach-input');
  if (btnAttachNotam && notamInput) {
    btnAttachNotam.addEventListener('click', () => notamInput.click());
    notamInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const filePath = (window.api && window.api.getPathForFile) ? window.api.getPathForFile(file) : (file.path || '');
      if (!filePath) {
        showToast("Cannot determine file path.", "error");
        return;
      }

      showToast(`Attaching and parsing NOTAM: ${file.name}...`, "info");
      const res = await window.api.attachNotam(permit.permit_id, filePath);

      if (res && res.success) {
        showToast(`NOTAM attached! Updated airspace with ${res.coordinates_count} vertices.`, "success");
        // Update local object & re-render
        permit.notam_file = res.notam_file;
        permit.notam_reference = res.notam_reference;
        permit.max_altitude_ft = res.max_altitude_ft;

        // Reload permits list and inspector
        if (typeof loadPermitsData === 'function') {
          await loadPermitsData();
        } else {
          window.location.reload();
        }
      } else {
        showToast(res ? res.error : "Failed to attach NOTAM.", "error");
      }
    });
  }

  // Wire up multi-flight sortie upload and management triggers
  const btnUploadSortie = document.getElementById('btn-upload-sortie');
  const sortieFileInput = document.getElementById('sortie-upload-input');
  if (btnUploadSortie) {
    btnUploadSortie.addEventListener('click', () => handleSortieUploadAction(permit));
  }
  if (sortieFileInput) {
    sortieFileInput.addEventListener('change', (e) => handleSortieFileInputChange(e, permit));
  }

  const btnToggleAllSorties = document.getElementById('btn-toggle-all-sorties');
  if (btnToggleAllSorties) {
    btnToggleAllSorties.addEventListener('click', () => {
      plotAllSortiesOnMap(sorties, permit);
    });
  }

  document.querySelectorAll('.btn-view-sortie').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-sortie-id');
      const s = sorties.find(x => x.id === sId);
      if (s) plotSingleSortieOnMap(s, permit);
    });
  });

  document.querySelectorAll('.btn-studio-sortie').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-sortie-id');
      const s = sorties.find(x => x.id === sId);
      if (s) openSortieInStudio(s);
    });
  });

  document.querySelectorAll('.btn-delete-sortie').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-sortie-id');
      removeSortie(permit.permit_id, sId);
    });
  });

  // Wire up conflict airspace compare buttons
  document.querySelectorAll('.btn-compare-conflict').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-permit-id');
      const targetPermit = permits.find(p => p.permit_id === targetId);
      if (targetPermit) {
        showToast(`Focusing conflicting airspace: ${targetPermit.operator_name}`, 'info');
        const polyTarget = polygonLayers[targetPermit.permit_id];
        const polyCurrent = polygonLayers[permit.permit_id];

        if (map && (polyTarget || polyCurrent)) {
          const bounds = L.latLngBounds([]);
          if (polyTarget && polyTarget.getBounds && polyTarget.getBounds().isValid()) {
            bounds.extend(polyTarget.getBounds());
            polyTarget.setStyle({ color: '#ef4444', weight: 4, fillOpacity: 0.35 });
            polyTarget.openPopup();
          }
          if (polyCurrent && polyCurrent.getBounds && polyCurrent.getBounds().isValid()) {
            bounds.extend(polyCurrent.getBounds());
            polyCurrent.setStyle({ color: '#6366f1', weight: 4, fillOpacity: 0.35 });
          }
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
          }
        }
      }
    });
  });

  // Update the circular progress gauge
  const altPercentage = Math.min((permit.max_altitude_ft / 400) * 100, 100);
  setTimeout(() => {
    updateRadialProgress(altPercentage);
  }, 50);

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

  let bgClass = 'bg-white/95 border-black/5 text-[#2a2334]';
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

  // Reset selected file label
  const selectedPdfName = document.getElementById('selected-pdf-name');
  if (selectedPdfName) {
    selectedPdfName.textContent = "No file chosen";
    selectedPdfName.classList.add('italic', 'text-gray-500');
    selectedPdfName.classList.remove('text-gray-800', 'font-bold');
  }

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

  const fileInput = document.getElementById('input-pdf-file');
  const fileObject = fileInput.files[0];
  const errorAlert = document.getElementById('form-error-alert');

  if (!fileObject) {
    errorAlert.textContent = "Please choose a PDF file to upload.";
    errorAlert.classList.remove('hidden');
    return;
  }

  const localFilePath = fileObject.path;

  // Basic Validations
  if (!permitId || !operatorName || !location || !dateStart || !dateEnd || !timeStart || !timeEnd || !localFilePath) {
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
    file_name: "" // backend will auto-generate and fill this standardized name
  };

  // Save permit via IPC
  showToast("Saving new permission & syncing to Supabase...", "info");
  const res = await window.api.savePermit(newPermit, localFilePath);

  if (res && res.success) {
    showToast("Permit saved and uploaded successfully!", "success");
    closeAddPermitModal();
    // Reload dashboard to show the new permit
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } else {
    errorAlert.textContent = res.error || "Failed to save new permit.";
    errorAlert.classList.remove('hidden');
    showToast("Failed to save permit", "error");
  }
}

// 7. Multi-Flight Sortie Management Engine & Spatial Audit

function calculateTrackDistanceKm(points) {
  if (!points || points.length < 2) return 0;
  let totalMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const lat1 = points[i - 1][0], lon1 = points[i - 1][1];
    const lat2 = points[i][0], lon2 = points[i][1];
    totalMeters += getDistance(lat1, lon1, lat2, lon2);
  }
  return totalMeters / 1000.0;
}

function computeSortieAuditSummary(permit) {
  const sorties = getPermitSorties(permit.permit_id);
  if (!sorties || sorties.length === 0) {
    return {
      hasSorties: false,
      summaryText: 'Awaiting flight logs for post-flight telemetry verification.',
      badgeText: 'NO FLIGHT LOGS',
      badgeClass: 'bg-gray-100 text-gray-500 border border-gray-200',
      totalSorties: 0,
      totalDurationFormatted: '0m',
      totalDistanceKm: '0.0',
      totalPoints: 0
    };
  }

  let altBreaches = 0;
  let geoBreaches = 0;
  let kkopBreaches = 0;
  let maxAgl = 0;
  let totalSec = 0;
  let totalDistKm = 0;
  let totalPoints = 0;

  sorties.forEach(s => {
    if (s.compliance) {
      if (!s.compliance.alt_compliant) altBreaches++;
      if (!s.compliance.geofence_compliant) geoBreaches++;
      if (!s.compliance.kkop_compliant) kkopBreaches++;
    }
    if (s.stats) {
      if (s.stats.max_agl_ft > maxAgl) maxAgl = s.stats.max_agl_ft;
      totalSec += (s.stats.duration_sec || 0);
      totalPoints += (s.stats.points_count || 0);
    }
    if (s.map_points && s.map_points.length > 1) {
      totalDistKm += calculateTrackDistanceKm(s.map_points);
    }
  });

  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const totalDurationFormatted = h > 0 ? `${h}h ${remM}m` : `${m}m ${s}s`;

  const hasBreach = altBreaches > 0 || geoBreaches > 0 || kkopBreaches > 0;
  let details = [];
  if (altBreaches > 0) details.push(`${altBreaches} ceiling breach(es) (Max: ${Math.round(maxAgl)}ft)`);
  if (geoBreaches > 0) details.push(`${geoBreaches} perimeter breach(es)`);
  if (kkopBreaches > 0) details.push(`${kkopBreaches} KKOP buffer breach(es)`);

  return {
    hasSorties: true,
    totalSorties: sorties.length,
    totalDurationSec: totalSec,
    totalDurationFormatted: totalDurationFormatted,
    totalDistanceKm: totalDistKm.toFixed(1),
    totalPoints: totalPoints,
    altBreaches,
    geoBreaches,
    kkopBreaches,
    maxAgl,
    hasBreach,
    badgeText: hasBreach ? 'BREACH RECORDED' : 'AUDIT COMPLIANT',
    badgeClass: hasBreach
      ? 'bg-red-50 text-red-700 border border-red-200 shadow-sm'
      : 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    summaryText: hasBreach
      ? `Post-flight inspection detected: ${details.join(', ')}.`
      : `All ${sorties.length} recorded flight sorties fully complied with airspace boundaries and the 400ft ceiling.`
  };
}

function clearSortieMapLayers() {
  if (!map) return;
  Object.values(activeSortieMapLayers).forEach(layerObj => {
    if (layerObj.polylines) {
      layerObj.polylines.forEach(pl => {
        if (map.hasLayer(pl)) map.removeLayer(pl);
      });
    } else if (layerObj.polyline && map.hasLayer(layerObj.polyline)) {
      map.removeLayer(layerObj.polyline);
    }
    if (layerObj.markers) {
      layerObj.markers.forEach(m => {
        if (map.hasLayer(m)) map.removeLayer(m);
      });
    }
  });
  activeSortieMapLayers = {};
  isShowingAllSorties = false;
  currentHighlightedSortieId = null;
}

// Partition coordinates into continuous compliant (inside polygon) vs breach (outside polygon) segments
function segmentRouteByGeofence(points, polygon) {
  if (!polygon || !polygon.length || !points || points.length < 2) {
    return [{ isBreach: false, points: points }];
  }

  const segments = [];
  let currentSegment = [points[0]];
  let currentIsBreach = !isPointInPolygon([points[0][0], points[0][1]], polygon);

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const ptIsBreach = !isPointInPolygon([pt[0], pt[1]], polygon);

    if (ptIsBreach === currentIsBreach) {
      currentSegment.push(pt);
    } else {
      // Bridge point so lines connect seamlessly without gaps
      currentSegment.push(pt);
      segments.push({ isBreach: currentIsBreach, points: currentSegment });
      // Start new segment including the transition point
      currentSegment = [points[i - 1], pt];
      currentIsBreach = ptIsBreach;
    }
  }

  if (currentSegment.length > 1) {
    segments.push({ isBreach: currentIsBreach, points: currentSegment });
  }

  return segments;
}

function plotSingleSortieOnMap(sortie, permit, fitBounds = true) {
  if (!map || !sortie || !sortie.map_points || !sortie.map_points.length) {
    showToast("No GPS coordinate track available for this sortie.", "warning");
    return;
  }

  // Toggle off if currently active
  if (currentHighlightedSortieId === sortie.id && !isShowingAllSorties) {
    clearSortieMapLayers();
    renderInspector(permit);
    return;
  }

  clearSortieMapLayers();
  currentHighlightedSortieId = sortie.id;

  const latlngs = sortie.map_points.map(p => [p[0], p[1]]);
  const polygon = permit ? permit.coordinates : null;
  const segments = segmentRouteByGeofence(latlngs, polygon);

  const polylines = [];
  const markers = [];
  let breachSegmentCount = 0;
  let allBounds = L.latLngBounds([]);

  segments.forEach((seg, idx) => {
    const isBreach = seg.isBreach;
    if (isBreach) breachSegmentCount++;

    const polyline = L.polyline(seg.points, {
      color: isBreach ? '#ef4444' : '#06b6d4', // Bright Red for geofence breach, Vibrant Cyan for compliant
      weight: isBreach ? 4.5 : 3.5,
      opacity: isBreach ? 1.0 : 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0
    }).addTo(map);

    allBounds.extend(polyline.getBounds());
    polylines.push(polyline);

    // If entering breach area from compliant area, add warning breach marker at the exit point
    if (isBreach && idx > 0 && seg.points.length > 0) {
      const breachPt = seg.points[0];
      const breachMarker = L.circleMarker(breachPt, {
        radius: 6,
        color: '#ffffff',
        fillColor: '#ef4444',
        fillOpacity: 1,
        weight: 2
      }).addTo(map).bindPopup(`
        <div class="text-xs p-1">
          <b class="text-red-700">⚠️ Geofence Breach Event</b><br/>
          <span class="text-gray-600">Drone exited approved NOTAM perimeter</span><br/>
          <span class="text-[10px] text-gray-500 font-mono">Lat: ${breachPt[0].toFixed(5)}, Lon: ${breachPt[1].toFixed(5)}</span>
        </div>
      `);
      markers.push(breachMarker);
    }
  });

  const startPt = latlngs[0];
  const endPt = latlngs[latlngs.length - 1];

  const startMarker = L.circleMarker(startPt, {
    radius: 6,
    color: '#ffffff',
    fillColor: '#10b981',
    fillOpacity: 1,
    weight: 2
  }).addTo(map).bindPopup(`
    <div class="text-xs p-1">
      <b class="text-emerald-700">${sortie.sortie_name}</b><br/>
      <span>🟢 Takeoff Location</span><br/>
      <span class="text-gray-500">Max AGL: <b>${sortie.stats?.max_agl_ft || 0} ft</b></span>
    </div>
  `);
  markers.push(startMarker);

  const endMarker = L.circleMarker(endPt, {
    radius: 6,
    color: '#ffffff',
    fillColor: '#0ea5e9',
    fillOpacity: 1,
    weight: 2
  }).addTo(map).bindPopup(`
    <div class="text-xs p-1">
      <b class="text-sky-700">${sortie.sortie_name}</b><br/>
      <span>🔵 Landing / End of Mission</span><br/>
      <span class="text-gray-500">Duration: <b>${sortie.stats?.duration_formatted || '--'}</b></span>
    </div>
  `);
  markers.push(endMarker);

  activeSortieMapLayers[sortie.id] = {
    polylines: polylines,
    markers: markers
  };

  if (fitBounds && allBounds.isValid()) {
    map.fitBounds(allBounds, { padding: [50, 50] });
  }

  if (breachSegmentCount > 0) {
    showToast(`⚠️ Spatial Alert: ${breachSegmentCount} route segment(s) outside permit polygon!`, "warning");
  }

  renderInspector(permit);
}

function plotAllSortiesOnMap(sorties, permit) {
  if (!map || !sorties || !sorties.length) return;

  if (isShowingAllSorties) {
    clearSortieMapLayers();
    renderInspector(permit);
    return;
  }

  clearSortieMapLayers();
  isShowingAllSorties = true;

  const COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981', '#3b82f6', '#0ea5e9', '#eab308'];
  let allBounds = L.latLngBounds([]);
  const polygon = permit ? permit.coordinates : null;

  sorties.forEach((sortie, idx) => {
    if (!sortie.map_points || !sortie.map_points.length) return;
    const baseColor = COLORS[idx % COLORS.length];
    const latlngs = sortie.map_points.map(p => [p[0], p[1]]);
    const segments = segmentRouteByGeofence(latlngs, polygon);

    const polylines = [];
    const markers = [];

    segments.forEach((seg) => {
      const isBreach = seg.isBreach;
      const polyline = L.polyline(seg.points, {
        color: isBreach ? '#ef4444' : baseColor,
        weight: isBreach ? 4 : 3,
        opacity: isBreach ? 1.0 : 0.9,
        dashArray: idx % 2 === 1 ? '6, 4' : null,
        smoothFactor: 0
      }).addTo(map);

      polylines.push(polyline);
      allBounds.extend(polyline.getBounds());
    });

    const startMarker = L.circleMarker(latlngs[0], {
      radius: 5,
      color: '#ffffff',
      fillColor: baseColor,
      fillOpacity: 1,
      weight: 2
    }).addTo(map).bindPopup(`
      <div class="text-xs p-1">
        <b style="color:${baseColor}">${sortie.sortie_name}</b><br/>
        <span>Takeoff (Sortie ${idx + 1})</span><br/>
        <span class="text-gray-500">Max AGL: <b>${sortie.stats?.max_agl_ft || 0} ft</b></span>
      </div>
    `);
    markers.push(startMarker);

    activeSortieMapLayers[sortie.id] = {
      polylines: polylines,
      markers: markers
    };
  });

  if (allBounds.isValid()) {
    map.fitBounds(allBounds, { padding: [50, 50] });
  }

  renderInspector(permit);
}

function openSortieInStudio(sortie) {
  if (!sortie) return;

  openUlgConverterModal();

  if (sortie.studioData) {
    // If sortie has high-resolution map_points, ensure studioData uses them
    if (sortie.map_points && sortie.map_points.length > (sortie.studioData.map_points?.length || 0)) {
      sortie.studioData.map_points = sortie.map_points;
    }
    ulgLastResult = sortie.studioData;
    ulgCurrentFilePath = sortie.filePath || sortie.file_name;

    // Reset previous studio polyline layer so fresh high-res trajectory renders on open
    if (ulgPolylineLayer && ulgLeafletMapInstance) {
      ulgLeafletMapInstance.removeLayer(ulgPolylineLayer);
      ulgPolylineLayer = null;
    }

    const fileNameEl = document.getElementById('ulg-file-name');
    if (fileNameEl) fileNameEl.textContent = sortie.sortie_name;
    const fileSizeEl = document.getElementById('ulg-file-size');
    if (fileSizeEl) fileSizeEl.textContent = `${sortie.file_size_mb || 0.5} MB · ${(sortie.file_type || '').toUpperCase()}`;

    const fileInfo = document.getElementById('ulg-file-info');
    if (fileInfo) fileInfo.classList.remove('hidden');
    const dropZone = document.getElementById('ulg-drop-zone');
    if (dropZone) dropZone.classList.add('hidden');

    ulgRenderInspector(sortie.studioData);
  } else if (sortie.filePath && window.api && window.api.parseFlightLog) {
    ulgSetFileFromPath(sortie.filePath, sortie.file_name, (sortie.file_size_mb || 1) * 1024 * 1024);
  } else {
    showToast("Telemetry data not formatted for Studio.", "warning");
  }
}

function removeSortie(permitId, sortieId) {
  if (!permitFlightSorties[permitId]) return;
  if (!confirm("Are you sure you want to remove this flight sortie log?")) return;

  permitFlightSorties[permitId] = permitFlightSorties[permitId].filter(s => s.id !== sortieId);
  saveSortiesToStorage();

  if (activeSortieMapLayers[sortieId]) {
    if (activeSortieMapLayers[sortieId].polyline && map) map.removeLayer(activeSortieMapLayers[sortieId].polyline);
    if (activeSortieMapLayers[sortieId].markers && map) {
      activeSortieMapLayers[sortieId].markers.forEach(m => map.removeLayer(m));
    }
    delete activeSortieMapLayers[sortieId];
  }

  showToast("Flight sortie removed.", "info");
  renderInspector(selectedPermit);
}

async function handleSortieUploadAction(permit) {
  if (!permit) return;

  if (window.api && window.api.selectFile) {
    const res = await window.api.selectFile({
      title: `Select Flight Log for ${permit.operator_name}`,
      filters: [
        { name: 'All Drone Flight Logs (*.ulg, *.txt, *.dat, *.csv, *.kml)', extensions: ['ulg', 'txt', 'dat', 'csv', 'kml'] },
        { name: 'PX4 ULog (*.ulg)', extensions: ['ulg'] },
        { name: 'DJI FlightRecord (*.txt, *.dat)', extensions: ['txt', 'dat'] },
        { name: 'CSV / KML Telemetry (*.csv, *.kml)', extensions: ['csv', 'kml'] }
      ]
    });

    if (!res.canceled && res.filePath) {
      await processSortieFromPath(res.filePath, res.name, res.size, permit);
      return;
    }
  }

  // Fallback to DOM input
  const input = document.getElementById('sortie-upload-input');
  if (input) input.click();
}

async function processSortieFromPath(filePath, fileName, fileSize, permit) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  showToast(`Processing flight log: ${fileName}...`, 'info');

  try {
    if (ext === 'ulg' || ext === 'txt' || ext === 'dat') {
      const key = djiApiKey || '07dadcba863fab453c6b46999a38eea';
      let parseResult = null;
      if (window.api && window.api.parseFlightLog) {
        parseResult = await window.api.parseFlightLog(filePath, key, null, []);
      } else {
        parseResult = await window.api.convertUlg(filePath, null, []);
      }

      if (!parseResult || !parseResult.success) {
        throw new Error((parseResult && parseResult.error) || 'Failed to parse binary flight log.');
      }

      const sortie = buildSortieFromParsedResult(parseResult, fileName, ext, fileSize, permit, filePath);
      addSortieToPermit(permit.permit_id, sortie);
      showToast(`Sortie attached: ${sortie.sortie_name}`, 'success');
      plotSingleSortieOnMap(sortie, permit);
      renderInspector(permit);
    } else if (ext === 'csv' || ext === 'kml') {
      let text = '';
      if (window.require) {
        const fs = window.require('fs');
        text = fs.readFileSync(filePath, 'utf8');
      } else {
        const resp = await fetch(filePath);
        text = await resp.text();
      }

      const parsed = parseLogData(text, ext);
      if (!parsed || !parsed.points || parsed.points.length === 0) {
        throw new Error('No GPS coordinate data found in file.');
      }

      const sortie = buildSortieFromCsvKml(parsed, fileName, ext, fileSize, permit, filePath);
      addSortieToPermit(permit.permit_id, sortie);
      showToast(`Sortie attached: ${sortie.sortie_name}`, 'success');
      plotSingleSortieOnMap(sortie, permit);
      renderInspector(permit);
    }
  } catch (err) {
    console.error('Error processing sortie file:', err);
    showToast(err.message || 'Failed to process flight log.', 'error');
  }
}

function handleSortieFileInputChange(event, permit) {
  const file = event.target.files[0];
  if (!file || !permit) return;

  const ext = file.name.split('.').pop().toLowerCase();
  const filePath = (window.api && window.api.getPathForFile) ? window.api.getPathForFile(file) : (file.path || '');

  if ((ext === 'ulg' || ext === 'txt' || ext === 'dat') && filePath) {
    processSortieFromPath(filePath, file.name, file.size, permit);
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      const parsed = parseLogData(text, ext);
      if (!parsed || !parsed.points || parsed.points.length === 0) {
        throw new Error('No GPS coordinate data found in log file.');
      }
      const sortie = buildSortieFromCsvKml(parsed, file.name, ext, file.size, permit, filePath);
      addSortieToPermit(permit.permit_id, sortie);
      showToast(`Sortie attached: ${sortie.sortie_name}`, 'success');
      plotSingleSortieOnMap(sortie, permit);
      renderInspector(permit);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to process log file.', 'error');
    }
  };
  reader.readAsText(file);
}

function addSortieToPermit(permitId, sortie) {
  if (!permitFlightSorties[permitId]) {
    permitFlightSorties[permitId] = [];
  }
  permitFlightSorties[permitId].push(sortie);
  saveSortiesToStorage();
}

function generateSortieName(permit, sortieIndex, timestamp = null) {
  let d = new Date();
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  const opClean = (permit.operator_name || 'Operator').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const sortieNum = String(sortieIndex).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}.${min}_${opClean}_Sortie-${sortieNum}`;
}

function buildSortieFromParsedResult(parseResult, fileName, ext, fileSize, permit, filePath) {
  const sorties = getPermitSorties(permit.permit_id);
  const sortieIndex = sorties.length + 1;
  const sortieName = generateSortieName(permit, sortieIndex);

  let map_points = [];
  if (parseResult.map_points && parseResult.map_points.length > 0) {
    const raw = parseResult.map_points;
    const targetPoints = Math.min(raw.length, 3000);
    const step = Math.max(1, Math.floor(raw.length / targetPoints));
    for (let i = 0; i < raw.length; i += step) {
      map_points.push([raw[i][0], raw[i][1], raw[i][2] || 0]);
    }
  } else if (parseResult.preview_points && parseResult.preview_points.length > 0) {
    map_points = parseResult.preview_points.map(p => [p.lat, p.lon, p.agl_ft]);
  }

  let geofenceCompliant = true;
  let breachCount = 0;
  const polygon = permit.coordinates;
  if (polygon && polygon.length > 0 && map_points.length > 0) {
    for (const pt of map_points) {
      if (!isPointInPolygon([pt[0], pt[1]], polygon)) {
        geofenceCompliant = false;
        breachCount++;
      }
    }
  }

  let kkopCompliant = true;
  if (map_points.length > 0) {
    for (const pt of map_points) {
      for (const airport of REGION_AIRPORTS) {
        if (isPointInCircle([pt[0], pt[1]], [airport.lat, airport.lng], 5000)) {
          let insidePermit = false;
          if (polygon && polygon.length > 0) {
            insidePermit = isPointInPolygon([pt[0], pt[1]], polygon);
          }
          if (!insidePermit) {
            kkopCompliant = false;
            break;
          }
        }
      }
      if (!kkopCompliant) break;
    }
  }

  const dur = parseResult.duration_sec || 0;
  const durStr = dur < 60 ? `${Math.round(dur)}s` :
    dur < 3600 ? `${Math.floor(dur / 60)}m ${Math.round(dur % 60)}s` :
      `${Math.floor(dur / 3600)}h ${Math.floor((dur % 3600) / 60)}m`;

  const ceilingLimit = permit.max_altitude_ft || 400;
  const altOk = parseResult.max_agl_ft <= ceilingLimit;
  const speedOk = parseResult.max_speed_knots <= 87;

  const studioData = Object.assign({}, parseResult);
  if (studioData.map_points && studioData.map_points.length > 300) {
    studioData.map_points = map_points;
  }

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} WIB`;
  const dateStr = now.toISOString().split('T')[0];

  return {
    id: 'sortie_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sortie_name: sortieName,
    date_time: `${dateStr} ${timeStr}`,
    file_name: fileName,
    file_type: ext,
    file_size_mb: Number(((fileSize || 0) / (1024 * 1024)).toFixed(1)),
    filePath: filePath,
    stats: {
      duration_formatted: durStr,
      duration_sec: dur,
      max_agl_ft: Math.round(parseResult.max_agl_ft || 0),
      max_amsl_ft: Math.round(parseResult.max_amsl_ft || 0),
      max_speed_kts: Number((parseResult.max_speed_knots || 0).toFixed(1)),
      points_count: parseResult.track_points || map_points.length,
      takeoff_lat: map_points[0] ? map_points[0][0] : 0,
      takeoff_lng: map_points[0] ? map_points[0][1] : 0
    },
    compliance: {
      alt_compliant: altOk,
      speed_compliant: speedOk,
      geofence_compliant: geofenceCompliant,
      kkop_compliant: kkopCompliant,
      time_compliant: true,
      breach_count: breachCount
    },
    map_points: map_points,
    studioData: studioData
  };
}

function buildSortieFromCsvKml(parsed, fileName, ext, fileSize, permit, filePath) {
  const sorties = getPermitSorties(permit.permit_id);
  const sortieIndex = sorties.length + 1;
  const sortieName = generateSortieName(permit, sortieIndex);

  const rawPts = parsed.points || [];
  const targetPoints = Math.min(rawPts.length, 3000);
  const step = Math.max(1, Math.floor(rawPts.length / targetPoints));
  const sampled = [];
  for (let i = 0; i < rawPts.length; i += step) {
    sampled.push(rawPts[i]);
  }

  const map_points = sampled.map(p => [p[0], p[1], Math.round(p[2])]);

  let geofenceCompliant = true;
  let breachCount = 0;
  const polygon = permit.coordinates;
  if (polygon && polygon.length > 0 && map_points.length > 0) {
    for (const pt of map_points) {
      if (!isPointInPolygon([pt[0], pt[1]], polygon)) {
        geofenceCompliant = false;
        breachCount++;
      }
    }
  }

  let kkopCompliant = true;
  if (map_points.length > 0) {
    for (const pt of map_points) {
      for (const airport of REGION_AIRPORTS) {
        if (isPointInCircle([pt[0], pt[1]], [airport.lat, airport.lng], 5000)) {
          let insidePermit = false;
          if (polygon && polygon.length > 0) {
            insidePermit = isPointInPolygon([pt[0], pt[1]], polygon);
          }
          if (!insidePermit) {
            kkopCompliant = false;
            break;
          }
        }
      }
      if (!kkopCompliant) break;
    }
  }

  const ceilingLimit = permit.max_altitude_ft || 400;
  const altOk = parsed.maxAltitude <= ceilingLimit;
  const speedOk = parsed.maxSpeed <= 87;

  const preview_points = sampled.map((p, idx) => ({
    time_min: Number(((idx / Math.max(1, sampled.length - 1)) * 30).toFixed(1)),
    agl_ft: Math.round(p[2]),
    amsl_ft: Math.round(p[2] + 97.6),
    speed_knots: Number((p[3] || 0).toFixed(1)),
    speed_mph: Number(((p[3] || 0) * 1.15078).toFixed(1)),
    battery_pct: Math.max(12, Math.round(100 - (idx / Math.max(1, sampled.length - 1)) * 82)),
    voltage_v: Number((32.0 - (idx / Math.max(1, sampled.length - 1)) * 6.5).toFixed(1)),
    lat: p[0],
    lon: p[1],
    heading: 0
  }));

  const studioData = {
    success: true,
    drone_brand: ext === 'kml' ? 'KML Telemetry' : 'CSV Telemetry',
    aircraft_name: 'Telemetry Track',
    max_agl_ft: Math.round(parsed.maxAltitude),
    max_agl_m: Math.round(parsed.maxAltitude * 0.3048),
    max_amsl_ft: Math.round(parsed.maxAltitude + 97.6),
    max_amsl_m: Math.round((parsed.maxAltitude + 97.6) * 0.3048),
    max_speed_knots: Number(parsed.maxSpeed.toFixed(1)),
    max_speed_kmh: Number((parsed.maxSpeed * 1.852).toFixed(1)),
    max_speed_ms: Number((parsed.maxSpeed * 0.514444).toFixed(1)),
    duration_sec: Math.max(600, sampled.length * 4),
    track_points: rawPts.length,
    takeoff_amsl_ft: 97.6,
    takeoff_amsl_m: 29.8,
    preview_points: preview_points,
    map_points: map_points,
    compliance: {
      ceiling_limit_ft: ceilingLimit,
      max_agl_ft: Math.round(parsed.maxAltitude),
      ceiling_breach: !altOk,
      speed_limit_knots: 87,
      max_speed_knots: Number(parsed.maxSpeed.toFixed(1)),
      speed_breach: !speedOk
    }
  };

  const durSec = studioData.duration_sec;
  const durStr = `${Math.floor(durSec / 60)}m ${Math.round(durSec % 60)}s`;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} WIB`;
  const dateStr = now.toISOString().split('T')[0];

  return {
    id: 'sortie_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sortie_name: sortieName,
    date_time: `${dateStr} ${timeStr}`,
    file_name: fileName,
    file_type: ext,
    file_size_mb: Number(((fileSize || 0) / (1024 * 1024)).toFixed(1)),
    filePath: filePath,
    stats: {
      duration_formatted: durStr,
      duration_sec: durSec,
      max_agl_ft: Math.round(parsed.maxAltitude),
      max_amsl_ft: Math.round(parsed.maxAltitude + 97.6),
      max_speed_kts: Number(parsed.maxSpeed.toFixed(1)),
      points_count: rawPts.length,
      takeoff_lat: map_points[0] ? map_points[0][0] : 0,
      takeoff_lng: map_points[0] ? map_points[0][1] : 0
    },
    compliance: {
      alt_compliant: altOk,
      speed_compliant: speedOk,
      geofence_compliant: geofenceCompliant,
      kkop_compliant: kkopCompliant,
      time_compliant: true,
      breach_count: breachCount
    },
    map_points: map_points,
    studioData: studioData
  };
}

// =================================================================
// Shared KML coordinate parser — used by both parseLogData() and
// processTelemetryKml() to eliminate duplicate logic.
// Returns the raw coordinate text from the longest <coordinates> block.
// =================================================================
function parseKmlCoordinates(text) {
  const parser = new DOMParser();
  const kml = parser.parseFromString(text, 'text/xml');

  // Search both namespaces/capitalizations
  let coordinatesNodes = Array.from(kml.getElementsByTagNameNS('*', 'coordinates'))
    .concat(Array.from(kml.getElementsByTagNameNS('*', 'Coordinates')));

  // Regex fallback for malformed XML or namespace prefix issues
  const regex = /<(?:[a-zA-Z0-9_-]+:)?(?:[Cc]oordinates)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?(?:[Cc]oordinates)>/g;
  let match;
  const regexTexts = [];
  while ((match = regex.exec(text)) !== null) {
    regexTexts.push(match[1]);
  }

  const allTexts = coordinatesNodes.map(node => node.textContent).concat(regexTexts);
  if (allTexts.length === 0) throw new Error('No coordinate data tags found in KML file.');

  // Pick the text block with the most whitespace-separated tokens (= most coordinate tuples)
  let coordText = '';
  for (const txt of allTexts) {
    if (txt.trim().split(/\s+/).length > coordText.trim().split(/\s+/).length) {
      coordText = txt;
    }
  }
  return coordText;
}

function parseLogData(text, extension) {
  let points = [];
  let maxAltitude = 0;
  let maxSpeed = 0;

  let altitudes = [];
  let speeds = [];
  let timestamps = [];

  if (extension === 'kml') {
    const coordText = parseKmlCoordinates(text);
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

  // 4. KKOP Airspace Buffer Proximity Auditing (Butir 2.2.2.a)
  let kkopBreached = false;
  const breachedAirports = [];
  const authorizedAirports = [];

  for (const pt of points) {
    const lat = pt[0];
    const lng = pt[1];

    for (const airport of REGION_AIRPORTS) {
      const insideKkop = isPointInCircle([lat, lng], [airport.lat, airport.lng], 5000);
      if (insideKkop) {
        // Check if inside the permit boundaries
        let insidePermit = false;
        if (polygon && polygon.length > 0) {
          insidePermit = isPointInPolygon([lat, lng], polygon);
        } else {
          const center = getCoordsFromLocation(selectedPermit.location);
          if (center) {
            insidePermit = isPointInCircle([lat, lng], center, 6000);
          }
        }

        if (insidePermit) {
          if (!authorizedAirports.includes(airport.code)) {
            authorizedAirports.push(airport.code);
          }
        } else {
          kkopBreached = true;
          if (!breachedAirports.includes(airport.code)) {
            breachedAirports.push(airport.code);
          }
        }
      }
    }
  }

  flightLogData.kkopBreached = kkopBreached;
  flightLogData.breachedAirports = breachedAirports;
  flightLogData.authorizedAirports = authorizedAirports;

  // 5. Time Compliance (Daylight & Permit Time-Window Auditing (Butir 3.6 & 3.7))
  let daylightBreached = false;
  let permitTimeBreached = false;
  let nightPointsCount = 0;
  let outOfWindowPointsCount = 0;

  const parsePermitTime = (tStr) => {
    if (!tStr) return null;
    const clean = tStr.split(' ')[0].replace('.', ':');
    const parts = clean.split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { hours: parts[0], minutes: parts[1] };
    }
    return null;
  };

  const permitStart = parsePermitTime(selectedPermit.time_start);
  const permitEnd = parsePermitTime(selectedPermit.time_end);

  for (const pt of points) {
    const timeVal = pt[4];
    if (typeof timeVal === 'string') {
      const localDate = parseTimeToLocal(timeVal);
      if (localDate) {
        const localHours = localDate.getHours();
        const localMinutes = localDate.getMinutes();

        // Daylight Check (06:00 - 18:00 local time)
        if (localHours < 6 || localHours >= 18) {
          daylightBreached = true;
          nightPointsCount++;
        }

        // Permit Window Check
        if (permitStart && permitEnd) {
          const ptMin = localHours * 60 + localMinutes;
          const startMin = permitStart.hours * 60 + permitStart.minutes;
          const endMin = permitEnd.hours * 60 + permitEnd.minutes;
          if (ptMin < startMin || ptMin > endMin) {
            permitTimeBreached = true;
            outOfWindowPointsCount++;
          }
        }
      }
    }
  }

  flightLogData.daylightBreached = daylightBreached;
  flightLogData.permitTimeBreached = permitTimeBreached;
  flightLogData.nightPointsCount = nightPointsCount;
  flightLogData.outOfWindowPointsCount = outOfWindowPointsCount;
}

function parseTimeToLocal(timeVal) {
  // Handles standard date time format "YYYY-MM-DD HH:MM:SS" (e.g. UTC timestamp from flight log)
  if (timeVal.includes(' ') && timeVal.split(' ')[0].includes('-')) {
    const parts = timeVal.split(' ');
    const datePart = parts[0];
    const timePart = parts[1];
    // Treating as UTC by appending Z to convert to local PC timezone
    const d = new Date(datePart + 'T' + timePart + 'Z');
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  // Handles time only format "HH:MM:SS" or "HH:MM" (AM/PM optional)
  const timeMatch = timeVal.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[4];
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
  return null;
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
  if (!vs || !Array.isArray(vs) || vs.length === 0) return false;
  // If MultiPolygon (array of polygon rings)
  if (Array.isArray(vs[0]) && Array.isArray(vs[0][0])) {
    return vs.some(ring => isPointInPolygon(point, ring));
  }
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

  // KKOP Status UI
  const kkopEl = document.getElementById('log-kkop');
  if (kkopEl) {
    if (flightLogData.kkopBreached) {
      kkopEl.textContent = `Breached (outside permit in ${flightLogData.breachedAirports.join(', ')} KKOP)`;
      kkopEl.className = "font-bold text-red-600 animate-pulse";
    } else if (flightLogData.authorizedAirports && flightLogData.authorizedAirports.length > 0) {
      kkopEl.textContent = `Authorized KKOP (${flightLogData.authorizedAirports.join(', ')})`;
      kkopEl.className = "font-bold text-emerald-600";
    } else {
      kkopEl.textContent = "Compliant (Clear of KKOP)";
      kkopEl.className = "font-bold text-emerald-600";
    }
  }

  // Time Compliance UI
  const timeEl = document.getElementById('log-time');
  if (timeEl) {
    if (flightLogData.daylightBreached && flightLogData.permitTimeBreached) {
      timeEl.textContent = `Breached (Night flight & Out of permit window)`;
      timeEl.className = "font-bold text-red-600 animate-pulse";
    } else if (flightLogData.daylightBreached) {
      timeEl.textContent = `Breached (Night flight)`;
      timeEl.className = "font-bold text-red-600 animate-pulse";
    } else if (flightLogData.permitTimeBreached) {
      timeEl.textContent = `Breached (Out of permit window)`;
      timeEl.className = "font-bold text-red-600 animate-pulse";
    } else {
      timeEl.textContent = "Compliant (Daylight & within window)";
      timeEl.className = "font-bold text-emerald-600";
    }
  }
}



// ============================================================
// TELEMETRY ANALYZER LOGIC
// ============================================================

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
  clearTelemetryCsv();
  clearTelemetryKml();
  clearTelemetryAnalyzerMap();
  switchTelemetryTab('combined');
}

function switchTelemetryTab(tabName) {
  currentActiveTelemetryTab = tabName;

  // Hide all wrappers
  document.getElementById('wrapper-chart-combined').classList.add('hidden');
  document.getElementById('wrapper-chart-altitude').classList.add('hidden');
  document.getElementById('wrapper-chart-amsl').classList.add('hidden');
  document.getElementById('wrapper-chart-speed').classList.add('hidden');
  document.getElementById('wrapper-chart-map').classList.add('hidden');

  // Reset active classes on all tab buttons
  const tabs = ['combined', 'altitude', 'amsl', 'speed', 'map'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btn-tab-${t}`);
    if (btn) {
      btn.className = "text-[11px] font-bold px-3.5 py-1.5 rounded-xl text-gray-500 hover:bg-black/5 hover:text-gray-700 transition-all border border-transparent";
    }
  });

  // Show active wrapper and set active styles
  const activeWrapper = document.getElementById(`wrapper-chart-${tabName}`);
  if (activeWrapper) activeWrapper.classList.remove('hidden');

  const activeBtn = document.getElementById(`btn-tab-${tabName}`);
  if (activeBtn) {
    activeBtn.className = "text-[11px] font-bold px-3.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 transition-all border border-indigo-100/50";
  }

  if (tabName === 'map') {
    initTelemetryAnalyzerMap();
  }
}

function handleTelemetryCsvDrop(event) {
  event.preventDefault();
  document.getElementById('telemetry-csv-drop-zone').classList.remove('border-indigo-400');
  const file = event.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    processTelemetryCsv(file);
  } else {
    showToast('Please drop a valid .csv file.', 'error');
  }
}

function handleTelemetryKmlDrop(event) {
  event.preventDefault();
  document.getElementById('telemetry-kml-drop-zone').classList.remove('border-violet-400');
  const file = event.dataTransfer.files[0];
  if (file && file.name.endsWith('.kml')) {
    processTelemetryKml(file);
  } else {
    showToast('Please drop a valid .kml file.', 'error');
  }
}

function handleTelemetryCsvUpload(event) {
  const file = event.target.files[0];
  if (file) processTelemetryCsv(file);
}

function handleTelemetryKmlUpload(event) {
  const file = event.target.files[0];
  if (file) processTelemetryKml(file);
}

function clearTelemetryCsv() {
  uploadedCsvFile = null;
  uploadedCsvData = null;
  document.getElementById('telemetry-csv-file-info').classList.add('hidden');
  document.getElementById('telemetry-csv-drop-zone').classList.remove('hidden');
  document.getElementById('telemetry-csv-input').value = '';

  if (telemetryChartCombinedInstance) {
    telemetryChartCombinedInstance.destroy();
    telemetryChartCombinedInstance = null;
  }
  if (telemetryChartAltitudeInstance) {
    telemetryChartAltitudeInstance.destroy();
    telemetryChartAltitudeInstance = null;
  }
  if (telemetryChartAmslInstance) {
    telemetryChartAmslInstance.destroy();
    telemetryChartAmslInstance = null;
  }
  if (telemetryChartSpeedInstance) {
    telemetryChartSpeedInstance.destroy();
    telemetryChartSpeedInstance = null;
  }

  clearTelemetryAnalyzerMap();
  updateTelemetryAnalyzerUI();
}

function clearTelemetryKml() {
  uploadedKmlFile = null;
  uploadedKmlCoords = null;
  document.getElementById('telemetry-kml-file-info').classList.add('hidden');
  document.getElementById('telemetry-kml-drop-zone').classList.remove('hidden');
  document.getElementById('telemetry-kml-input').value = '';

  if (map && flightPathPolyline) {
    map.removeLayer(flightPathPolyline);
    flightPathPolyline = null;
  }

  clearTelemetryAnalyzerMap();
  updateTelemetryAnalyzerUI();
}

function processTelemetryCsv(file) {
  startLogoProcessing();
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      const rows = text.trim().split('\n');
      if (rows.length < 2) throw new Error('CSV file appears empty.');

      const header = rows[0].split(',').map(h => h.trim().toLowerCase());

      // --- Column Index Detection ---
      const timeIdx = header.findIndex(h => h.includes('time(millisecond)') || h === 'time(ms)' || h === 'time');

      // Speed (mph / ms / knots)
      let speedIdx = header.findIndex(h => h.includes('speed(knots)') || h.includes('speed(kts)') || h === 'speed_knots' || h === 'speed_kts');
      let speedUnit = 'knots';
      if (speedIdx === -1) {
        speedIdx = header.findIndex(h => h.includes('speed(mph)') || h === 'speed_mph' || h === 'speed');
        speedUnit = 'mph';
      }
      if (speedIdx === -1) {
        speedIdx = header.findIndex(h => h.includes('speed(m/s)') || h === 'speed_ms');
        speedUnit = 'm/s';
      }

      // Altitude (AGL vs AMSL)
      let aglIdx = header.findIndex(h => h.includes('height_above_takeoff') || h.includes('height_above_ground') || h === 'height' || h === 'agl');
      let amslIdx = header.findIndex(h => h.includes('altitude_above_sealevel') || h.includes('altitude') || h === 'amsl');

      // Coordinate columns (latitude/longitude)
      const latIdx = header.findIndex(h => h === 'latitude' || h === 'lat');
      const lngIdx = header.findIndex(h => h === 'longitude' || h === 'lon' || h === 'lng');

      if (timeIdx === -1) throw new Error("Could not find a 'time(millisecond)' column.");
      if (speedIdx === -1) throw new Error("Could not find a 'speed' column.");
      if (aglIdx === -1 && amslIdx === -1) throw new Error("Could not find an altitude (AGL or AMSL) column.");

      const timeData = [];
      const speedData = [];
      const aglData = [];
      const amslData = [];
      const coords = [];
      let filteredPreFlight = 0;
      let dateVal = "";
      let timeVal = "";

      const datetimeIdx = header.findIndex(h => h.includes('datetime') || h.includes('date') || h.includes('time_utc'));

      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        const cols = rows[i].split(',');
        if (cols.length < header.length) continue;

        const timeMs = parseFloat(cols[timeIdx]);
        let speed = parseFloat(cols[speedIdx]);
        let aglAlt = aglIdx !== -1 ? parseFloat(cols[aglIdx]) : null;
        let amslAlt = amslIdx !== -1 ? parseFloat(cols[amslIdx]) : null;
        const lat = latIdx !== -1 ? parseFloat(cols[latIdx]) : null;
        const lng = lngIdx !== -1 ? parseFloat(cols[lngIdx]) : null;

        if (isNaN(timeMs) || isNaN(speed)) continue;

        // Fallbacks if one altitude column is missing
        if (aglAlt === null || isNaN(aglAlt)) {
          aglAlt = amslAlt !== null && !isNaN(amslAlt) ? amslAlt : 0;
        }
        if (amslAlt === null || isNaN(amslAlt)) {
          amslAlt = aglAlt;
        }

        // Convert speed to knots
        if (speedUnit === 'mph') {
          speed = speed * 0.868976;
        } else if (speedUnit === 'm/s') {
          speed = speed * 1.94384;
        }

        // Clean noise readings
        if (aglAlt < -100 || aglAlt > 10000) aglAlt = 0;
        if (amslAlt < -100 || amslAlt > 10000) amslAlt = 0;
        if (speed < 0 || speed > 300) speed = 0;

        // Pre-Flight Ground Filter: skip rows where speed=0 AND AGL altitude<=0
        if (speed === 0 && aglAlt <= 0) {
          filteredPreFlight++;
          continue;
        }

        // Convert ms to decimal minutes for X-axis
        const timeMinutes = timeMs / 60000.0;

        timeData.push(parseFloat(timeMinutes.toFixed(3)));
        speedData.push(parseFloat(speed.toFixed(2)));
        aglData.push(parseFloat(aglAlt.toFixed(1)));
        amslData.push(parseFloat(amslAlt.toFixed(1)));

        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
          coords.push([lat, lng]);
        }

        // Auto-extract date and time from the first valid record
        if (datetimeIdx !== -1 && !dateVal && cols[datetimeIdx]) {
          const dtStr = cols[datetimeIdx].trim();
          const parts = dtStr.split(' ');
          if (parts.length >= 2) {
            dateVal = parts[0];
            timeVal = parts[1];
          } else {
            dateVal = dtStr;
          }
        }
      }

      if (timeData.length === 0) throw new Error('No valid flight data found after filtering.');

      // Summary statistics
      const maxSpeed = Math.max(...speedData);
      const maxAgl = Math.max(...aglData);
      const maxAmsl = Math.max(...amslData);
      const duration = timeData[timeData.length - 1];

      // Find takeoff and landing indices to calculate average values during flight phase (takeoff to landing)
      let startIdx = 0;
      let endIdx = aglData.length - 1;

      // Find first point where AGL > 5 (takeoff)
      for (let i = 0; i < aglData.length; i++) {
        if (aglData[i] > 5) {
          startIdx = i;
          break;
        }
      }

      // Find last point where AGL > 5 (landing)
      for (let i = aglData.length - 1; i >= startIdx; i--) {
        if (aglData[i] > 5) {
          endIdx = i;
          break;
        }
      }

      const flightSpeedSlice = speedData.slice(startIdx, endIdx + 1);
      const flightAglSlice = aglData.slice(startIdx, endIdx + 1);
      const flightAmslSlice = amslData.slice(startIdx, endIdx + 1);

      const avgSpeed = flightSpeedSlice.length > 0
        ? flightSpeedSlice.reduce((a, b) => a + b, 0) / flightSpeedSlice.length
        : (speedData.reduce((a, b) => a + b, 0) / speedData.length || 0);

      const avgAgl = flightAglSlice.length > 0
        ? flightAglSlice.reduce((a, b) => a + b, 0) / flightAglSlice.length
        : (aglData.reduce((a, b) => a + b, 0) / aglData.length || 0);

      const avgAmsl = flightAmslSlice.length > 0
        ? flightAmslSlice.reduce((a, b) => a + b, 0) / flightAmslSlice.length
        : (amslData.reduce((a, b) => a + b, 0) / amslData.length || 0);

      // Save parsed CSV structure globally
      uploadedCsvFile = file;
      uploadedCsvData = {
        filename: file.name,
        timeData,
        speedData,
        aglData,
        amslData,
        coords,
        maxSpeed,
        maxAgl,
        maxAmsl,
        duration,
        avgSpeed,
        avgAgl,
        avgAmsl,
        hasAgl: aglIdx !== -1,
        hasAmsl: amslIdx !== -1,
        date: dateVal,
        time: timeVal
      };

      // Show results in UI
      showTelemetryFileInfo(file.name, timeData.length, filteredPreFlight, maxSpeed, maxAgl, maxAmsl, duration, avgSpeed, avgAgl, avgAmsl);
      renderTelemetryChart(timeData, speedData, aglData, amslData, aglIdx !== -1, amslIdx !== -1);
      updateTelemetryAnalyzerUI();
      stopLogoProcessing();

    } catch (err) {
      console.error('Telemetry parse error:', err);
      showToast(err.message || 'Failed to parse CSV file.', 'error');
      stopLogoProcessing();
    }
  };
  reader.readAsText(file);
}

function showTelemetryFileInfo(filename, points, filtered, maxSpeed, maxAgl, maxAmsl, duration, avgSpeed, avgAgl, avgAmsl) {
  // Hide drop zone, show info
  document.getElementById('telemetry-csv-drop-zone').classList.add('hidden');
  const infoEl = document.getElementById('telemetry-csv-file-info');
  infoEl.classList.remove('hidden');

  document.getElementById('telemetry-csv-filename').textContent = filename;
  document.getElementById('telemetry-csv-stats').textContent =
    `${points.toLocaleString()} points · ${filtered} pre-flight rows filtered`;

  const avgHiddenClass = telemetryAveragesEnabled ? '' : 'hidden';

  // Summary stats row
  const summaryRow = document.getElementById('telemetry-summary-row');
  summaryRow.innerHTML = `
    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-3 text-center shadow-sm">
      <div class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Flight Duration</div>
      <div class="text-lg font-extrabold text-indigo-700 mt-1">${duration.toFixed(2)}</div>
      <div class="text-[9px] text-gray-400 font-medium">minutes</div>
    </div>
    <div class="bg-orange-50 border border-orange-100 rounded-2xl p-3 text-center shadow-sm flex flex-col justify-between">
      <div class="text-[10px] font-bold text-orange-500 uppercase tracking-wider">Speed Profile</div>
      <div class="text-lg font-extrabold text-orange-600 mt-1">${maxSpeed.toFixed(1)} <span class="text-[10px] font-semibold text-gray-400">max</span></div>
      <div class="telemetry-avg-info ${avgHiddenClass}">
        <div class="text-[10px] text-orange-700 font-bold mt-1">Avg: ${avgSpeed.toFixed(1)} kts</div>
        <div class="text-[7.5px] text-gray-400 mt-0.5">(Takeoff to Landing)</div>
      </div>
    </div>
    <div class="bg-sky-50 border border-sky-100 rounded-2xl p-3 text-center shadow-sm flex flex-col justify-between">
      <div class="text-[10px] font-bold text-sky-500 uppercase tracking-wider">Altitude AGL</div>
      <div class="text-lg font-extrabold text-sky-600 mt-1">${maxAgl.toFixed(0)} <span class="text-[10px] font-semibold text-gray-400">max</span></div>
      <div class="telemetry-avg-info ${avgHiddenClass}">
        <div class="text-[10px] text-sky-700 font-bold mt-1">Avg: ${avgAgl.toFixed(0)} ft</div>
        <div class="text-[7.5px] text-gray-400 mt-0.5">(Takeoff to Landing)</div>
      </div>
    </div>
    <div class="bg-violet-50 border border-violet-100 rounded-2xl p-3 text-center shadow-sm flex flex-col justify-between">
      <div class="text-[10px] font-bold text-violet-500 uppercase tracking-wider">Altitude AMSL</div>
      <div class="text-lg font-extrabold text-violet-600 mt-1">${maxAmsl.toFixed(0)} <span class="text-[10px] font-semibold text-gray-400">max</span></div>
      <div class="telemetry-avg-info ${avgHiddenClass}">
        <div class="text-[10px] text-violet-700 font-bold mt-1">Avg: ${avgAmsl.toFixed(0)} ft</div>
        <div class="text-[7.5px] text-gray-400 mt-0.5">(Takeoff to Landing)</div>
      </div>
    </div>
  `;
}

function processTelemetryKml(file) {
  startLogoProcessing();
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      // Use shared KML coordinate parser helper
      const coordText = parseKmlCoordinates(text);
      const lines = coordText.trim().split(/\s+/);
      const points = [];
      lines.forEach(line => {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const lng = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
            points.push([lat, lng]);
          }
        }
      });

      if (points.length === 0) throw new Error("No valid coordinates found in KML.");

      uploadedKmlFile = file;
      uploadedKmlCoords = points;

      // Update UI file badge
      document.getElementById('telemetry-kml-drop-zone').classList.add('hidden');
      const infoEl = document.getElementById('telemetry-kml-file-info');
      infoEl.classList.remove('hidden');

      document.getElementById('telemetry-kml-filename').textContent = file.name;
      document.getElementById('telemetry-kml-stats').textContent = `${points.length} boundary coordinates parsed`;

      // Plot immediate feedback on the main map
      if (map) {
        if (flightPathPolyline) {
          map.removeLayer(flightPathPolyline);
        }
        flightPathPolyline = L.polyline(points, {
          color: '#8b5cf6', // Violet color for geofence/route path
          weight: 3,
          opacity: 0.85,
          dashArray: '5, 5'
        }).addTo(map);
        map.fitBounds(flightPathPolyline.getBounds(), { padding: [40, 40] });
      }

      showToast("KML flight path loaded and plotted on map!", "success");
      updateTelemetryAnalyzerUI();
      stopLogoProcessing();

    } catch (err) {
      console.error("KML parse error:", err);
      showToast(err.message || "Failed to parse KML file.", "error");
      stopLogoProcessing();
    }
  };
  reader.readAsText(file);
}

window.handleTelemetryAveragesToggle = function () {
  const checkbox = document.getElementById('enable-flight-averages');
  telemetryAveragesEnabled = checkbox ? checkbox.checked : true;

  const avgInfoElements = document.querySelectorAll('.telemetry-avg-info');
  avgInfoElements.forEach(el => {
    if (telemetryAveragesEnabled) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
};

function handleTelemetryLimitChange() {
  const checkbox = document.getElementById('enable-limit-lines');
  telemetryLimitEnabled = checkbox ? checkbox.checked : true;

  const modeSelect = document.getElementById('select-limit-alt-mode');
  telemetryAltLimitMode = modeSelect ? modeSelect.value : 'agl';

  // Update the label to reflect selected mode
  const altLabel = document.getElementById('label-alt-limit');
  if (altLabel) {
    altLabel.textContent = telemetryAltLimitMode === 'agl' ? 'Alt AGL Limit:' : 'Alt AMSL Limit:';
  }

  // Read from the single unified alt limit input
  const altInput = document.getElementById('input-limit-alt');
  const altVal = altInput ? (parseFloat(altInput.value) || 1150) : 1150;

  // Apply the value to the active mode
  if (telemetryAltLimitMode === 'agl') {
    telemetryLimitAgl = altVal;
  } else {
    telemetryLimitAmsl = altVal;
  }

  const speedInput = document.getElementById('input-limit-speed');
  if (speedInput) telemetryLimitSpeed = parseFloat(speedInput.value) || 100;

  // Reactively update charts
  if (uploadedCsvData) {
    updateTelemetryChartsLimits();
  }
}

function updateTelemetryChartsLimits() {
  if (!uploadedCsvData) return;

  const labels = telemetryChartCombinedInstance ? telemetryChartCombinedInstance.data.labels : [];

  // 1. Update Combined Chart
  if (telemetryChartCombinedInstance) {
    const datasets = telemetryChartCombinedInstance.data.datasets;
    const cleanDatasets = datasets.filter(d => !d.label.includes('Limit'));

    if (telemetryLimitEnabled) {
      const activeAltLimit = telemetryAltLimitMode === 'agl' ? telemetryLimitAgl : telemetryLimitAmsl;
      const activeAltLabel = telemetryAltLimitMode === 'agl' ? 'Alt AGL Limit (ft)' : 'Alt AMSL Limit (ft)';

      cleanDatasets.push({
        label: activeAltLabel,
        data: Array(labels.length).fill(activeAltLimit),
        borderColor: '#ef4444',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        yAxisID: 'yAlt',
      });

      cleanDatasets.push({
        label: 'Speed Limit (knots)',
        data: Array(labels.length).fill(telemetryLimitSpeed),
        borderColor: '#f43f5e',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        yAxisID: 'ySpeed',
      });
    }

    telemetryChartCombinedInstance.data.datasets = cleanDatasets;
    telemetryChartCombinedInstance.update();
  }

  // 2. Update Altitude AGL Chart
  if (telemetryChartAltitudeInstance) {
    const cleanDatasets = telemetryChartAltitudeInstance.data.datasets.filter(d => !d.label.includes('Limit'));
    if (telemetryLimitEnabled) {
      cleanDatasets.push({
        label: 'Altitude AGL Limit (ft)',
        data: Array(labels.length).fill(telemetryLimitAgl),
        borderColor: '#ef4444',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      });
    }
    telemetryChartAltitudeInstance.data.datasets = cleanDatasets;
    telemetryChartAltitudeInstance.update();
  }

  // 3. Update Altitude AMSL Chart
  if (telemetryChartAmslInstance) {
    const cleanDatasets = telemetryChartAmslInstance.data.datasets.filter(d => !d.label.includes('Limit'));
    if (telemetryLimitEnabled) {
      cleanDatasets.push({
        label: 'Altitude AMSL Limit (ft)',
        data: Array(labels.length).fill(telemetryLimitAmsl),
        borderColor: '#ef4444',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      });
    }
    telemetryChartAmslInstance.data.datasets = cleanDatasets;
    telemetryChartAmslInstance.update();
  }

  // 4. Update Speed Chart
  if (telemetryChartSpeedInstance) {
    const cleanDatasets = telemetryChartSpeedInstance.data.datasets.filter(d => !d.label.includes('Limit'));
    if (telemetryLimitEnabled) {
      cleanDatasets.push({
        label: 'Speed Limit (knots)',
        data: Array(labels.length).fill(telemetryLimitSpeed),
        borderColor: '#f43f5e',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      });
    }
    telemetryChartSpeedInstance.data.datasets = cleanDatasets;
    telemetryChartSpeedInstance.update();
  }
}

function renderTelemetryChart(timeData, speedData, aglData, amslData, hasAgl, hasAmsl) {
  // ---- Destroy previous chart instances ----
  if (telemetryChartCombinedInstance) {
    telemetryChartCombinedInstance.destroy();
    telemetryChartCombinedInstance = null;
  }
  if (telemetryChartAltitudeInstance) {
    telemetryChartAltitudeInstance.destroy();
    telemetryChartAltitudeInstance = null;
  }
  if (telemetryChartAmslInstance) {
    telemetryChartAmslInstance.destroy();
    telemetryChartAmslInstance = null;
  }
  if (telemetryChartSpeedInstance) {
    telemetryChartSpeedInstance.destroy();
    telemetryChartSpeedInstance = null;
  }

  // ---- Show chart area and hide AMSL tab if no AMSL data ----
  document.getElementById('telemetry-chart-area').classList.remove('hidden');
  const amslTabBtn = document.getElementById('btn-tab-amsl');
  const amslWrapper = document.getElementById('wrapper-chart-amsl');
  if (amslTabBtn) amslTabBtn.style.display = hasAmsl ? '' : 'none';
  if (amslWrapper) amslWrapper.classList.add('hidden');

  // ---- Downsample if too many points (keep max 600 for performance) ----
  let labels = timeData;
  let speeds = speedData;
  let agls = aglData;
  let amsls = amslData;
  if (timeData.length > 600) {
    const step = Math.ceil(timeData.length / 600);
    labels = timeData.filter((_, i) => i % step === 0);
    speeds = speedData.filter((_, i) => i % step === 0);
    agls = aglData.filter((_, i) => i % step === 0);
    amsls = amslData.filter((_, i) => i % step === 0);
  }

  const isDarkMode = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
  const textColor = isDarkMode ? '#9ca3af' : '#6b7280';
  const labelColor = isDarkMode ? '#d1d5db' : '#9ca3af';
  const gridColor = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';

  // ---- Common X-axis scale ----
  const commonXScale = {
    title: {
      display: true,
      text: 'Elapsed Time (minutes)',
      font: { size: 12, weight: 'bold' },
      color: textColor
    },
    ticks: {
      maxTicksLimit: 14,
      font: { size: 11 },
      color: labelColor
    },
    grid: { color: gridColor }
  };

  const commonPlugins = {
    legend: {
      position: 'top',
      labels: { font: { size: 12, weight: 'bold' }, boxWidth: 14, color: isDarkMode ? '#e8eee5' : '#2a2334' }
    },
    tooltip: {
      callbacks: {
        title: (items) => `T+${items[0].label} min`,
        label: (item) => {
          if (item.dataset.label.includes('Limit')) return null;
          const unit = item.dataset.label.includes('Speed') || item.dataset.label.includes('Kecepatan') ? ' knots' : ' ft';
          return ` ${item.dataset.label}: ${item.formattedValue}${unit}`;
        }
      }
    }
  };

  // 1. COMBINED PROFILE CHART
  const combinedCtx = document.getElementById('telemetry-chart-combined').getContext('2d');
  const combinedDatasets = [];

  combinedDatasets.push({
    label: 'Altitude AGL (ft)',
    data: agls,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    fill: true,
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    yAxisID: 'yAlt',
  });

  if (hasAmsl) {
    combinedDatasets.push({
      label: 'Altitude AMSL (ft)',
      data: amsls,
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.03)',
      fill: true,
      tension: 0.3,
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      yAxisID: 'yAlt',
    });
  }

  combinedDatasets.push({
    label: 'Ground Speed (knots)',
    data: speeds,
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.04)',
    fill: true,
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    yAxisID: 'ySpeed',
  });

  if (telemetryLimitEnabled) {
    const activeAltLimit = telemetryAltLimitMode === 'agl' ? telemetryLimitAgl : telemetryLimitAmsl;
    const activeAltLabel = telemetryAltLimitMode === 'agl' ? 'Alt AGL Limit (ft)' : 'Alt AMSL Limit (ft)';

    combinedDatasets.push({
      label: activeAltLabel,
      data: Array(labels.length).fill(activeAltLimit),
      borderColor: '#ef4444',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      yAxisID: 'yAlt',
    });

    combinedDatasets.push({
      label: 'Speed Limit (knots)',
      data: Array(labels.length).fill(telemetryLimitSpeed),
      borderColor: '#f43f5e',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      yAxisID: 'ySpeed',
    });
  }

  telemetryChartCombinedInstance = new Chart(combinedCtx, {
    type: 'line',
    data: { labels: labels, datasets: combinedDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: commonPlugins,
      scales: {
        x: commonXScale,
        yAlt: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Altitude (feet)', font: { size: 12, weight: 'bold' }, color: '#3b82f6' },
          ticks: { color: '#3b82f6', font: { size: 10 } },
          grid: { color: isDarkMode ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.07)' }
        },
        ySpeed: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Ground Speed (knots)', font: { size: 12, weight: 'bold' }, color: '#f97316' },
          ticks: { color: '#f97316', font: { size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  // 2. ALTITUDE AGL PROFILE CHART
  const altCtx = document.getElementById('telemetry-chart-altitude').getContext('2d');
  const altDatasets = [{
    label: 'Altitude AGL (ft)',
    data: agls,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    fill: true,
    tension: 0.3,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
  }];

  if (telemetryLimitEnabled) {
    altDatasets.push({
      label: 'Altitude AGL Limit (ft)',
      data: Array(labels.length).fill(telemetryLimitAgl),
      borderColor: '#ef4444',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0
    });
  }

  telemetryChartAltitudeInstance = new Chart(altCtx, {
    type: 'line',
    data: { labels: labels, datasets: altDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: commonPlugins,
      scales: {
        x: commonXScale,
        y: {
          type: 'linear',
          title: { display: true, text: 'Altitude AGL (feet)', font: { size: 12, weight: 'bold' }, color: isDarkMode ? '#e8eee5' : '#374151' },
          ticks: { color: labelColor },
          grid: { color: gridColor }
        }
      }
    }
  });

  // 3. ALTITUDE AMSL PROFILE CHART
  if (hasAmsl) {
    const amslCtx = document.getElementById('telemetry-chart-amsl').getContext('2d');
    const amslDatasets = [{
      label: 'Altitude AMSL (ft)',
      data: amsls,
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.08)',
      fill: true,
      tension: 0.3,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
    }];

    if (telemetryLimitEnabled) {
      amslDatasets.push({
        label: 'Altitude AMSL Limit (ft)',
        data: Array(labels.length).fill(telemetryLimitAmsl),
        borderColor: '#ef4444',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      });
    }

    telemetryChartAmslInstance = new Chart(amslCtx, {
      type: 'line',
      data: { labels: labels, datasets: amslDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: commonPlugins,
        scales: {
          x: commonXScale,
          y: {
            type: 'linear',
            title: { display: true, text: 'Altitude AMSL (feet)', font: { size: 12, weight: 'bold' }, color: isDarkMode ? '#e8eee5' : '#374151' },
            ticks: { color: labelColor },
            grid: { color: gridColor }
          }
        }
      }
    });
  }

  // 4. SPEED PROFILE CHART
  const speedCtx = document.getElementById('telemetry-chart-speed').getContext('2d');
  const speedDatasets = [{
    label: 'Ground Speed (knots)',
    data: speeds,
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    fill: true,
    tension: 0.3,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
  }];

  if (telemetryLimitEnabled) {
    speedDatasets.push({
      label: 'Speed Limit (knots)',
      data: Array(labels.length).fill(telemetryLimitSpeed),
      borderColor: '#f43f5e',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0
    });
  }

  telemetryChartSpeedInstance = new Chart(speedCtx, {
    type: 'line',
    data: { labels: labels, datasets: speedDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: commonPlugins,
      scales: {
        x: commonXScale,
        y: {
          type: 'linear',
          title: { display: true, text: 'Speed (knots)', font: { size: 12, weight: 'bold' }, color: isDarkMode ? '#e8eee5' : '#374151' },
          ticks: { color: labelColor },
          grid: { color: gridColor }
        }
      }
    }
  });

  // Keep showing current active tab wrapper
  switchTelemetryTab(currentActiveTelemetryTab);
}

async function exportTelemetryChart() {
  const activeWrapper = document.getElementById(`wrapper-chart-${currentActiveTelemetryTab}`);
  if (!activeWrapper) return;
  try {
    showToast('Generating HD chart image...', 'info');
    // Render at scale 3 for HD output
    const canvas = await html2canvas(activeWrapper, { scale: 3, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `PUTA_Telemetry_${currentActiveTelemetryTab.toUpperCase()}_Profile_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('HD Chart exported successfully!', 'success');
  } catch (err) {
    console.error('Export error:', err);
    showToast('Failed to export chart.', 'error');
  }
}



// ============================================================
// TELEMETRY ROUTE MAP & LIMIT INTERACTIVE GRAPH FUNCTIONS
// ============================================================

function initTelemetryAnalyzerMap() {
  const mapContainer = document.getElementById('telemetry-analyzer-map');
  if (!mapContainer) return;

  if (typeof L === 'undefined') {
    console.warn("Leaflet (L) library is not defined. Telemetry Analyzer map is disabled.");
    return;
  }

  if (!telemetryAnalyzerMap) {
    // Initialize Leaflet map
    telemetryAnalyzerMap = L.map('telemetry-analyzer-map').setView([-0.94, 100.35], 10);
    telemetryMapTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(telemetryAnalyzerMap);
  }

  // Force map invalidation to trigger correct rendering in dynamic/hidden containers
  setTimeout(() => {
    telemetryAnalyzerMap.invalidateSize();

    // Clear old layers
    if (telemetryAnalyzerPolylineKml) {
      telemetryAnalyzerMap.removeLayer(telemetryAnalyzerPolylineKml);
      telemetryAnalyzerPolylineKml = null;
    }
    if (telemetryAnalyzerPolylineCsv) {
      telemetryAnalyzerMap.removeLayer(telemetryAnalyzerPolylineCsv);
      telemetryAnalyzerPolylineCsv = null;
    }
    if (telemetryAnalyzerMarkerTakeoff) {
      telemetryAnalyzerMap.removeLayer(telemetryAnalyzerMarkerTakeoff);
      telemetryAnalyzerMarkerTakeoff = null;
    }

    const bounds = [];

    // Plot KML coordinates if loaded (stored as [lat, lng])
    if (uploadedKmlCoords && uploadedKmlCoords.length > 0) {
      telemetryAnalyzerPolylineKml = L.polyline(uploadedKmlCoords, {
        color: '#ef4444',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '5, 5'
      }).addTo(telemetryAnalyzerMap);

      uploadedKmlCoords.forEach(pt => bounds.push(pt));
    }

    // Plot CSV flight path coordinates if loaded (stored as [lat, lng])
    if (uploadedCsvData && uploadedCsvData.coords && uploadedCsvData.coords.length > 0) {
      telemetryAnalyzerPolylineCsv = L.polyline(uploadedCsvData.coords, {
        color: '#8b5cf6',
        weight: 3.5,
        opacity: 0.9
      }).addTo(telemetryAnalyzerMap);

      uploadedCsvData.coords.forEach(pt => bounds.push(pt));

      // Add takeoff marker
      const takeoff = uploadedCsvData.coords[0];
      telemetryAnalyzerMarkerTakeoff = L.marker(takeoff).addTo(telemetryAnalyzerMap)
        .bindPopup("Takeoff Point");
    }

    if (bounds.length > 0) {
      telemetryAnalyzerMap.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    }
  }, 100);
}

function clearTelemetryAnalyzerMap() {
  if (telemetryAnalyzerPolylineKml && telemetryAnalyzerMap) {
    telemetryAnalyzerMap.removeLayer(telemetryAnalyzerPolylineKml);
    telemetryAnalyzerPolylineKml = null;
  }
  if (telemetryAnalyzerPolylineCsv && telemetryAnalyzerMap) {
    telemetryAnalyzerMap.removeLayer(telemetryAnalyzerPolylineCsv);
    telemetryAnalyzerPolylineCsv = null;
  }
  if (telemetryAnalyzerMarkerTakeoff && telemetryAnalyzerMap) {
    telemetryAnalyzerMap.removeLayer(telemetryAnalyzerMarkerTakeoff);
    telemetryAnalyzerMarkerTakeoff = null;
  }
}

function updateTelemetryAnalyzerUI() {
  const chartArea = document.getElementById('telemetry-chart-area');
  if (!chartArea) return;

  const hasCsv = !!uploadedCsvData;
  const hasKml = uploadedKmlCoords && uploadedKmlCoords.length > 0;

  if (hasCsv || hasKml) {
    chartArea.classList.remove('hidden');
  } else {
    chartArea.classList.add('hidden');
    return;
  }

  // Update tabs visibility
  const combinedTab = document.getElementById('btn-tab-combined');
  const altitudeTab = document.getElementById('btn-tab-altitude');
  const amslTab = document.getElementById('btn-tab-amsl');
  const speedTab = document.getElementById('btn-tab-speed');
  const mapTab = document.getElementById('btn-tab-map');

  if (hasCsv) {
    if (combinedTab) combinedTab.style.display = '';
    if (altitudeTab) altitudeTab.style.display = '';
    if (amslTab) amslTab.style.display = uploadedCsvData.hasAmsl ? '' : 'none';
    if (speedTab) speedTab.style.display = '';
  } else {
    if (combinedTab) combinedTab.style.display = 'none';
    if (altitudeTab) altitudeTab.style.display = 'none';
    if (amslTab) amslTab.style.display = 'none';
    if (speedTab) speedTab.style.display = 'none';
  }

  // Map is available if KML is loaded or if CSV has coordinates
  const mapAvailable = hasKml || (hasCsv && uploadedCsvData.coords && uploadedCsvData.coords.length > 0);
  if (mapTab) mapTab.style.display = mapAvailable ? '' : 'none';

  // If we just uploaded a KML first, or if map tab was open, auto-select map
  if (!hasCsv && hasKml) {
    switchTelemetryTab('map');
  } else if (currentActiveTelemetryTab === 'map' && !mapAvailable) {
    switchTelemetryTab('combined');
  } else if (hasCsv && currentActiveTelemetryTab === 'combined') {
    // Make sure we keep showing combined
    switchTelemetryTab('combined');
  }
}

// --- Premium Dark Mode Functions ---
function initDarkMode() {
  const savedMode = localStorage.getItem('darkMode');
  const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const isDark = savedMode === 'enabled' || (savedMode === null && systemPrefersDark);

  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    const sunIcon = document.getElementById('dark-mode-icon-sun');
    const moonIcon = document.getElementById('dark-mode-icon-moon');
    if (sunIcon) sunIcon.classList.remove('hidden');
    if (moonIcon) moonIcon.classList.add('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    const sunIcon = document.getElementById('dark-mode-icon-sun');
    const moonIcon = document.getElementById('dark-mode-icon-moon');
    if (sunIcon) sunIcon.classList.add('hidden');
    if (moonIcon) moonIcon.classList.remove('hidden');
  }
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  document.documentElement.classList.toggle('dark', isDark);

  localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');

  const sunIcon = document.getElementById('dark-mode-icon-sun');
  const moonIcon = document.getElementById('dark-mode-icon-moon');

  if (isDark) {
    if (sunIcon) sunIcon.classList.remove('hidden');
    if (moonIcon) moonIcon.classList.add('hidden');

    // Swap Leaflet map layers to CartoDB Dark Matter
    if (map && activeTileMode === 'streets') {
      map.removeLayer(streetLayer);
      darkLayer.addTo(map);
    }
  } else {
    if (sunIcon) sunIcon.classList.add('hidden');
    if (moonIcon) moonIcon.classList.remove('hidden');

    // Swap Leaflet map layers to CartoDB Positron
    if (map && activeTileMode === 'streets') {
      map.removeLayer(darkLayer);
      streetLayer.addTo(map);
    }
  }

  // Update lazy-loaded telemetry analyzer map tiles if initialized
  if (telemetryAnalyzerMap && telemetryMapTileLayer) {
    telemetryAnalyzerMap.removeLayer(telemetryMapTileLayer);
    telemetryMapTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(telemetryAnalyzerMap);
  }

  // Trigger telemetry charts re-render if loaded
  if (uploadedCsvData) {
    // Redraw charts with the new color schemes
    renderTelemetryChart(
      uploadedCsvData.timeData,
      uploadedCsvData.speedData,
      uploadedCsvData.aglData,
      uploadedCsvData.amslData,
      uploadedCsvData.hasAmsl
    );
  }
}

// --- Premium View Switching and Portal Navigation Logic ---
window.showPortal = function () {
  const portal = document.getElementById('portal-container');
  const appWorkspace = document.getElementById('app-workspace-container');

  if (portal && appWorkspace) {
    // Start transition
    appWorkspace.classList.add('view-transition', 'view-fade-out');

    setTimeout(() => {
      appWorkspace.classList.add('hidden');
      appWorkspace.classList.remove('view-transition', 'view-fade-out');

      portal.classList.remove('hidden');
      portal.classList.add('view-fade-out');

      // Force reflow
      void portal.offsetWidth;

      portal.classList.add('view-transition');
      portal.classList.remove('view-fade-out');
      portal.classList.add('view-fade-in');

      setTimeout(() => {
        portal.classList.remove('view-transition', 'view-fade-in');

        // Defer CPU-intensive state clearing and list rendering until after portal fade-in finishes
        selectedPermit = null;
        selectedAirport = null;
        renderDashboard();
        renderInspector();
        updatePortalStats();
      }, 300);
    }, 300);
  }
};

// Populate the system status card on the portal with live permit counts
function updatePortalStats() {
  let active = 0, pending = 0, expired = 0;
  permits.forEach(p => {
    const s = getPermitStatus(p);
    if (s === 'ACTIVE') active++;
    else if (s === 'PENDING') pending++;
    else expired++;
  });
  const el = (id) => document.getElementById(id);
  if (el('portal-stat-active')) el('portal-stat-active').textContent = active;
  if (el('portal-stat-pending')) el('portal-stat-pending').textContent = pending;
  if (el('portal-stat-expired')) el('portal-stat-expired').textContent = expired;
}

window.showDashboard = function () {
  const portal = document.getElementById('portal-container');
  const appWorkspace = document.getElementById('app-workspace-container');

  if (portal && appWorkspace) {
    // Start transition
    portal.classList.add('view-transition', 'view-fade-out');

    setTimeout(() => {
      portal.classList.add('hidden');
      portal.classList.remove('view-transition', 'view-fade-out');

      appWorkspace.classList.remove('hidden');
      appWorkspace.classList.add('view-fade-out');

      // Force reflow
      void appWorkspace.offsetWidth;

      appWorkspace.classList.add('view-transition');
      appWorkspace.classList.remove('view-fade-out');
      appWorkspace.classList.add('view-fade-in');

      setTimeout(() => {
        appWorkspace.classList.remove('view-transition', 'view-fade-in');
        // Invalidate Leaflet map size AFTER the workspace is fully visible to prevent animation stuttering
        if (map) {
          map.invalidateSize({ animate: false });
        }
      }, 300);
    }, 300);
  }
};

// ============================================================
// KML CONVERTER MODAL CONTROLLER                             
// ============================================================
let generatedKmlContent = null;
let generatedKmlFilename = "";

window.openConverterModal = function () {
  const modal = document.getElementById('kml-converter-modal');
  const box = modal.querySelector('div');

  // Reset fields
  generatedKmlContent = null;
  generatedKmlFilename = "";
  document.getElementById('converter-drop-zone').classList.remove('hidden');
  document.getElementById('converter-loader').classList.add('hidden');
  document.getElementById('converter-results').classList.add('hidden');
  document.getElementById('converter-error-alert').classList.add('hidden');

  const dlBtn = document.getElementById('btn-download-conv-kml');
  dlBtn.disabled = true;
  dlBtn.className = "px-6 py-2.5 rounded-2xl bg-[#e8eee5] text-gray-400 font-bold cursor-not-allowed transition-all shadow-sm";

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    box.classList.remove('scale-95');
  }, 10);
};

window.closeConverterModal = function () {
  const modal = document.getElementById('kml-converter-modal');
  const box = modal.querySelector('div');
  modal.classList.add('opacity-0');
  box.classList.add('scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);
};

let lastConvertedData = null;
let customNotamMapLayers = [];

window.processConverterFile = async function (file) {
  if (!file) return;

  const dropZone = document.getElementById('converter-drop-zone');
  const loader = document.getElementById('converter-loader');
  const results = document.getElementById('converter-results');
  const errorAlert = document.getElementById('converter-error-alert');
  const dlBtn = document.getElementById('btn-download-conv-kml');
  const viewMapBtn = document.getElementById('btn-view-conv-map');

  // Hide drop zone, show loader
  dropZone.classList.add('hidden');
  errorAlert.classList.add('hidden');
  results.classList.add('hidden');
  loader.classList.remove('hidden');
  startLogoProcessing();

  try {
    if (!window.api || !window.api.convertToKml) {
      throw new Error("KML conversion requires running in the Electron desktop environment.");
    }

    showToast(`Converting ${file.name} to KML...`, "info");

    const filePath = (window.api && window.api.getPathForFile) ? window.api.getPathForFile(file) : (file.path || '');
    if (!filePath) {
      throw new Error("Cannot determine file system path for document.");
    }
    const res = await window.api.convertToKml(filePath);

    loader.classList.add('hidden');
    stopLogoProcessing();

    if (res && res.success) {
      lastConvertedData = res;
      generatedKmlContent = res.kml_content;
      generatedKmlFilename = `PUTA_Airspace_${res.permit_id.replace(/[\/\\:\s]/g, '_')}.kml`;

      // Update UI labels
      document.getElementById('conv-permit-id').textContent = res.permit_id;
      document.getElementById('conv-operator').textContent = res.operator;
      const altDisplay = res.upper_limit ? `${res.max_altitude_ft} ft (${res.upper_limit})` : `${res.max_altitude_ft} ft AGL`;
      document.getElementById('conv-altitude').textContent = altDisplay;

      const areasCount = res.areas ? res.areas.length : 0;
      const areaDesc = areasCount > 1 ? ` (${areasCount} distinct polygon areas)` : '';
      document.getElementById('conv-coords-count').textContent = `${res.coords_count} coordinates extracted${areaDesc}`;

      results.classList.remove('hidden');

      // Enable download button
      dlBtn.disabled = false;
      dlBtn.className = "px-6 py-2.5 rounded-2xl bg-[#4a5d3e] hover:bg-[#2c3b26] text-white font-bold transition-all shadow-md shadow-[#4a5d3e]/15 text-xs";

      // Enable View on Map button if coordinates exist
      if (viewMapBtn) {
        if (res.coords_count > 0) {
          viewMapBtn.disabled = false;
          viewMapBtn.className = "px-5 py-2.5 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700 font-bold transition-all shadow-md shadow-indigo-500/20 flex items-center gap-2 text-xs cursor-pointer";
        } else {
          viewMapBtn.disabled = true;
          viewMapBtn.className = "px-5 py-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-400 font-bold transition-all flex items-center gap-2 text-xs opacity-50 cursor-not-allowed";
        }
      }

      showToast("Document parsed and 3D KML generated!", "success");
    } else {
      throw new Error(res ? res.error : "Unknown conversion error.");
    }
  } catch (err) {
    console.error("Conversion failed:", err);
    loader.classList.add('hidden');
    dropZone.classList.remove('hidden');
    stopLogoProcessing();

    errorAlert.textContent = `Error: ${err.message}`;
    errorAlert.classList.remove('hidden');
    showToast("Conversion failed.", "error");
  }
};

window.viewConvertedPolygonsOnMap = function () {
  if (!lastConvertedData || !lastConvertedData.areas || lastConvertedData.areas.length === 0) {
    showToast("No boundary coordinates available to display on map.", "warning");
    return;
  }

  if (typeof L === 'undefined' || !map) {
    showToast("Map instance is not ready.", "error");
    return;
  }

  // Close modal to reveal map
  closeConverterModal();

  // Clear previous temporary NOTAM layers
  customNotamMapLayers.forEach(layer => map.removeLayer(layer));
  customNotamMapLayers = [];

  const boundsGroup = L.featureGroup();
  const palette = ['#dc2626', '#f59e0b', '#06b6d4', '#10b981', '#8b5cf6'];

  lastConvertedData.areas.forEach((area, idx) => {
    if (!area.coordinates || area.coordinates.length === 0) return;

    const strokeColor = palette[idx % palette.length];
    const poly = L.polygon(area.coordinates, {
      color: strokeColor,
      weight: 3,
      fillColor: strokeColor,
      fillOpacity: 0.22,
      dashArray: '4, 4'
    });

    const popupHtml = `
      <div class="text-xs space-y-1.5 p-1 min-w-[200px]">
        <div class="font-extrabold text-[#2a2334] text-sm">${area.name || 'Permitted Airspace'}</div>
        <div class="text-[10px] text-gray-500 font-mono">Doc: <b>${lastConvertedData.permit_id}</b></div>
        <div class="text-[10px] text-gray-600">Operator: <b>${lastConvertedData.operator}</b></div>
        <div class="mt-1 pt-1 border-t border-gray-200 flex justify-between items-center text-[10px]">
          <span class="text-gray-500">Vertical Ceiling:</span>
          <span class="font-bold text-indigo-600">${lastConvertedData.upper_limit || lastConvertedData.max_altitude_ft + ' FT'}</span>
        </div>
        <div class="flex justify-between items-center text-[10px]">
          <span class="text-gray-500">Lower Limit:</span>
          <span class="font-bold text-gray-700">${lastConvertedData.lower_limit || 'SFC'}</span>
        </div>
        <div class="flex justify-between items-center text-[10px]">
          <span class="text-gray-500">Vertices:</span>
          <span class="font-bold text-emerald-600">${area.coordinates.length} points</span>
        </div>
      </div>
    `;

    poly.bindPopup(popupHtml);
    poly.addTo(map);
    boundsGroup.addLayer(poly);
    customNotamMapLayers.push(poly);
  });

  // Fit camera bounds with smooth animation
  if (customNotamMapLayers.length > 0) {
    map.fitBounds(boundsGroup.getBounds(), { padding: [50, 50], maxZoom: 13, animate: true, duration: 1.5 });
    showToast(`Displaying ${lastConvertedData.areas.length} real airspace polygon(s) on map!`, "success");
  }
};

window.downloadConvertedKml = function () {
  if (!generatedKmlContent) return;

  try {
    const blob = new Blob([generatedKmlContent], { type: 'application/vnd.google-earth.kml+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = generatedKmlFilename;
    link.click();
    showToast("3D KML file downloaded for Google Earth Pro!", "success");
    closeConverterModal();
  } catch (err) {
    console.error("Download failed:", err);
    showToast("Failed to save file.", "error");
  }
};

// ============================================================
// REGULATIONS LIBRARY CONTROLLER                             
// ============================================================
const REGULATION_TEXTS = {
  pm37: `
    <div class="space-y-4">
      <h2 class="text-base font-bold text-gray-900 dark:text-white border-b border-black/5 dark:border-white/5 pb-2">PM 37 Tahun 2020 Summary</h2>
      <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Official Title: <em>Pengoperasian Pesawat Udara Tanpa Awak di Ruang Udara yang Dilayani Indonesia</em></p>
      
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">1. Airspace & Altitude Limits (Butir 2.1)</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Uncontrolled Airspace (&le; 400 ft / 120 m AGL):</strong> Permitted without DGCA approval.</li>
          <li><strong>Uncontrolled Airspace (&gt; 400 ft / 120 m AGL):</strong> Requires Director General of Civil Aviation approval.</li>
          <li><strong>Controlled Airspace:</strong> Always requires DGCA approval regardless of altitude.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">2. Controlled Zones & Buffer Zones (Butir 2.2 & 3.13)</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>KKOP (Kawasan Keselamatan Operasi Penerbangan):</strong> Strict No-Fly Zone within lateral airport boundaries unless explicitly authorized.</li>
          <li><strong>Helipad Buffers:</strong> Operating within a <strong>3 Nautical Mile (5.56 km)</strong> radius of a helipad outside KKOP requires official approval.</li>
          <li><strong>Camera Drone Buffers:</strong> Drones equipped with cameras must maintain a minimum <strong>500-meter buffer</strong> from the boundaries of Prohibited or Restricted military/national security zones.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">3. Operational Requirements & Timelines (Butir 3.6, 3.7, 3.12, 4.3 & 4.9)</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Daylight Only:</strong> Operations are limited from sunrise to sunset unless a dedicated safety assessment is approved.</li>
          <li><strong>AirNav Coordination:</strong> Operators must submit flight coordination notices to the local Air Traffic Services (ATS) unit at least <strong>24 hours prior</strong> to take-off.</li>
          <li><strong>New Permit Application Lead Time:</strong> Must be submitted at least <strong>14 working days</strong> prior to flight.</li>
          <li><strong>Flight Plan Time Modification Lead Time:</strong> Must be submitted at least <strong>7 working days</strong> prior to flight.</li>
        </ul>
      </div>
    </div>
  `,
  pm63: `
    <div class="space-y-4">
      <h2 class="text-base font-bold text-gray-900 dark:text-white border-b border-black/5 dark:border-white/5 pb-2">PM 63 Tahun 2021 Summary</h2>
      <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Official Title: <em>Sistem Pesawat Udara Kecil Tanpa Awak (CASR Part 107)</em></p>
      
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">1. Small Unmanned Aircraft (sUA) Operating Limits</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Maximum Speed:</strong> <strong>87 knots (100 mph / 161 km/h)</strong> calibrated airspeed.</li>
          <li><strong>Maximum Altitude:</strong> <strong>400 feet (120 meters) AGL</strong> (unless flying within a 400 ft radius of a structure and not higher than 400 ft above the structure's top).</li>
          <li><strong>Weather Minimums:</strong> Flight visibility must be at least <strong>3 miles (4.8 km)</strong> from the control station.</li>
          <li><strong>Cloud Clearance:</strong> Must remain at least <strong>500 feet below</strong> and <strong>2,000 feet horizontally</strong> away from any clouds.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">2. Operational Restrictions</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Operations Over People:</strong> Prohibited from flying directly over any non-participating person unless they are under a safe shelter or vehicle.</li>
          <li><strong>Visual Line of Sight (VLOS):</strong> Must maintain direct, unaided visual contact at all times. Visual observers do not satisfy the pilot's VLOS duty.</li>
          <li><strong>Multi-UAS:</strong> A single remote pilot cannot operate more than one drone at a time.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">3. Licenses & Reporting</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Remote Pilot License:</strong> Mandatory certification from DGCA, valid for <strong>24 months</strong>. Recurrency check required.</li>
          <li><strong>Accident Reporting:</strong> Must report any drone incident resulting in serious injury, loss of consciousness, or property damage exceeding $500 (or equivalent) to the DGCA/nearest Airport Authority within <strong>10 calendar days</strong>.</li>
        </ul>
      </div>
    </div>
  `,
  kp242: `
    <div class="space-y-4">
      <h2 class="text-base font-bold text-gray-900 dark:text-white border-b border-black/5 dark:border-white/5 pb-2">KP 242 Tahun 2017 Summary</h2>
      <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Official Title: <em>Staff Instruction (SI) 8900-12.01: Pendaftaran Pesawat Udara Kecil Tanpa Awak</em></p>
      
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">1. Registration Criteria</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Applicability:</strong> Mandatory registration for all small Unmanned Aircraft (sUA) weighing <strong>between 250 grams and 25 kg</strong>. Drones under 250 grams are exempt.</li>
          <li><strong>Ownership Eligibility:</strong> Restricted to Indonesian citizens (WNI), government agencies, or Indonesian legal entities.</li>
          <li><strong>Validity:</strong> The Registration Certificate (Tanda Pendaftaran) is valid for <strong>3 years</strong>.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">2. Identification Markings (Butir 6.3)</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Marking Placement:</strong> The registration number must be clearly displayed in a visible location on the drone.</li>
          <li><strong>Lettering Size Requirements:</strong>
            <ul class="list-disc list-inside pl-4 space-y-0.5">
              <li><strong>Bottom Surface:</strong> Letters must have a minimum height of <strong>5 cm</strong>.</li>
              <li><strong>Side Surfaces:</strong> Letters must have a minimum height of <strong>3 cm</strong>.</li>
            </ul>
          </li>
          <li><strong>Durability:</strong> Markings must be affixed in a permanent manner, using a contrasting color to ensure readability from a distance.</li>
        </ul>
      </div>
    </div>
  `,
  pr09: `
    <div class="space-y-4">
      <h2 class="text-base font-bold text-gray-900 dark:text-white border-b border-black/5 dark:border-white/5 pb-2">PR 09 Tahun 2022 Summary</h2>
      <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Official Title: <em>Petunjuk Teknis Persetujuan Pengoperasian Pesawat Udara Tanpa Awak di Ruang Udara yang Dilayani Indonesia dengan Sistem Berbasis Teknologi Informasi (SIDOPI GO)</em></p>
      
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">1. Digital Submission Guidelines (SIDOPI GO Portal)</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Mandatory Lead Time:</strong> Flight permit applications must be submitted digitally at least <strong>14 working days</strong> prior to flight date.</li>
          <li><strong>Approval Issuance:</strong> DGCA operating approval is issued within <strong>5 working days</strong> after AirNav airspace assessment completion and DGCA validation.</li>
          <li><strong>Document Format:</strong> All supporting documents must be uploaded independently as scanned PDF files.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">2. Required Supporting Attachments (10 Mandatory Items)</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Official Application Letter (Lampiran A) & Form (Lampiran B):</strong> Complete operator identity, dates, time, purpose, and drone specs.</li>
          <li><strong>Flight Plan & Coordinates (Lampiran C):</strong> Map, <code>.kml</code>/<code>.geojson</code> files, takeoff/landing points, and operational area polygon.</li>
          <li><strong>Certificates & Permits:</strong> Remote Pilot Certificate, Drone Registration Certificate, and Third-Party Liability Insurance.</li>
          <li><strong>Operational Procedures:</strong> Standard Operating Procedures (SOP), Emergency SOP, Self Safety Assessment, AirNav Airspace Assessment, and Property Owner/Authority Authorization.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-xs font-bold text-indigo-600 dark:text-indigo-400">3. Revisions, Modifications & Cancellations</h3>
        <ul class="list-disc list-inside pl-2 space-y-1 font-medium text-gray-600 dark:text-gray-300">
          <li><strong>Document Re-upload Window:</strong> If revisions are requested via SIDOPI GO, applicants have a maximum of <strong>7 days</strong> to re-upload documents before the application is automatically rejected.</li>
          <li><strong>Flight Schedule Changes:</strong> Date/time adjustments must be submitted via Lampiran E at least <strong>7 days</strong> prior to the new flight date.</li>
          <li><strong>Area/Altitude Modifications:</strong> Changing flight coordinates or ceiling automatically cancels the application; a fresh application must be submitted.</li>
          <li><strong>Emergency Operations Exemption:</strong> Expedited handling applies to SAR, natural disasters, humanitarian aid, state visits, and law enforcement operations.</li>
        </ul>
      </div>
    </div>
  `
};

window.openRegulationsLibrary = function () {
  const modal = document.getElementById('regulations-modal');
  const box = modal.querySelector('div');

  // Load default tab
  switchRegulationTab('pm37');

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    box.classList.remove('scale-95');
  }, 10);
};

window.closeRegulationsLibrary = function () {
  const modal = document.getElementById('regulations-modal');
  const box = modal.querySelector('div');

  modal.classList.add('opacity-0');
  box.classList.add('scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);
};

window.switchRegulationTab = function (tabId) {
  // Update button styles
  const tabs = ['pm37', 'pm63', 'kp242', 'pr09'];
  tabs.forEach(t => {
    const btn = document.getElementById(`reg-tab-${t}`);
    if (btn) {
      if (t === tabId) {
        btn.className = "text-left text-xs font-bold px-3 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 transition-all border border-indigo-100/50 dark:border-indigo-500/20 flex flex-col w-full";
      } else {
        btn.className = "text-left text-xs font-bold px-3 py-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-all border border-transparent flex flex-col w-full";
      }
    }
  });

  // Set content
  const contentArea = document.getElementById('regulations-content-area');
  if (contentArea && REGULATION_TEXTS[tabId]) {
    contentArea.innerHTML = REGULATION_TEXTS[tabId];
  }
};

window.openAuthorModal = function () {
  const modal = document.getElementById('author-modal');
  const box = modal.querySelector('div');

  switchAuthorTab('dev');

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    box.classList.remove('scale-95');
  }, 10);
};

window.closeAuthorModal = function () {
  const modal = document.getElementById('author-modal');
  const box = modal.querySelector('div');

  modal.classList.add('opacity-0');
  box.classList.add('scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);
};

window.switchAuthorTab = function (tabId) {
  const btnDev = document.getElementById('btn-author-tab-dev');
  const btnOkc = document.getElementById('btn-author-tab-okc');
  const panelDev = document.getElementById('author-panel-dev');
  const panelOkc = document.getElementById('author-panel-okc');

  if (tabId === 'dev') {
    if (btnDev) btnDev.className = "py-2.5 text-xs font-bold text-[#4a5d3e] border-b-2 border-[#4a5d3e] transition-all focus:outline-none";
    if (btnOkc) btnOkc.className = "py-2.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition-all focus:outline-none";
    if (panelDev) panelDev.classList.remove('hidden');
    if (panelOkc) panelOkc.classList.add('hidden');
  } else if (tabId === 'okc') {
    if (btnDev) btnDev.className = "py-2.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition-all focus:outline-none";
    if (btnOkc) btnOkc.className = "py-2.5 text-xs font-bold text-[#007AC1] border-b-2 border-[#007AC1] transition-all focus:outline-none";
    if (panelDev) panelDev.classList.add('hidden');
    if (panelOkc) panelOkc.classList.remove('hidden');

    // Reset OKC sub-panels to default stats view
    const statsPanel = document.getElementById('okc-stats-view');
    const rosterPanel = document.getElementById('okc-roster-view');
    const btnToggle = document.getElementById('btn-toggle-okc-roster');
    if (statsPanel && rosterPanel && btnToggle) {
      statsPanel.classList.remove('hidden');
      rosterPanel.classList.add('hidden');
      btnToggle.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
        </svg>
        <span>Show Full Roster & Front Office</span>
      `;
      btnToggle.className = "w-full mt-3 px-4 py-2.5 rounded-xl bg-[#007AC1] hover:bg-[#2c3b26] text-white font-bold transition-all shadow-md shadow-[#007AC1]/10 flex items-center justify-center gap-2 focus:outline-none";
    }
  }
};

window.toggleOkcRoster = function () {
  const statsPanel = document.getElementById('okc-stats-view');
  const rosterPanel = document.getElementById('okc-roster-view');
  const btnToggle = document.getElementById('btn-toggle-okc-roster');

  if (rosterPanel.classList.contains('hidden')) {
    statsPanel.classList.add('hidden');
    rosterPanel.classList.remove('hidden');
    btnToggle.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
      </svg>
      <span>Back to Team Overview</span>
    `;
    btnToggle.className = "w-full mt-3 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-all border border-black/5 flex items-center justify-center gap-2 focus:outline-none";
  } else {
    statsPanel.classList.remove('hidden');
    rosterPanel.classList.add('hidden');
    btnToggle.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
      </svg>
      <span>Show Full Roster & Front Office</span>
    `;
    btnToggle.className = "w-full mt-3 px-4 py-2.5 rounded-xl bg-[#007AC1] hover:bg-[#2c3b26] text-white font-bold transition-all shadow-md shadow-[#007AC1]/10 flex items-center justify-center gap-2 focus:outline-none";
  }
};

window.startLogoProcessing = function () {
  const containers = [
    document.getElementById('nav-logo-container'),
    document.getElementById('hero-logo-container'),
    document.getElementById('workspace-logo-container'),
    document.getElementById('author-logo-container')
  ];
  containers.forEach(c => {
    if (c) c.classList.add('logo-processing');
  });
};

window.stopLogoProcessing = function () {
  const containers = [
    document.getElementById('nav-logo-container'),
    document.getElementById('hero-logo-container'),
    document.getElementById('workspace-logo-container'),
    document.getElementById('author-logo-container')
  ];
  containers.forEach(c => {
    if (c) c.classList.remove('logo-processing');
  });
};



// ============================================================
// ADS-B LIVE MONITOR — OpenSky Network Integration
// ============================================================

// OpenSky state vector field indexes
const OPENSKY_FIELDS = {
  ICAO24: 0, CALLSIGN: 1, ORIGIN_COUNTRY: 2, TIME_POS: 3, LAST_CONTACT: 4,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8, VELOCITY: 9,
  HEADING: 10, VERTICAL_RATE: 11, GEO_ALT: 13, SQUAWK: 14
};

function openAdsbMonitor() {
  isAdsbModalOpen = true;
  const modal = document.getElementById('adsb-modal');
  const box = modal.querySelector('div');
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    box.classList.remove('scale-95');
  }, 10);

  // Initialize map if not already done
  if (!adsbMap) {
    initAdsbMap();
  } else {
    setTimeout(() => adsbMap.invalidateSize(), 100);
  }

  // Ensure current markers are shown on the adsbMap when opened
  for (const marker of Object.values(adsbMarkers)) {
    if (adsbMap && !adsbMap.hasLayer(marker)) marker.addTo(adsbMap);
  }

  // Wire manual refresh button
  const btnRefresh = document.getElementById('btn-adsb-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = () => fetchAdsbData(true);
  }

  // Wire search input
  const searchInput = document.getElementById('adsb-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      adsbSearchQuery = e.target.value.toLowerCase().trim();
      renderAdsbFlightList(adsbFlightData);
    };
  }

  updateAdsbPolling();
}

window.closeAdsbMonitor = function () {
  isAdsbModalOpen = false;
  const modal = document.getElementById('adsb-modal');
  const box = modal.querySelector('div');
  modal.classList.add('opacity-0');
  box.classList.add('scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);

  // Remove markers from adsbMap when closed
  for (const marker of Object.values(adsbMarkers)) {
    if (adsbMap && adsbMap.hasLayer(marker)) adsbMap.removeLayer(marker);
  }

  updateAdsbPolling();
};

function initAdsbMap() {
  const mapContainer = document.getElementById('adsb-map');
  if (!mapContainer) return;

  if (typeof L === 'undefined') {
    console.warn("Leaflet (L) library is not defined. ADS-B Live Map is disabled.");
    return;
  }

  adsbMap = L.map('adsb-map', { zoomControl: true }).setView([-0.5, 102.0], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(adsbMap);

  const isDark = document.body.classList.contains('dark');
  adsbMapTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18
  }).addTo(adsbMap);

  setTimeout(() => adsbMap.invalidateSize(), 150);
}

async function fetchAdsbData(isManual = false) {
  // Reset countdown display
  adsbCountdownSeconds = 12;
  updateAdsbCountdown();

  const errorOverlay = document.getElementById('adsb-error-overlay');
  if (errorOverlay) errorOverlay.classList.add('hidden');

  try {
    const response = await fetch(OPENSKY_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const states = data.states || [];

    // Filter out entries with no position
    adsbFlightData = states.filter(s => s[OPENSKY_FIELDS.LAT] !== null && s[OPENSKY_FIELDS.LON] !== null);

    renderAdsbFlightList(adsbFlightData);
    renderAdsbMapMarkers(adsbFlightData);
    updateAdsbHeaderCounts(adsbFlightData);
    checkAdsbKkopConflicts(adsbFlightData);

    if (isManual) showToast(`ADS-B data refreshed — ${adsbFlightData.length} aircraft in Sumatra airspace`, 'success');

  } catch (err) {
    console.error('OpenSky fetch failed:', err);
    if (errorOverlay) errorOverlay.classList.remove('hidden');
    if (isManual) showToast('Failed to reach OpenSky Network. Check your connection.', 'error');
  }
}

function startAdsbPolling() {
  stopAdsbPolling(); // Clear any existing

  // Ticker (1 second)
  adsbCountdownInterval = setInterval(() => {
    adsbCountdownSeconds--;
    if (adsbCountdownSeconds <= 0) adsbCountdownSeconds = 12;
    updateAdsbCountdown();
  }, 1000);

  // Data fetch every 12 seconds
  adsbPollingInterval = setInterval(() => fetchAdsbData(false), ADSB_REFRESH_INTERVAL);
}

function stopAdsbPolling() {
  if (adsbPollingInterval) { clearInterval(adsbPollingInterval); adsbPollingInterval = null; }
  if (adsbCountdownInterval) { clearInterval(adsbCountdownInterval); adsbCountdownInterval = null; }
}

function updateAdsbPolling() {
  if (isAdsbModalOpen || isAdsbOnMainMap) {
    if (!adsbPollingInterval) {
      fetchAdsbData(false);
      startAdsbPolling();
    }
  } else {
    stopAdsbPolling();
    // Remove all flight markers from both maps
    for (const marker of Object.values(adsbMarkers)) {
      if (map && map.hasLayer(marker)) map.removeLayer(marker);
      if (adsbMap && adsbMap.hasLayer(marker)) adsbMap.removeLayer(marker);
    }
    adsbMarkers = {};
  }
}

function updateAdsbCountdown() {
  const el = document.getElementById('adsb-refresh-countdown');
  if (el) el.textContent = `${adsbCountdownSeconds}s`;
}

function updateAdsbHeaderCounts(flights) {
  const airborne = flights.filter(f => !f[OPENSKY_FIELDS.ON_GROUND]).length;
  const ground = flights.filter(f => f[OPENSKY_FIELDS.ON_GROUND]).length;

  const elAir = document.getElementById('adsb-count-airborne');
  const elGnd = document.getElementById('adsb-count-ground');
  if (elAir) elAir.textContent = airborne;
  if (elGnd) elGnd.textContent = ground;
}

function renderAdsbFlightList(flights) {
  const listEl = document.getElementById('adsb-flight-list');
  if (!listEl) return;

  const filtered = adsbSearchQuery
    ? flights.filter(f => {
      const callsign = (f[OPENSKY_FIELDS.CALLSIGN] || '').toLowerCase();
      const icao = (f[OPENSKY_FIELDS.ICAO24] || '').toLowerCase();
      return callsign.includes(adsbSearchQuery) || icao.includes(adsbSearchQuery);
    })
    : flights;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="flex flex-col items-center justify-center h-32 text-gray-400 text-center gap-2">
        <svg class="w-8 h-8 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <p class="text-xs font-semibold">No aircraft match your search.</p>
      </div>`;
    return;
  }

  // Sort: airborne first, then by altitude desc
  const sorted = [...filtered].sort((a, b) => {
    if (a[OPENSKY_FIELDS.ON_GROUND] !== b[OPENSKY_FIELDS.ON_GROUND]) {
      return a[OPENSKY_FIELDS.ON_GROUND] ? 1 : -1;
    }
    return (b[OPENSKY_FIELDS.BARO_ALT] || 0) - (a[OPENSKY_FIELDS.BARO_ALT] || 0);
  });

  listEl.innerHTML = sorted.map(f => {
    const icao = f[OPENSKY_FIELDS.ICAO24] || '???';
    const callsign = (f[OPENSKY_FIELDS.CALLSIGN] || '').trim() || icao.toUpperCase();
    const country = f[OPENSKY_FIELDS.ORIGIN_COUNTRY] || 'Unknown';
    const onGround = f[OPENSKY_FIELDS.ON_GROUND];
    const altM = f[OPENSKY_FIELDS.BARO_ALT];
    const altFt = altM !== null ? Math.round(altM * 3.28084) : null;
    const velMs = f[OPENSKY_FIELDS.VELOCITY];
    const speedKts = velMs !== null ? Math.round(velMs * 1.94384) : null;
    const heading = f[OPENSKY_FIELDS.HEADING];
    const isConflict = checkSingleFlightKkop(f);
    const isSelected = icao === adsbSelectedIcao;

    const statusColor = isConflict
      ? 'border-red-200 bg-red-50'
      : onGround
        ? 'border-black/[0.04] bg-white'
        : 'border-sky-100 bg-white';

    const iconColor = isConflict ? '#ef4444' : onGround ? '#9ca3af' : '#0ea5e9';
    const selectedBorder = isSelected ? 'ring-2 ring-sky-400' : '';

    return `
      <div class="adsb-flight-card p-2.5 rounded-xl border ${statusColor} ${selectedBorder} cursor-pointer hover:shadow-sm transition-all text-xs"
           data-icao="${icao}" onclick="selectAdsbFlight('${icao}')"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span style="color:${iconColor};transform:rotate(${heading || 0}deg);display:inline-block;font-size:14px;line-height:1;">✈</span>
            <span class="font-extrabold text-[#2a2334] tracking-tight">${callsign}</span>
            ${isConflict ? '<span class="text-[8px] font-extrabold text-red-600 bg-red-100 px-1 py-0.5 rounded uppercase">KKOP</span>' : ''}
          </div>
          <span class="text-[9px] font-bold text-gray-400 uppercase">${onGround ? 'Ground' : 'Airborne'}</span>
        </div>
        <div class="mt-1.5 flex items-center gap-3 text-[10px] text-gray-500 font-semibold">
          <span>${altFt !== null ? altFt.toLocaleString() + ' ft' : 'Alt N/A'}</span>
          <span>${speedKts !== null ? speedKts + ' kts' : ''}</span>
          <span class="ml-auto text-[9px] text-gray-300 font-mono">${icao.toUpperCase()}</span>
        </div>
        <div class="mt-0.5 text-[9px] text-gray-300 font-semibold">${country}</div>
      </div>`;
  }).join('');
}

async function fetchFlightDetails(icao, callsign) {
  const cacheKey = icao.toLowerCase();

  if (adsbFlightDetailsCache[cacheKey] && !adsbFlightDetailsCache[cacheKey].error) {
    return adsbFlightDetailsCache[cacheKey];
  }

  adsbFlightDetailsCache[cacheKey] = {
    loading: true,
    aircraft: null,
    route: null,
    error: false
  };

  const cleanCallsign = (callsign || '').trim();

  try {
    const fetchPromises = [
      fetch(`https://hexdb.io/api/v1/aircraft/${cacheKey}`, { signal: AbortSignal.timeout(5000) })
        .then(async r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .catch(err => {
          console.warn(`Aircraft fetch failed for ${icao}:`, err);
          return null;
        })
    ];

    if (cleanCallsign && cleanCallsign !== icao.toUpperCase()) {
      fetchPromises.push(
        fetch(`https://hexdb.io/api/v1/route/callsign/${cleanCallsign}`, { signal: AbortSignal.timeout(5000) })
          .then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .catch(err => {
            console.warn(`Route fetch failed for ${cleanCallsign}:`, err);
            return null;
          })
      );
    } else {
      fetchPromises.push(Promise.resolve(null));
    }

    const [aircraftResult, routeResult] = await Promise.all(fetchPromises);

    adsbFlightDetailsCache[cacheKey] = {
      loading: false,
      aircraft: aircraftResult,
      route: routeResult,
      error: !aircraftResult && !routeResult
    };
  } catch (err) {
    console.error(`Error fetching flight details for ${icao}:`, err);
    adsbFlightDetailsCache[cacheKey] = {
      loading: false,
      aircraft: null,
      route: null,
      error: true
    };
  }

  return adsbFlightDetailsCache[cacheKey];
}

function getFlightPopupHtml(icao, callsign, flight, cachedDetails) {
  const onGround = flight ? flight[OPENSKY_FIELDS.ON_GROUND] : false;
  const altM = flight ? flight[OPENSKY_FIELDS.BARO_ALT] : null;
  const altFt = altM !== null ? Math.round(altM * 3.28084) : null;
  const velMs = flight ? flight[OPENSKY_FIELDS.VELOCITY] : null;
  const speedKts = velMs !== null ? Math.round(velMs * 1.94384) : null;
  const heading = flight ? flight[OPENSKY_FIELDS.HEADING] : null;
  const isConflict = flight ? checkSingleFlightKkop(flight) : false;

  let detailsHtml = '';

  if (cachedDetails) {
    if (cachedDetails.loading) {
      detailsHtml = `
        <div class="pt-1.5 border-t border-black/5 flex items-center justify-center gap-1.5 text-[10px] text-gray-500 py-1">
          <span class="animate-spin text-sky-500">⌛</span> Loading details...
        </div>`;
    } else {
      const a = cachedDetails.aircraft;
      const r = cachedDetails.route;

      const aircraftModel = (a && a.model) ? a.model : null;
      const typeCode = (a && a.typecode) ? a.typecode : null;
      const registration = (a && a.registration) ? a.registration : null;
      const operator = (a && a.operator) ? a.operator : null;

      let routeStr = null;
      let routeTitle = '';
      if (r && r.from && r.to) {
        const fromCode = r.from.iata || r.from.icao || 'N/A';
        const toCode = r.to.iata || r.to.icao || 'N/A';
        routeStr = `${fromCode} ✈ ${toCode}`;
        routeTitle = `title="${r.from.name || r.from.location || ''} to ${r.to.name || r.to.location || ''}"`;
      }

      detailsHtml = `
        <div class="pt-1.5 border-t border-black/5 space-y-1 text-[10px]">
          ${operator ? `<div class="flex justify-between gap-2"><span class="text-gray-400 font-medium">Operator</span><span class="font-bold text-gray-700 truncate max-w-[110px]" title="${operator}">${operator}</span></div>` : ''}
          ${aircraftModel ? `<div class="flex justify-between gap-2"><span class="text-gray-400 font-medium">Aircraft</span><span class="font-bold text-gray-700 truncate max-w-[110px]" title="${aircraftModel}${typeCode ? ` (${typeCode})` : ''}">${aircraftModel}</span></div>` : ''}
          ${registration ? `<div class="flex justify-between"><span class="text-gray-400 font-medium">Reg Code</span><span class="font-bold text-gray-700 font-mono">${registration}</span></div>` : ''}
          ${routeStr ? `<div class="flex justify-between" ${routeTitle}><span class="text-gray-400 font-medium">Route</span><span class="font-bold text-sky-600">${routeStr}</span></div>` : ''}
          ${(!operator && !aircraftModel && !registration && !routeStr) ? `<div class="text-[9px] text-gray-400 italic text-center py-0.5">No additional aircraft data found</div>` : ''}
        </div>`;
    }
  } else {
    detailsHtml = `
      <div class="pt-1.5 border-t border-black/5 text-[9px] text-gray-400 text-center italic py-0.5">
        Click marker to load flight details
      </div>`;
  }

  return `
    <div class="text-xs space-y-1" style="min-width:180px">
      <div class="flex justify-between items-center pb-0.5">
        <span class="font-extrabold text-[#2a2334] text-sm tracking-tight">${callsign}</span>
        <span class="font-mono text-gray-400 text-[10px]">${icao.toUpperCase()}</span>
      </div>
      <div class="flex justify-between pt-0.5 border-t border-black/5">
        <span class="text-gray-500">Status</span>
        <span class="font-bold ${onGround ? 'text-gray-500' : 'text-sky-600'}">${onGround ? 'On Ground' : 'Airborne'}</span>
      </div>
      ${altFt !== null ? `<div class="flex justify-between"><span class="text-gray-500">Altitude</span><span class="font-bold">${altFt.toLocaleString()} ft</span></div>` : ''}
      ${speedKts !== null ? `<div class="flex justify-between"><span class="text-gray-500">Speed</span><span class="font-bold">${speedKts} kts</span></div>` : ''}
      ${heading ? `<div class="flex justify-between"><span class="text-gray-500">Heading</span><span class="font-bold">${Math.round(heading)}°</span></div>` : ''}
      ${isConflict ? '<div class="mt-1 text-[10px] font-bold text-red-600 bg-red-50 rounded px-1.5 py-0.5">⚠ KKOP Proximity Alert</div>' : ''}
      ${detailsHtml}
    </div>`;
}

function renderAdsbMapMarkers(flights) {
  // Remove stale markers (ICAOs no longer in feed)
  const currentIcaos = new Set(flights.map(f => f[OPENSKY_FIELDS.ICAO24]));
  for (const [icao, marker] of Object.entries(adsbMarkers)) {
    if (!currentIcaos.has(icao)) {
      if (adsbMap && adsbMap.hasLayer(marker)) adsbMap.removeLayer(marker);
      if (map && map.hasLayer(marker)) map.removeLayer(marker);
      delete adsbMarkers[icao];
    }
  }

  flights.forEach(f => {
    const icao = f[OPENSKY_FIELDS.ICAO24];
    const lat = f[OPENSKY_FIELDS.LAT];
    const lon = f[OPENSKY_FIELDS.LON];
    const onGround = f[OPENSKY_FIELDS.ON_GROUND];
    const heading = f[OPENSKY_FIELDS.HEADING] || 0;
    const callsign = (f[OPENSKY_FIELDS.CALLSIGN] || '').trim() || icao.toUpperCase();
    const isConflict = checkSingleFlightKkop(f);

    const color = isConflict ? '#ef4444' : onGround ? '#9ca3af' : '#0ea5e9';
    const size = onGround ? 16 : 20;

    const icon = L.divIcon({
      html: `<div style="color:${color};font-size:${size}px;transform:rotate(${heading}deg);line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.2));" title="${callsign}">✈</div>`,
      className: 'adsb-plane-icon',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });

    const cacheKey = icao.toLowerCase();
    const cachedDetails = adsbFlightDetailsCache[cacheKey] || null;
    const popupContent = getFlightPopupHtml(icao, callsign, f, cachedDetails);

    if (adsbMarkers[icao]) {
      adsbMarkers[icao].setLatLng([lat, lon]);
      adsbMarkers[icao].setIcon(icon);
      adsbMarkers[icao].setPopupContent(popupContent);

      // Handle layer visibility for main map
      if (isAdsbOnMainMap && map) {
        if (!map.hasLayer(adsbMarkers[icao])) adsbMarkers[icao].addTo(map);
      } else {
        if (map && map.hasLayer(adsbMarkers[icao])) map.removeLayer(adsbMarkers[icao]);
      }

      // Handle layer visibility for modal map
      if (isAdsbModalOpen && adsbMap) {
        if (!adsbMap.hasLayer(adsbMarkers[icao])) adsbMarkers[icao].addTo(adsbMap);
      } else {
        if (adsbMap && adsbMap.hasLayer(adsbMarkers[icao])) adsbMap.removeLayer(adsbMarkers[icao]);
      }
    } else {
      const marker = L.marker([lat, lon], { icon })
        .bindPopup(popupContent, { maxWidth: 220 });

      // Dynamic lookup on popup open
      marker.on('popupopen', async () => {
        const cached = adsbFlightDetailsCache[cacheKey];
        if (!cached || cached.error) {
          const currentFlight = adsbFlightData.find(fl => fl[OPENSKY_FIELDS.ICAO24] === icao) || f;

          // Start the fetch (sets cache to loading state synchronously)
          const fetchPromise = fetchFlightDetails(icao, callsign);

          // Show spinner immediately
          marker.setPopupContent(getFlightPopupHtml(icao, callsign, currentFlight, adsbFlightDetailsCache[cacheKey]));

          // Wait for the fetch to resolve
          const details = await fetchPromise;

          // Update popup with results
          marker.setPopupContent(getFlightPopupHtml(icao, callsign, currentFlight, details));
        }
      });

      marker.on('click', () => selectAdsbFlight(icao));
      adsbMarkers[icao] = marker;

      // Add to main map if toggle is active
      if (isAdsbOnMainMap && map) {
        marker.addTo(map);
      }

      // Add to adsbMap if modal is open
      if (isAdsbModalOpen && adsbMap) {
        marker.addTo(adsbMap);
      }
    }
  });
}

function checkSingleFlightKkop(flight) {
  const lat = flight[OPENSKY_FIELDS.LAT];
  const lon = flight[OPENSKY_FIELDS.LON];
  if (lat === null || lon === null) return false;

  for (const airport of REGION_AIRPORTS) {
    const inside = isPointInCircle([lat, lon], [airport.lat, airport.lng], 5000);
    if (inside) return true; // Within 5km KKOP zone
  }
  return false;
}

function checkAdsbKkopConflicts(flights) {
  const conflictingFlights = flights.filter(f => checkSingleFlightKkop(f));
  const conflictCount = conflictingFlights.length;

  const elCount = document.getElementById('adsb-count-conflicts');
  if (elCount) elCount.textContent = conflictCount;

  const banner = document.getElementById('adsb-conflict-banner');
  const bannerText = document.getElementById('adsb-conflict-text');

  if (conflictCount > 0 && banner && bannerText) {
    const names = conflictingFlights
      .slice(0, 3)
      .map(f => ((f[OPENSKY_FIELDS.CALLSIGN] || '').trim() || f[OPENSKY_FIELDS.ICAO24].toUpperCase()))
      .join(', ');
    bannerText.textContent = `${names}${conflictCount > 3 ? ` +${conflictCount - 3} more` : ''} within 5km KKOP zones.`;
    banner.classList.remove('hidden');
  } else if (banner) {
    banner.classList.add('hidden');
  }
}

window.selectAdsbFlight = function (icao) {
  adsbSelectedIcao = icao;

  // Pan map to aircraft (dynamic based on which map shows the marker)
  const flight = adsbFlightData.find(f => f[OPENSKY_FIELDS.ICAO24] === icao);
  if (flight) {
    const lat = flight[OPENSKY_FIELDS.LAT];
    const lon = flight[OPENSKY_FIELDS.LON];
    if (lat !== null && lon !== null) {
      if (isAdsbModalOpen && adsbMap) {
        adsbMap.setView([lat, lon], 10, { animate: true, duration: 0.8 });
        if (adsbMarkers[icao]) adsbMarkers[icao].openPopup();
      }
      if (isAdsbOnMainMap && map) {
        map.setView([lat, lon], 10, { animate: true, duration: 0.8 });
        if (adsbMarkers[icao]) adsbMarkers[icao].openPopup();
      }
    }
  }

  // Highlight selected card in list
  renderAdsbFlightList(adsbFlightData);
};


// ============================================================================
// ULG FLIGHT LOG CONVERTER
// ============================================================================
let ulgCurrentFilePath = null;
let ulgLastResult = null;
let ulgChartInstance = null;
let ulgLeafletMapInstance = null;
let ulgPolylineLayer = null;
let ulgMarkersLayer = null;
let ulgDroneMarker = null;
let ulgActiveTab = 'combined';
let ulgOsmLayer = null;
let ulgSatLayer = null;
let ulgCurrentMapLayer = 'osm';
let ulgRouteColor = '#ffff00';
let ulgRouteWeight = 2.8;
let flightInspectorMode = 'auto'; // 'auto' | 'px4' | 'dji'
let djiApiKey = '07dadcba863fab453c6b46999a38eea';

// Flight Replay & Virtual Stick State
let replayAnimationId = null;
let isReplayPlaying = false;
let replayCurrentIndex = 0;
let replaySpeedMultiplier = 1;
let replayPoints = [];

function setFlightInspectorMode(mode) {
  flightInspectorMode = mode;
  const tabs = ['auto', 'px4', 'dji'];
  tabs.forEach(t => {
    const btn = document.getElementById(`flight-tab-${t}`);
    if (btn) {
      if (t === mode) {
        btn.className = "px-3 py-1 rounded-xl bg-white text-gray-800 shadow-xs transition-all font-bold";
      } else {
        btn.className = "px-3 py-1 rounded-xl text-gray-500 hover:text-gray-800 transition-all font-bold";
      }
    }
  });

  const dropTitle = document.getElementById('ulg-drop-title');
  const dropDesc = document.getElementById('ulg-drop-desc');
  const fileInput = document.getElementById('ulg-file-input');

  if (mode === 'dji') {
    if (dropTitle) dropTitle.innerHTML = 'Drop DJI flight log (<span class="text-blue-600 font-mono">DJIFlightRecord*.txt</span>) here';
    if (dropDesc) dropDesc.textContent = 'Supports AES-encrypted v13+ & plaintext v1-v12 logs with offline keychain caching';
    if (fileInput) fileInput.accept = '.txt,.dat';
    const keyPanel = document.getElementById('dji-api-key-panel');
    if (keyPanel) keyPanel.classList.remove('hidden');
  } else if (mode === 'px4') {
    if (dropTitle) dropTitle.innerHTML = 'Drop PX4 / Wingtra flight log (<span class="text-rose-600 font-mono">.ulg</span>) here';
    if (dropDesc) dropDesc.textContent = 'Synchronizes AGL, AMSL, Airspeed, Battery, Orientation & EKF telemetry topics';
    if (fileInput) fileInput.accept = '.ulg';
    const keyPanel = document.getElementById('dji-api-key-panel');
    if (keyPanel) keyPanel.classList.add('hidden');
  } else {
    if (dropTitle) dropTitle.innerHTML = 'Drop flight log (<span class="text-rose-600 font-mono">.ulg</span> or <span class="text-blue-600 font-mono">DJIFlightRecord*.txt</span>) here';
    if (dropDesc) dropDesc.textContent = 'Smart auto-detects autopilot · Syncs AGL, AMSL, Velocity & Battery · KKOP & 400ft Safety Audit';
    if (fileInput) fileInput.accept = '.ulg,.txt,.dat';
    const keyPanel = document.getElementById('dji-api-key-panel');
    if (keyPanel) keyPanel.classList.add('hidden');
  }
}

function toggleDjiApiKeyInput() {
  const panel = document.getElementById('dji-api-key-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

function saveDjiApiKey() {
  const input = document.getElementById('dji-api-key-input');
  if (input && input.value.trim()) {
    djiApiKey = input.value.trim();
    showToast('DJI Developer API Key saved successfully!', 'success');
  }
}

function openUlgConverterModal() {
  const modal = document.getElementById('ulg-converter-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    modal.classList.remove('opacity-0');
    const inner = modal.querySelector('div');
    if (inner) inner.classList.remove('scale-95');
  });
  ulgResetState();
  setupUlgModalListeners();
}

function closeUlgConverterModal() {
  const modal = document.getElementById('ulg-converter-modal');
  if (!modal) return;
  modal.classList.add('opacity-0');
  const inner = modal.querySelector('div');
  if (inner) inner.classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
    if (ulgChartInstance) {
      ulgChartInstance.destroy();
      ulgChartInstance = null;
    }
    if (ulgLeafletMapInstance) {
      ulgLeafletMapInstance.remove();
      ulgLeafletMapInstance = null;
    }
  }, 300);
}

function ulgResetState() {
  ulgCurrentFilePath = null;
  ulgLastResult = null;
  ulgActiveTab = 'combined';
  if (ulgChartInstance) {
    ulgChartInstance.destroy();
    ulgChartInstance = null;
  }
  if (ulgLeafletMapInstance) {
    ulgLeafletMapInstance.remove();
    ulgLeafletMapInstance = null;
  }
  ulgPolylineLayer = null;
  ulgMarkersLayer = null;
  ulgDroneMarker = null;
  const fileInfo = document.getElementById('ulg-file-info');
  if (fileInfo) fileInfo.classList.add('hidden');
  const loader = document.getElementById('ulg-loader');
  if (loader) loader.classList.add('hidden');
  const results = document.getElementById('ulg-results');
  if (results) results.classList.add('hidden');
  const errAlert = document.getElementById('ulg-error-alert');
  if (errAlert) errAlert.classList.add('hidden');
  const dropZone = document.getElementById('ulg-drop-zone');
  if (dropZone) dropZone.classList.remove('hidden');

  // Reset badges
  const badge = document.getElementById('flight-inspector-badge');
  if (badge) {
    badge.className = 'text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wider';
    badge.textContent = 'Universal Core';
  }
}

function setupUlgModalListeners() {
  const modal = document.getElementById('ulg-converter-modal');
  if (!modal || modal._ulgListenersAttached) return;
  modal._ulgListenersAttached = true;

  const closeBtn = document.getElementById('close-ulg-modal');
  if (closeBtn) closeBtn.onclick = closeUlgConverterModal;
  const cancelBtn = document.getElementById('ulg-cancel-btn');
  if (cancelBtn) cancelBtn.onclick = closeUlgConverterModal;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeUlgConverterModal(); });

  const clearBtn = document.getElementById('ulg-clear-file');
  if (clearBtn) clearBtn.onclick = ulgResetState;

  const dropZone = document.getElementById('ulg-drop-zone');
  const fileInput = document.getElementById('ulg-file-input');

  const triggerSelectFile = async () => {
    if (window.api && window.api.selectFile) {
      let filters = [{ name: 'Flight Logs (*.ulg, *.txt, *.dat)', extensions: ['ulg', 'txt', 'dat'] }];
      if (flightInspectorMode === 'px4') {
        filters = [{ name: 'PX4 ULog (*.ulg)', extensions: ['ulg'] }];
      } else if (flightInspectorMode === 'dji') {
        filters = [{ name: 'DJI Flight Record (*.txt, *.dat)', extensions: ['txt', 'dat'] }];
      }

      const res = await window.api.selectFile({
        title: 'Select Drone Flight Log',
        filters: filters
      });
      if (!res.canceled && res.filePath) {
        ulgSetFileFromPath(res.filePath, res.name, res.size);
        return;
      }
    } else if (fileInput) {
      fileInput.click();
    }
  };

  if (dropZone) {
    dropZone.onclick = triggerSelectFile;
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-rose-400', 'bg-rose-50/40'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-rose-400', 'bg-rose-50/40'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-rose-400', 'bg-rose-50/40');
      if (e.dataTransfer.files[0]) ulgSetFile(e.dataTransfer.files[0]);
    });
  }

  if (fileInput) {
    fileInput.onchange = (e) => { if (e.target.files[0]) ulgSetFile(e.target.files[0]); };
  }

  const reuploadBtn = document.getElementById('ulg-reupload-btn');
  if (reuploadBtn) {
    reuploadBtn.onclick = triggerSelectFile;
  }

  // Replay timeline slider explicit input listener
  const slider = document.getElementById('replay-seek-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      seekFlightReplay(e.target.value);
    });
  }
}

function ulgShowError(msg) {
  const el = document.getElementById('ulg-error-alert');
  const txt = document.getElementById('ulg-error-text');
  if (txt) txt.textContent = msg;
  else if (el) el.textContent = '⚠ ' + msg;
  if (el) el.classList.remove('hidden');
}

async function ulgSetFile(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.ulg') && !name.endsWith('.txt') && !name.endsWith('.dat')) {
    ulgShowError('Please select a valid drone flight log (.ulg for PX4/Wingtra or .txt for DJI).');
    return;
  }
  let filePath = '';
  if (window.api && window.api.getPathForFile) {
    filePath = window.api.getPathForFile(file);
  } else if (file.path) {
    filePath = file.path;
  }

  if (!filePath) {
    ulgShowError('Unable to access file system path in this environment. Please click to select file.');
    return;
  }

  return ulgSetFileFromPath(filePath, file.name, file.size);
}

async function ulgSetFileFromPath(filePath, fileName, fileSize) {
  ulgCurrentFilePath = filePath;
  const dropZone = document.getElementById('ulg-drop-zone');
  if (dropZone) dropZone.classList.add('hidden');
  const fileInfo = document.getElementById('ulg-file-info');
  if (fileInfo) fileInfo.classList.remove('hidden');
  const fileNameEl = document.getElementById('ulg-file-name');
  if (fileNameEl) fileNameEl.textContent = fileName || 'flight_log';
  const mb = ((fileSize || 0) / 1024 / 1024).toFixed(1);
  const fileSizeEl = document.getElementById('ulg-file-size');

  const lowerName = (fileName || '').toLowerCase();
  const isDji = lowerName.endsWith('.txt') || lowerName.endsWith('.dat') || lowerName.startsWith('djiflightrecord');
  if (fileSizeEl) {
    fileSizeEl.textContent = isDji ? `${mb} MB · DJI FlightRecord` : `${mb} MB · PX4 Binary Log`;
  }

  const results = document.getElementById('ulg-results');
  if (results) results.classList.add('hidden');
  const errAlert = document.getElementById('ulg-error-alert');
  if (errAlert) errAlert.classList.add('hidden');
  const loader = document.getElementById('ulg-loader');
  if (loader) loader.classList.remove('hidden');

  try {
    const key = djiApiKey || '07dadcba863fab453c6b46999a38eea';
    let result = null;

    if (window.api && window.api.parseFlightLog) {
      result = await window.api.parseFlightLog(ulgCurrentFilePath, key, null, []);
    } else {
      result = await window.api.convertUlg(ulgCurrentFilePath, null, []);
    }

    ulgLastResult = result;
    if (loader) loader.classList.add('hidden');

    if (!result.success) {
      ulgShowError(result.error || 'Parsing failed — no GPS telemetry topics found.');
    } else {
      ulgRenderInspector(result);
    }
  } catch (err) {
    if (loader) loader.classList.add('hidden');
    ulgShowError('Error parsing flight log: ' + (err.message || String(err)));
  }
}

function ulgRenderInspector(r) {
  const results = document.getElementById('ulg-results');
  if (results) results.classList.remove('hidden');

  // Update Brand Badge
  const badge = document.getElementById('flight-inspector-badge');
  const iconWrap = document.getElementById('flight-inspector-icon-wrap');
  if (badge) {
    if (r.drone_brand === 'DJI') {
      badge.className = 'text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 uppercase tracking-wider';
      badge.textContent = r.aircraft_name ? `DJI: ${r.aircraft_name}` : 'DJI Enterprise';
      if (iconWrap) iconWrap.className = 'w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500 shadow-sm transition-colors';
    } else {
      badge.className = 'text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wider';
      badge.textContent = 'PX4 / Wingtra';
      if (iconWrap) iconWrap.className = 'w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500 shadow-sm transition-colors';
    }
  }

  // Populate Key Metric Cards
  const statAgl = document.getElementById('ulg-stat-agl');
  if (statAgl) statAgl.textContent = `${r.max_agl_ft} ft`;
  const statAglSub = document.getElementById('ulg-stat-agl-sub');
  if (statAglSub) statAglSub.textContent = `${r.max_agl_m} m AGL · Launch: ${r.takeoff_amsl_ft} ft`;

  const statAmsl = document.getElementById('ulg-stat-amsl');
  if (statAmsl) statAmsl.textContent = `${r.max_amsl_ft} ft`;
  const statAmslSub = document.getElementById('ulg-stat-amsl-sub');
  if (statAmslSub) statAmslSub.textContent = `${r.max_amsl_m} m AMSL (Sea Level)`;

  const statSpeed = document.getElementById('ulg-stat-speed');
  if (statSpeed) statSpeed.textContent = `${r.max_speed_knots} kts`;
  const statSpeedSub = document.getElementById('ulg-stat-speed-sub');
  if (statSpeedSub) statSpeedSub.textContent = `${r.max_speed_kmh} km/h · ${r.max_speed_ms} m/s`;

  const statDuration = document.getElementById('ulg-stat-duration');
  const dur = r.duration_sec || 0;
  const durStr = dur < 60 ? `${Math.round(dur)}s` :
    dur < 3600 ? `${Math.floor(dur / 60)}m ${Math.round(dur % 60)}s` :
      `${Math.floor(dur / 3600)}h ${Math.floor((dur % 3600) / 60)}m`;
  if (statDuration) statDuration.textContent = durStr;
  const statPointsSub = document.getElementById('ulg-stat-points-sub');
  if (statPointsSub) statPointsSub.textContent = `Total Points: ${r.track_points.toLocaleString()}`;

  // Populate Regulatory Compliance Card
  const comp = r.compliance || {};
  const compCard = document.getElementById('ulg-compliance-card');
  const compTitle = document.getElementById('ulg-compliance-title');
  const compDesc = document.getElementById('ulg-compliance-desc');
  const compIcon = document.getElementById('ulg-compliance-icon');
  const badgeCeiling = document.getElementById('ulg-badge-ceiling');
  const badgeSpeed = document.getElementById('ulg-badge-speed');

  if (comp.ceiling_breach) {
    if (compCard) compCard.className = 'rounded-2xl p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm bg-rose-50/60 border-rose-200';
    if (compIcon) compIcon.className = 'w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0';
    if (compTitle) compTitle.textContent = 'Ceiling Breach Detected ⚠️';
    if (compDesc) compDesc.textContent = `Flight reached ${comp.max_agl_ft} ft AGL, exceeding the mandatory 400 ft (120 m) ceiling for drone operations.`;
    if (badgeCeiling) {
      badgeCeiling.className = 'px-2.5 py-1 rounded-xl text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200';
      badgeCeiling.textContent = `Ceiling Breached (${comp.max_agl_ft} ft > 400 ft)`;
    }
  } else {
    if (compCard) compCard.className = 'rounded-2xl p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm bg-emerald-50/50 border-emerald-200';
    if (compIcon) compIcon.className = 'w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0';
    if (compTitle) compTitle.textContent = 'Airspace Safety Audit Passed ✅';
    if (compDesc) compDesc.textContent = `Flight remained strictly within the 400 ft AGL ceiling (max: ${comp.max_agl_ft} ft AGL) and speed caps.`;
    if (badgeCeiling) {
      badgeCeiling.className = 'px-2.5 py-1 rounded-xl text-[10px] font-bold bg-emerald-100 text-emerald-700';
      badgeCeiling.textContent = `Ceiling OK (Max ${comp.max_agl_ft} ft AGL)`;
    }
  }

  if (badgeSpeed) {
    if (comp.speed_breach) {
      badgeSpeed.className = 'px-2.5 py-1 rounded-xl text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200';
      badgeSpeed.textContent = `Speed Warning (${comp.max_speed_knots} kts > 87 kts)`;
    } else {
      badgeSpeed.className = 'px-2.5 py-1 rounded-xl text-[10px] font-bold bg-emerald-100 text-emerald-700';
      badgeSpeed.textContent = `Speed OK (${comp.max_speed_knots} kts)`;
    }
  }

  // Render Charts & Maps
  renderUlgChart();
  showToast(`Parsed ${r.track_points.toLocaleString()} telemetry points successfully!`, 'success');
}

function switchUlgStudioTab(tab) {
  ulgActiveTab = tab;
  const tabs = ['combined', 'agl', 'amsl', 'speed', 'battery', 'map'];
  tabs.forEach(t => {
    const btn = document.getElementById(`ulg-tab-${t}`);
    if (btn) {
      if (t === tab) {
        btn.className = 'px-3.5 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-100 transition-all font-bold';
      } else {
        btn.className = 'px-3.5 py-1.5 rounded-xl text-gray-500 hover:bg-black/5 transition-all font-bold';
      }
    }
  });

  const chartWrap = document.getElementById('ulg-chart-wrapper');
  const mapWrap = document.getElementById('ulg-map-wrapper');
  const mapToolbar = document.getElementById('ulg-map-toolbar');
  const ceilingToggleLabel = document.getElementById('ulg-toggle-ceiling-line')?.parentElement;

  if (tab === 'map') {
    if (chartWrap) chartWrap.classList.add('hidden');
    if (mapWrap) mapWrap.classList.remove('hidden');
    if (mapToolbar) mapToolbar.classList.remove('hidden');
    if (ceilingToggleLabel) ceilingToggleLabel.classList.add('hidden');
    renderUlgLeafletMap();
  } else {
    pauseFlightReplay();
    if (mapWrap) mapWrap.classList.add('hidden');
    if (chartWrap) chartWrap.classList.remove('hidden');
    if (mapToolbar) mapToolbar.classList.add('hidden');
    if (ceilingToggleLabel) ceilingToggleLabel.classList.remove('hidden');
    renderUlgChart();
  }
}

function handleUlgChartRedraw() {
  if (ulgActiveTab !== 'map') {
    renderUlgChart();
  }
}

function renderUlgChart() {
  if (!ulgLastResult || !ulgLastResult.preview_points) return;
  const pts = ulgLastResult.preview_points;
  const labels = pts.map(p => p.time_min);

  const canvas = document.getElementById('ulg-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (ulgChartInstance) {
    ulgChartInstance.destroy();
    ulgChartInstance = null;
  }

  const showCeiling = document.getElementById('ulg-toggle-ceiling-line')?.checked ?? true;
  let datasets = [];
  let yAxes = {};

  if (ulgActiveTab === 'combined') {
    datasets = [
      {
        label: 'Altitude AGL (ft)',
        data: pts.map(p => p.agl_ft),
        borderColor: '#10b981', // Emerald
        backgroundColor: 'rgba(16, 185, 129, 0.05)',
        borderWidth: 2,
        tension: 0.2,
        yAxisID: 'yAlt',
        pointRadius: 0
      },
      {
        label: 'Altitude AMSL (ft)',
        data: pts.map(p => p.amsl_ft),
        borderColor: '#0284c7', // Sky blue
        borderDash: [4, 4],
        borderWidth: 1.5,
        tension: 0.2,
        yAxisID: 'yAlt',
        pointRadius: 0
      },
      {
        label: 'Ground Speed (knots)',
        data: pts.map(p => p.speed_knots),
        borderColor: '#f97316', // Orange
        borderWidth: 2,
        tension: 0.2,
        yAxisID: 'ySpeed',
        pointRadius: 0
      }
    ];

    if (showCeiling) {
      datasets.push({
        label: '400 ft Regulatory Ceiling (AGL)',
        data: pts.map(() => 400),
        borderColor: '#ef4444',
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        yAxisID: 'yAlt'
      });
    }

    yAxes = {
      yAlt: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Altitude (ft)', font: { size: 10, weight: 'bold' } },
        grid: { color: 'rgba(0,0,0,0.04)' }
      },
      ySpeed: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Speed (knots)', font: { size: 10, weight: 'bold' } },
        grid: { drawOnChartArea: false }
      }
    };
  } else if (ulgActiveTab === 'agl') {
    datasets = [
      {
        label: 'Height Above Takeoff - AGL (ft)',
        data: pts.map(p => p.agl_ft),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        borderWidth: 2.5,
        tension: 0.2,
        pointRadius: 0
      }
    ];
    if (showCeiling) {
      datasets.push({
        label: 'Mandatory 400 ft Ceiling Cap',
        data: pts.map(() => 400),
        borderColor: '#ef4444',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0
      });
    }
  } else if (ulgActiveTab === 'amsl') {
    datasets = [
      {
        label: 'True Altitude - AMSL (ft Above Sea Level)',
        data: pts.map(p => p.amsl_ft),
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.1)',
        fill: true,
        borderWidth: 2.5,
        tension: 0.2,
        pointRadius: 0
      }
    ];
  } else if (ulgActiveTab === 'speed') {
    datasets = [
      {
        label: 'Ground Velocity (knots)',
        data: pts.map(p => p.speed_knots),
        borderColor: '#f97316',
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0
      },
      {
        label: 'Ground Velocity (mph)',
        data: pts.map(p => p.speed_mph),
        borderColor: '#fbbf24',
        borderWidth: 1.5,
        tension: 0.2,
        pointRadius: 0
      }
    ];
  } else if (ulgActiveTab === 'battery') {
    datasets = [
      {
        label: 'Battery Remaining (%)',
        data: pts.map(p => p.battery_pct),
        borderColor: '#8b5cf6',
        borderWidth: 2.5,
        tension: 0.2,
        pointRadius: 0,
        yAxisID: 'yPct'
      },
      {
        label: 'Pack Voltage (V)',
        data: pts.map(p => p.voltage_v),
        borderColor: '#ec4899',
        borderWidth: 1.5,
        tension: 0.2,
        pointRadius: 0,
        yAxisID: 'yVolt'
      }
    ];
    yAxes = {
      yPct: {
        type: 'linear',
        position: 'left',
        max: 100,
        min: 0,
        title: { display: true, text: 'Battery %', font: { size: 10, weight: 'bold' } }
      },
      yVolt: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Voltage (V)', font: { size: 10, weight: 'bold' } },
        grid: { drawOnChartArea: false }
      }
    };
  }

  ulgChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } },
        tooltip: {
          callbacks: {
            title: (items) => `Time: ${items[0].label} mins`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Elapsed Flight Time (minutes)', font: { size: 10, weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.03)' }
        },
        ...yAxes
      }
    }
  });
}

function setUlgMapLayer(layerType) {
  ulgCurrentMapLayer = layerType;
  const btnOsm = document.getElementById('ulg-map-btn-osm');
  const btnSat = document.getElementById('ulg-map-btn-sat');

  if (layerType === 'sat') {
    if (btnSat) btnSat.className = "px-2 py-0.5 rounded-md font-bold bg-white text-gray-800 shadow-xs";
    if (btnOsm) btnOsm.className = "px-2 py-0.5 rounded-md font-bold text-gray-500 hover:text-gray-800";
    if (ulgLeafletMapInstance) {
      if (ulgOsmLayer && ulgLeafletMapInstance.hasLayer(ulgOsmLayer)) {
        ulgLeafletMapInstance.removeLayer(ulgOsmLayer);
      }
      if (!ulgSatLayer) {
        ulgSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
          maxZoom: 19
        });
      }
      ulgSatLayer.addTo(ulgLeafletMapInstance);
      if (ulgPolylineLayer) ulgPolylineLayer.bringToFront();
    }
  } else {
    if (btnOsm) btnOsm.className = "px-2 py-0.5 rounded-md font-bold bg-white text-gray-800 shadow-xs";
    if (btnSat) btnSat.className = "px-2 py-0.5 rounded-md font-bold text-gray-500 hover:text-gray-800";
    if (ulgLeafletMapInstance) {
      if (ulgSatLayer && ulgLeafletMapInstance.hasLayer(ulgSatLayer)) {
        ulgLeafletMapInstance.removeLayer(ulgSatLayer);
      }
      if (ulgOsmLayer) {
        ulgOsmLayer.addTo(ulgLeafletMapInstance);
      }
      if (ulgPolylineLayer) ulgPolylineLayer.bringToFront();
    }
  }
}

function setUlgRouteColor(color) {
  ulgRouteColor = color;
  const picker = document.getElementById('ulg-route-color-picker');
  if (picker && picker.value !== color) {
    picker.value = color;
  }
  if (ulgPolylineLayer) {
    ulgPolylineLayer.setStyle({ color: color });
  }
}

function setUlgRouteWeight(weight) {
  ulgRouteWeight = parseFloat(weight) || 2.8;
  if (ulgPolylineLayer) {
    ulgPolylineLayer.setStyle({ weight: ulgRouteWeight });
  }
}

function renderUlgLeafletMap() {
  if (!ulgLastResult) return;
  // Use high-resolution coordinates (map_points) if available, fallback to preview_points
  const latlngs = ulgLastResult.map_points && ulgLastResult.map_points.length > 0
    ? ulgLastResult.map_points
    : (ulgLastResult.preview_points || []).map(p => [p.lat, p.lon]);

  if (!latlngs.length) return;

  const mapContainer = document.getElementById('ulg-leaflet-map');
  if (!mapContainer) return;

  if (!ulgLeafletMapInstance) {
    ulgLeafletMapInstance = L.map('ulg-leaflet-map', {
      zoomControl: true,
      attributionControl: true
    }).setView(latlngs[0], 15);

    ulgOsmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(ulgLeafletMapInstance);
  }

  if (ulgPolylineLayer) {
    ulgLeafletMapInstance.removeLayer(ulgPolylineLayer);
  }
  if (ulgMarkersLayer) {
    ulgLeafletMapInstance.removeLayer(ulgMarkersLayer);
    ulgMarkersLayer = null;
  }
  ulgMarkersLayer = L.layerGroup().addTo(ulgLeafletMapInstance);

  // Draw smooth flight vector polyline with user-selected color and weight
  ulgPolylineLayer = L.polyline(latlngs, {
    color: ulgRouteColor || '#ffff00',
    weight: ulgRouteWeight || 2.8,
    opacity: 0.95,
    smoothFactor: 0 // Keep raw precision without any simplification
  }).addTo(ulgLeafletMapInstance);

  // Takeoff & Landing markers
  const startPt = latlngs[0];
  const endPt = latlngs[latlngs.length - 1];

  L.circleMarker(startPt, {
    radius: 7,
    color: '#10b981',
    fillColor: '#10b981',
    fillOpacity: 0.9,
    weight: 2
  }).addTo(ulgMarkersLayer).bindPopup('<b>Takeoff Location</b><br>Elevation: ' + ulgLastResult.takeoff_amsl_ft + ' ft AMSL');

  L.circleMarker(endPt, {
    radius: 7,
    color: '#ef4444',
    fillColor: '#ef4444',
    fillOpacity: 0.9,
    weight: 2
  }).addTo(ulgMarkersLayer).bindPopup('<b>Landing / Last Record</b>');

  // Initialize or reset drone position marker for Flight Replay
  if (ulgDroneMarker) {
    ulgLeafletMapInstance.removeLayer(ulgDroneMarker);
    ulgDroneMarker = null;
  }

  // Create pulsating drone marker
  const droneIcon = L.divIcon({
    className: 'custom-drone-replay-marker',
    html: `
      <div class="relative flex items-center justify-center w-8 h-8">
        <div class="absolute w-8 h-8 rounded-full bg-rose-500/30 animate-ping"></div>
        <div class="w-6 h-6 rounded-full bg-rose-600 border-2 border-white shadow-xl flex items-center justify-center text-white text-[10px]">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  ulgDroneMarker = L.marker(startPt, { icon: droneIcon, zIndexOffset: 1000 }).addTo(ulgLeafletMapInstance);

  // Initialize Flight Replay Engine
  initFlightReplay(ulgLastResult);

  ulgLeafletMapInstance.fitBounds(ulgPolylineLayer.getBounds(), { padding: [30, 30] });

  // Default to satellite view for flight routes if not already toggled
  if (ulgCurrentMapLayer === 'sat') {
    setUlgMapLayer('sat');
  }

  setTimeout(() => {
    if (ulgLeafletMapInstance) ulgLeafletMapInstance.invalidateSize();
  }, 200);
}

// ============================================================================
// Flight Replay & RC Virtual Stick Visualizer Engine
// ============================================================================
function initFlightReplay(result) {
  const data = result || ulgLastResult;
  if (!data) return;

  stopFlightReplay();
  replayPoints = data.preview_points || [];
  replayCurrentIndex = 0;

  const totalTimeEl = document.getElementById('replay-time-total');
  const durSec = data.duration_sec || 0;
  const durStr = formatFlightTime(durSec);
  if (totalTimeEl) totalTimeEl.textContent = durStr;

  const slider = document.getElementById('replay-seek-slider');
  if (slider) {
    slider.value = 0;
    slider.max = Math.max(0, replayPoints.length - 1);
  }

  updateReplayTelemetry(0);
}

function formatFlightTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toggleFlightReplay() {
  if (isReplayPlaying) {
    pauseFlightReplay();
  } else {
    startFlightReplay();
  }
}

function startFlightReplay() {
  if (!replayPoints || !replayPoints.length) {
    if (ulgLastResult && ulgLastResult.preview_points) {
      initFlightReplay(ulgLastResult);
    } else {
      return;
    }
  }

  isReplayPlaying = true;
  lastReplayTick = 0;
  updateReplayButtonUI(true);

  if (replayCurrentIndex >= replayPoints.length - 1) {
    replayCurrentIndex = 0;
  }

  runReplayLoop();
}

function pauseFlightReplay() {
  isReplayPlaying = false;
  if (replayAnimationId) {
    cancelAnimationFrame(replayAnimationId);
    replayAnimationId = null;
  }
  updateReplayButtonUI(false);
}

function stopFlightReplay() {
  pauseFlightReplay();
  replayCurrentIndex = 0;
  const slider = document.getElementById('replay-seek-slider');
  if (slider) slider.value = 0;
}

function resetFlightReplay() {
  pauseFlightReplay();
  replayCurrentIndex = 0;
  const slider = document.getElementById('replay-seek-slider');
  if (slider) slider.value = 0;
  updateReplayTelemetry(0);
  startFlightReplay();
}

function setReplaySpeed(multiplier) {
  replaySpeedMultiplier = multiplier;
  [1, 2, 5, 10].forEach(s => {
    const btn = document.getElementById(`replay-speed-${s}`);
    if (btn) {
      if (s === multiplier) {
        btn.className = "px-2 py-0.5 rounded-md font-bold bg-white text-gray-800 shadow-xs";
      } else {
        btn.className = "px-2 py-0.5 rounded-md font-bold text-gray-500 hover:text-gray-800";
      }
    }
  });
}

function seekFlightReplay(val) {
  pauseFlightReplay();
  replayCurrentIndex = Math.min(Math.max(0, Math.round(Number(val))), replayPoints.length - 1);
  updateReplayTelemetry(replayCurrentIndex);
}

function updateReplayButtonUI(playing) {
  const playIcon = document.getElementById('replay-play-icon');
  const pauseIcon = document.getElementById('replay-pause-icon');
  if (playIcon && pauseIcon) {
    if (playing) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  }
}

let lastReplayTick = 0;
function runReplayLoop(timestamp) {
  if (!isReplayPlaying) return;

  const now = timestamp || performance.now();
  if (!lastReplayTick) lastReplayTick = now;
  const elapsed = now - lastReplayTick;

  // Interval step based on speed multiplier (~100ms base interval for 250 points)
  const interval = 100 / replaySpeedMultiplier;

  if (elapsed >= interval) {
    lastReplayTick = now;
    replayCurrentIndex++;

    if (replayCurrentIndex >= replayPoints.length) {
      replayCurrentIndex = replayPoints.length - 1;
      updateReplayTelemetry(replayCurrentIndex);
      pauseFlightReplay();
      return;
    }

    updateReplayTelemetry(replayCurrentIndex);
  }

  replayAnimationId = requestAnimationFrame(runReplayLoop);
}

function updateReplayTelemetry(idx) {
  if (!replayPoints || !replayPoints[idx]) return;
  const p = replayPoints[idx];

  // Update Timeline Slider
  const slider = document.getElementById('replay-seek-slider');
  if (slider) slider.value = idx;

  // Update Time display
  const timeCur = document.getElementById('replay-time-current');
  const curSec = (p.time_min || 0) * 60;
  if (timeCur) timeCur.textContent = formatFlightTime(curSec);

  // Update Live Telemetry
  const aglLabel = document.getElementById('replay-live-agl');
  if (aglLabel) aglLabel.textContent = `${p.agl_ft} ft AGL`;
  const spdLabel = document.getElementById('replay-live-spd');
  if (spdLabel) spdLabel.textContent = `${p.speed_knots} kts`;

  // Move Drone Marker on Leaflet Map
  if (ulgDroneMarker && ulgLeafletMapInstance && p.lat && p.lon) {
    const newPos = [p.lat, p.lon];
    ulgDroneMarker.setLatLng(newPos);

    // Rotate marker according to heading
    const markerEl = ulgDroneMarker.getElement();
    if (markerEl && p.heading !== undefined) {
      const arrow = markerEl.querySelector('svg');
      if (arrow) {
        arrow.style.transform = `rotate(${p.heading}deg)`;
        arrow.style.transformOrigin = 'center';
      }
    }
  }

  // Update Virtual RC Sticks
  updateRCHud(p);
}

function updateRCHud(p) {
  // DJI / PX4 RC channels normalization (-1.0 to +1.0 and 0 to 100% throttle)
  let throttle = 50; // 0 to 100% (neutral hover is 50%)
  let rudder = 0;   // -1 to +1 (Yaw: negative=left, positive=right)
  let elevator = 0; // -1 to +1 (Pitch: positive=forward, negative=backward)
  let aileron = 0;  // -1 to +1 (Roll: positive=right, negative=left)

  if (p.rc_throttle !== undefined && p.rc_throttle !== null && p.rc_throttle > 0) {
    // DJI Remote Controller standard 11-bit PWM channel mapping:
    // Min: 364, Center/Neutral: 1024, Max: 1684 (Span: 660 from center)
    if (p.rc_throttle > 100) {
      const djiCenter = 1024;
      const djiSpan = 660; // 1684 - 1024

      throttle = Math.min(100, Math.max(0, Math.round(((p.rc_throttle - 364) / (1684 - 364)) * 100)));
      rudder = Math.min(1, Math.max(-1, (p.rc_rudder - djiCenter) / djiSpan));
      elevator = Math.min(1, Math.max(-1, (p.rc_elevator - djiCenter) / djiSpan));
      aileron = Math.min(1, Math.max(-1, (p.rc_aileron - djiCenter) / djiSpan));
    } else {
      // Direct percentage format (0 to 100 or -1 to 1)
      throttle = p.rc_throttle;
      rudder = p.rc_rudder || 0;
      elevator = p.rc_elevator || 0;
      aileron = p.rc_aileron || 0;
    }
  } else {
    // Kinematic estimation fallback from velocity and heading changes
    const spdKnots = p.speed_knots || 0;
    throttle = Math.min(100, Math.max(20, Math.round(50 + (p.agl_ft > 50 ? 10 : 0))));
    rudder = Math.sin((p.heading || 0) * (Math.PI / 180)) * 0.4;
    elevator = Math.min(0.8, spdKnots / 30.0);
    aileron = Math.cos((p.heading || 0) * (Math.PI / 180)) * 0.2;
  }

  // Bound stick knob travel inside 80px circle (-24px to +24px)
  const maxTravelPx = 24;

  // Left Stick: X = Rudder (-1 to +1), Y = Throttle (0 to 100% -> inverted Y, 50% is center)
  const leftX = rudder * maxTravelPx;
  const leftY = ((50 - throttle) / 50.0) * maxTravelPx;
  const leftStick = document.getElementById('rc-stick-left');
  if (leftStick) {
    leftStick.style.transform = `translate(${leftX.toFixed(1)}px, ${leftY.toFixed(1)}px)`;
  }
  const leftVal = document.getElementById('rc-stick-left-val');
  if (leftVal) {
    leftVal.textContent = `T: ${Math.round(throttle)}% | R: ${(rudder * 100).toFixed(0)}%`;
  }

  // Right Stick: X = Aileron (-1 to +1), Y = Elevator (-1 to +1, inverted: positive pitch moves stick forward/up)
  const rightX = aileron * maxTravelPx;
  const rightY = -elevator * maxTravelPx;
  const rightStick = document.getElementById('rc-stick-right');
  if (rightStick) {
    rightStick.style.transform = `translate(${rightX.toFixed(1)}px, ${rightY.toFixed(1)}px)`;
  }
  const rightVal = document.getElementById('rc-stick-right-val');
  if (rightVal) {
    rightVal.textContent = `P: ${(elevator * 100).toFixed(0)}% | R: ${(aileron * 100).toFixed(0)}%`;
  }
}

let isRCHudVisible = true;
function toggleRCHudPanel() {
  const panel = document.getElementById('rc-hud-panel');
  const btn = document.getElementById('btn-toggle-rc-hud');
  if (!panel) return;

  isRCHudVisible = !isRCHudVisible;
  if (isRCHudVisible) {
    panel.classList.remove('hidden');
    if (btn) btn.className = 'flex items-center gap-1 px-2 py-1 rounded-lg bg-black/10 text-gray-900 text-[10px] font-bold transition-all';
  } else {
    panel.classList.add('hidden');
    if (btn) btn.className = 'flex items-center gap-1 px-2 py-1 rounded-lg bg-black/5 text-gray-400 hover:text-gray-700 text-[10px] font-bold transition-all';
  }
}

async function ulgRunExportFiles() {
  if (!ulgCurrentFilePath) return;

  const formats = [];
  if (document.getElementById('ulg-opt-csv')?.checked) formats.push('csv');
  if (document.getElementById('ulg-opt-kml')?.checked) formats.push('kml');
  if (document.getElementById('ulg-opt-gpx')?.checked) formats.push('gpx');

  if (!formats.length) {
    showToast('Please select at least one format to export.', 'warning');
    return;
  }

  const exportBtn = document.getElementById('ulg-btn-export-files');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Generating Files...';
  }

  try {
    const outputDir = ulgCurrentFilePath.replace(/[^\\\/]+$/, '');
    const key = djiApiKey || '07dadcba863fab453c6b46999a38eea';
    let result = null;

    if (window.api && window.api.parseFlightLog) {
      result = await window.api.parseFlightLog(ulgCurrentFilePath, key, outputDir, formats);
    } else {
      result = await window.api.convertUlg(ulgCurrentFilePath, outputDir, formats);
    }

    if (result.success) {
      showToast(`Exported ${Object.keys(result.outputs || {}).length} format(s) to flight folder!`, 'success');
      const openFolderBtn = document.getElementById('ulg-btn-open-folder');
      if (openFolderBtn) openFolderBtn.classList.remove('hidden');
    } else {
      showToast(result.error || 'Export failed', 'error');
    }
  } catch (err) {
    showToast('Export error: ' + err.message, 'error');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Generate &amp; Save Selected Formats
      `;
    }
  }
}

function ulgOpenExportFolder() {
  if (!ulgCurrentFilePath) return;
  if (window.require) {
    const { shell } = window.require('electron');
    shell.showItemInFolder(ulgCurrentFilePath);
  } else {
    showToast('Folder: ' + ulgCurrentFilePath, 'info');
  }
}

// Global Sage & Forest radial progress calculator
function updateRadialProgress(percentage) {
  const circle = document.getElementById('radial-fill-bar');
  const valueLabel = document.getElementById('radial-percent-val');
  const descLabel = document.getElementById('radial-percent-desc');

  if (!circle || !valueLabel) return;

  // Circumference = 2 * PI * Radius (70) ~ 440px
  const circumference = 440;
  const offset = circumference - (circumference * percentage / 100);

  circle.style.strokeDashoffset = offset;
  valueLabel.innerText = `${Math.round(percentage)}%`;
  if (descLabel) {
    descLabel.innerText = `${Math.round(percentage)}%`;
  }
}

// Explicit window bindings for HTML onclick handlers
window.toggleFlightReplay = toggleFlightReplay;
window.resetFlightReplay = resetFlightReplay;
window.setReplaySpeed = setReplaySpeed;
window.seekFlightReplay = seekFlightReplay;
window.setFlightInspectorMode = setFlightInspectorMode;
window.toggleDjiApiKeyInput = toggleDjiApiKeyInput;
window.saveDjiApiKey = saveDjiApiKey;
window.switchUlgStudioTab = switchUlgStudioTab;
window.setUlgMapLayer = setUlgMapLayer;
window.setUlgRouteColor = setUlgRouteColor;
window.setUlgRouteWeight = setUlgRouteWeight;
window.handleUlgChartRedraw = handleUlgChartRedraw;
window.toggleRCHudPanel = toggleRCHudPanel;
window.ulgRunExportFiles = ulgRunExportFiles;
window.ulgOpenExportFolder = ulgOpenExportFolder;
