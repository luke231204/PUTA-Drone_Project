# PUTA Permit & Storage Standardization Guide

This document outlines the standard operating procedures for renaming, uploading, and managing drone clearance permits within the PUTA-Monitor system.

---

## 1. PDF Filename Standardization

Clearance PDFs must follow a uniform naming convention. This makes the shared Google Drive tidy and ensures the Electron app can link files and metadata perfectly.

### Standard Format:
`{Year} - {Operator Name} - {Location} - {Cleaned Permit ID}.pdf`

* **Example:** `2026 - PT TORTUGA XCEL DYNAMICS - Ogan Komering Ilir - 0006.pdf`
* **Subdirectory Rules:**
  * **2024 Permits:** Placed inside the `2024/` folder.
  * **2025 Permits:** Placed inside the `2025/` folder.
  * **2026 Permits:** Placed directly in the root directory.

### Automation Tool:
Run the renaming script locally to instantly clean up all new files and update the local index:
```bash
python rename_permits.py
```
*(This script reads the metadata inside `data/permits.json` and physically renames the local files on disk/Google Drive).*

---

## 2. Database & Cloud Storage Uploads

After local files are renamed and `data/permits.json` is updated, the changes must be pushed to Supabase.

### Prerequisite Environment Variables:
Ensure `data/Cred.env` or `.env` has the correct endpoints and keys:
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-public-key
```

### Necessary Supabase Storage Policies:
In your Supabase Dashboard, create a **Public** storage bucket named **`permit-pdfs`** and configure folder RLS policies for `public`/`anon` roles to allow:
* **`SELECT`** (so users can download/open PDFs).
* **`INSERT` / `Upload`** (so the upload script can store files).
* **`DELETE`** (so the cleanup script can prune old files).

### Synchronization:
Run the upload script to push both database records and PDF files to the cloud:
```bash
python upload_to_supabase.py
```
*(This script updates the `permits` database table and uploads the physical PDFs directly to the `permit-pdfs` Storage bucket).*

---

## 3. Storage Optimization & Cleanup

Because Supabase free tiers have a **1GB Storage Limit**, old files with messy names should be removed when new ones are uploaded.

Run the cleanup script to compare remote storage files against your local `permits.json` catalog and delete orphan files in bulk:
```bash
python cleanup_storage.py
```
*(This script lists remote files and deletes any file not referenced in `permits.json`, instantly reclaiming space).*
