# JAWABAN KOMPREHENSIF & KLARIFIKASI DATA TEKNIS LAPORAN AKTUALISASI LATSAR CPNS 2026
**Nama Peserta:** Lukman Yudand Hidayat, S.Tr.T.  
**NIP:** 20030422 202512 1 003 (Golongan III/a)  
**Jabatan:** Pengevaluasi Penerbangan  
**Unit Kerja:** Kantor Otoritas Bandar Udara Kelas II Wilayah VI Padang  
**Gagasan / Inovasi:** PUTA-Monitor (*Universal Flight Log & Drone Permit Oversight System*)  
**Dokumen Rujukan:** `gemini-code-1788633196228.md`  

---

## ⚠️ KLARIFIKASI PENTING (REALITAS PROYEK VS. PERTANYAAN AWAL)

Sebelum masuk ke rincian per bab, terdapat beberapa **asumsi dalam pertanyaan awal yang perlu diluruskan agar sesuai 100% dengan apa yang sebenarnya kita bangun di lapangan**:

1. **Bukan Hanya PX4 `.ulg`, Melainkan *Dual-Engine Universal Flight Inspector* (PX4 & DJI):**
   * *Asumsi awal:* Aplikasi hanya memproses file PX4 `.ulg` via Python `pyulog`.
   * *Fakta Realisasi:* Di lapangan, mayoritas drone operasional industri (seperti pada kasus pengawasan PT. Timah Bangka) menggunakan **DJI Enterprise / Consumer** (Mavic 2/3, Matrice 300/350). Oleh karena itu, kita telah membangun **Dual-Engine Architecture**:
     - **Engine 1 (PX4/Wingtra):** Menggunakan `ulg_converter.py` berbasis Python.
     - **Engine 2 (DJI Flight Record):** Menggunakan `dji_parser.js` berbasis Rust WebAssembly (`dji-log-parser-js`) yang mampu mendeskripsi log DJI terenkripsi AES (v13+) dan memiliki *Offline Keychain Vault*.
     - **Smart Auto-Detect:** Sistem mengenali biner file secara otomatis tanpa inspektur harus memilih manual.

2. **Cakupan Wilayah Udara: Seluruh 11 Bandara OTBAN Wilayah VI (Bukan Hanya BIM/Padang):**
   * *Asumsi awal:* Geofence KKOP hanya untuk Bandara Internasional Minangkabau (BIM / WIEE).
   * *Fakta Realisasi:* Otoritas Bandar Udara Wilayah VI membawahi 5 provinsi (Sumbar, Jambi, Bengkulu, Sumsel, Babel). Sistem telah memetakan **11 bandara resmi** dengan parameter ICAO/IATA terkoreksi, radius lateral KKOP 5.000 m (5 km), serta *Emergency Tower Contact* otomatis (AirNav Padang, Palembang, Jambi, Bengkulu, Pangkalpinang, Tanjungpandan).

3. **Fitur Inovatif Baru: Interactive 4D Flight Replay & Dual Virtual RC Sticks HUD:**
   * Selain sekadar grafik statis dan konversi file (CSV/KML/GPX), sistem telah dilengkapi:
     - **Replay Bar Interaktif:** Play/Pause, timeline slider, pengatur kecepatan ($1\times, 2\times, 5\times, 10\times$), dan live telemetry AGL & Speed.
     - **Virtual RC Joystick HUD:** Mensimulasikan gerakan tuas fisik remote pilot di lapangan (Throttle/Yaw & Pitch/Roll) yang dinormalisasi dari sinyal 11-bit PWM ($364 \dots 1684$).

---

## SECTION 1: ARCHITECTURAL & CODE UPDATES (GAGASAN & INOVASI)

### 1. Core Stack & Versi Dependensi Riil
* **Desktop Runtime:** `Electron` v42.4.1 (Node.js runtime v20+, Chromium base) dengan arsitektur multi-process aman (`contextIsolation: true`, `nodeIntegration: false`, `preload.js`).
* **Frontend UI Framework:** Native HTML5, Vanilla CSS3 (Sistem warna Mac-style Sage & Forest Theme), ES6+ JavaScript Modular tanpa build-step rumit sehingga sangat portabel.
* **Geospatial GIS Engine:** `Leaflet.js` v1.9.4 dengan dual-tile layer:
  - OpenStreetMap Standard (`tile.openstreetmap.org`).
  - Esri World Imagery Satellite Tiles.
