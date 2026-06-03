# Implementation Plan: Google Drive PDF Permit Sync Pipeline

This plan details the implementation of a Python sync script (`sync-pdf.py`) designed to parse drone operation permission letters from your synced Google Drive folders and populate the dashboard's `mockData.js`.

---

## User Review Required

> [!IMPORTANT]
> **Folder Traversal Logic:**
> * Files in the `2024` subfolder will be categorized under the year **2024**.
> * Files in the `2025` subfolder will be categorized under the year **2025**.
> * PDF files directly in the root directory (not in subfolders) will be categorized under the year **2026**.

---

## Proposed Changes

### Sync Engine

#### [NEW] [sync-pdf.py](file:///c:/Users/lukma/OneDrive/Documents/Project%20Latsar/dasilawas-web/sync-pdf.py)
This script will:
1. Scan the configured Google Drive path recursively.
2. Filter folders and assign the year accordingly (`2024`, `2025`, and `2026` for root).
3. Read the text from each PDF using a lightweight Python library (e.g., `pypdf`).
4. Extract the following metadata fields:
   * `nomor_surat` (Permit number, e.g., `0006/APPROVAL-PUTA/DNP-2026`)
   * `nama_operator` (Operator name, e.g., `PT TORTUGA XCEL DYNAMICS`)
   * `lokasi` (Operating location, e.g., `Ogan Komering Ilir`)
   * `tanggal_mulai` and `tanggal_selesai` (Start/End dates)
   * `waktu_mulai` and `waktu_selesai` (Time window, e.g., `07:00 WIB` to `17:30 WIB`)
5. Format the extracted data array and write/update it in [mockData.js](file:///c:/Users/lukma/OneDrive/Documents/Project%20Latsar/dasilawas-web/src/data/mockData.js) as `export const DRONE_PERMITS_LIST = [...]`.

---

## Extraction Approach

We have two options for parsing the PDF text:
1. **Option 1: Regex Parser (Traditional/Offline)**
   Uses predefined regular expressions to capture the fields from the standard "Kementerian Perhubungan" letter layout.
2. **Option 2: Gemini API Parser (AI-powered / Robust)**
   Calls the Gemini Python SDK to read the extracted text and output a structured JSON schema. This is highly robust against any formatting changes in the letter templates.

Please let us know which option you prefer!

---

## Verification Plan

### Automated Verification
* Run `python sync-pdf.py` and inspect the console logs to see if it successfully finds the folders and extracts the text fields.
* Verify that [mockData.js](file:///c:/Users/lukma/OneDrive/Documents/Project%20Latsar/dasilawas-web/src/data/mockData.js) is successfully updated with the new array.
* Ensure the React application starts up and renders without compilation errors.
