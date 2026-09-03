"""
ULG to CSV/KML/GPX converter - Production version
Works with:
- Standard PX4 ULog v1 files
- WingtraOne non-standard ULog v2 files
- Any ULog with vehicle_global_position, vehicle_gps_position, or sensor_gps topics

Strategy:
1. Try standard forward-walk parsing (fast, works on v1 and many v2)
2. Fall back to targeted binary scan using known struct sizes (works on WingtraOne v2)
3. Extract and export GPS track as CSV (Airdata-compatible), KML, GPX

Usage (CLI):
  python ulg_converter.py <input.ulg> [output_dir] [csv,kml,gpx]

Usage (as module):
  from ulg_converter import convert_ulg
  result = convert_ulg("log001.ulg", output_dir="./output", formats_out=["csv","kml"])
"""
import struct
import sys
import os
import json
import math

# ==============================================================================
# Type system
# ==============================================================================
TYPE_SIZES = {
    'int8_t': 1, 'uint8_t': 1,
    'int16_t': 2, 'uint16_t': 2,
    'int32_t': 4, 'uint32_t': 4,
    'int64_t': 8, 'uint64_t': 8,
    'float': 4, 'double': 8,
    'bool': 1, 'char': 1,
}
TYPE_STRUCTS = {
    'int8_t': 'b', 'uint8_t': 'B',
    'int16_t': 'h', 'uint16_t': 'H',
    'int32_t': 'i', 'uint32_t': 'I',
    'int64_t': 'q', 'uint64_t': 'Q',
    'float': 'f', 'double': 'd',
    'bool': 'B', 'char': 'B',
}

# ==============================================================================
# Known GPS topic struct specs (hard-coded for reliability)
# ==============================================================================
# vehicle_global_position: 60 bytes (WingtraOne PX4 v2 variant - no delta_alt field)
# timestamp(Q,8) + timestamp_sample(Q,8) + lat(d,8) + lon(d,8) +
# alt(f,4) + alt_ellipsoid(f,4) + eph(f,4) + epv(f,4) + terrain_alt(f,4) +
# lat_lon_reset(B,1) + alt_reset(B,1) + terrain_valid(B,1) + dead_reckoning(B,1) +
# _padding0(4s,4)  =  8+8+8+8+4+4+4+4+4+1+1+1+1+4 = 60 bytes
VGP_FMT = '<QQddfffffBBBB4s'
VGP_SIZE_PAYLOAD = struct.calcsize(VGP_FMT)  # 60

# Standard PX4 v1.13+ variant with delta_alt field = 64 bytes
VGP_FMT_64 = '<QQddffffffBBBB4s'
VGP_SIZE_64 = struct.calcsize(VGP_FMT_64)    # 64

# ==============================================================================
# Format string helpers
# ==============================================================================
def parse_format_str(fmt_str):
    """'name:type1 field1;type2 field2;...' -> (name, [(type,name,arr_len), ...])"""
    parts = fmt_str.split(':')
    if len(parts) < 2:
        return None, []
    name = parts[0].strip()
    fields = []
    for f in ':'.join(parts[1:]).rstrip(';').split(';'):
        f = f.strip()
        if not f:
            continue
        tokens = f.split(' ')
        if len(tokens) >= 2:
            ft = tokens[0]
            fn = tokens[1]
            if '[' in ft:
                bt = ft[:ft.index('[')]
                al = int(ft[ft.index('[')+1:ft.index(']')])
                fields.append((bt, fn, al))
            else:
                fields.append((ft, fn, 1))
    return name, fields

def format_size(fields, all_fmts):
    total = 0
    for ft, fn, al in fields:
        if ft in TYPE_SIZES:
            total += TYPE_SIZES[ft] * al
        elif ft in all_fmts:
            sub = format_size(all_fmts[ft], all_fmts)
            if sub is None:
                return None
            total += sub * al
        else:
            return None
    return total

def unpack_fields(payload, fields, all_fmts, off=0):
    result = {}
    for ft, fn, al in fields:
        if ft in TYPE_STRUCTS:
            fc = TYPE_STRUCTS[ft]
            sz = TYPE_SIZES[ft]
            if al == 1:
                result[fn] = struct.unpack_from('<'+fc, payload, off)[0] if off+sz <= len(payload) else None
                off += sz
            else:
                vals = []
                for _ in range(al):
                    vals.append(struct.unpack_from('<'+fc, payload, off)[0] if off+sz <= len(payload) else None)
                    off += sz
                result[fn] = bytes(v for v in vals if v is not None).decode('utf-8','replace') if ft=='char' else vals
        elif ft in all_fmts:
            sub, off = unpack_fields(payload, all_fmts[ft], all_fmts, off)
            result[fn] = sub
        else:
            result[fn] = None
    return result, off

