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

---

## 4. Software Versioning & Release Lifecycle Standardization (SemVer)

To prevent confusion among evaluators, mentors, and inspectors, PUTA-Monitor adheres to a standardized **Semantic Versioning (SemVer 2.0.0)** lifecycle adapted for internal government innovation and civil service accreditation:

### Format:
$$\mathbf{vMAJOR.MINOR.PATCH\ [-TAG]}$$

* **MAJOR (`v1.x.x` $\rightarrow$ `v2.x.x`)**:
  - Incremented **ONLY** upon full production migration, complete architectural overhaul, or when a previous version is officially decommissioned.
  - *Current Status:* Since PUTA-Monitor is an innovative pilot project for OTBAN Wilayah VI, the system is within the **`v1.x.x`** generation.
* **MINOR (`v1.4.x` $\rightarrow$ `v1.5.0`)**:
  - Incremented whenever **new functional features or capabilities** are added (e.g., adding DJI Wasm Engine, 4D Flight Replay HUD, Multi-Block Geometry, or Spatial Conflict Matrix).
* **PATCH (`v1.5.0` $\rightarrow$ `v1.5.1`)**:
  - Incremented for **bug fixes, UI alignment, data corrections**, or small optimizations that do not add new major features.
* **RELEASE TAG**:
  - **`-beta` / `Pilot Release`**: Used during the internal evaluation, field testing with senior inspectors, and Latsar examination stage (current stage).
  - **`Stable Release`**: Used when the system is officially signed off and deployed as the mandatory daily standard operating software across all evaluator desks in OTBAN Wilayah VI.

### Unified Version Matrix Across the Project:
Whenever the version changes, update the following files simultaneously:
1. `package.json` $\rightarrow$ `"version": "1.5.0"`
2. `index.html` $\rightarrow$ Top bar tag, Header badge, and Developer Info modal (`v1.5.0 (Pilot Release)`).
3. `CHANGELOG.md` $\rightarrow$ Create a corresponding entry `## [1.5.0] - YYYY-MM-DD`.
4. `JAWABAN_LAPORAN_AKTUALISASI_LATSAR.md` $\rightarrow$ Reflect active version in executive summary.

