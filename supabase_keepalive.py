import os
import json
import urllib.request
import urllib.error

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

def keep_alive():
    load_env()
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("ERROR: Supabase credentials are not configured!")
        return False
        
    supabase_url = supabase_url.rstrip('/')
    # Query the permits table for just 1 ID to generate database activity.
    url = f"{supabase_url}/rest/v1/permits?select=permit_id&limit=1"
    
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    
    print(f"Sending keep-alive request to: {url}...")
    req = urllib.request.Request(url, headers=headers, method='GET')
    
    try:
        with urllib.request.urlopen(req) as response:
            status = response.status
            body = response.read().decode('utf-8')
            print(f"SUCCESS: Supabase keep-alive successful. Status: {status}")
            print(f"Response: {body}")
            return True
    except urllib.error.HTTPError as e:
        print(f"HTTP ERROR: Failed to contact Supabase (Status {e.code})")
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
    keep_alive()