# ==============================================================================
# Standard forward-walk parser
# ==============================================================================
def parse_standard(data):
    """Parse ULog using correct forward message walk. Returns (formats, subs, data_msgs)."""
    pos = 16  # after header
    formats = {}
    subs = {}
    data_msgs = {}

    while pos + 3 <= len(data):
        sz = struct.unpack_from('<H', data, pos)[0]
        mt = data[pos + 2]
        if sz > 65535 or pos + 3 + sz > len(data):
            break
        payload = data[pos+3:pos+3+sz]

        if mt == ord('F'):
            try:
                s = payload.decode('utf-8', errors='strict').rstrip('\x00')
                n, flds = parse_format_str(s)
                if n:
                    formats[n] = flds
            except Exception:
                pass

        elif mt == ord('A'):
            if len(payload) >= 3:
                mid = struct.unpack_from('<H', payload, 1)[0]
                try:
                    nm = payload[3:].decode('utf-8', errors='strict').rstrip('\x00')
                    if nm.isidentifier():
                        subs[mid] = nm
                        data_msgs[mid] = []
                except Exception:
                    pass

        elif mt == ord('D'):
            if len(payload) >= 2:
                mid = struct.unpack_from('<H', payload, 0)[0]
                if mid in data_msgs:
                    data_msgs[mid].append(payload[2:])

        pos += 3 + sz

    return formats, subs, data_msgs

# ==============================================================================
# Targeted binary scan for WingtraOne/non-standard ULog v2
# ==============================================================================
def find_subscriptions(data):
    """Scan file for subscription ('A') messages to dynamically discover topic msg_ids."""
    targets = {
        b'vehicle_global_position\x00': 'vgp',
        b'vehicle_gps_position\x00': 'vgp_pos',
        b'sensor_gps\x00': 'sensor_gps',
        b'battery_status\x00': 'battery_status',
        b'vehicle_attitude\x00': 'vehicle_attitude',
        b'input_rc\x00': 'input_rc',
    }
    mids = {}
    n = len(data)
    i = 16
    while i < n - 30:
        if data[i+2] == 65: # ord('A')
            sz = data[i] + (data[i+1] << 8)
            if 5 <= sz <= 100 and i + 3 + sz <= n:
                payload = data[i+3 : i+3+sz]
                if len(payload) >= 3:
                    multi_id = payload[0]
                    msg_id = payload[1] + (payload[2] << 8)
                    name_bytes = payload[3:].split(b'\x00')[0]
                    if multi_id == 0:
                        for t_bytes, t_key in targets.items():
                            if t_bytes[:-1] == name_bytes:
                                mids[msg_id] = t_key
                                break
                i += 3 + sz
            else:
                i += 1
        else:
            i += 1
    return mids

def get_nearest_sample(ts, lst, idx_ptr):
    """Linear-time pointer advancement to find the nearest timestamp sample."""
    if not lst:
        return None, 0
    n_lst = len(lst)
    while idx_ptr < n_lst - 1:
        curr_diff = abs(lst[idx_ptr]['timestamp'] - ts)
        next_diff = abs(lst[idx_ptr+1]['timestamp'] - ts)
        if next_diff < curr_diff:
            idx_ptr += 1
        else:
            break
    return lst[idx_ptr], idx_ptr

