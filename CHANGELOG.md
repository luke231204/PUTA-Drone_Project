# CHANGELOG - PUTA (Pengawasan Udara Tanpa Awak) Monitor

Dokumen ini mencatat seluruh riwayat perubahan fungsional (*features*), peningkatan arsitektur teknis (*enhancements*), dan refaktorisasi sistem pada aplikasi PUTA-Monitor.

---

## [2.1.0] - 2026-09-04

### 🚀 Fitur Baru (Features Added)
1. **Universal Flight Inspector Studio**:
   - Mendukung multi-brand drone secara *native*: **PX4 / Wingtra** (`.ulg`) dan **DJI Enterprise / Consumer** (`.txt`, `.dat`).
   - Deteksi format otomatis (*Auto-Detect Engine*) yang mengenali header biner file secara instan.
   - Drawer pengaturan **DJI Developer Open API Key** mandiri dengan proteksi *password masking* dan penyimpanan lokal terenkripsi.
   - *Dynamic Brand Badge* di header inspektur: Label biru untuk `DJI: <model>` dan rose untuk `PX4 / Wingtra`.

2. **Offline Decryption Keychain Vault**:
   - Sistem penyimpanan lokal di `data/dji_keychains/` yang menyimpan *AES decryption keychain* untuk setiap log DJI v13+ yang sudah pernah didekripsi.
   - Log yang sama dapat dibuka dan dianalisis berulang kali di lapangan tanpa perlu koneksi internet.

3. **Interactive 4D Flight Replay Bar**:
   - Bilah kontrol interaktif di bawah Leaflet Map: Tombol Play/Pause, Reset/Restart, *Timeline seek slider*, dan waktu penerbangan aktual (`MM:SS`).
   - Kontrol kecepatan putar (*Playback Speed Multiplier*): $1\times, 2\times, 5\times, 10\times$.
   - Kapsul telemetri live yang menampilkan angka *AGL (ft)* dan *Ground Speed (kts)* secara dinamis mengikuti pergerakan waktu.
   - Marker drone bersimbol pesawat dengan animasi pulsasi dan rotasi otomatis mengikuti orientasi kompas (*yaw heading*).

4. **Dual Virtual RC Joysticks HUD**:
   - Panel HUD semi-transparan (*glassmorphism*) yang mensimulasikan pergerakan dua tuas kendali pilot di lapangan:
     - **Stik Kiri**: Throttle ($0-100\%$) dan Rudder/Yaw (Putaran Kiri/Kanan).
     - **Stik Kanan**: Elevator/Pitch (Maju/Mundur) dan Aileron/Roll (Geser Kiri/Kanan).
   - Tombol toggle **`RC Sticks`** di toolbar peta dan tombol tutup **`×`** pada header HUD untuk keleluasaan inspektur melihat sudut peta tanpa terhalang.

5. **Multi-Format Flight Path Converter & Export**:
   - Konversi log penerbangan ke format standar geospasial: **CSV**, **KML** (Google Earth 3D Path), dan **GPX**.
   - Tombol *Open Export Folder* untuk langsung membuka direktori hasil ekspor di Windows Explorer.

---

### 🔧 Perbaikan Sistem (Bug Fixes & Refinements)
- **Normalisasi Sinyal RC 11-Bit DJI**: Memetakan sinyal PWM mentah DJI ($364 \text{ s/d } 1684$, netral $1024$) ke format persentase realistis ($0-100\%$), mengatasi bug nilai $102400\%$.
- **Eliminasi Double-Trigger Bounce pada Tombol Play**: Menghapus listener ganda yang memicu *toggle ON/OFF* seketika pada satu kali klik tombol.
- **Layer Z-Index & Event Propagation**: Menaikkan z-index bilah replay ke `z-[2000]` dengan `pointer-events-auto` agar event klik tidak tertelan layer Leaflet map.
- **Pembersihan Dokumentasi (Documentation Pruning)**: Menghapus 5 file draft/blueprint usang (`gemini-code-*`, `puta_project_summary-v2`, `Telemetry_Feature_Specification_v2`, `TELEMETRY_FEATURE_BLUEPRINT`, `implementation_plan`) dan menyatukan seluruh spesifikasi ke `PROJECT_OVERVIEW.md` dan `CHANGELOG.md`.

---

## [2.0.0] - 2026-09-02

### 🚀 Fitur Utama
1. **Analisis Kepatuhan Regulasi CASR Part 107 / PM 37**:
   - Kartu audit kepatuhan otomatis terhadap batas ketinggian **400 ft AGL** dan batas kecepatan **87 kts (160 km/h)**.
   - Distingsi visual antara kurva AGL (Above Ground Level) dan AMSL (Above Mean Sea Level).
2. **Katalog & Parser Izin Drone (Markdown & PDF)**:
   - Modul inventarisasi dokumen perizinan DNP (*Direktorat Navigasi Penerbangan*).
   - Ekstraksi otomatis nomor registrasi, instansi operator, dan masa berlaku izin.
3. **Pembaruan Kode ICAO Bandara OTBAN VI**:
   - Koreksi kode ICAO bandara di wilayah kerja Kantor Otoritas Bandar Udara Wilayah VI:
     - Bandara Depati Amir, Pangkalpinang: `WIPK` (sebelumnya tercatat usang `WIKK`).
     - Bandara H.A.S. Hanandjoeddin, Tanjung Pandan: `WIKT`.
     - Bandara Silampari, Lubuklinggau: `WIPB` (sebelumnya `WIKL`).
     - Bandara Fatmawati Soekarno, Bengkulu: `WIGG` (sebelumnya `WIPH`).

---

## 📚 Dokumen Terkait
- Evaluasi & Pemecahan Masalah: [CATATAN_EVALUASI_TROUBLESHOOTING.md](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/CATATAN_EVALUASI_TROUBLESHOOTING.md)
- Ringkasan Proyek & Panduan: [PROJECT_OVERVIEW.md](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/PROJECT_OVERVIEW.md)
