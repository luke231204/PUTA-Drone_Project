import os
import re
import sys
import json
import traceback
from pypdf import PdfReader

# Configuration and mappings from sync-pdf.py
MONTHS_ID = {
    'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
    'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
    'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
}

def dms_to_dd(deg, mins, secs, direction):
    """Converts Degrees Minutes Seconds to Decimal Degrees."""
    try:
        dd = float(deg) + float(mins)/60.0 + float(secs)/3600.0
        if direction.upper() in ['S', 'W', 'LS', 'BB']:
            dd = -dd
        return round(dd, 6)
    except Exception:
        return 0.0

def extract_coordinates(text):
    """
    Extracts coordinate points from text.
    Handles both Decimal and DMS formats.
    """
    coords = []
    
    # 1. Look for DMS coordinates (lenient symbols, allowing spaces or newlines as separator)
    dms_pattern = re.compile(
        r'(\d+)\s*[°o*]?\s*(\d+)\s*\'?\s*(\d+(?:\.\d+)?)\s*"?\s*(LS|LU|S|N)\s*(?:[-–—:]|\s+)\s*(\d+)\s*[°o*]?\s*(\d+)\s*\'?\s*(\d+(?:\.\d+)?)\s*"?\s*(BT|BB|E|W)',
        re.IGNORECASE
    )
    for match in dms_pattern.finditer(text):
        lat_deg, lat_min, lat_sec, lat_dir, lng_deg, lng_min, lng_sec, lng_dir = match.groups()
        lat_dd = dms_to_dd(lat_deg, lat_min, lat_sec, lat_dir)
        lng_dd = dms_to_dd(lng_deg, lng_min, lng_sec, lng_dir)
        coords.append([lat_dd, lng_dd])
        
    if coords:
        return coords

    # 2. Look for Decimal coordinates
    decimal_pattern = re.compile(r'(-?\d+\.\d+)\s*,\s*(1\d{2}\.\d+)')
    for match in decimal_pattern.finditer(text):
        lat, lng = match.groups()
        coords.append([float(lat), float(lng)])
        
    return coords

def clean_operator_name(op_name):
    if "timah" in op_name.lower():
        return "PT Timah Tbk"
    if "agrinas" in op_name.lower():
        return "PT Agrinas Palma Nusantara"
    if "musi hutan" in op_name.lower():
        return "PT Musi Hutan Persada"
    if "perkebunan nusantara" in op_name.lower() or "ptpn 1" in op_name.lower() or "ptpn i" in op_name.lower():
        return "PTPN I"
    if "hutama karya" in op_name.lower():
        return "PT Hutama Karya"
        
    op_name = re.sub(r'^(Division Head Exploration & Production|Deputy Coorporate Legal Division Head|SEVP Business Support|Direktur Utama|Yth\.\s+Direktur\s+Utama|Yth\.\s+)\s*', '', op_name, flags=re.IGNORECASE)
    op_name = re.sub(r'\s+\(Persero\)$', '', op_name, flags=re.IGNORECASE)
    return op_name.strip()

def ocr_single_image(file_path):
    """Runs Windows native OCR on a PNG/JPG image file."""
    try:
        import asyncio
        from PIL import Image
        from winrt.windows.storage import StorageFile, FileAccessMode
        from winrt.windows.graphics.imaging import BitmapDecoder
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.globalization import Language
    except ImportError:
        return ""

    async def run_ocr():
        try:
            lang = Language("id-ID")
            engine = OcrEngine.try_create_from_language(lang)
        except Exception:
            engine = None
        if not engine:
            engine = OcrEngine.try_create_from_user_profile_languages()
        if not engine:
            engine = OcrEngine.try_create_from_language(Language("en-US"))
        if not engine:
            return ""

        file = await StorageFile.get_file_from_path_async(file_path)
        stream = await file.open_async(FileAccessMode.READ)
        decoder = await BitmapDecoder.create_async(stream)
        bitmap = await decoder.get_software_bitmap_async()
        result = await engine.recognize_async(bitmap)
        return result.text

    try:
        import asyncio
        try:
            loop = asyncio.get_running_loop()
            is_running = True
        except RuntimeError:
            is_running = False
            
        if is_running:
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, run_ocr()).result()
        else:
            return asyncio.run(run_ocr())
    except Exception as e:
        sys.stderr.write(f"OCR Exception: {str(e)}\n")
        return ""