def extract_gps(data, start_timestamp):
    """
    Scans ULog file in a single pass to collect telemetry data from multiple
    topics, aligns them to a uniform time-grid, and calibrates UTC time and AGL.
    """
    import datetime
    
    mids = find_subscriptions(data)
    if not mids:
        return None, []
        
    vgp_list = []
    gps_list = []
    bat_list = []
    att_list = []
    log_list = []
    
    n = len(data)
    i = 16
    D_BYTE = ord('D')
    L_BYTE = ord('L')
    C_BYTE = ord('C')
    A_BYTE = ord('A')
    F_BYTE = ord('F')
    I_BYTE = ord('I')

    EXPECTED_PAYLOAD_SIZES = {
        'vgp': (64, 60, 52),
        'vgp_pos': (120, 138, 140, 114),
        'battery_status': (128, 60),
        'vehicle_attitude': (49, 32),
        'sensor_gps': (114, 120, 138, 140),
    }
    
    while i < n - 3:
        sz = data[i] + (data[i+1] << 8)
        mt = data[i+2]
        
        # Sanity check if this is a valid message
        is_valid = False
        
        if mt == D_BYTE:
            if i + 5 <= n:
                mid = data[i+3] + (data[i+4] << 8)
                if mid in mids:
                    topic = mids[mid]
                    expected_lens = EXPECTED_PAYLOAD_SIZES.get(topic, [])
                    if (sz - 2) in expected_lens:
                        is_valid = True
                else:
                    if 2 <= sz <= 300:
                        is_valid = True
                        
        elif mt == L_BYTE:
            if 9 <= sz <= 200:
                is_valid = True
        elif mt == C_BYTE:
            if 11 <= sz <= 200:
                is_valid = True
        elif mt in (A_BYTE, F_BYTE, I_BYTE, ord('P'), ord('R'), ord('S'), ord('O')):
            if 2 <= sz <= 500:
                is_valid = True
                
        if is_valid and i + 3 + sz <= n:
            payload = data[i+3 : i+3+sz]
            
            if mt == D_BYTE:
                mid = payload[0] + (payload[1] << 8)
                if mid in mids:
                    topic = mids[mid]
                    raw = payload[2:]
                    
                    if topic == 'vgp':
                        if len(raw) == 64:
                            try:
                                vals = struct.unpack('<QQddffffffBBBB4s', raw)
                                vgp_list.append({
                                    'timestamp': vals[0], 'lat': vals[2], 'lon': vals[3],
                                    'alt_m': vals[4], 'alt_ell_m': vals[5], 'eph': vals[7], 'epv': vals[8]
                                })
                            except Exception: pass
                        elif len(raw) == 60:
                            try:
                                vals = struct.unpack('<QQddffffffBBBB', raw)
                                vgp_list.append({
                                    'timestamp': vals[0], 'lat': vals[2], 'lon': vals[3],
                                    'alt_m': vals[4], 'alt_ell_m': vals[5], 'eph': vals[7], 'epv': vals[8]
                                })
                            except Exception: pass
                        elif len(raw) == 52:
                            try:
                                vals = struct.unpack('<QQddfffffBBBB', raw)
                                vgp_list.append({
                                    'timestamp': vals[0], 'lat': vals[2], 'lon': vals[3],
                                    'alt_m': vals[4], 'alt_ell_m': vals[5], 'eph': vals[6], 'epv': vals[7]
                                })
                            except Exception: pass
                            
                    elif topic in ('vgp_pos', 'sensor_gps'):
                        if len(raw) == 120:
                            try:
                                vals = struct.unpack('<QQIiiiiffBffffiifffffBiQBffffB', raw)
                                gps_list.append({
                                    'timestamp': vals[0], 'time_utc_usec': vals[23],
                                    'satellites_used': vals[24], 'fix_type': vals[9]
                                })
                            except Exception: pass
                        elif len(raw) == 114:
                            try:
                                vals = struct.unpack('<QQIiiiiffffffiifffffifffIHBBBB', raw)
                                gps_list.append({
                                    'timestamp': vals[0], 'time_utc_usec': vals[1],
                                    'satellites_used': vals[29], 'fix_type': vals[26]
                                })
                            except Exception: pass
                        elif len(raw) == 140:
                            try:
                                vals = struct.unpack('<QQQQiiiiffffffiifffffiffffffBBBBBBBBBBBB', raw)
                                gps_list.append({
                                    'timestamp': vals[0], 'time_utc_usec': vals[1],
                                    'satellites_used': vals[32], 'fix_type': vals[29]
                                })
                            except Exception: pass
                        elif len(raw) == 138:
                            try:
                                vals = struct.unpack('<QQQQiiiiffffffiifffffiffffffBBBBBBBBBB', raw)
                                gps_list.append({
                                    'timestamp': vals[0], 'time_utc_usec': vals[1],
                                    'satellites_used': vals[32], 'fix_type': vals[29]
                                })
                            except Exception: pass
                            
                    elif topic == 'battery_status':
                        if len(raw) == 128:
                            try:
                                vals = struct.unpack('<Q20f2B10Hf10B4B', raw)
                                bat_list.append({
                                    'timestamp': vals[0], 'voltage_v': vals[1],
                                    'current_a': vals[3], 'remaining': vals[6]
                                })
                            except Exception: pass
                        elif len(raw) == 60:
                            try:
                                vals = struct.unpack('<QffffffffffffBBBB', raw)
                                bat_list.append({
                                    'timestamp': vals[0], 'voltage_v': vals[1],
                                    'current_a': vals[3], 'remaining': vals[6]
                                })
                            except Exception: pass
                            
                    elif topic == 'vehicle_attitude':
                        if len(raw) == 49:
                            try:
                                vals = struct.unpack('<QQffffffffB', raw)
                                att_list.append({
                                    'timestamp': vals[0], 'q': vals[2:6]
                                })
                            except Exception: pass
                            
            elif mt == L_BYTE:
                try:
                    ts = struct.unpack('<Q', payload[1:9])[0]
                    msg = payload[9:].decode('utf-8', errors='replace').rstrip('\x00')
                    log_list.append({'timestamp': ts, 'message': msg})
                except Exception: pass
                
            elif mt == C_BYTE:
                try:
                    ts = struct.unpack('<Q', payload[3:11])[0]
                    msg = payload[11:].decode('utf-8', errors='replace').rstrip('\x00')
                    log_list.append({'timestamp': ts, 'message': msg})
                except Exception: pass
                
            i += 3 + sz
        else:
            i += 1
        
    if not vgp_list:
        return None, []
        
    # Sort by timestamp
    vgp_list.sort(key=lambda x: x['timestamp'])
    gps_list.sort(key=lambda x: x['timestamp'])
    bat_list.sort(key=lambda x: x['timestamp'])
    att_list.sort(key=lambda x: x['timestamp'])
    log_list.sort(key=lambda x: x['timestamp'])
    
    # Takeoff reference
    takeoff_alt = vgp_list[0]['alt_m']
    
    # Calculate UTC Time Offset
    time_offset_us = None
    for g in gps_list:
        if g.get('time_utc_usec', 0) > 0:
            time_offset_us = g['time_utc_usec'] - g['timestamp']
            break
    if time_offset_us is None:
        # Fallback to file header timestamp
        time_offset_us = start_timestamp - vgp_list[0]['timestamp']
        
    gps_ptr = 0
    bat_ptr = 0
    att_ptr = 0
    log_ptr = 0
    prev_ts = 0
    
    rich_track = []
    
    for idx, vgp in enumerate(vgp_list):
        ts = vgp['timestamp']
        
        # UTC Datetime
        ts_utc_us = ts + time_offset_us
        dt = datetime.datetime.fromtimestamp(ts_utc_us / 1e6, datetime.timezone.utc)
        dt_str = dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Elapsed milliseconds
        elapsed_ms = int((ts - vgp_list[0]['timestamp']) / 1000)
        
        # Altitudes (AGL vs AMSL)
        amsl_m = vgp['alt_m']
        amsl_ft = amsl_m * 3.28084
        agl_m = amsl_m - takeoff_alt
        agl_ft = agl_m * 3.28084
        
        # Ascent calculation
        ascent_ft = 0.0
        if idx > 0:
            prev_pt = rich_track[-1]
            ascent_ft = max(0.0, agl_ft - prev_pt['height_above_takeoff_ft'])
            
        # Horizontal Speed & Distance
        speed_ms = 0.0
        dist_ft = 0.0
        if idx > 0:
            prev_pt = rich_track[-1]
            dt_s = (ts - prev_ts) / 1e6
            if dt_s > 0:
                dlat = (vgp['lat'] - prev_pt['lat']) * 111320
                dlon = (vgp['lon'] - prev_pt['lon']) * 111320 * math.cos(math.radians(vgp['lat']))
                dist_m = math.sqrt(dlat**2 + dlon**2)
                speed_ms = dist_m / dt_s
                # Limit speed spikes from GPS jump noise
                if speed_ms > 80.0:
                    speed_ms = prev_pt['speed_ms']
                dist_ft = speed_ms * dt_s * 3.28084
                
        speed_mph = speed_ms * 2.23694
        speed_knots = speed_ms * 1.94384
        
        # GPS satellites
        gps_pt, gps_ptr = get_nearest_sample(ts, gps_list, gps_ptr)
        sats = gps_pt['satellites_used'] if gps_pt else 0
        fix = gps_pt['fix_type'] if gps_pt else 0
        
        # Battery performance
        bat_pt, bat_ptr = get_nearest_sample(ts, bat_list, bat_ptr)
        voltage = bat_pt['voltage_v'] if bat_pt else 0.0
        current = bat_pt['current_a'] if bat_pt else 0.0
        remaining = bat_pt['remaining'] if bat_pt else 0.0
        
        # Euler Angles (Roll, Pitch, Heading)
        att_pt, att_ptr = get_nearest_sample(ts, att_list, att_ptr)
        roll = 0.0
        pitch = 0.0
        heading = 0.0
        if att_pt:
            qw, qx, qy, qz = att_pt['q']
            val = max(-1.0, min(1.0, 2.0 * (qw * qy - qz * qx)))
            pitch = math.degrees(math.asin(val))
            roll = math.degrees(math.atan2(2.0 * (qw * qx + qy * qz), 1.0 - 2.0 * (qx * qx + qy * qy)))
            yaw = math.degrees(math.atan2(2.0 * (qw * qz + qx * qy), 1.0 - 2.0 * (qy * qy + qz * qz)))
            heading = yaw % 360
            
        # Log message aggregation
        msgs = []
        while log_ptr < len(log_list):
            log_ts = log_list[log_ptr]['timestamp']
            if (idx == 0 and log_ts <= ts) or (idx > 0 and prev_ts < log_ts <= ts):
                clean_msg = log_list[log_ptr]['message'].replace('"', '""')
                msgs.append(clean_msg)
                log_ptr += 1
            else:
                break
        msg_str = " | ".join(msgs)
        
        rich_track.append({
            'timestamp_us': ts,
            'time_ms': elapsed_ms,
            'datetime_utc': dt_str,
            'lat': vgp['lat'],
            'lon': vgp['lon'],
            'height_above_takeoff_ft': agl_ft,
            'altitude_above_seaLevel_ft': amsl_ft,
            'altitude_m': amsl_m, # for KML/GPX
            'alt_m': amsl_m,      # alias for write_kml / write_gpx
            'ascent_ft': ascent_ft,
            'speed_mph': speed_mph,
            'speed_ms': speed_ms,
            'speed_knots': speed_knots,
            'dist_ft': dist_ft,
            'satellites': sats,
            'gpslevel': fix,
            'voltage_v': voltage,
            'current_a': current,
            'battery_percent': remaining * 100.0,
            'compass_heading': heading,
            'pitch': pitch,
            'roll': roll,
            'message': msg_str,
            'eph': vgp['eph'],
            'epv': vgp['epv'],
        })
        prev_ts = ts
        
    return 'vehicle_global_position', rich_track

