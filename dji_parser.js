const fs = require('fs');
const path = require('path');
const { DJILog } = require('dji-log-parser-js');

/**
 * Parses a DJI Flight Record (.txt) log file.
 * Handles both unencrypted (v1-v12) and AES-encrypted (v13+) files.
 * Caches keychains locally to enable 100% offline parsing once fetched.
 *
 * @param {string} filePath - Absolute path to the .txt flight log
 * @param {string} [apiKey] - DJI Developer Open API key (for v13+ logs)
 * @param {string} [outputDir] - Optional directory to save converted CSV/KML
 * @param {string[]} [formats] - Export formats: ['csv', 'kml', 'gpx']
 * @returns {Promise<Object>} Standardized flight inspection object
 */
async function parseDjiLog(filePath, apiKey = '', outputDir = null, formats = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const fileBuffer = fs.readFileSync(filePath);
    let djiLog;
    try {
      djiLog = new DJILog(new Uint8Array(fileBuffer));
    } catch (err) {
      const errMsg = String(err.message || err);
      if (errMsg.includes('bad magic') || errMsg.includes('no variants matched')) {
        return {
          success: false,
          error: "Unrecognized DJI Log Format. This file appears to be an internal DJI App cache/diagnostic log rather than a DJI Flight Record. Official flight logs are named 'DJIFlightRecord_YYYY-MM-DD_[HH-MM-SS].txt' located in your device's 'DJI/dji.go.vX/FlightRecord' or 'Android/data/dji.go.vX/files/FlightRecord' folder."
        };
      }
      return { success: false, error: `DJI Log Parse Error: ${errMsg}` };
    }

    const version = djiLog.version;
    const details = djiLog.details || {};

    let keychains = undefined;

    // Cache directory for offline keychains
    const cacheDir = path.join(__dirname, 'data', 'dji_keychains');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Determine a stable cache filename based on base filename and file size
    const baseName = path.basename(filePath, path.extname(filePath));
    const keychainCachePath = path.join(cacheDir, `${baseName}.keychain.json`);

    if (version >= 13) {
      // Check local cache first
      if (fs.existsSync(keychainCachePath)) {
        try {
          keychains = JSON.parse(fs.readFileSync(keychainCachePath, 'utf8'));
        } catch (e) {
          console.warn('[DJI Parser] Failed to read cached keychain, re-fetching...');
        }
      }

      // If not cached, fetch via DJI API Key
      if (!keychains) {
        const key = apiKey || '07dadcba863fab453c6b46999a38eea';
        if (!key) {
          return {
            success: false,
            error: `This DJI flight log is encrypted (Version ${version}). A DJI Developer API key is required to decrypt it.`
          };
        }

        try {
          keychains = await djiLog.fetchKeychains(key);
          // Cache keychains for future offline use
          fs.writeFileSync(keychainCachePath, JSON.stringify(keychains, null, 2), 'utf8');
        } catch (err) {
          return {
            success: false,
            error: `DJI Decryption failed: ${err.message || String(err)}. Please verify your DJI API key or internet connection.`
          };
        }
      }
    }

    // Extract normalized frames
    const frames = djiLog.frames(keychains);
    if (!frames || !frames.length) {
      return { success: false, error: 'No flight telemetry frames could be extracted from this DJI log.' };
    }

    // Process and normalize points
    const track = [];
    let initialAmsl = null;

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const osd = f.osd;
      if (!osd || !osd.latitude || !osd.longitude) continue;

      const lat = osd.latitude;
      const lon = osd.longitude;
      // Skip invalid coordinates
      if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) continue;

      const heightAglM = osd.height || 0;
      const altAmslM = osd.altitude || heightAglM;

      if (initialAmsl === null) {
        initialAmsl = altAmslM;
      }

      const vx = osd.xSpeed || 0;
      const vy = osd.ySpeed || 0;
      const vz = osd.zSpeed || 0;
      const speedMs = Math.sqrt(vx * vx + vy * vy);

      const batt = f.battery || {};
      const rc = f.rc || {};

      track.push({
        time_ms: Math.round((osd.flyTime || (i * 0.1)) * 1000),
        lat: lat,
        lon: lon,
        altitude_amsl_m: altAmslM,
        altitude_amsl_ft: altAmslM * 3.28084,
        height_agl_m: heightAglM,
        height_agl_ft: heightAglM * 3.28084,
        speed_ms: speedMs,
        speed_kmh: speedMs * 3.6,
        speed_knots: speedMs * 1.943844,
        speed_mph: speedMs * 2.23694,
        battery_percent: batt.chargeLevel || 0,
        voltage_v: batt.voltage || 0,
        heading: osd.yaw || 0,
        pitch: osd.pitch || 0,
        roll: osd.roll || 0,
        flight_mode: osd.flycState || 'GPS',
        rc_throttle: rc.throttle || 0,
        rc_rudder: rc.rudder || 0,
        rc_elevator: rc.elevator || 0,
        rc_aileron: rc.aileron || 0
      });
    }

    if (!track.length) {
      return { success: false, error: 'No valid GPS telemetry positions found in flight frames.' };
    }

    // Calculations
    const aglsFt = track.map(p => p.height_agl_ft);
    const amslsFt = track.map(p => p.altitude_amsl_ft);
    const speedsKnots = track.map(p => p.speed_knots);
    const speedsMs = track.map(p => p.speed_ms);
    const lats = track.map(p => p.lat);
    const lons = track.map(p => p.lon);

    const takeoffAmslFt = initialAmsl ? initialAmsl * 3.28084 : 0;
    const maxAglFt = Math.max(...aglsFt);
    const maxAmslFt = Math.max(...amslsFt);
    const minAmslFt = Math.min(...amslsFt);
    const durSec = (track[track.length - 1].time_ms - track[0].time_ms) / 1000.0;

    // Downsample to 250 points for chart visualization
    const step = Math.max(1, Math.floor(track.length / 250));
    const previewPoints = [];
    for (let i = 0; i < track.length; i += step) {
      const p = track[i];
      previewPoints.push({
        time_min: Math.round((p.time_ms / 60000.0) * 100) / 100,
        agl_ft: Math.round(p.height_agl_ft * 10) / 10,
        amsl_ft: Math.round(p.altitude_amsl_ft * 10) / 10,
        speed_knots: Math.round(p.speed_knots * 10) / 10,
        speed_mph: Math.round(p.speed_mph * 10) / 10,
        battery_pct: Math.round(p.battery_percent * 10) / 10,
        voltage_v: Math.round(p.voltage_v * 100) / 100,
        lat: p.lat,
        lon: p.lon,
        heading: Math.round(p.heading * 10) / 10
      });
    }

    // Full resolution map points
    const mapPoints = track.map(p => [p.lat, p.lon]);

    // Aviation Compliance Auditing (CASR Part 107 / PM 37)
    const maxSpeedKnots = Math.max(...speedsKnots);
    const breach400ft = maxAglFt > 400.0;
    const speedBreach = maxSpeedKnots > 87.0;

    const compliance = {
      ceiling_limit_ft: 400.0,
      max_agl_ft: Math.round(maxAglFt * 10) / 10,
      ceiling_breach: breach400ft,
      speed_limit_knots: 87.0,
      max_speed_knots: Math.round(maxSpeedKnots * 10) / 10,
      speed_breach: speedBreach,
      takeoff_amsl_ft: Math.round(takeoffAmslFt * 10) / 10,
      takeoff_amsl_m: Math.round((takeoffAmslFt / 3.28084) * 10) / 10,
      min_battery_pct: Math.min(...track.map(p => p.battery_percent)),
      min_voltage_v: Math.min(...track.map(p => p.voltage_v))
    };

    // Exports if requested
    const outputs = {};
    if (outputDir && formats && formats.length) {
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      // CSV Export
      if (formats.includes('csv')) {
        const csvPath = path.join(outputDir, `${baseName}_telemetry.csv`);
        const headers = 'time_ms,latitude,longitude,height_agl_ft,altitude_amsl_ft,speed_knots,speed_ms,battery_percent,voltage_v,heading,pitch,roll,flight_mode\n';
        const rows = track.map(p =>
          `${p.time_ms},${p.lat},${p.lon},${p.height_agl_ft.toFixed(1)},${p.altitude_amsl_ft.toFixed(1)},${p.speed_knots.toFixed(1)},${p.speed_ms.toFixed(2)},${p.battery_percent},${p.voltage_v.toFixed(2)},${p.heading.toFixed(1)},${p.pitch.toFixed(1)},${p.roll.toFixed(1)},${p.flight_mode}`
        ).join('\n');
        fs.writeFileSync(csvPath, headers + rows, 'utf8');
        outputs.csv = csvPath;
      }

      // KML Export
      if (formats.includes('kml')) {
        const kmlPath = path.join(outputDir, `${baseName}_flightpath.kml`);
        const coordsStr = track.map(p => `${p.lon},${p.lat},${p.altitude_amsl_m.toFixed(1)}`).join(' ');
        const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${baseName} (DJI Flight)</name>
    <Style id="djiPath">
      <LineStyle><color>ff00ffff</color><width>3</width></LineStyle>
    </Style>
    <Placemark>
      <name>Flight Route</name>
      <styleUrl>#djiPath</styleUrl>
      <LineString>
        <extrude>1</extrude>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coordsStr}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
        fs.writeFileSync(kmlPath, kmlContent, 'utf8');
        outputs.kml = kmlPath;
      }

      // GPX Export
      if (formats.includes('gpx')) {
        const gpxPath = path.join(outputDir, `${baseName}_track.gpx`);
        const trkpts = track.map(p =>
          `    <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.altitude_amsl_m.toFixed(1)}</ele></trkpt>`
        ).join('\n');
        const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PUTA-Monitor DJI Studio" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${baseName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
        fs.writeFileSync(gpxPath, gpxContent, 'utf8');
        outputs.gpx = gpxPath;
      }
    }

    return {
      success: true,
      drone_brand: 'DJI',
      aircraft_name: details.aircraftName || 'DJI Drone',
      aircraft_sn: details.aircraftSn || '—',
      app_platform: details.appPlatform || 'DJI App',
      app_version: details.appVersion || '—',
      log_version: version,
      track_points: track.length,
      duration_sec: Math.round(durSec * 10) / 10,
      takeoff_amsl_ft: Math.round(takeoffAmslFt * 10) / 10,
      takeoff_amsl_m: Math.round((takeoffAmslFt / 3.28084) * 10) / 10,
      max_agl_ft: Math.round(maxAglFt * 10) / 10,
      max_agl_m: Math.round((maxAglFt / 3.28084) * 10) / 10,
      max_amsl_ft: Math.round(maxAmslFt * 10) / 10,
      max_amsl_m: Math.round((maxAglFt / 3.28084) * 10) / 10,
      min_amsl_ft: Math.round(minAmslFt * 10) / 10,
      max_speed_ms: Math.round(Math.max(...speedsMs) * 100) / 100,
      max_speed_kmh: Math.round(Math.max(...speedsMs) * 3.6 * 10) / 10,
      max_speed_knots: Math.round(maxSpeedKnots * 10) / 10,
      center_lat: Math.round((lats.reduce((a, b) => a + b, 0) / lats.length) * 1000000) / 1000000,
      center_lon: Math.round((lons.reduce((a, b) => a + b, 0) / lons.length) * 1000000) / 1000000,
      start_lat: track[0].lat,
      start_lon: track[0].lon,
      compliance: compliance,
      preview_points: previewPoints,
      map_points: mapPoints,
      outputs: outputs
    };
  } catch (error) {
    console.error('[DJI Parser Error]:', error);
    return { success: false, error: error.message || String(error) };
  }
}

module.exports = { parseDjiLog };