def ocr_scanned_pdf(file_path):
    """Performs WinRT native OCR on scanned PDF pages."""
    try:
        import asyncio
        import io
        from PIL import Image
        from winrt.windows.storage import StorageFile, FileAccessMode
        from winrt.windows.graphics.imaging import BitmapDecoder
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.globalization import Language
    except ImportError:
        return ""

    async def run_ocr():
        temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'ocr_temp_conv')
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)
            
        try:
            lang = Language("id-ID")
            engine = OcrEngine.try_create_from_language(lang)
        except Exception:
            engine = None
        if not engine:
            engine = OcrEngine.try_create_from_user_profile_languages()
        if not engine:
            engine = OcrEngine.try_create_from_language(Language("en-US"))
        if not engine:
            return ""
            
        reader = PdfReader(file_path)
        full_text = ""
        
        for idx, page in enumerate(reader.pages):
            page_text = ""
            for img_idx, img_obj in enumerate(page.images):
                try:
                    img = Image.open(io.BytesIO(img_obj.data))
                    temp_img_path = os.path.join(temp_dir, f"conv_{idx}_{img_idx}.jpg")
                    img.convert('RGB').save(temp_img_path, format='JPEG')
                    
                    file = await StorageFile.get_file_from_path_async(temp_img_path)
                    stream = await file.open_async(FileAccessMode.READ)
                    decoder = await BitmapDecoder.create_async(stream)
                    bitmap = await decoder.get_software_bitmap_async()
                    result = await engine.recognize_async(bitmap)
                    page_text += result.text + "\n"
                    
                    if os.path.exists(temp_img_path):
                        os.remove(temp_img_path)
                except Exception as e:
                    sys.stderr.write(f"Page image OCR failed: {str(e)}\n")
            full_text += page_text + "\n"
            
        try:
            if os.path.exists(temp_dir) and not os.listdir(temp_dir):
                os.rmdir(temp_dir)
        except Exception:
            pass
            
        return full_text

    try:
        import asyncio
        try:
            loop = asyncio.get_running_loop()
            is_running = True
        except RuntimeError:
            is_running = False
            
        if is_running:
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, run_ocr()).result()
        else:
            return asyncio.run(run_ocr())
    except Exception as e:
        sys.stderr.write(f"Async OCR failed: {str(e)}\n")
        return ""