def write_csv(track, path):
    headers = [
        'time(millisecond)', 'datetime(utc)', 'latitude', 'longitude',
        'height_above_takeoff(feet)', 'altitude_above_seaLevel(feet)', 'altitude(feet)', 'ascent(feet)',
        'speed(mph)', 'speed(m/s)', 'speed(knots)', 'distance(feet)',
        'satellites', 'gpslevel', 'voltage(v)', 'current(A)', 'battery_percent',
        'compass_heading(degrees)', 'pitch(degrees)', 'roll(degrees)', 'message'
    ]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(','.join(headers) + '\n')
        for pt in track:
            msg_val = pt['message']
            if msg_val:
                # Escape double quotes by doubling them and wrapping in quotes
                msg_val = msg_val.replace('"', '""')
                msg_val = f'"{msg_val}"'
            else:
                msg_val = ''
                
            row = [
                pt['time_ms'],
                pt['datetime_utc'],
                f"{pt['lat']:.8f}",
                f"{pt['lon']:.8f}",
                round(pt['height_above_takeoff_ft'], 2),
                round(pt['altitude_above_seaLevel_ft'], 2),
                round(pt['altitude_above_seaLevel_ft'], 2),
                round(pt['ascent_ft'], 2),
                round(pt['speed_mph'], 3),
                round(pt['speed_ms'], 3),
                round(pt['speed_knots'], 3),
                round(pt['dist_ft'], 2),
                pt['satellites'],
                pt['gpslevel'],
                round(pt['voltage_v'], 2),
                round(pt['current_a'], 2),
                round(pt['battery_percent'], 1),
                round(pt['compass_heading'], 1),
                round(pt['pitch'], 1),
                round(pt['roll'], 1),
                msg_val
            ]
            f.write(','.join(str(v) for v in row) + '\n')
    return True