* **Telemetry & Chart Engine:** `Chart.js` v4.4.1 dengan custom crosshair interaction, dual-axis (AGL/AMSL vs Speed), dan threshold ceiling 400 ft.
* **Backend Cloud & Auth:** `Supabase` (PostgreSQL 15, PostgREST API v1, Supabase Storage API, GoTrue Auth API v1).
* **Python Engine:** Python 3.10+ dengan parser biner mandiri berkecepatan tinggi di `ulg_converter.py` (tanpa dependensi eksternal yang rentan crash saat packaging).
* **DJI Wasm Decryption:** `dji-log-parser-js` v0.5.7 (Rust binding compiled to WebAssembly).

### 2. Implementasi Offline-First & Keamanan Supabase
* **Mekanisme Caching Offline:**
  - Metadata perizinan disimpan secara lokal dalam format JSON terstruktur di `data/permits.json`.
  - Berkas fisik PDF izin di-cache secara otomatis di folder lokal (`6. KOBU VI - PADANG/` atau mirroring Google Drive).
  - Jika koneksi internet ke Supabase terputus, aplikasi beralih (*graceful fallback*) ke `data/permits.json` sehingga inspektur tetap dapat mencari izin, melihat batas koordinat geofence, dan mengaudit telemetri di pedalaman tanpa sinyal.
* **Sinkronisasi Database (Supabase Sync):**
  - Saat ada izin baru diinput via form aplikasi (`save-permit`), proses utama Electron menyimpan data ke `permits.json` lokal terlebih dahulu (*Local-First Guarantee*).
  - Selanjutnya, asinkronus `fetch()` mengirim payload ke REST endpoint Supabase (`/rest/v1/permits`) dan mengunggah berkas PDF fisik ke Supabase Storage bucket (`permit-pdfs`) via REST Storage API (`/storage/v1/object/permit-pdfs/{year}/{file_name}`).
* **Keamanan Row Level Security (RLS) & Local Encryption:**
  - **Supabase RLS:** Diaktifkan pada tabel `public.profiles` dan `public.permits`. Hanya user dengan role `dev` dan `inspector` yang telah disetujui (`approved = true`) yang memiliki hak `INSERT/UPDATE`. User umum (*regular*) hanya memiliki izin `SELECT` (Read-Only).
  - **Local Token Security:** Session login pengguna disimpan di `data/session.json` menggunakan enkripsi perangkat keras **Windows DPAPI** melalui modul native Electron `safeStorage.encryptString()`.

### 3. Pipeline Telemetry Parsing (`.ulg` & `.txt` ke Visual)
* **Mekanisme IPC Execution:**
  - Di Renderer: `window.api.parseFlightLog(filePath, apiKey, outputDir, formats)` dipanggil.
  - Di `preload.js`: Menjembatani via `ipcRenderer.invoke('parse-flight-log', ...)`.
  - Di `main.js`: Memeriksa ekstensi file. Jika `.ulg`, memanggil Python menggunakan `child_process.execFile('python', ['ulg_converter.py', filePath, ...], { timeout: 120000 })`. Jika `.txt` (DJI), langsung dialihkan ke `dji_parser.js`.
* **Topik & Field PX4 yang Diekstrak:**
  - `vehicle_global_position` / `vehicle_gps_position`: Lintang (`lat`), Bujur (`lon`), Ketinggian Barometrik/AMSL (`alt`), Akurasi Horizontal (`eph`), Akurasi Vertikal (`epv`).
  - `battery_status`: Tegangan baterai (`voltage_v`), Arus (`current_a`), Sisa persentase baterai (`battery_percent`).
  - `vehicle_attitude`: Estimasi orientasi terbang (`pitch`, `roll`, `yaw/compass_heading`).
