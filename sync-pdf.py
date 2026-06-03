import os
import re
import json
import traceback
from pypdf import PdfReader

# Configuration
PERMITS_JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'permits.json')

MONTHS_ID = {
    'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
    'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
    'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
}

def find_gdrive_folder():
    """Auto-discovers the synced Google Drive folder for KOBU VI Padang."""
    user_profile = os.environ.get('USERPROFILE', 'C:\\Users\\lukma')
    candidates = [
        r"G:\My Drive\6. KOBU VI - PADANG",
        r"G:\Drive Saya\6. KOBU VI - PADANG",
        os.path.join(user_profile, r"Google Drive\My Drive\6. KOBU VI - PADANG"),
        os.path.join(user_profile, r"Google Drive\Drive Saya\6. KOBU VI - PADANG"),
        os.path.join(user_profile, r"OneDrive\Documents\Project Latsar\6. KOBU VI - PADANG"),
        r"c:\Users\lukma\Downloads\6. KOBU VI - PADANG",
        # Allow running in the current directory if it's placed there
        os.path.join(os.getcwd(), "6. KOBU VI - PADANG"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

def parse_indonesian_date(date_str):
    """Converts Indonesian date string like '16 Januari 2026' into ISO format '2026-01-16'."""
    if not date_str:
        return None
    try:
        parts = date_str.lower().split()
        if len(parts) == 3:
            day = parts[0].zfill(2)
            month_name = parts[1]
            year = parts[2]
            month = MONTHS_ID.get(month_name, '01')
            return f"{year}-{month}-{day}"
    except Exception:
        pass
    return date_str

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
    Extracts coordinate points from the PDF text.
    Handles both Decimal format (e.g. -6.1751, 106.8272)
    and DMS formats (e.g. 03°15'30" LS - 104°30'00" BT).
    """
    coords = []
    
    # 1. Look for DMS coordinate patterns: degrees° minutes' seconds" Direction (LS/LU/BT/BB)
    # E.g., 03° 15' 30" LS - 104° 30' 00" BT
    dms_pattern = re.compile(
        r'(\d+)\s*°\s*(\d+)\s*\'\s*(\d+(?:\.\d+)?)\s*"?\s*(LS|LU|S|N)\s*[-–—:]\s*(\d+)\s*°\s*(\d+)\s*\'\s*(\d+(?:\.\d+)?)\s*"?\s*(BT|BB|E|W)',
        re.IGNORECASE
    )
    
    for match in dms_pattern.finditer(text):
        lat_deg, lat_min, lat_sec, lat_dir, lng_deg, lng_min, lng_sec, lng_dir = match.groups()
        lat_dd = dms_to_dd(lat_deg, lat_min, lat_sec, lat_dir)
        lng_dd = dms_to_dd(lng_deg, lng_min, lng_sec, lng_dir)
        coords.append([lat_dd, lng_dd])
        
    if coords:
        return coords

    # 2. Look for Decimal coordinate patterns: -1.2345, 104.5678
    decimal_pattern = re.compile(r'(-?\d+\.\d+)\s*,\s*(1\d{2}\.\d+)')
    for match in decimal_pattern.finditer(text):
        lat, lng = match.groups()
        coords.append([float(lat), float(lng)])
        
    return coords

def clean_name(name_str):
    # If the string contains a colon, take everything after the last one
    if ':' in name_str:
        name_str = name_str.split(':')[-1]
    
    # Split by list numbers e.g. "1.", "2.", "6."
    nums_split = re.split(r'\b\d+\s*[\.,]\s*', name_str)
    if nums_split:
        if nums_split[-1].strip() == '' and len(nums_split) > 1:
            name_str = nums_split[-2]
        else:
            name_str = nums_split[-1]
        
    name_str = re.sub(r'^[^A-Za-z]+', '', name_str)
    name_str = re.sub(r'[^A-Za-z]+$', '', name_str)
    name_str = re.sub(r'[^A-Za-z\s\.\-]', '', name_str)
    name_clean = name_str.strip()
    words = name_clean.split()
    if not words:
        return None
    name_clean = ' '.join([w.capitalize() for w in words])
    return name_clean

def is_valid_pilot_name(name):
    if not name:
        return False
        
    # Remove dots, dashes, and spaces, and check length of raw alphabetic characters
    raw_alpha = re.sub(r'[^A-Za-z]', '', name)
    if len(raw_alpha) < 3:
        return False
        
    # Check for consecutive dashes (noise from drone registrations in OCR)
    if '--' in name or '---' in name:
        return False
        
    words = name.split()
    
    # Exact match forbidden words
    forbidden_exact = {
        'sertifikat', 'asuransi', 'polis', 'page', 'document', 'tembusan', 'persetujuan', 'penerbangan',
        'perum', 'lppnpi', 'cabang', 'general', 'manager', 'direktur', 'kepala', 'kantor', 'otoritas',
        'bandar', 'udara', 'wilayah', 'padang', 'minangkabau', 'palembang', 'surat', 'nomor', 'tanggal',
        'status', 'ada', 'keterangan', 'pilot', 'puta', 'atasnama', 'nama', 'instansi', 'alamat', 'lokasi',
        'maksud', 'tujuan', 'waktu', 'pic', 'telepon', 'fax', 'pos', 'kotak', 'medan', 'merdeka', 'barat',
        'biasa', 'berkas', 'perihal', 'permohonan', 'pengoperasian', 'pesawat', 'tanpa', 'awak', 'untuk',
        'kegiatan', 'pengukuran', 'pemetaan', 'provinsi', 'jambi', 'sumatera', 'selatan', 'tol', 'jalan',
        'kayu', 'agung', 'tungkal', 'jaya', 'hutan', 'persada', 'perkebunan', 'nusantara', 'agro', 'timah',
        'tbk', 'dnp', 'approval', 'jakarta', 'dengan', 'dan', 'atau', 's.d', 's/d', 'terhadap', 'wajib',
        'peraturan', 'perundang', 'undangan', 'kelaikudaraan', 'operasi', 'keselamatan', 'keamanan',
        'standardisasi', 'aeronautika', 'pusat', 'informasi', 'regional', 'asuransi', 'msig', 'jasa', 'tania',
        'berlakutan', 'glppnpkmp', 'tan', 'polis', 'tertanggung'
    }
    
    # Substring forbidden words (mostly drone brands, models, and months)
    forbidden_sub = {
        'wingra', 'wingtra', 'trinity', 'believer', 'mapper', 'vtol', 'skywalker', 'hero',
        'bds', 'farm', 'talon', 'dji', 'phantom', 'matrice', 'rtk', 'januari', 'februari', 'maret',
        'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'
    }
    
    for w in words:
        w_lower = w.lower()
        if w_lower in forbidden_exact:
            return False
        if any(sub in w_lower for sub in forbidden_sub):
            return False
            
    return True

def extract_operator_from_filename(filename):
    # Strip leading numbers in parentheses like "(2) "
    name = re.sub(r'^\(\d+\)\s*', '', filename)
    # Strip prefixes like "Persetujuan " or "Perizinan PUTA " or "Perizinan "
    name = re.sub(r'^(Persetujuan|Perizinan PUTA|Perizinan)\s+', '', name, flags=re.IGNORECASE)
    # Split by common delimiters that separate the operator name from the location / metadata
    delimiters = [r'\s+di\s+', r'\s+-\s+', r'_', r'\s*\(', r',']
    for delim in delimiters:
        parts = re.split(delim, name, flags=re.IGNORECASE)
        if parts:
            name = parts[0]
    return name.strip()

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

def ocr_scanned_pdf(file_path):
    """Performs WinRT native OCR on a scanned PDF on Windows."""
    try:
        import asyncio
        import io
        from PIL import Image
        from winrt.windows.storage import StorageFile, FileAccessMode
        from winrt.windows.graphics.imaging import BitmapDecoder
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.globalization import Language
    except ImportError:
        print("WARNING: winrt or pillow is not installed. Native OCR skipped.")
        return ""

    async def run_ocr():
        temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'ocr_temp')
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)
            
        try:
            lang = Language("id-ID")
            engine = OcrEngine.try_create_from_language(lang)
        except Exception:
            engine = None
            
        if not engine:
            try:
                engine = OcrEngine.try_create_from_user_profile_languages()
            except Exception:
                engine = None
                
        if not engine:
            try:
                engine = OcrEngine.try_create_from_language(Language("en-US"))
            except Exception:
                engine = None
                
        if not engine:
            print("WARNING: Could not initialize Windows OCR engine.")
            return ""
            
        reader = PdfReader(file_path)
        full_text = ""
        
        for idx, page in enumerate(reader.pages):
            page_text = ""
            for img_idx, img_obj in enumerate(page.images):
                try:
                    img = Image.open(io.BytesIO(img_obj.data))
                    temp_img_path = os.path.join(temp_dir, f"temp_{os.path.basename(file_path)}_{idx}_{img_idx}.jpg")
                    img.convert('RGB').save(temp_img_path, format='JPEG')
                    
                    # Run OCR
                    file = await StorageFile.get_file_from_path_async(temp_img_path)
                    stream = await file.open_async(FileAccessMode.READ)
                    decoder = await BitmapDecoder.create_async(stream)
                    bitmap = await decoder.get_software_bitmap_async()
                    result = await engine.recognize_async(bitmap)
                    page_text += result.text + "\n"
                    
                    if os.path.exists(temp_img_path):
                        os.remove(temp_img_path)
                except Exception as e:
                    print(f"ERROR: OCR failed on page {idx+1} in {os.path.basename(file_path)}: {e}")
            full_text += f"\n--- Page {idx+1} ---\n" + page_text
            
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
        print(f"WARNING: Async OCR run failed: {e}")
        return ""

def parse_pdf_permit(file_path, file_year):
    """Reads PDF and extracts permit fields via Regex."""
    print(f"Reading PDF: {os.path.basename(file_path)}...")
    reader = PdfReader(file_path)
    full_text = ""
    for page in reader.pages:
        text = page.extract_text()
        if text:
            full_text += text + "\n"
            
    # Check if this is a scanned PDF (very little text extracted)
    if len(full_text.strip()) < 100:
        ocr_text = ocr_scanned_pdf(file_path)
        if ocr_text:
            full_text = ocr_text
            
    # Clean whitespace for easier regex matching
    cleaned_text = re.sub(r'\s+', ' ', full_text)
    
    # --- 1. Extract Permit Number ---
    num_match = re.search(r'Nomor\s*:\s*([^\s\n\r,]+)', full_text, re.IGNORECASE)
    permit_id = num_match.group(1).strip() if num_match else "UNKNOWN_ID"
    if permit_id.endswith('/'):
        permit_id = permit_id[:-1]
    
    # Fallback to look for the structured permit ID pattern in the full text
    actual_num_match = re.search(r'(\d{4}/APPROVAL-PUTA/DNP-202\d)', full_text, re.IGNORECASE)
    if actual_num_match:
        permit_id = actual_num_match.group(1).strip().upper()
        
    operator = "Unknown Operator"
    
    # Primary: Look for "Nama Instansi : [Name]" on Page 2 (handling optional colon)
    # Reject if it captured the layout row containing multiple label headers
    op_match_page2 = re.search(r'Nama\s+Instansi\s*:?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if op_match_page2 and not any(kw in op_match_page2.group(1).lower() for kw in ['alamat', 'lokasi', 'maksud', 'waktu', 'pic', 'instansi', 'kelengkapan']):
        operator = op_match_page2.group(1).strip()
    else:
        # Fallback to Page 1 recipient "Yth. [Name]"
        op_match_line = re.search(r'Yth\.\s+([^\n\r]+)', full_text, re.IGNORECASE)
        if op_match_line:
            operator = op_match_line.group(1).strip()
        else:
            op_match1 = re.search(r'Yth\.\s+Direktur\s+Utama\s+(PT\s+[A-Z0-9\s\.\-_]+|CV\s+[A-Z0-9\s\.\-_]+)', cleaned_text, re.IGNORECASE)
            op_match2 = re.search(r'kepada\s+(PT\s+[A-Z0-9\s\.\-_]+|CV\s+[A-Z0-9\s\.\-_]+)', cleaned_text, re.IGNORECASE)
            if op_match1:
                operator = op_match1.group(1).strip()
            elif op_match2:
                operator = op_match2.group(1).strip()
            else:
                op_match3 = re.search(r'(PT\s+[A-Z][A-Z0-9\s\.\-_]{3,})', cleaned_text)
                if op_match3:
                    operator = op_match3.group(1).strip()
                    
    # Clean operator name and check fallback
    operator = clean_operator_name(operator)
    if not operator or operator == "Unknown Operator" or len(operator) > 80 or any(kw in operator.lower() for kw in ['alamat', 'lokasi', 'maksud', 'waktu', 'pic', 'instansi', 'kelengkapan']):
        extracted_op = extract_operator_from_filename(os.path.basename(file_path))
        operator = clean_operator_name(extracted_op)
    
    # --- 3. Extract Location ---
    location = "Unknown Location"
    
    # Primary: Look for "Lokasi Pengoperasian PUTA : [Location]" on Page 2
    loc_match_page2 = re.search(r'Lokasi\s+Pengoperasian\s*(?:PUTA)?\s*:?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if loc_match_page2:
        location = loc_match_page2.group(1).strip()
    else:
        # Fallback to Page 1
        loc_match = re.search(r'berlokasi\s+di\s+([A-Za-z0-9\s\.\-_,]+?)\s+pada\s+tanggal', cleaned_text, re.IGNORECASE)
        if loc_match:
            location = loc_match.group(1).strip()
            
    # Fallback to extract location from filename if it remains unknown, is too long, or contains layout headers
    if (location == "Unknown Location" or len(location) > 80 or 
            any(kw in location.lower() for kw in ['maksud', 'waktu', 'pic', 'kelengkapan', 'dokumen', 'persyaratan', 'nama instansi', 'alamat instansi', 'hasil verifikasi'])):
        fn_match1 = re.search(r'\bdi\s+([^(_\-\d]+)', os.path.basename(file_path), re.IGNORECASE)
        fn_match2 = re.search(r'-\s*([^(_\d]+)_KOBU', os.path.basename(file_path), re.IGNORECASE)
        if fn_match1:
            location = fn_match1.group(1).strip()
        elif fn_match2:
            location = fn_match2.group(1).strip()
            
    # Clean operator name trailing words if fallback matched extra text
    location = re.split(r'\s+(yang|di|dalam|untuk|nomor|tanggal|menindaklanjuti)\s+', location, flags=re.IGNORECASE)[0]
    
    # --- 4. Extract Date Window ---
    date_start = None
    date_end = None
    
    # Primary: Look for Page 2 time window: "16 Januari 2026 - 16 Januari 2026"
    date_match_page2 = re.search(
        r'Waktu\s+Pengoperasian\s*:\s*([0-9]+\s+[A-Za-z]+\s+[0-9]{4})\s*-\s*([0-9]+\s+[A-Za-z]+\s+[0-9]{4})',
        full_text,
        re.IGNORECASE
    )
    if date_match_page2:
        date_start = parse_indonesian_date(date_match_page2.group(1).strip())
        date_end = parse_indonesian_date(date_match_page2.group(2).strip())
    else:
        # Fallback to Page 1
        date_match = re.search(
            r'pada\s+tanggal\s+([0-9]+\s+[A-Za-z]+\s+[0-9]{4})\s+s\.d\.?\s+([0-9]+\s+[A-Za-z]+\s+[0-9]{4})',
            cleaned_text,
            re.IGNORECASE
        )
        if date_match:
            date_start = parse_indonesian_date(date_match.group(1).strip())
            date_end = parse_indonesian_date(date_match.group(2).strip())
        else:
            # Look for split-year fallback pattern: "tanggal 11 Februari s.d. 05 Agustus 2025"
            split_date_match = re.search(
                r'pada\s+tanggal\s+(\d+)\s+([A-Za-z]+)\s+(?:s\.d\.?|sampai|s\.d|s\.d\.)\s+(\d+)\s+([A-Za-z]+)\s+(\d{4})',
                cleaned_text,
                re.IGNORECASE
            )
            if split_date_match:
                d1, m1, d2, m2, y = split_date_match.groups()
                date_start = parse_indonesian_date(f"{d1} {m1} {y}")
                date_end = parse_indonesian_date(f"{d2} {m2} {y}")
            else:
                single_date_match = re.search(r'pada\s+tanggal\s+([0-9]+\s+[A-Za-z]+\s+[0-9]{4})', cleaned_text, re.IGNORECASE)
                if single_date_match:
                    parsed_date = parse_indonesian_date(single_date_match.group(1).strip())
                    date_start = parsed_date
                    date_end = parsed_date
            
    # --- 5. Extract Time Window ---
    time_start = "08:00"
    time_end = "17:00"
    
    # Try matching standard range e.g. "08:00 WIB - 17:00 WIB"
    time_match_page2 = re.search(
        r'(\d{2})[\.:](\d{2})\s*(?:WIB|WITA|WIT)?\s*-\s*(\d{2})[\.:](\d{2})\s*(WIB|WITA|WIT)?',
        full_text,
        re.IGNORECASE
    )
    if time_match_page2:
        h1, m1, h2, m2, tz = time_match_page2.groups()
        time_start = f"{h1}:{m1}"
        time_end = f"{h2}:{m2}"
        if tz:
            time_start += f" {tz.upper()}"
            time_end += f" {tz.upper()}"
    else:
        # Fallback to Page 1 "s.d." format
        time_match = re.search(
            r'(?:pukul|jam)?\s*(\d{2})[\.:](\d{2})\s*(?:WIB|WITA|WIT)?\s*(?:s\.d\.?|sampai)\s*(\d{2})[\.:](\d{2})\s*(WIB|WITA|WIT)?',
            cleaned_text,
            re.IGNORECASE
        )
        if time_match:
            h1, m1, h2, m2, tz = time_match.groups()
            time_start = f"{h1}:{m1}"
            time_end = f"{h2}:{m2}"
            if tz:
                time_start += f" {tz.upper()}"
                time_end += f" {tz.upper()}"
            
    # --- 6. Extract Max Altitude ---
    max_alt = 400 # Default ceiling
    alt_match = re.search(
        r'(?:ketinggian|ceiling|ketinggian\s+maksimum)\s*(\d+)\s*(kaki|ft|feet|meter|m)',
        cleaned_text,
        re.IGNORECASE
    )
    if alt_match:
        val, unit = alt_match.groups()
        val = int(val)
        if unit.lower() in ['meter', 'm']:
            max_alt = int(val * 3.28084) # Convert meters to feet
        else:
            max_alt = val
            
    # --- 7. Extract Coordinate Points ---
    coords = extract_coordinates(full_text)
    
    # --- 8. Extract Pilot PUTA and PUTA Registry ---
    pilots = []
    registrations = []
    
    # Split cleaned text by Indonesian date patterns to find names preceding "Berlaku"
    date_regex = re.compile(
        r'\b(?:\d{1,2}\s+)?(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Oct|Nov|Dec|Se\s+tember|A\s+stus|A\s+ril|Desember|Des)\s+202\d\b',
        re.IGNORECASE
    )
    parts = date_regex.split(cleaned_text)
    for part in parts:
        kw_match = re.search(r'\b(?:Berlaku|Exp|sampai|sam\s*ai)\b', part, re.IGNORECASE)
        if kw_match:
            name_text = part[:kw_match.start()]
            c_name = clean_name(name_text)
            if c_name and is_valid_pilot_name(c_name) and c_name not in pilots:
                pilots.append(c_name)
        else:
            c_name = clean_name(part)
            if c_name and is_valid_pilot_name(c_name) and c_name not in pilots:
                pilots.append(c_name)
                
    # Fallback to single pilot regex
    if not pilots:
        single_pilot = re.search(r'Pilot\s+PUTA\s+(?:atas\s*nama|atas\s*nama\s*:)\s*([^\n\r\(\)]+)', full_text, re.IGNORECASE)
        if single_pilot:
            c = clean_name(single_pilot.group(1))
            if c and is_valid_pilot_name(c):
                pilots.append(c)
                
    # Extract registrations
    reg_pattern = re.compile(r'\b([A-Z]{2,3}\s*-\s*[A-Z0-9]{2,3}\s*-\s*[0-9A-Z]\s*-\s*[A-Z0-9]{3,4})\b', re.IGNORECASE)
    for match in reg_pattern.finditer(cleaned_text):
        reg_id = re.sub(r'\s+', '', match.group(1)).upper()
        if reg_id not in registrations:
            registrations.append(reg_id)
            
    # Fallback registry search
    if not registrations:
        direct_reg = re.search(r'Registrasi\s+PUTA\s*:\s*([A-Za-z0-9\-]+)', full_text, re.IGNORECASE)
        if direct_reg:
            reg_id = direct_reg.group(1).strip().upper()
            if reg_id not in registrations:
                registrations.append(reg_id)

    # Business logic override for Ismanto
    if operator.lower() == "ismanto" and location == "Pl Jabung":
        location = "Pl Sekernan"

    # Construct structured record
    permit_data = {
        "permit_id": permit_id,
        "operator_name": operator,
        "location": location,
        "year": file_year,
        "date_start": date_start or f"{file_year}-01-01",
        "date_end": date_end or f"{file_year}-12-31",
        "time_start": time_start,
        "time_end": time_end,
        "max_altitude_ft": max_alt,
        "coordinates": coords,
        "pilot_name": pilots,
        "puta_registry": registrations,
        "file_name": os.path.basename(file_path)
    }
    
    return permit_data

def sync_all_permits():
    gdrive_dir = find_gdrive_folder()
    if not gdrive_dir:
        print("ERROR: Synced Google Drive folder '6. KOBU VI - PADANG' could not be found!")
        print("Please ensure your Google Drive for Desktop is running and synced, or place a copy of the folder in your working directory.")
        return False
        
    print(f"Syncing from Google Drive folder: {gdrive_dir}")
    
    permits = []
    
    # Traverse directory based on rules:
    # Subfolders 2024, 2025 -> years 2024, 2025
    # Files directly in root directory -> year 2026
    for root, dirs, files in os.walk(gdrive_dir):
        # We only want to look at root, and subfolders 2024 / 2025
        rel_path = os.path.relpath(root, gdrive_dir)
        
        # Determine year
        if rel_path == '.':
            file_year = 2026
        elif rel_path == '2024':
            file_year = 2024
        elif rel_path == '2025':
            file_year = 2025
        else:
            # Skip any other subdirectories
            continue
            
        for file in files:
            if file.lower().endswith('.pdf'):
                pdf_path = os.path.join(root, file)
                try:
                    permit_info = parse_pdf_permit(pdf_path, file_year)
                    permits.append(permit_info)
                except Exception as e:
                    print(f"WARNING: Failed to parse {file}: {str(e)}")
                    traceback.print_exc()
                    
    print(f"\nSuccessfully parsed {len(permits)} drone permit letters.")
    
    # Print a summary table
    print("\nSummary of Extracted Permits:")
    print("-" * 105)
    print(f"{'Year':<5} | {'Permit ID':<30} | {'Operator':<30} | {'Coords Count':<12} | {'File Name'}")
    print("-" * 105)
    for p in sorted(permits, key=lambda x: (x['year'], x['permit_id'])):
        coords_count = len(p['coordinates'])
        coords_str = f"{coords_count} points" if coords_count > 0 else "0 (WARNING)"
        print(f"{p['year']:<5} | {p['permit_id'][:30]:<30} | {p['operator_name'][:30]:<30} | {coords_str:<12} | {p['file_name']}")
    print("-" * 105)
    
    # --- Write to permits.json ---
    output_dir = os.path.dirname(PERMITS_JSON_PATH)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    print(f"\nWriting structured data to: {PERMITS_JSON_PATH}...")
    with open(PERMITS_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(permits, f, indent=2)
        
    print("Database sync completed successfully!")
    return True

if __name__ == '__main__':
    sync_all_permits()