def write_kml(track, path, name='Flight Path'):
    coords = '\n'.join(f'          {p["lon"]:.8f},{p["lat"]:.8f},{p["alt_m"]:.2f}' for p in track)
    kml = f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>{name}</name>
  <description>Converted from PX4 ULog by PUTA-Monitor</description>
  <Style id="line"><LineStyle><color>ffFF8C00</color><width>3</width></LineStyle></Style>
  <Style id="go"><IconStyle><color>ff00FF00</color><scale>1.2</scale></IconStyle></Style>
  <Style id="stop"><IconStyle><color>ff0000FF</color><scale>1.2</scale></IconStyle></Style>
  <Placemark>
    <name>Flight Path</name><styleUrl>#line</styleUrl>
    <LineString>
      <tessellate>1</tessellate><altitudeMode>absolute</altitudeMode>
      <coordinates>
{coords}
      </coordinates>
    </LineString>
  </Placemark>
  <Placemark><name>Takeoff</name><styleUrl>#go</styleUrl>
    <Point><coordinates>{track[0]["lon"]:.8f},{track[0]["lat"]:.8f},{track[0]["alt_m"]:.2f}</coordinates></Point>
  </Placemark>
  <Placemark><name>Landing</name><styleUrl>#stop</styleUrl>
    <Point><coordinates>{track[-1]["lon"]:.8f},{track[-1]["lat"]:.8f},{track[-1]["alt_m"]:.2f}</coordinates></Point>
  </Placemark>