* **Algoritma Audit Kepatuhan (Compliance Checkers):**
  1. **Batas Ketinggian 400 ft (120 m) AGL:**
     $$\text{AGL} = \text{AMSL}_{\text{current}} - \text{AMSL}_{\text{takeoff}}$$
     Sistem secara otomatis mendeteksi apakah $\max(\text{AGL}) > 400\text{ ft}$. Jika terlampaui, kartu audit menampilkan status merah: `Ceiling Breach Detected ⚠️`.
  2. **Batas Kecepatan Maksimum 87 Knots (160 km/jam):**
     $$\text{Speed}_{\text{knots}} = \sqrt{v_x^2 + v_y^2} \times 1.943844$$
     Sistem memvalidasi seluruh titik lintasan terhadap ambang batas 87 knots sesuai CASR Part 107.
  3. **Geofence Proximity KKOP Bandara (Haversine Formula):**
     $$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$
     $$d = 2R \cdot \text{atan2}(\sqrt{a}, \sqrt{1-a})$$
     Jarak antara lintasan drone dengan titik referensi bandara OTBAN Wilayah VI dihitung otomatis untuk menentukan apakah penerbangan memasuki zona buffer 5 km (KKOP) atau zona pendekatan landasan (*Runway Approach Corridor*).

---

## SECTION 2: KENDALA RIIL & SOLUSI REKAYASA TEKNIS (SUBBAB III.B)

| No | Kendala Teknis Riil di Lapangan | Akar Masalah (*Root Cause*) | Solusi Rekayasa yang Diterapkan |
| :--- | :--- | :--- | :--- |
| 1 | **Log Operator Bukan File Telemetri (Kasus PT. Timah)** | Operator menyerahkan folder cache Android DJI Pilot 2 berisi `log-2026-06-24.log` (64 KB) dan folder aktivitas UI (`BaseFpvActivity`). | Menambahkan validator *magic header* di `dji_parser.js` yang menolak file teks cache dan memunculkan notifikasi edukasi lokasi path resmi log telemetri: `/DJI/dji.pilot/FlightRecord/`. |
| 2 | **Enkripsi AES Log Drone DJI Versi 13+** | Sejak firmware 2021+, DJI mengenkripsi biner `.txt` menggunakan AES yang membutuhkan kunci dinamis dari server DJI. | Mengintegrasikan Rust Wasm `dji-log-parser-js` dengan DJI Open API key, serta membangun **Offline Keychain Vault** di `data/dji_keychains/` agar log yang pernah dibuka dapat diakses 100% offline. |
| 3 | **Peta Leaflet Blank / Error Watermark CartoDB** | Endpoint CartoDB Positron pihak ketiga memblokir request atau memunculkan watermark hitam yang menutupi rute. | Migrasi penuh ke OpenStreetMap Standard (`tile.openstreetmap.org`) yang stabil dan bebas lisensi, ditambah filter CSS inversi pintar untuk Dark Mode. |
| 4 | **Crash DPAPI Sesi Login Saat Pindah Laptop** | Windows DPAPI mengenkripsi sesi terikat hardware komputer A, sehingga crash saat repo dikloning ke komputer B. | Menerapkan blok `try-catch` di `loadSession()` pada `main.js` yang mendeteksi kegagalan dekripsi DPAPI dan otomatis mereset sesi secara aman tanpa crash. |
| 5 | **Tombol Replay Play Tidak Merespon** | Lapisan kanvas peta Leaflet memiliki z-index internal 1000 yang menelan event klik mouse pada bilah kontrol. | Menaikkan z-index bilah replay ke `z-[2000]` dengan kelas CSS `pointer-events-auto` dan memastikan parameter data binding mengarah ke `ulgLastResult.preview_points`. |
| 6 | **Tombol Play Memantul (*Double Click Bounce*)** | Terdapat event listener ganda (`onclick` di HTML dan `addEventListener` di JS) sehingga satu klik memicu *Play $\rightarrow$ langsung Pause*. | Menghapus listener ganda, menyisakan satu handler resmi, serta memasang `pointer-events-none` pada tag SVG ikon tombol. |
| 7 | **HUD Joystick Menampilkan Angka Aneh `102400%`** | Sinyal RC DJI berformat integer 11-bit ($364 \dots 1684$ dengan netral $1024$), bukan persentase desimal $-1.0 \dots +1.0$. | Menerapkan normalisasi 11-bit: $\text{Throttle} = \frac{\text{raw} - 364}{1320} \times 100\%$ dan $\text{Yaw/Pitch/Roll} = \frac{\text{raw} - 1024}{660}$ sehingga tampilan kembali normal $0\% - 100\%$. |

---

## SECTION 3: REKAPITULASI KRONOLOGIS KEGIATAN 5W+1H (SUBBAB III.C & III.D)

