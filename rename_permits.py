import os
import json
import re

PERMITS_JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'permits.json')

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

def clean_filename_str(s):
    """Clean string to be safe for filenames by replacing illegal characters."""
    s = re.sub(r'[\/*?:"<>|]', '_', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip().strip('.')

def main():
    gdrive = find_gdrive_folder()
    if not gdrive:
        print("ERROR: Google Drive folder not found!")
        return

    if not os.path.exists(PERMITS_JSON_PATH):
        print(f"ERROR: permits.json not found at {PERMITS_JSON_PATH}")
        return

    with open(PERMITS_JSON_PATH, 'r', encoding='utf-8') as f:
        permits = json.load(f)

    print(f"Loaded {len(permits)} permits. Renaming local files...")

    updated_permits = []
    renamed_count = 0

    for p in permits:
        file_name = p.get('file_name')
        year = p.get('year')
        if not file_name or not year:
            updated_permits.append(p)
            continue

        parsed_year = int(year)
        if parsed_year == 2024:
            rel_dir = '2024'
        elif parsed_year == 2025:
            rel_dir = '2025'
        else:
            rel_dir = ''

        # Current full path
        old_rel_path = os.path.join(rel_dir, file_name)
        old_full_path = os.path.join(gdrive, old_rel_path)

        # Generate new name: year - operator - location - permit_number.pdf
        op = clean_filename_str(p.get('operator_name', 'Unknown'))
        loc = clean_filename_str(p.get('location', 'Unknown'))
        pid = p.get('permit_id', 'Unknown')
        num = pid.split('/')[0].strip()
        num_clean = clean_filename_str(num)

        new_file_name = f"{year} - {op} - {loc} - {num_clean}.pdf"
        new_rel_path = os.path.join(rel_dir, new_file_name)
        new_full_path = os.path.join(gdrive, new_rel_path)

        # If it exists at the old location, rename it
        if os.path.exists(old_full_path):
            if old_full_path != new_full_path:
                try:
                    # If target already exists, delete it first to prevent duplicate errors
                    if os.path.exists(new_full_path):
                        os.remove(new_full_path)
                    os.rename(old_full_path, new_full_path)
                    print(f"Renamed: '{file_name}' -> '{new_file_name}'")
                    renamed_count += 1
                except Exception as e:
                    print(f"Error renaming '{file_name}': {e}")
            else:
                print(f"Already correctly named: '{new_file_name}'")
        else:
            # Check if it was already renamed (exists at the new location)
            if os.path.exists(new_full_path):
                print(f"File already renamed: '{new_file_name}'")
            else:
                print(f"WARNING: File not found locally: '{old_rel_path}'")

        # Update permit record in JSON
        p['file_name'] = new_file_name
        updated_permits.append(p)

    # Save permits.json back
    with open(PERMITS_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(updated_permits, f, indent=2, ensure_ascii=False)

    print(f"Successfully processed {len(permits)} permits. Renamed {renamed_count} files.")
    print("Saved updated permits.json.")

if __name__ == '__main__':
    main()
