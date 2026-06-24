import os
import json
import urllib.request

# Configuration paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PERMITS_JSON_PATH = os.path.join(BASE_DIR, 'data', 'permits.json')
CRED_PATH = os.path.join(BASE_DIR, 'data', 'Cred.env')

def load_credentials():
    env = {}
    if os.path.exists(CRED_PATH):
        with open(CRED_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def list_files_in_folder(supabase_url, supabase_key, prefix):
    url = f"{supabase_url}/storage/v1/object/list/permit-pdfs"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "prefix": prefix,
        "limit": 100,
        "offset": 0,
        "sortBy": {
            "column": "name",
            "order": "asc"
        }
    }
    data_json = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data_json, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            items = json.loads(r.read().decode('utf-8'))
            files = []
            for item in items:
                name = item.get('name')
                if name and name.lower().endswith('.pdf') and item.get('metadata') is not None:
                    full_path = f"{prefix}/{name}" if prefix else name
                    files.append(full_path)
            return files
    except Exception as e:
        print(f"Error listing folder '{prefix}': {e}")
        return []

def delete_files_from_storage(supabase_url, supabase_key, file_paths):
    url = f"{supabase_url}/storage/v1/object/permit-pdfs"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "prefixes": file_paths
    }
    data_json = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data_json, headers=headers, method='DELETE')
    try:
        with urllib.request.urlopen(req) as r:
            res = json.loads(r.read().decode('utf-8'))
            return res
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8')
            print(f"HTTP ERROR deleting files (Status {e.code}): {err_body}")
        except Exception:
            print(f"HTTP ERROR deleting files (Status {e.code})")
        return None
    except Exception as e:
        print(f"Error deleting files: {e}")
        return None

def main():
    env = load_credentials()
    supabase_url = env.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        print("ERROR: Supabase credentials not found in Cred.env.")
        return

    if not os.path.exists(PERMITS_JSON_PATH):
        print(f"ERROR: permits.json not found at {PERMITS_JSON_PATH}")
        return

    with open(PERMITS_JSON_PATH, 'r', encoding='utf-8') as f:
        permits = json.load(f)

    # 1. Collect valid paths from permits.json
    valid_paths = set()
    for p in permits:
        file_name = p.get('file_name')
        year = p.get('year')
        if file_name and year:
            parsed_year = int(year)
            if parsed_year == 2024:
                path = f"2024/{file_name}"
            elif parsed_year == 2025:
                path = f"2025/{file_name}"
            else:
                path = file_name
            valid_paths.add(path)

    print(f"Found {len(valid_paths)} active files cataloged in permits.json.")

    # 2. List files currently in Supabase Storage
    print("Listing files in Supabase Storage bucket 'permit-pdfs'...")
    all_remote_files = []
    
    # List root directory
    all_remote_files.extend(list_files_in_folder(supabase_url, supabase_key, ""))
    # List 2024 directory
    all_remote_files.extend(list_files_in_folder(supabase_url, supabase_key, "2024"))
    # List 2025 directory
    all_remote_files.extend(list_files_in_folder(supabase_url, supabase_key, "2025"))

    print(f"Found {len(all_remote_files)} total files in remote storage.")

    # 3. Compare and find files to delete
    to_delete = []
    for remote_file in all_remote_files:
        if remote_file not in valid_paths:
            to_delete.append(remote_file)

    if not to_delete:
        print("No old files found. Storage bucket is already perfectly tidy!")
        return

    print(f"Found {len(to_delete)} old/untidied files to delete:")
    for path in to_delete:
        print(f"  - {path}")

    # 4. Perform bulk delete
    print("\nExecuting bulk delete of old files...")
    result = delete_files_from_storage(supabase_url, supabase_key, to_delete)
    print(f"Delete API response: {result}")
    if result is not None:
        print(f"Processed delete requests for {len(to_delete)} files.")
    else:
        print("FAILED: Failed to delete files.")

if __name__ == '__main__':
    main()