### Kegiatan 1: Persiapan & Inisialisasi Lingkungan Pengembangan (29–31 Juli 2026)
* **What:** Membangun repositori Git, inisialisasi runtime Electron v42, dan struktur folder sistem.
* **Why:** Menjamin landasan aplikasi desktop memiliki pemisahan proses yang aman (*IPC contextIsolation*) dan fondasi offline-first.
* **Where:** Ruang Evaluasi Penerbangan, Kantor OBU Wilayah VI Padang.
* **When:** 29 s.d. 31 Juli 2026.
* **Who:** Lukman Yudand Hidayat (Pengevaluasi Penerbangan) dengan persetujuan Mentor.
* **How:** Menginisialisasi `package.json`, konfigurasi `main.js`, `preload.js`, serta `.gitignore` untuk melindungi credential dan file besar.

### Kegiatan 2: Pemetaan Spasial Wilayah Udara & Ingesti Dokumen (1–14 Agustus 2026)
* **What:** Menyiapkan koordinat 11 bandara OTBAN VI, buffer lateral 5 km KKOP, dan modul konversi izin PDF ke format terstruktur.
* **Why:** Memudahkan inspektur melihat posisi izin drone terhadap kawasan keselamatan operasi penerbangan.
* **Where:** Kantor OBU Wilayah VI Padang.
* **When:** 1 s.d. 14 Agustus 2026.
* **Who:** Peserta berkoordinasi dengan Seksi Pelayanan Navigasi Penerbangan.
* **How:** Menyusun array spasial `REGION_AIRPORTS`, mengintegrasikan Leaflet.js, dan mengekstraksi 29 berkas PDF izin ke direktori `data/markdown_permits/`.

### Kegiatan 3: Integrasi Cloud Supabase & Keamanan RBAC (13–14 Agustus 2026)
* **What:** Merancang tabel PostgreSQL di Supabase, mengonfigurasi skema Role-Based Access Control (RBAC), dan RLS.
* **Why:** Mengamankan integritas data perizinan agar tidak dimanipulasi oleh pihak luar dan memfasilitasi sinkronisasi cloud.
* **Where:** Kantor OBU Wilayah VI Padang.
* **When:** 13 s.d. 14 Agustus 2026.
* **Who:** Peserta secara mandiri.
* **How:** Mengeksekusi script `setup_auth.sql`, membuat role `regular`, `inspector`, dan `dev`, serta mengonfigurasi bucket Supabase Storage `permit-pdfs`.

### Kegiatan 4: Pembangunan Mesin Analisis Telemetri & Grafik Kepatuhan (14–27 Agustus 2026)
* **What:** Membangun parser biner PX4 (`ulg_converter.py`) dan DJI Wasm (`dji_parser.js`), algoritma audit ketinggian/kecepatan, serta studio visualisasi grafik.
* **Why:** Menggantikan proses audit manual yang lambat dan berisiko kebocoran data jika diunggah ke web pihak ketiga (Airdata).
* **Where:** Kantor OBU Wilayah VI Padang.
* **When:** 14 s.d. 27 Agustus 2026.
* **Who:** Peserta.
* **How:** Mengembangkan parser biner terdedikasi yang mengekstraksi GPS, AGL, baterai, dan kecepatan, lalu menampilkannya pada Chart.js dengan garis merah *regulatory ceiling* 400 ft AGL.

### Kegiatan 5: Pengujian Lapangan & UAT Bersama Rekan Kerja/Senior (27–31 Agustus 2026)
* **What:** Melakukan User Acceptance Testing (UAT) menggunakan file riil WingtraOne (`.ulg`) dan DJI Mavic 2 (`.txt`).
* **Why:** Memastikan akurasi deteksi pelanggaran ketinggian dan memvalidasi keandalan sistem pada kasus nyata inspeksi PT. Timah Bangka.
* **Where:** Kantor OBU Wilayah VI Padang.
* **When:** 27 s.d. 31 Agustus 2026.
* **Who:** Peserta bersama Senior Inspektur Penerbangan.
* **How:** Menjalankan skenario uji: (1) Ekstraksi log valid, (2) Deteksi dini file logcache Android yang salah, (3) Uji deteksi pelanggaran batas 400 ft AGL.

