# CHANGELOG - PUTA (Pengawasan Udara Tanpa Awak) Monitor

Dokumen ini mencatat seluruh riwayat perubahan fungsional (*features*), peningkatan arsitektur teknis (*enhancements*), dan refaktorisasi sistem pada aplikasi PUTA-Monitor.

---

## [2.3.0] - 2026-09-07

### 🚀 Fitur & Peningkatan Database (Permit Database Expansion & Cloud Ingestion)
1. **Pembaruan & Audit Database Izin Operasi (53 Dokumen Lengkap)**:
   - Mengaudit dan membandingkan seluruh berkas perizinan hasil unduhan terbaru dari Google Drive (`6. KOBU VI - PADANG-20260907T132509Z-1-001`, 53 berkas) dengan database lama (42 berkas).
   - Melakukan deduplikasi otomatis berbasis nomor izin dan nama instansi: mendeteksi 35 izin lama, 7 izin pindaian gambar 2024/2025, dan menemukan **11 Izin Baru Tahun 2026**.
   - Total database lokal `data/permits.json` dan Supabase Cloud kini meningkat menjadi **53 izin aktif**.

2. **Integrasi 11 Izin Baru 2026 dengan Standarisasi Nama Berkas**:
   - Seluruh berkas PDF baru telah disalin dan dibakukan namanya mengikuti pola baku: `{YEAR} - {OPERATOR} - {LOCATION} - {PERMIT_NUM}.pdf` ke dalam direktori `6. KOBU VI - PADANG`:
     1. `2026 - CV. Arkhon Engineering Solution - Sengeti Muaro Jambi - 0182.pdf`
     2. `2026 - PT Bukit Asam (Persero) Tbk - Tanjung Enim Muara Enim - 0219.pdf`
     3. `2026 - PT Geobisnis Prima Solusi - Merlung Tanjung Jabung Barat - 0191.pdf`
     4. `2026 - PT Geonusa Scientia Indonesia - Area TLB Bengkulu - 0181.pdf`
     5. `2026 - KJSB Lalu Akhmad Farhan - Pesisir Selatan - 0235.pdf`
     6. `2026 - PT Halo Indah Permai - Surveillance Sinarmas Term 5 - 0275.pdf`
     7. `2026 - PT Halo Indah Permai - Sipef Mukomuko - 0279.pdf`
     8. `2026 - PT Indo Maju Listrik - Jembatan Siti Nurbaya Kota Tua Padang - AU.307.pdf`
     9. `2026 - PT Fasade Kobetama Internasional - Air Manjunto Mukomuko - 0283.pdf`
     10. `2026 - PT Inovasi Mandiri Pratama - Kota Palembang - 0351.pdf`
     11. `2026 - PT Inovasi Mandiri Pratama - Pangkal Pinang Bangka - 0353.pdf`

3. **Diferensiasi Sumber Koordinat (Permit Attachment vs AirNav NOTAM)**:
   - Mengakomodasi izin yang memuat batas poligon langsung di lampiran surat persetujuan DNP (contoh: **PT Indo Maju Listrik** untuk atraksi *Drone Light Show* 150 drone di Jembatan Siti Nurbaya, Padang dengan 4 titik koordinat batas dan ketinggian 655 ft MSL).
   - Menampilkan notifikasi visual khusus pada Leaflet Map Popup dan Panel Inspeksi:
     - Poligon dari Lampiran Izin (*DNP Permit Attachment*) ditampilkan dengan *badge* hijau serta pemberitahuan bahwa NOTAM AirNav tetap dapat diunggah kemudian saat telah terbit.
     - Izin yang belum memiliki NOTAM maupun koordinat lampiran diberikan titik perkiraan area (*Approximate Fallback Circle*) dengan label informatif.

4. **Sinkronisasi Otomatis ke Supabase Cloud (Storage & DB)**:
   - 11 berkas PDF baru otomatis diunggah ke *storage bucket* `permit-pdfs/2026/`.
   - Melakukan bulk upsert metadata seluruh 53 izin ke tabel Supabase `permits` lengkap dengan pembersihan karakter null (*Unicode zero-byte sanitizer*) sehingga integritas database tetap terjamin.

---

## [2.2.0] - 2026-09-07

### 🚀 Fitur Baru (Features Added)
1. **Zero-Token Local NOTAM & Permit Parser Engine**:
   - Memanfaatkan `PyMuPDF` + *Deterministic Structural Grammar Regex* yang berjalan 100% lokal di CPU (*Zero API Key*, *Zero Tokens*, bebas biaya).
   - Ekstraksi dokumen ICAO NOTAM resmi (`Q)`, `B)`, `C)`, `D)`, `E)`, `F)`, `G)`) dan surat izin DNP dalam waktu < 0.05 detik.
   - Deteksi multi-poligon otomatis (misal memisahkan `BELITUNG AREA` dan `BANGKA AREA` menjadi segmen spasial independen).

2. **3D Extruded Safety Boundary KML for Google Earth Pro**:
   - Menghasilkan file KML berstandar `<Polygon>` 3D dengan atribut `<extrude>1</extrude>` dan `<altitudeMode>relativeToGround</altitudeMode>`.
   - Mengambil ketinggian vertikal nyata langsung dari NOTAM (misal `1000 FT AMSL`), sehingga saat dibuka di Google Earth Pro tampak sebagai *3D Airspace Curtain / Glass Wall* transparan yang membatasi ruang udara secara tegak lurus dari permukaan bumi (*SFC*).

3. **Interactive 2D Airspace Polygon Visualizer on Leaflet**:
   - Menambahkan tombol interaktif **"View Polygons on Map"** pada modul KML Document Converter.
   - Merender poligon berliku asli di peta Leaflet 2D tanpa lagi menggunakan lingkaran dummy buatan.
   - Fitur auto camera pan & zoom (*fitBounds*) dengan popup informatif berisi batas ketinggian atas/bawah, nomor NOTAM, nama pemohon, dan jumlah titik koordinat.

4. **Koreksi Data Izin Operasional PT Timah Tbk**:
   - Memetakan koordinat poligon nyata dari NOTAM `B0598/26 NOTAMN` langsung ke dalam `data/permits.json` untuk izin Belitung (`0015/APPROVAL-PUTA/DNP-2026`, 23 titik) dan Bangka (`0016/APPROVAL-PUTA/DNP-2026`, 24 titik) dengan batas ketinggian 1.000 ft.

5. **Direct NOTAM Attachment to Permit Inspection Panel & Standardized Template Naming**:
   - Panel inspeksi izin sebelah kanan kini memiliki modul terintegrasi: **AirNav NOTAM Airspace**.
   - User dapat meng-attach file PDF NOTAM secara langsung ke izin manapun (`Attach NOTAM PDF (.pdf)`).
   - **Template Penamaan Standar**: Setiap NOTAM yang di-attach otomatis dibakukan namanya mengikuti aturan:
     `{NOTAM_CODE} - {OPERATOR_NAME} - {NOMOR_IZIN}.pdf`
     (Contoh: `B0598_26 NOTAMN - PT Timah Tbk - 0015.pdf`).
   - Sistem secara otomatis meng-copy file ke direktori lokal `Notam/`, mengekstrak batas poligon & ketinggian ceiling-nya, menyinkronkan ke Supabase Cloud (`notam-pdfs`), dan mengaitkan file tersebut sehingga bisa dibuka/dibaca kapan saja hanya dengan mengklik tautan **Attached NOTAM**.

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
