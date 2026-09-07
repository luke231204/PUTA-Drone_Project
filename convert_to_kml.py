import os
import re
import sys
import json
import math
import traceback
import warnings
warnings.filterwarnings("ignore")
import pymupdf as fitz

def dms_str_to_dd(deg, mins, secs, direction):
    """Converts Degrees Minutes Seconds to Decimal Degrees."""
    try:
        dd = float(deg) + float(mins)/60.0 + float(secs)/3600.0
        if direction.upper() in ['S', 'W', 'LS', 'BB']:
            dd = -dd
        return round(dd, 6)
    except Exception:
        return 0.0

def parse_notam_text(full_text):
    """
    Parses standard ICAO NOTAM text into structured metadata and polygon areas.
    """
    # 1. NOTAM Number (e.g. B0598/26 NOTAMN)
    notam_no_m = re.search(r'([A-Z]\d{4}/\d{2}\s+NOTAM[NR])', full_text)
    notam_no = notam_no_m.group(1).strip() if notam_no_m else "UNKNOWN_NOTAM"

    # 2. Validity Schedule B) and C)
    b_m = re.search(r'B\)\s+(\d{10})', full_text)
    c_m = re.search(r'C\)\s+(\d{10})', full_text)
    d_m = re.search(r'D\)\s+([^\n\r]+)', full_text)
    
    valid_start = b_m.group(1) if b_m else ""
    valid_end = c_m.group(1) if c_m else ""
    daily_sched = d_m.group(1).strip() if d_m else ""

    # 3. Altitude Limits F) and G)
    f_m = re.search(r'F\)\s+([^\n\r]+?)\s+G\)\s+([^\n\r]+)', full_text)
    lower_limit = "SFC"
    upper_limit = "400FT AGL"
    max_alt_ft = 400

    if f_m:
        lower_limit = f_m.group(1).strip()
        upper_limit = f_m.group(2).strip()
        alt_num = re.search(r'(\d+)\s*(?:FT|M)', upper_limit, re.IGNORECASE)
        if alt_num:
            val = int(alt_num.group(1))
            if 'm' in upper_limit.lower() and 'ft' not in upper_limit.lower():
                max_alt_ft = int(val * 3.28084)
            else:
                max_alt_ft = val

    # 4. Extract E) block
    e_m = re.search(r'E\)\s+(.*?)(?=RMK:|F\)|Visualisasi|$)', full_text, re.DOTALL)
    e_text = e_m.group(1) if e_m else full_text

    # 5. Extract Areas and Coordinates line-by-line
    notam_coord_regex = re.compile(r'(\d{2})(\d{2})(\d{2})([SN])(\d{3})(\d{2})(\d{2})([EW])')

    areas = []
    current_name = None
    current_lines = []

    for line in e_text.splitlines():
        l_strip = line.strip()
        if not l_strip:
            continue
        # Check if line looks like an area section title (e.g. 'BELITUNG AREA', 'AREA A4')
        if re.search(r'\bAREA\b', l_strip, re.IGNORECASE) and not re.search(r'\d{6}[SN]', l_strip):
            if current_name and current_lines:
                coords = []
                for deg_lat, min_lat, sec_lat, hem_lat, deg_lon, min_lon, sec_lon, hem_lon in notam_coord_regex.findall('\n'.join(current_lines)):
                    lat = dms_str_to_dd(deg_lat, min_lat, sec_lat, hem_lat)
                    lon = dms_str_to_dd(deg_lon, min_lon, sec_lon, hem_lon)
                    coords.append([lat, lon])
                if coords:
                    areas.append({"name": current_name, "coordinates": coords})
                current_lines = []
            current_name = l_strip
        else:
            if current_name:
                current_lines.append(l_strip)

    if current_name and current_lines:
        coords = []
        for deg_lat, min_lat, sec_lat, hem_lat, deg_lon, min_lon, sec_lon, hem_lon in notam_coord_regex.findall('\n'.join(current_lines)):
            lat = dms_str_to_dd(deg_lat, min_lat, sec_lat, hem_lat)
            lon = dms_str_to_dd(deg_lon, min_lon, sec_lon, hem_lon)
            coords.append([lat, lon])
        if coords:
            areas.append({"name": current_name, "coordinates": coords})

    # Fallback if no specific section headers were found
    if not areas:
        coords = []
        for deg_lat, min_lat, sec_lat, hem_lat, deg_lon, min_lon, sec_lon, hem_lon in notam_coord_regex.findall(e_text):
            lat = dms_str_to_dd(deg_lat, min_lat, sec_lat, hem_lat)
            lon = dms_str_to_dd(deg_lon, min_lon, sec_lon, hem_lon)
            coords.append([lat, lon])
        if coords:
            areas.append({"name": "OPERATIONAL AREA", "coordinates": coords})

    # Operator identification
    op_guess = "Airspace Activity"
    if "timah" in full_text.lower():
        op_guess = "PT Timah Tbk"
    elif "hutan persada" in full_text.lower():
        op_guess = "PT Musi Hutan Persada"
    elif "hutama karya" in full_text.lower():
        op_guess = "PT Hutama Karya"
    elif "ptpn" in full_text.lower():
        op_guess = "PTPN IV PalmCo"

    return {
        "is_notam": True,
        "permit_id": notam_no,
        "operator": op_guess,
        "valid_start": valid_start,
        "valid_end": valid_end,
        "daily_schedule": daily_sched,
        "lower_limit": lower_limit,
        "upper_limit": upper_limit,
        "max_altitude_ft": max_alt_ft,
        "areas": areas
    }