### Kegiatan 6: Pengembangan Fitur Replay 4D & Virtual RC Joystick HUD (1–2 September 2026)
* **What:** Membangun bilah interaktif 4D Flight Replay dan panel HUD tuas joystick virtual pilot (Throttle, Yaw, Pitch, Roll).
* **Why:** Memberikan kemampuan visualisasi forensik gerak drone dan input kendali pilot detik demi detik bagi inspektur.
* **Where:** Kantor OBU Wilayah VI Padang.
* **When:** 1 s.d. 2 September 2026.
* **Who:** Peserta.
* **How:** Menghubungkan array downsampled telemetri dengan animasi penanda Leaflet berorientasi kompas serta mentranslasikan sinyal PWM 11-bit ke pergerakan knob joystick.

### Kegiatan 7: Finalisasi Sistem, Dokumentasi Standar, & Git Synchronization (September 2026)
* **What:** Pembersihan draft usang, penyusunan `CHANGELOG.md`, `CATATAN_EVALUASI_TROUBLESHOOTING.md`, dan sinkronisasi repositori GitHub.
* **Why:** Menjamin transparansi, keberlanjutan kode (*maintainability*), dan kesiapan laporan pertanggungjawaban Latsar.
* **Where:** Kantor OBU Wilayah VI Padang.
* **When:** 4 s.d. 6 September 2026.
* **Who:** Peserta.
* **How:** Mengonfigurasi proteksi `.gitignore` untuk file raksasa (>100MB) dan mem-push seluruh commit bersih ke GitHub repository.

---

## SECTION 4: PERBANDINGAN SEBELUM VS SESUDAH AKTUALISASI (SUBBAB III.F)

| Parameter Evaluasi | Sebelum Aktualisasi (*Conventional Workflow*) | Sesudah Aktualisasi (*PUTA-Monitor*) |
| :--- | :--- | :--- |
| **Metode Analisis Log Telemetri** | Harus diunggah manual ke situs web pihak ketiga luar negeri (*Airdata UAV*). | **100% Pemrosesan Lokal di Laptop:** Mampu membaca PX4 ULog dan mendekripsi biner DJI tanpa internet. |
| **Kedaulatan & Keamanan Data Negara** | Berkas log sensitif objek vital nasional (PLN, Gas Negara, Tambang) terekspos ke server cloud asing. | **Data Aman & Terisolasi:** Berkas dianalisis lokal; token sesi diamankan Windows DPAPI; sinkronisasi ke Supabase mandiri ber-RLS. |
| **Kecepatan Audit Kepatuhan** | Memakan waktu 30–45 menit (buka Google Earth, konversi Excel manual, hitung manual AGL). | **Selesai dalam 2–5 Detik:** Sistem langsung mengeluarkan kartu audit: status pelanggaran 400 ft AGL, kecepatan, dan sisa baterai. |
| **Verifikasi Geofence KKOP Bandara** | Inspektur mencocokkan koordinat secara visual manual dari lembaran PDF ke peta fisik. | **Plotting Spasial Otomatis:** Menampilkan poligon izin dan lingkaran KKOP 5 km di 11 bandara OTBAN VI secara instan. |
| **Forensik Penerbangan** | Hanya melihat garis lintasan 2D statis. | **Interaktif 4D Replay & Virtual Stick HUD:** Inspektur dapat memutar ulang pergerakan drone dan melihat respon tuas remote pilot. |
| **Pengarsipan & Aksesibilitas Berkas** | Berkas izin tercecer di folder personal dan hardisk terpisah. | **Katalog Digital Terpusat:** Tersimpan rapi dengan standar penamaan otomatis, sinkron ke Cloud Supabase, dan siap diakses offline. |

---

## SECTION 5: ARTIFAK KODE SUMBER UNTUK LAMPIRAN LAPORAN

### 1. Struktur Pohon Direktori Repositori
```text
Project Latsar PUTA/
├── main.js                             # Electron Main Process (IPC Handlers, DPAPI, Window Mgmt)
├── preload.js                          # Secure Context Bridge (API Exposer)
├── renderer.js                         # Renderer UI Logic, Leaflet GIS, Replay Engine, Charts
├── index.html                          # Dashboard Structure, HUD Overlays, Control Bars
├── style.css                           # Custom Glassmorphism Styles & Theme Customizations
├── dji_parser.js                       # Native DJI Parser Engine (Rust Wasm + Offline Keychain Vault)
├── ulg_converter.py                    # Native PX4/Wingtra ULog Fast Binary Parser
├── setup_auth.sql                      # Supabase Schema Migration (Tables, Roles, RLS Policies)
├── CHANGELOG.md                        # Official Release History & Feature Additions
├── CATATAN_EVALUASI_TROUBLESHOOTING.md # Detailed Bug & Engineering Troubleshooting Log
├── PROJECT_OVERVIEW.md                 # System Technical Blueprint & Regional Overview
├── STANDARDIZATION_GUIDE.md            # SOP for Document Naming & Storage Management
├── package.json                        # Dependencies (Electron v42.4.1, dji-log-parser-js v0.5.7)
├── data/
│   ├── permits.json                    # Offline Local Database of Drone Flight Permits
│   ├── dji_keychains/                  # Cached Offline AES Decryption Keys
│   └── markdown_permits/               # 29 Extracted Text Files of Approved Permits
└── Airport/
    └── Depati Amir/                    # 3D Runway Approach Corridor KMLs
```