</Document>
</kml>'''
    with open(path, 'w', encoding='utf-8') as f:
        f.write(kml)
    return True

def write_gpx(track, path, name='Flight'):
    trkpts = [
        f'    <trkpt lat="{p["lat"]:.8f}" lon="{p["lon"]:.8f}">\n'
        f'      <ele>{p["alt_m"]:.3f}</ele>\n'
        f'      <extensions><speed>{p["speed_ms"]:.3f}</speed></extensions>\n'
        f'    </trkpt>'
        for p in track
    ]
    gpx = f'''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PUTA-Monitor ULG Converter"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>{name}</name></metadata>
  <trk><name>{name}</name><trkseg>
{chr(10).join(trkpts)}
  </trkseg></trk>
</gpx>'''
    with open(path, 'w', encoding='utf-8') as f:
        f.write(gpx)
    return True

# ==============================================================================
# Main entry point
# ==============================================================================
def convert_ulg(input_path, output_dir=None, formats_out=None):
    if formats_out is None:
        formats_out = ['csv', 'kml', 'gpx']
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(input_path))
    base = os.path.splitext(os.path.basename(input_path))[0]

    try:
        with open(input_path, 'rb') as f:
            data = f.read()
    except Exception as e:
        return {'success': False, 'error': f'Cannot read file: {e}'}

    if data[:4] != b'ULog':
        return {'success': False, 'error': 'Not a valid ULog file.'}

    version = data[7]
    start_timestamp = struct.unpack('<Q', data[8:16])[0]
    gps_topic, track = extract_gps(data, start_timestamp)

    if not track:
        return {'success': False, 'error': 'No GPS data found in this ULog file.', 'ulog_version': version}

    alts = [p['alt_m'] for p in track]
    speeds = [p['speed_ms'] for p in track]
    lats = [p['lat'] for p in track]
    lons = [p['lon'] for p in track]
    dur = (track[-1]['timestamp_us'] - track[0]['timestamp_us']) / 1e6

    outputs = {}
    errors = []

    if 'csv' in formats_out:
        try:
            p = os.path.join(output_dir, base + '.csv')
            write_csv(track, p)
            outputs['csv'] = p
        except Exception as e:
            errors.append(f'CSV: {e}')

    if 'kml' in formats_out:
        try:
            p = os.path.join(output_dir, base + '.kml')
            write_kml(track, p, name=base)
            outputs['kml'] = p
        except Exception as e:
            errors.append(f'KML: {e}')

    if 'gpx' in formats_out:
        try:
            p = os.path.join(output_dir, base + '.gpx')
            write_gpx(track, p, name=base)
            outputs['gpx'] = p
        except Exception as e:
            errors.append(f'GPX: {e}')

    # Calculate exact AGL & AMSL metrics
    agls_ft = [p['height_above_takeoff_ft'] for p in track]
    amsls_ft = [p['altitude_above_seaLevel_ft'] for p in track]
    takeoff_amsl_ft = track[0]['altitude_above_seaLevel_ft']
    max_agl_ft = max(agls_ft)
    max_amsl_ft = max(amsls_ft)
    min_amsl_ft = min(amsls_ft)

    # Downsample time-series for smooth UI rendering (max 250 points)
    step = max(1, len(track) // 250)
    preview_points = []
    for p in track[::step]:
        preview_points.append({
            'time_min': round(p['time_ms'] / 60000.0, 2),
            'agl_ft': round(p['height_above_takeoff_ft'], 1),
            'amsl_ft': round(p['altitude_above_seaLevel_ft'], 1),
            'speed_knots': round(p['speed_knots'], 1),
            'speed_mph': round(p['speed_mph'], 1),
            'battery_pct': round(p['battery_percent'], 1),
            'voltage_v': round(p['voltage_v'], 2),
            'lat': p['lat'],
            'lon': p['lon'],
            'heading': round(p['compass_heading'], 1)
        })

    # Aviation Compliance Auditing (CASR Part 107 / PM 37)
    breach_400ft = max_agl_ft > 400.0
    speed_exceeded_87kts = max(p['speed_knots'] for p in track) > 87.0
    
    compliance = {
        'ceiling_limit_ft': 400.0,
        'max_agl_ft': round(max_agl_ft, 1),
        'ceiling_breach': breach_400ft,
        'speed_limit_knots': 87.0,
        'max_speed_knots': round(max(p['speed_knots'] for p in track), 1),
        'speed_breach': speed_exceeded_87kts,
        'takeoff_amsl_ft': round(takeoff_amsl_ft, 1),
        'takeoff_amsl_m': round(takeoff_amsl_ft / 3.28084, 1),
        'min_battery_pct': round(min(p['battery_percent'] for p in track), 1) if any(p['battery_percent'] > 0 for p in track) else None,
        'min_voltage_v': round(min(p['voltage_v'] for p in track), 2) if any(p['voltage_v'] > 0 for p in track) else None,
    }

    return {
        'success': True,
        'ulog_version': version,
        'gps_topic': gps_topic,
        'track_points': len(track),
        'duration_sec': round(dur, 1),
        'takeoff_amsl_ft': round(takeoff_amsl_ft, 1),
        'takeoff_amsl_m': round(takeoff_amsl_ft / 3.28084, 1),
        'max_agl_ft': round(max_agl_ft, 1),
        'max_agl_m': round(max_agl_ft / 3.28084, 1),
        'max_amsl_ft': round(max_amsl_ft, 1),
        'max_amsl_m': round(max_amsl_ft / 3.28084, 1),
        'min_amsl_ft': round(min_amsl_ft, 1),
        'max_altitude_m': round(max_amsl_ft / 3.28084, 2),
        'max_altitude_ft': round(max_amsl_ft, 2),
        'max_speed_ms': round(max(speeds), 2),
        'max_speed_kmh': round(max(speeds) * 3.6, 2),
        'max_speed_knots': round(max(speeds) * 1.943844, 2),
        'bounding_box': {'min_lat': round(min(lats),6), 'max_lat': round(max(lats),6),
                         'min_lon': round(min(lons),6), 'max_lon': round(max(lons),6)},
        'center_lat': round(sum(lats)/len(lats), 6),
        'center_lon': round(sum(lons)/len(lons), 6),
        'start_lat': track[0]['lat'],
        'start_lon': track[0]['lon'],
        'compliance': compliance,
        'preview_points': preview_points,
        'map_points': [[p['lat'], p['lon']] for p in track],
        'outputs': outputs,
        'errors': errors,
    }

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: ulg_converter.py <input.ulg> [output_dir] [csv,kml,gpx]'}))
        sys.exit(1)
    result = convert_ulg(
        sys.argv[1],
        sys.argv[2] if len(sys.argv) > 2 else None,
        sys.argv[3].split(',') if len(sys.argv) > 3 else None
    )
    print(json.dumps(result, ensure_ascii=False))
