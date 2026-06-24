import os
import json
import urllib.request
import urllib.error
import urllib.parse

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

def upload_pdf_to_supabase(file_path, year, file_name, supabase_url, supabase_key):
    """Uploads a PDF file to the Supabase Storage bucket 'permit-pdfs'."""
    bucket = "permit-pdfs"
    quoted_filename = urllib.parse.quote(file_name)
    storage_path = f"{year}/{quoted_filename}"
    upload_url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
    
    try:
        with open(file_path, 'rb') as f:
            file_data = f.read()
            
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/pdf",
            "x-upsert": "true"
        }
        
        req = urllib.request.Request(upload_url, data=file_data, headers=headers, method='POST')
        with urllib.request.urlopen(req) as response:
            if response.status in [200, 201]:
                print(f"  Successfully uploaded {file_name}")
            else:
                print(f"  Upload response status: {response.status}")
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8')
            err_json = json.loads(err_body)
            print(f"  HTTP ERROR uploading {file_name} (Status {e.code}): {err_json.get('message', err_body)}")
        except Exception:
            print(f"  HTTP ERROR uploading {file_name} (Status {e.code})")
    except Exception as e:
        print(f"  ERROR uploading {file_name}: {e}")

def ensure_bucket_exists(supabase_url, supabase_key):
    """Ensures the 'permit-pdfs' storage bucket exists, and creates it if it doesn't."""
    bucket_url = f"{supabase_url}/storage/v1/bucket"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    
    # First, list buckets to see if it exists
    try:
        req = urllib.request.Request(bucket_url, headers=headers, method='GET')
        with urllib.request.urlopen(req) as response:
            buckets = json.loads(response.read().decode('utf-8'))
            for b in buckets:
                if b.get('id') == 'permit-pdfs':
                    print("Supabase Storage bucket 'permit-pdfs' already exists.")
                    return True
    except Exception as e:
        print(f"Warning: Could not list buckets: {e}")
        
    # Create the bucket
    print("Attempting to create public Supabase Storage bucket 'permit-pdfs'...")
    payload = {
        "id": "permit-pdfs",
        "name": "permit-pdfs",
        "public": True
    }
    data_json = json.dumps(payload).encode('utf-8')
    try:
        req = urllib.request.Request(bucket_url, data=data_json, headers=headers, method='POST')
        with urllib.request.urlopen(req) as response:
            if response.status in [200, 201]:
                print("Successfully created public bucket 'permit-pdfs'!")
                return True
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8')
            print(f"Failed to create bucket (Status {e.code}): {err_body}")
        except Exception:
            print(f"Failed to create bucket (Status {e.code})")
    except Exception as e:
        print(f"Unexpected error creating bucket: {e}")
    return False

# Config Paths
PERMITS_JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'permits.json')
MARKDOWN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'markdown_permits')

def load_env():
    """Loads environment variables from a local .env file or data/Cred.env if it exists."""
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'Cred.env')
    ]
    for env_path in candidates:
        if os.path.exists(env_path):
            print(f"Loading environment variables from: {env_path}")
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        os.environ[key.strip()] = val.strip().strip('"').strip("'")
            break