def parse_regular_permit_text(full_text, file_path):
    """
    Parses standard Ministry/DNP permit letters.
    """
    cleaned_text = re.sub(r'\s+', ' ', full_text)
    
    # 1. Extract Permit Number
    actual_num_match = re.search(r'(\d{4}/APPROVAL-PUTA/DNP-202\d)', full_text, re.IGNORECASE)
    if actual_num_match:
        permit_id = actual_num_match.group(1).strip().upper()
    else:
        num_match = re.search(r'Nomor\s*:\s*([^\s\n\r,]+)', full_text, re.IGNORECASE)
        permit_id = num_match.group(1).strip() if num_match else "UNKNOWN_ID"
        
    # 2. Extract Operator Name
    operator = "Unknown Operator"
    op_match_page2 = re.search(r'Nama\s+Instansi\s*:?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if op_match_page2 and not any(kw in op_match_page2.group(1).lower() for kw in ['alamat', 'lokasi', 'maksud', 'waktu', 'pic']):
        operator = op_match_page2.group(1).strip()
    else:
        op_match_line = re.search(r'Yth\.\s+([^\n\r]+)', full_text, re.IGNORECASE)
        if op_match_line:
            operator = op_match_line.group(1).strip()
            
    # Clean operator name
    if "timah" in operator.lower():
        operator = "PT Timah Tbk"
    elif "agrinas" in operator.lower():
        operator = "PT Agrinas Palma Nusantara"
    elif "musi hutan" in operator.lower():
        operator = "PT Musi Hutan Persada"
    elif "perkebunan nusantara" in operator.lower() or "ptpn" in operator.lower():
        operator = "PTPN IV PalmCo"
    elif "hutama karya" in operator.lower():
        operator = "PT Hutama Karya"
    else:
        operator = re.sub(r'^(Division Head|Direktur Utama|Yth\.\s+Direktur\s+Utama|Yth\.\s+)\s*', '', operator, flags=re.IGNORECASE).strip()

    if not operator or operator == "Unknown Operator":
        base = os.path.basename(file_path)
        operator = base.split('.')[0]

    # 3. Extract Max Altitude
    max_alt = 400
    alt_match = re.search(
        r'(?:ketinggian|ceiling|ketinggian\s+maksimum)\s*(\d+)\s*(kaki|ft|feet|meter|m)',
        cleaned_text,
        re.IGNORECASE
    )
    if alt_match:
        val, unit = alt_match.groups()
        val = int(val)
        if unit.lower() in ['meter', 'm']:
            max_alt = int(val * 3.28084)
        else:
            max_alt = val

    # 4. Extract Coordinates (Regular DMS format or Decimal format)
    coords = []
    dms_pattern = re.compile(
        r'(\d+)\s*[°o*]?\s*(\d+)\s*\'?\s*(\d+(?:\.\d+)?)\s*"?\s*(LS|LU|S|N)\s*(?:[-–—:]|\s+)\s*(\d+)\s*[°o*]?\s*(\d+)\s*\'?\s*(\d+(?:\.\d+)?)\s*"?\s*(BT|BB|E|W)',
        re.IGNORECASE
    )
    for match in dms_pattern.finditer(full_text):
        lat_deg, lat_min, lat_sec, lat_dir, lng_deg, lng_min, lng_sec, lng_dir = match.groups()
        lat_dd = dms_str_to_dd(lat_deg, lat_min, lat_sec, lat_dir)
        lng_dd = dms_str_to_dd(lng_deg, lng_min, lng_sec, lng_dir)
        coords.append([lat_dd, lng_dd])

    if not coords:
        decimal_pattern = re.compile(r'(-?\d+\.\d+)\s*,\s*(1\d{2}\.\d+)')
        for match in decimal_pattern.finditer(full_text):
            lat, lng = match.groups()
            coords.append([float(lat), float(lng)])

    areas = []
    if coords:
        areas.append({
            "name": "PERMIT FLIGHT AREA",
            "coordinates": coords
        })

    return {
        "is_notam": False,
        "permit_id": permit_id,
        "operator": operator,
        "max_altitude_ft": max_alt,
        "lower_limit": "SFC",
        "upper_limit": f"{max_alt}FT AGL",
        "areas": areas
    }

def generate_kml_3d(data):
    """
    Generates rich 3D Google Earth KML with extruded polygon walls.
    """
    permit_id = data["permit_id"]
    operator = data["operator"]
    limit_alt_ft = data["max_altitude_ft"]
    limit_alt_m = round(limit_alt_ft * 0.3048, 1)
    areas = data.get("areas", [])

    placemarks_kml = ""

    # Palette styles for multiple areas (Red, Amber, Cyan)
    styles_kml = """
    <Style id="putaRedWall">
      <LineStyle>
        <color>ff0000ff</color>
        <width>3.0</width>
      </LineStyle>
      <PolyStyle>
        <color>600000ff</color> <!-- Semi-transparent Red Wall -->
      </PolyStyle>
    </Style>
    <Style id="putaAmberWall">
      <LineStyle>
        <color>ff00aaff</color>
        <width>3.0</width>
      </LineStyle>
      <PolyStyle>
        <color>6000aaff</color> <!-- Semi-transparent Amber Wall -->
      </PolyStyle>
    </Style>
    <Style id="putaCyanWall">
      <LineStyle>
        <color>ffffff00</color>
        <width>3.0</width>
      </LineStyle>
      <PolyStyle>
        <color>60ffff00</color> <!-- Semi-transparent Cyan Wall -->
      </PolyStyle>
    </Style>
    """

    style_ids = ["#putaRedWall", "#putaAmberWall", "#putaCyanWall"]

    for idx, area in enumerate(areas):
        area_name = area.get("name", f"Area {idx+1}")
        coords = area.get("coordinates", [])
        if not coords:
            continue

        style_url = style_ids[idx % len(style_ids)]
        
        # Format: lon,lat,alt_m
        pts_str_list = [f"{c[1]},{c[0]},{limit_alt_m}" for c in coords]
        # Ensure closed ring
        if pts_str_list[0] != pts_str_list[-1]:
            pts_str_list.append(pts_str_list[0])
            
        boundary_coords_str = "\n            ".join(pts_str_list)

        placemarks_kml += f"""
      <Placemark>
        <name>{area_name} ({limit_alt_ft} ft / {limit_alt_m} m)</name>
        <description><![CDATA[
          <h3>{operator}</h3>
          <p><b>Permit / NOTAM:</b> {permit_id}</p>
          <p><b>Airspace Ceiling:</b> {limit_alt_ft} FT ({data.get('upper_limit', '')})</p>
          <p><b>Lower Limit:</b> {data.get('lower_limit', 'SFC')}</p>
          <p><b>Total Boundary Vertices:</b> {len(coords)} points</p>
        ]]></description>
        <styleUrl>{style_url}</styleUrl>
        <Polygon>
          <extrude>1</extrude>
          <altitudeMode>relativeToGround</altitudeMode>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>
            {boundary_coords_str}
              </coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>"""

    if not placemarks_kml:
        pts = []
        center_lat, center_lon = -2.99, 104.76
        for i in range(37):
            angle = math.radians(i * 10)
            radial = 6000 / 6378137.0
            p_lat = math.asin(math.sin(math.radians(center_lat))*math.cos(radial) + math.cos(math.radians(center_lat))*math.sin(radial)*math.cos(angle))
            p_lon = math.radians(center_lon) + math.atan2(math.sin(angle)*math.sin(radial)*math.cos(math.radians(center_lat)), math.cos(radial)-math.sin(math.radians(center_lat))*math.sin(p_lat))
            pts.append(f"{math.degrees(p_lon)},{math.degrees(p_lat)},{limit_alt_m}")
        fallback_str = "\n            ".join(pts)
        placemarks_kml = f"""
      <Placemark>
        <name>Approximate Reference Airspace ({limit_alt_ft} ft)</name>
        <description>Notice: Exact vertex points were not found in document text.</description>
        <styleUrl>#putaAmberWall</styleUrl>
        <Polygon>
          <extrude>1</extrude>
          <altitudeMode>relativeToGround</altitudeMode>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>
            {fallback_str}
              </coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>"""

    kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>PUTA Airspace Volume - {permit_id}</name>
    <description><![CDATA[
      <b>3D Segregated Airspace Corridor for Google Earth Pro</b><br/>
      Operator: {operator}<br/>
      Authority: Kantor Otoritas Bandar Udara Wilayah VI Padang / Perum LPPNPI
    ]]></description>
    {styles_kml}
    <Folder>
      <name>{permit_id} Airspace Boundaries</name>
      {placemarks_kml}
    </Folder>
  </Document>
</kml>"""
    return kml

def parse_file(file_path):
    doc = fitz.open(file_path)
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"

    # Check if this document is an ICAO NOTAM
    if "NOTAM" in full_text and ("Q)" in full_text or "WIIF" in full_text or "WAAF" in full_text):
        parsed = parse_notam_text(full_text)
    else:
        parsed = parse_regular_permit_text(full_text, file_path)

    return parsed

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No file path provided."}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"success": False, "error": f"File not found: {file_path}"}))
        sys.exit(1)
        
    try:
        parsed_data = parse_file(file_path)
        kml_string = generate_kml_3d(parsed_data)

        total_coords = sum(len(a.get("coordinates", [])) for a in parsed_data.get("areas", []))
        all_flattened_coords = []
        for a in parsed_data.get("areas", []):
            all_flattened_coords.extend(a.get("coordinates", []))

        result = {
            "success": True,
            "is_notam": parsed_data.get("is_notam", False),
            "permit_id": parsed_data["permit_id"],
            "operator": parsed_data["operator"],
            "max_altitude_ft": parsed_data["max_altitude_ft"],
            "lower_limit": parsed_data.get("lower_limit", "SFC"),
            "upper_limit": parsed_data.get("upper_limit", f"{parsed_data['max_altitude_ft']}FT AGL"),
            "coords_count": total_coords,
            "areas": parsed_data.get("areas", []),
            "coordinates": all_flattened_coords,
            "kml_content": kml_string
        }
        print(json.dumps(result))
        
    except Exception as e:
        error_msg = str(e)
        tb = traceback.format_exc()
        sys.stderr.write(tb)
        print(json.dumps({"success": False, "error": error_msg}))
        sys.exit(1)