def parse_document(file_path):
    """Reads PDF or Image and extracts coordinates, ceilings and metadata."""
    ext = os.path.splitext(file_path)[1].lower()
    full_text = ""
    
    if ext in ['.png', '.jpg', '.jpeg', '.bmp', '.tiff']:
        full_text = ocr_single_image(file_path)
    elif ext == '.pdf':
        reader = PdfReader(file_path)
        for page in reader.pages:
            text = page.extract_text()
            if text:
                full_text += text + "\n"
        if len(full_text.strip()) < 100:
            full_text = ocr_scanned_pdf(file_path)
    else:
        raise ValueError(f"Unsupported file format: {ext}")

    cleaned_text = re.sub(r'\s+', ' ', full_text)
    
    # 1. Extract Permit Number
    num_match = re.search(r'Nomor\s*:\s*([^\s\n\r,]+)', full_text, re.IGNORECASE)
    permit_id = num_match.group(1).strip() if num_match else "UNKNOWN_ID"
    actual_num_match = re.search(r'(\d{4}/APPROVAL-PUTA/DNP-202\d)', full_text, re.IGNORECASE)
    if actual_num_match:
        permit_id = actual_num_match.group(1).strip().upper()
        
    # 2. Extract Operator Name
    operator = "Unknown Operator"
    op_match_page2 = re.search(r'Nama\s+Instansi\s*:?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if op_match_page2 and not any(kw in op_match_page2.group(1).lower() for kw in ['alamat', 'lokasi', 'maksud', 'waktu', 'pic']):
        operator = op_match_page2.group(1).strip()
    else:
        op_match_line = re.search(r'Yth\.\s+([^\n\r]+)', full_text, re.IGNORECASE)
        if op_match_line:
            operator = op_match_line.group(1).strip()
            
    operator = clean_operator_name(operator)
    if not operator or operator == "Unknown Operator":
        # Guess from file name
        base = os.path.basename(file_path)
        operator = clean_operator_name(base.split('.')[0])

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

    # 4. Extract Coordinates
    coords = extract_coordinates(full_text)
    
    return {
        "permit_id": permit_id,
        "operator": operator,
        "max_altitude_ft": max_alt,
        "coordinates": coords or []
    }

def generate_kml_circle(center, radius_m, limit_alt_m):
    """Generates coordinate path for fallback circle."""
    lat, lng = center
    points = []
    number_of_points = 36
    earth_radius = 6378137
    
    lat_rad = lat * Math.PI / 180 if 'Math' in globals() else lat * 3.14159265 / 180
    # Let's use python math module
    import math
    lat_rad = math.radians(lat)
    lng_rad = math.radians(lng)
    
    for i in range(number_of_points + 1):
        angle = math.radians(i * 360 / number_of_points)
        radial = radius_m / earth_radius
        
        point_lat_rad = math.asin(
            math.sin(lat_rad) * math.cos(radial) +
            math.cos(lat_rad) * math.sin(radial) * math.cos(angle)
        )
        
        point_lng_rad = lng_rad + math.atan2(
            math.sin(angle) * math.sin(radial) * math.cos(lat_rad),
            math.cos(radial) - math.sin(lat_rad) * math.sin(point_lat_rad)
        )
        
        point_lat = math.degrees(point_lat_rad)
        point_lng = math.degrees(point_lng_rad)
        points.append(f"{point_lng},{point_lat},{limit_alt_m}")
        
    return "\n".join(points)

def generate_kml(permit_id, operator, limit_alt_ft, coords):
    limit_alt_m = limit_alt_ft * 0.3048
    boundary_coordinates_str = ""
    
    if coords and len(coords) > 0:
        boundary_coordinates_str = "\n".join(f"{c[1]},{c[0]},{limit_alt_m}" for c in coords) + \
                                   f"\n{coords[0][1]},{coords[0][0]},{limit_alt_m}"
    else:
        # Fallback circle center - Palembang coords as default center if none found
        boundary_coordinates_str = generate_kml_circle([-2.99, 104.76], 6000, limit_alt_m)

    kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>PUTA Airspace Limit - {permit_id}</name>
    <description>Extracted 3D Safety Boundary for Google Earth - Operator: {operator}</description>
    
    <Style id="redPolygon">
      <LineStyle>
        <color>ff0000ff</color> <!-- Red border -->
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>400000ff</color> <!-- Semi-transparent Red Wall -->
      </PolyStyle>
    </Style>
    
    <Placemark>
      <name>Permit Airspace Volume: {limit_alt_ft}ft AGL</name>
      <description>Extracted Operating ceiling boundary for {operator}</description>
      <styleUrl>#redPolygon</styleUrl>
      <Polygon>
        <extrude>1</extrude>
        <altitudeMode>relativeToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
{boundary_coordinates_str}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>"""
    return kml

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No file path provided."}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"success": False, "error": f"File not found: {file_path}"}))
        sys.exit(1)
        
    try:
        parsed_data = parse_document(file_path)
        
        kml_string = generate_kml(
            parsed_data["permit_id"],
            parsed_data["operator"],
            parsed_data["max_altitude_ft"],
            parsed_data["coordinates"]
        )
        
        result = {
            "success": True,
            "permit_id": parsed_data["permit_id"],
            "operator": parsed_data["operator"],
            "max_altitude_ft": parsed_data["max_altitude_ft"],
            "coords_count": len(parsed_data["coordinates"]),
            "kml_content": kml_string
        }
        print(json.dumps(result))
        
    except Exception as e:
        error_msg = str(e)
        # Grab traceback stack
        tb = traceback.format_exc()
        sys.stderr.write(tb)
        print(json.dumps({"success": False, "error": error_msg}))
        sys.exit(1)