### 2. Cuplikan Kode IPC Handler Eksekusi Parser (`main.js`)
```javascript
// Universal Smart Autodetect Flight Log Parser (ULog or DJI)
ipcMain.handle('parse-flight-log', async (event, filePath, apiKey, outputDir, formats) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: 'File path not provided or does not exist.' };
  }

  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath).toLowerCase();

  // Engine 1: DJI Flight Record (.txt) via Rust WebAssembly
  if (ext === '.txt' || baseName.startsWith('djiflightrecord')) {
    return await parseDjiLog(filePath, apiKey, outputDir, formats);
  }

  // Engine 2: PX4 / Wingtra ULog (.ulg) via Python Binary Engine
  const { execFile } = require('child_process');
  const pythonScript = path.join(__dirname, 'ulg_converter.py');
  const args = [pythonScript, filePath];
  if (outputDir) args.push(outputDir);
  if (formats && formats.length) args.push(formats.join(','));

  return new Promise((resolve) => {
    execFile('python', args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) return resolve({ success: false, error: stderr || error.message });
      try {
        const lines = stdout.trim().split('\n');
        const lastJson = lines.reverse().find(l => l.trim().startsWith('{'));
        resolve(JSON.parse(lastJson || stdout.trim()));
      } catch (err) {
        resolve({ success: false, error: 'Invalid converter JSON output' });
      }
    });
  });
});
```

### 3. Cuplikan Logika Audit Kepatuhan Regulasi (`ulg_converter.py`)
```python
# Aviation Compliance Auditing (CASR Part 107 / PM 37)
breach_400ft = max_agl_ft > 400.0
speed_exceeded_87kts = max(p['speed_knots'] for p in track) > 87.0

compliance = {
    'ceiling_limit_ft': 400.0,
    'max_agl_ft': round(max_agl_ft, 1),
    'ceiling_breach': breach_400ft,
    'speed_limit_knots': 87.0,
    'max_speed_knots': round(max(p['speed_knots'] for p in track), 1),
    'speed_breach': speed_exceeded_87kts,
    'takeoff_amsl_ft': round(takeoff_amsl_ft, 1),
    'takeoff_amsl_m': round(takeoff_amsl_ft / 3.28084, 1),
    'min_battery_pct': round(min(p['battery_percent'] for p in track), 1),
    'min_voltage_v': round(min(p['voltage_v'] for p in track), 2),
}
```

### 4. Cuplikan Normalisasi Joystick Remote Control 11-Bit DJI (`renderer.js`)
```javascript
function updateRCHud(p) {
  let throttle = 50; // 50% hover saat netral
  let rudder = 0, elevator = 0, aileron = 0;

  if (p.rc_throttle > 100) {
    // Standard DJI 11-bit PWM Mapping: Min 364, Neutral 1024, Max 1684
    throttle = Math.min(100, Math.max(0, Math.round(((p.rc_throttle - 364) / (1684 - 364)) * 100)));
    rudder = Math.min(1, Math.max(-1, (p.rc_rudder - 1024) / 660));
    elevator = Math.min(1, Math.max(-1, (p.rc_elevator - 1024) / 660));
    aileron = Math.min(1, Math.max(-1, (p.rc_aileron - 1024) / 660));
  }
  
  // Update posisi tuas virtual joystick secara visual
  const maxTravelPx = 24;
  leftStick.style.transform = `translate(${(rudder * maxTravelPx).toFixed(1)}px, ${(((50 - throttle) / 50.0) * maxTravelPx).toFixed(1)}px)`;
  rightStick.style.transform = `translate(${(aileron * maxTravelPx).toFixed(1)}px, ${(-elevator * maxTravelPx).toFixed(1)}px)`;
}
```