def get_markdown_content(permit_id):
    """Reads the extracted markdown content for a given permit ID."""
    clean_id = permit_id.replace('/', '_').replace('\\', '_').replace(':', '_')
    md_path = os.path.join(MARKDOWN_DIR, f"{clean_id}.md")
    
    if os.path.exists(md_path):
        try:
            with open(md_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Remove null bytes (PostgreSQL does not support them in text fields)
                content = content.replace('\x00', '').replace('\u0000', '')
                # Optionally strip front matter
                if content.startswith('---'):
                    parts = content.split('---', 2)
                    if len(parts) >= 3:
                        return parts[2].strip()
                return content.strip()
        except Exception as e:
            print(f"WARNING: Failed to read markdown for {permit_id}: {e}")
    return None

def sync_to_supabase():
    load_env()
    
    supabase_url = os.environ.get('SUPABASE_URL')
    # Prefer Service Role key if writing/upserting to bypass RLS policies
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("\nERROR: Supabase credentials are not configured!")
        print("Please set the following environment variables or add them to a '.env' file in this directory:")
        print("  SUPABASE_URL=https://your-project-id.supabase.co")
        print("  SUPABASE_SERVICE_ROLE_KEY=your-service-role-api-key\n")
        return False
    
    # Standardize Supabase API URL format
    supabase_url = supabase_url.rstrip('/')
    rest_url = f"{supabase_url}/rest/v1/permits"
    
    if not os.path.exists(PERMITS_JSON_PATH):
        print(f"ERROR: Local database file not found: {PERMITS_JSON_PATH}")
        print("Please run 'python sync-pdf.py' first to populate local data.")
        return False
        
    print(f"Reading permits from: {PERMITS_JSON_PATH}...")
    with open(PERMITS_JSON_PATH, 'r', encoding='utf-8') as f:
        permits = json.load(f)
        
    print(f"Found {len(permits)} permits. Preparing to sync with Supabase...")
    
    def clean_val(v):
        if isinstance(v, str):
            return v.replace('\x00', '').replace('\u0000', '')
        if isinstance(v, list):
            return [clean_val(item) for item in v]
        if isinstance(v, dict):
            return {k: clean_val(val) for k, val in v.items()}
        return v

    payload = []
    for p in permits:
        # Load associated full text markdown
        md_text = get_markdown_content(p['permit_id'])
        
        payload.append({
            "permit_id": clean_val(p["permit_id"]),
            "operator_name": clean_val(p["operator_name"]),
            "location": clean_val(p["location"]),
            "year": int(p["year"]),
            "date_start": clean_val(p["date_start"]),
            "date_end": clean_val(p["date_end"]),
            "time_start": clean_val(p["time_start"]),
            "time_end": clean_val(p["time_end"]),
            "max_altitude_ft": int(p["max_altitude_ft"]),
            "coordinates": p["coordinates"], # stores array of [lat, lng]
            "pilot_name": clean_val(p["pilot_name"]),   # array of strings
            "puta_registry": clean_val(p["puta_registry"]), # array of strings
            "file_name": clean_val(p["file_name"]),
            "markdown_content": md_text
        })
        
    # JSON payload
    data_json = json.dumps(payload).encode('utf-8')
    
    # Headers for PostgREST Upsert (Prefer: resolution=merge-duplicates)
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"  # Tells Supabase to perform an UPSERT based on the primary key
    }
    
    print(f"Sending UPSERT request to: {rest_url}...")
    req = urllib.request.Request(rest_url, data=data_json, headers=headers, method='POST')
    
    try:
        with urllib.request.urlopen(req) as response:
            status = response.status
            print(f"SUCCESS: Supabase synchronization completed with HTTP status: {status}")
            
            # Synchronize PDF files to Supabase Storage bucket 'permit-pdfs'
            gdrive_folder = find_gdrive_folder()
            if gdrive_folder:
                ensure_bucket_exists(supabase_url, supabase_key)
                print(f"Found local PDF source folder: {gdrive_folder}")
                print("Uploading local PDF files to Supabase Storage...")
                for p in permits:
                    file_name = p.get('file_name')
                    year = p.get('year')
                    if not file_name or not year:
                        continue
                    
                    parsed_year = int(year)
                    if parsed_year == 2024:
                        rel_path = os.path.join('2024', file_name)
                    elif parsed_year == 2025:
                        rel_path = os.path.join('2025', file_name)
                    else:
                        rel_path = file_name
                        
                    full_path = os.path.join(gdrive_folder, rel_path)
                    if os.path.exists(full_path):
                        upload_pdf_to_supabase(full_path, year, file_name, supabase_url, supabase_key)
                    else:
                        print(f"  WARNING: PDF not found locally: {rel_path}")
            else:
                print("WARNING: Local PDF folder '6. KOBU VI - PADANG' not found. Skipping PDF uploads.")
            
            return True
    except urllib.error.HTTPError as e:
        print(f"HTTP ERROR: Failed to synchronize with Supabase (Status {e.code})")
        try:
            err_body = e.read().decode('utf-8')
            print(f"Response Body: {err_body}")
        except Exception:
            pass
        return False
    except urllib.error.URLError as e:
        print(f"CONNECTION ERROR: Failed to connect to Supabase: {e.reason}")
        return False
    except Exception as e:
        print(f"UNEXPECTED ERROR: {e}")
        return False

if __name__ == '__main__':
    sync_to_supabase()
