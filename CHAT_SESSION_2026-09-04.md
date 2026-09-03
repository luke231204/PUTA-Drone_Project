# Rangkuman Sesi Diskusi & Pengembangan PUTA-Monitor
**Tanggal Sesi:** 4 September 2026 (01:00 - 02:15 WIB)  
**Tujuan:** Evaluasi Lapangan, Investigasi Log Drone Operator PT. Timah, Pemecahan Bug Replay & HUD Joystick, Standarisasi Dokumentasi, dan Git Sync.

---

## 1. Latar Belakang & Investigasi Kasus Lapangan (PT. Timah Bangka)

### Misteri Folder Log Operator Drone
* **Konteks:** Senior inspektur di Kantor Otoritas Bandar Udara Wilayah VI melakukan inspeksi pengawasan PUTA terhadap operasi drone PT. Timah Bangka (2026-06-24). Saat meminta log penerbangan, operator menyerahkan folder:
  `Pengawasan Drone PT. Timah Bangka / FlightLog / 2026_06_24` yang berisi file teks seperti `log-2026-06-24.log` (64 KB) dan folder aktivitas UI (`BaseFpvActivity`, `TwoStageLandingController`).
* **Temuan Investigasi Forensik:**
  - File yang diberikan operator **bukan log telemetri penerbangan**, melainkan log debug/crash dari aplikasi Android DJI Pilot 2 (*Logcat Android*).
  - Operator drone tidak sengaja (atau keliru) menyalin folder cache aplikasi alih-alih data telemetri.
  - **SOP Edukasi Lapangan Ditetapkan:** File telemetri penerbangan asli tersimpan di penyimpanan internal perangkat Android pada folder:  
    `/DJI/dji.pilot/FlightRecord/` atau `/Android/data/dji.go.v5/files/FlightRecord/` dengan format biner `DJIFlightRecord_*.txt`.

---

## 2. Pembangunan Fitur Baru

### A. Universal Flight Inspector (Multi-Engine)
* **Dua Mesin Parser Terintegrasi:**
  1. **PX4 / Wingtra Engine** (`ulg_converter.py` berbasis Python `pyulog`).
  2. **DJI Engine** (`dji_parser.js` berbasis WebAssembly Rust `dji-log-parser-js`).
* **Auto-Detect:** Mengenali header file secara instan (.ulg vs .txt/.dat).
* **DJI Developer API & Offline Keychain Vault:**
  - Integrasi API key DJI (`07dadcba863fab453c6b46999a38eea`) untuk membuka enkripsi AES log DJI versi 13+.
  - Setiap keychain yang berhasil didekripsi disimpan di `data/dji_keychains/` sehingga log yang sama dapat dibuka tanpa koneksi internet (*100% offline-ready*).

### B. Interactive 4D Flight Replay & Leaflet Synchronization
* Toolbar replay interaktif di bawah peta satelit:
  - Tombol Play/Pause dengan animasi ikon dinamis.
  - Tombol Reset/Restart replay.
  - Timeline seek slider yang sinkron dengan durasi penerbangan.
  - Pengatur kecepatan: $1\times, 2\times, 5\times, 10\times$.
  - Kapsul telemetri live (*AGL ft* dan *Speed kts*).
* Marker drone bersimbol pesawat dengan animasi pulsasi dan rotasi otomatis sesuai kompas (*yaw heading*).

### C. Dual Virtual RC Joysticks HUD
* HUD semi-transparan menampilkan posisi dua tuas remote control pilot:
  - **Stik Kiri:** Throttle ($0-100\%$) dan Rudder/Yaw (Putaran Kiri/Kanan).
  - **Stik Kanan:** Elevator/Pitch (Maju/Mundur) dan Aileron/Roll (Geser Kiri/Kanan).
* Tombol cepat **`RC Sticks`** di toolbar peta dan tombol close **`×`** pada header HUD untuk menyembunyikan/menampilkan panel joystick.

---

## 3. Catatan Masalah Teknis & Solusi (Troubleshooting Log)

### Masalah 1: Tombol Play Tidak Berjalan
* **Akar Masalah:**
  1. Parameter `initFlightReplay(r)` pada `renderUlgLeafletMap` dipanggil tanpa argumen `r`, menyebabkan array titik koordinat `replayPoints` kosong.
  2. Lapisan Leaflet map memiliki z-index internal 1000 sehingga event klik mouse tertelan.
* **Solusi:**
  - Menambahkan fallback otomatis ke `ulgLastResult.preview_points`.
  - Menaikkan z-index bilah replay ke `z-[2000]` dengan `pointer-events-auto`.

### Masalah 2: Tombol Play Memantul (*Double Click Trigger*)
* **Akar Masalah:**
  Tombol `btn-replay-play` memiliki penangan klik ganda: atribut inline HTML `onclick="toggleFlightReplay()"` dan `addEventListener('click')` di Javascript. Satu klik memicu toggle dua kali (*Play lalu seketika Pause*).
* **Solusi:**
  Menghapus `addEventListener` duplikat dan menambahkan `pointer-events-none` pada tag `<svg>` di dalam tombol.

### Masalah 3: Nilai Persentase Stik RC Menampilkan `102400%`
* **Akar Masalah:**
  Sinyal PWM Remote Controller DJI menggunakan format unsigned integer 11-bit:
  - Min: `364` | Netral: `1024` | Max: `1684` (Rentang dari tengah: 660).
  Kode awal mengasumsikan sinyal sudah desimal normal $-1.0 \dots +1.0$, sehingga angka netral `1024` dikalikan `100%` menjadi `102400%`.
* **Solusi:**
  Menerapkan formula normalisasi DJI 11-bit resmi:
  $$\text{Throttle (\%)} = \frac{\text{raw} - 364}{1684 - 364} \times 100\% \quad (50\% \text{ saat netral})$$
  $$\text{Yaw / Pitch / Roll} = \frac{\text{raw} - 1024}{660} \quad (-1.0 \dots +1.0)$$

---

## 4. Manajemen Repositori & Pembersihan Dokumen

### Pembersihan Markdown Usang
5 file draft usang telah dihapus demi kerapihan repositori:
- `gemini-code-1783999459500.md`
- `puta_project_summary-v2.md`
- `Telemetry_Feature_Specification_v2.md`
- `TELEMETRY_FEATURE_BLUEPRINT.md`
- `implementation_plan.md`

### Proteksi File Berukuran Besar (>100MB)
Git sempat menolak push karena keberadaan file telemetri biner riil:
- `Log/log001.ulg` (155.87 MB)
- `Contoh Laporan/sess387/log001.ulg` (103.36 MB)
Aturan di `.gitignore` diperbarui untuk mengabaikan `*.ulg`, `*.bin`, `*.dat`, folder `Log/`, dan `Contoh Laporan/`.

### Sinkronisasi GitHub Terakhir
Seluruh riwayat komit telah ter-push ke:
**`https://github.com/luke231204/PUTA-Drone_Project.git`**  
Status: `branch main up to date with origin/main`.
