# 📘 Catatan Evaluasi, Troubleshooting & Arsitektur Teknis
**Project**: PUTA-Monitor (Kantor Otoritas Bandar Udara Wilayah VI)  
**Dokumentasi Pembelajaran & Evaluasi Teknis**  
**Tanggal**: 4 September 2026  
**Penulis**: Lukman Yudand Hidayat (`luke231204`)

---

## 📑 Daftar Isi
1. [Latar Belakang & Tujuan](#1-latar-belakang--tujuan)
2. [Evaluasi Bug & Troubleshooting Riil](#2-evaluasi-bug--troubleshooting-riil)
   - [Bug 1: Chromium File Path Sandbox Security (`undefined`)](#bug-1-chromium-file-path-sandbox-security-undefined)
   - [Bug 2: Pola Garis Peta Patah / Kurang Halus Dibanding Google Earth Pro](#bug-2-pola-garis-peta-patah--kurang-halus-dibanding-google-earth-pro)
   - [Bug 3: Error `bad magic at 0x0: 43` pada Parser DJI](#bug-3-error-bad-magic-at-0x0-43-pada-parser-dji)
   - [Bug 4: Watermark Basemap CARTO `API KEY REQUIRED`](#bug-4-watermark-basemap-carto-api-key-required)
   - [Bug 5: Crash DPAPI Decryption Token Saat Pindah Komputer](#bug-5-crash-dpapi-decryption-token-saat-pindah-komputer)
3. [Arsitektur Teknis Universal Flight Inspector](#3-arsitektur-teknis-universal-flight-inspector)
   - [Distingsi Kritis: AGL vs. AMSL](#distingsi-kritis-agl-vs-amsl)
   - [Dual-Engine: PX4/Wingtra vs. DJI Encrypted Logs](#dual-engine-px4wingtra-vs-dji-encrypted-logs)
   - [Sistem Offline Keychain Caching](#sistem-offline-keychain-caching)
4. [Rekomendasi Operasional Lapangan (SOP)](#4-rekomendasi-operasional-lapangan-sop)

---

## 1. Latar Belakang & Tujuan
Dokumen ini disusun sebagai dokumentasi teknis komprehensif atas proses reverse engineering, perbaikan bug, dan penambahan fitur inspeksi telemetri penerbangan drone (*PX4 Autopilot & DJI Enterprise*). Catatan ini berguna bagi tim pengembang dan inspektur penerbangan OTBAN Wilayah VI untuk mengevaluasi setiap *trial-and-error*, memahami arsitektur data drone, serta menghindari kesalahan yang sama di masa mendatang.

---

## 2. Evaluasi Bug & Troubleshooting Riil

### Bug 1: Chromium File Path Sandbox Security (`undefined`)
* **Gejala**:
  Ketika pengguna men-drag & drop file log `.ulg` atau memilih file via dialog input HTML, aplikasi memunculkan error:
  ```
  Cannot read file: [Errno 2] No such file or directory: 'undefined'
  ```
* **Akar Masalah (Root Cause)**:
  Pada versi Electron modern (khususnya Electron v28 s/d v42 yang digunakan di proyek ini), Chromium menerapkan kebijakan keamanan sandbox yang ketat: **properti `file.path` pada objek `File` DOM HTML5 sengaja dibuat `undefined`** untuk mencegah kebocoran struktur direktori lokal ke context renderer web. Akibatnya, string literal `'undefined'` dikirim ke backend Python/Node.js.
* **Solusi yang Diterapkan**:
  1. Menggunakan API resmi Electron Bridge: `webUtils.getPathForFile(file)` di dalam [preload.js](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/preload.js).
  2. Menyediakan native Electron picker menggunakan `dialog.showOpenDialog` via IPC handler `dialog-select-file` di [main.js](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/main.js). Solusi ini menjamin 100% path Windows absolut (`C:\Users\...`) selalu valid dan aman.

---

### Bug 2: Pola Garis Peta Patah / Kurang Halus Dibanding Google Earth Pro
* **Gejala**:
  Ketika rute penerbangan drone (contoh: log WingtraOne 8.090 titik koordinat) ditampilkan di Leaflet, garis lintasan survey terlihat bersudut kaku (*choppy*) pada belokan 180° di ujung area survey, padahal file KML yang sama di Google Earth Pro terlihat sangat mulus melengkung.
* **Akar Masalah (Root Cause)**:
  1. **Over-Downsampling**: Awalnya, array koordinat peta mengambil data dari `preview_points` yang didownsample menjadi 250 titik (`step = len(track) // 250`). Untuk penerbangan 800 detik, 1 titik diambil tiap ~32 detik sehingga manuver tikungan tajam dan lingkaran loitering di atas titik *Home* terpotong.
  2. **Douglas-Peucker Simplification di Leaflet**: Secara default Leaflet menerapkan `smoothFactor: 1` yang memangkas titik-titik koordinat berdekatan.
* **Solusi yang Diterapkan**:
  1. **Pemisahan Pipeline Data**:
     * `preview_points` (250 titik): Digunakan khusus Chart.js agar grafik performan dan tidak lag.
     * `map_points` (8.090 titik penuh): Menyediakan seluruh pasangan `[latitude, longitude]` mentah tanpa reduksi untuk Leaflet.
  2. **Preservasi Detail Lintasan**: Mengatur `smoothFactor: 0` pada `L.polyline`.
  3. **Visualisasi Presisi Tinggi**: Ditambahkan opsi peta Satelit resolusi tinggi (Esri World Imagery) dan palet warna kustom (*Aero Yellow* `#ffff00`, dll) dengan ketebalan garis yang dapat disesuaikan langsung.

---

### Bug 3: Error `bad magic at 0x0: 43` pada Parser DJI (Kasus Lapangan: Salah Format File dari Operator)
* **Gejala**:
  Ketika mengunggah file teks DJI bernama `log-2026-06-24.txt` (diterima inspektur dari operator drone lapangan di Bangka), muncul pesan kegagalan:
  ```
  Parse error: no variants matched at 0x0: Info: bad magic at 0x0: 43 Version: bad magic at 0x0: 43
  ```
* **Akar Masalah (Root Cause & Analisis Forensik Folder)**:
  1. **Inspeksi Struktur Folder Operator**:
     Folder yang dikirimkan operator (`Pengawasan Drone PT. Timah Bangka / FlightLog / 2026_06_24`) berisi puluhan subfolder kelas internal Android seperti:
     `BaseFpvActivity`, `BusinessLogicManager`, `CalibrationEventViewModel`, `CameraActionItemProviderFactory`, `PlatformManager`, `SplashActivity`, `TwoStageLandingController`, dan file `log-2026-06-24.log` berukuran 64 KB.
  2. **Kesimpulan Teknis**:
     File tersebut adalah **Android Runtime/Crash & Activity Lifecycle Debug Log** dari aplikasi **DJI Pilot 2**, **BUKAN data telemetri blackbox penerbangan resmi (*DJI Flight Record*)**.
  3. **Struktur Heksadesimal**:
     File tersebut berisi baris-baris terenkode Base64 (`GmcONIA9PFzHw1gpPLLPoqev3ytAH5KO3S...`). Nilai byte pertama `0x43` adalah karakter ASCII `'C'`, yang bukan merupakan *magic header binary* file rekaman terbang DJI.
* **Solusi & Mitigasi**:
  1. **Proteksi di Aplikasi**: Mengupdate [dji_parser.js](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/dji_parser.js) agar menangkap error `bad magic` dan menampilkan notifikasi edukatif bahwa file yang dimasukkan adalah log debug aplikasi, bukan rekaman terbang.
  2. **SOP Permintaan Log ke Operator (Edukasi Tim Inspektur)**:
     Inspektur OTBAN Wilayah VI harus menginstruksikan operator untuk mengekstrak file resmi dari:
     - Menu aplikasi **DJI Pilot 2**: Masuk ke **Profile** $\rightarrow$ **Flight Records** $\rightarrow$ Pilih tanggal $\rightarrow$ **Export**.
     - Atau mengambil file biner dari direktori internal controller:
       `Internal Storage/Android/data/dji.pilot.v2/files/FlightRecord/` (nama file: `DJIFlightRecord_YYYY-MM-DD_[HH-MM-SS].txt`). File rekam terbang resmi berukuran beberapa MB (karena mencatat GPS & status motor 10 Hz), bukan puluhan KB.

---

### Bug 4: Watermark Basemap CARTO `API KEY REQUIRED`
* **Gejala**:
  Peta pemantau wilayah udara dan telemetri menampilkan tulisan watermark besar `API KEY REQUIRED carto.com/basemaps/apikey` di seluruh ubin peta.
* **Akar Masalah (Root Cause)**:
  URL penyedia tile CartoDB publik yang digunakan sebelumnya telah mengubah *terms of service* dan memblokir akses tanpa API key berbayar.
* **Solusi yang Diterapkan**:
  Mengganti seluruh endpoint tile di [renderer.js](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/renderer.js) ke server **OpenStreetMap standar** (`tile.openstreetmap.org`) yang stabil dan bebas watermark, serta menambahkan filter CSS inversi pintar (`.dark-map-tiles`) agar tampilan tema gelap (*Dark Mode*) tetap nyaman tanpa memerlukan API key eksternal.

---

### Bug 5: Crash DPAPI Decryption Token Saat Pindah Komputer
* **Gejala**:
  Saat repository dipindahkan dari laptop lama ke komputer baru, Electron gagal memuat sesi login sebelumnya dan memunculkan error dekripsi Windows DPAPI.
* **Akar Masalah (Root Cause)**:
  `safeStorage.encryptString` menggunakan Windows Data Protection API (DPAPI) yang terikat langsung pada identitas user Windows dan hardware mesin spesifik. File `data/session.json` yang dienkripsi di komputer A tidak bisa didekripsi di komputer B.
* **Solusi yang Diterapkan**:
  Menambahkan blok `try-catch` di fungsi `loadSession()` di [main.js](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/main.js) yang secara otomatis mendeteksi kegagalan dekripsi DPAPI dan membersihkan file sesi usang secara aman tanpa membuat aplikasi *crash*.

---

### Bug 6: Tombol Play/Pause Replay Memantul (Double Click Trigger)
* **Gejala**:
  Ketika tab *Flight Route Map* dibuka dan tombol Play diklik, tombol tidak berjalan atau animasi langsung terhenti, sehingga pengguna harus memakai tombol putar ulang (*restart circle*).
* **Akar Masalah (Root Cause)**:
  Tombol `btn-replay-play` memiliki atribut inline `onclick="toggleFlightReplay()"` dan secara bersamaan dipasangkan `playBtn.addEventListener('click', toggleFlightReplay)` di `renderer.js`. Akibatnya, setiap 1 kali klik memicu fungsi dua kali sekaligus (*toggle ON lalu seketika toggle OFF*).
* **Solusi yang Diterapkan**:
  Menghapus `addEventListener` ganda dan mempertahankan satu handler resmi `onclick="toggleFlightReplay()"` yang telah terhubung ke `window.toggleFlightReplay`. Menambahkan `pointer-events-none` pada tag `<svg>` di dalam tombol agar target klik mouse murni mengenai elemen `<button>`.

---

### Bug 7: Nilai Persentase Stik RC Menampilkan `102400%` (DJI 11-Bit Channel Range)
* **Gejala**:
  Saat memutar log penerbangan drone DJI (contoh: *chrisshe-MAVIC 2*), HUD Virtual Stick menampilkan angka ganjil: `T: 1024% | R: 102400% | P: 102400% | R: 102400%` dan stik knob keluar batas.
* **Akar Masalah (Root Cause)**:
  Pada protokol telemetri DJI, sinyal Remote Controller menggunakan representasi **11-bit unsigned integer**:
  * Nilai Minimum: `364`
  * Nilai Netral / Tengah: `1024`
  * Nilai Maksimum: `1684`
  Formula awal berasumsi nilai stik sudah dinormalisasi $-1.0 \text{ s/d } +1.0$, sehingga angka netral `1024` dikalikan `100%` menghasilkan `102400%`.
* **Solusi yang Diterapkan**:
  Menerapkan normalisasi 11-bit DJI resmi di `updateRCHud()`:
  $$\text{Throttle (\%)} = \frac{\text{raw} - 364}{1684 - 364} \times 100\% \quad (50\% \text{ saat netral})$$
  $$\text{Rudder / Pitch / Roll} = \frac{\text{raw} - 1024}{660} \quad (-1.0 \text{ s/d } +1.0)$$
  Kini tuas stik bergerak proporsional dan teks menampilkan persentase realistis ($0\% - 100\%$).

---

### Fitur Tambahan: Tombol Toggle / Sembunyikan Virtual RC Sticks HUD
* **Deskripsi**:
  Menambahkan tombol cepat `RC Sticks` di toolbar peta serta tombol close `×` di pojok kanan atas panel joystick HUD.
* **Kegunaan Lapangan**:
  Memungkinkan inspektur penerbangan menyembunyikan panel joystick (Throttle/Yaw & Pitch/Roll) jika ingin melihat visual rute penerbangan dan area KKOP di pojok kanan bawah peta secara penuh tanpa terhalang elemen HUD.

---

## 3. Arsitektur Teknis Universal Flight Inspector

### Distingsi Kritis: AGL vs. AMSL
Dalam audit kepatuhan penerbangan sipil (CASR Part 107 / PM 37):
* **AGL (Above Ground Level)**: Ketinggian relatif terhadap titik lepas landas (*launch pad*).
  $$\text{AGL} = \text{AMSL}_{\text{current}} - \text{AMSL}_{\text{takeoff}}$$
  Batasan legal ketinggian terbang maksimum drone **400 ft (120 meter) berlaku mutlak terhadap AGL**, bukan AMSL.
* **AMSL (Above Mean Sea Level)**: Ketinggian absolut di atas permukaan air laut rata-rata, digunakan untuk koordinasi batas wilayah udara bandar udara (KKOP) dan keselamatan pemisahan dengan pesawat berawak.
* **Implementasi**:
  Pada studio grafik, garis batas merah **400 ft Regulatory Ceiling** hanya dimunculkan pada kurva AGL dan tidak dipasang pada kurva AMSL untuk menghindari kekeliruan audit inspektur.

### Dual-Engine: PX4/Wingtra vs. DJI Encrypted Logs
Aplikasi kini memiliki arsitektur terpadu:
1. **Engine 1 - PX4/Wingtra (`ulg_converter.py`)**:
   * Membaca struktur biner ULog PX4 (`vehicle_global_position`, `sensor_gps`, `battery_status`).
   * Menghasilkan sinkronisasi waktu milidetik presisi tinggi.
2. **Engine 2 - DJI Flight Record (`dji_parser.js` & `dji-log-parser-js`)**:
   * Mendukung log versi lama (v1–v12 unencrypted) dan versi modern (v13+ AES encrypted).
   * Menggunakan kunci pengembang DJI Open API (`07dadcba863fab453c6b46999a38eea`) untuk meminta *keychain* dekripsi dari server otentikasi DJI.

### Sistem Offline Keychain Caching
Untuk mendukung kerja inspektur di lapangan (*remote site* tanpa internet):
* Begitu sebuah log DJI berhasil didekripsi untuk pertama kali, *keychain* AES disimpan secara otomatis di folder:
  `data/dji_keychains/<filename>.keychain.json`
* Jika file log tersebut dibuka kembali di kemudian hari, aplikasi membaca kunci lokal dan mendekripsinya secara instan tanpa perlu akses internet.
* Folder `data/dji_keychains/` telah didaftarkan ke [.gitignore](file:///c:/Users/Luke/Downloads/Project%20Latsar%20PUTA/.gitignore) agar kredensial aman.

### Fitur Interaktif: Flight Replay & RC Virtual Stick Visualizer
Mengadopsi inspirasi performa dari *Open DroneLog*, di dalam tab peta satelit telah ditambahkan:
1. **Interactive Timeline Bar**: Kontrol Play/Pause/Reset, slider timeline, dan pengatur kecepatan ($1\times, 2\times, 5\times, 10\times$).
2. **Pulsating Drone Marker**: Marker drone dinamis dengan orientasi rotasi derajat kompas (*heading*) yang bergerak mulus di atas garis lintasan.
3. **Dual Virtual RC Joysticks (HUD Overlay)**:
   * **Stik Kiri**: Throttle (0–100%) dan Rudder/Yaw (-100% s/d +100%).
   * **Stik Kanan**: Elevator/Pitch dan Aileron/Roll.
   * Nilai posisi stik dihitung secara langsung dari channel RC log DJI / estimasi vektor aerodinamika.

---

## 4. Rekomendasi Operasional Lapangan (SOP)
1. **Pemeriksaan File Log Sebelum Inspeksi**:
   * Jika drone berbasis **PX4 / ArduPilot / Wingtra**: Pastikan format file berakhiran `.ulg` atau `.bin`.
   * Jika drone **DJI** (Mavic, Mini, Matrice, Inspire): Pastikan mengambil file dari folder `FlightRecord` dengan nama format `DJIFlightRecord_YYYY-MM-DD_[HH-MM-SS].txt`. Jangan mengambil file dari folder `LOG_CACHE`.
2. **Verifikasi Wilayah Udara**:
   * Gunakan tombol ekspor **KML (Google Earth)** untuk menumpangsusunkan (*overlay*) rute drone terhadap dokumen izin terbang polygon wilayah pemotretan udara.
   * Periksa tab **Airspace Safety Audit**: pastikan status bertanda hijau (`Ceiling OK` $\le 400$ ft AGL dan `Speed OK` $\le 87$ knots).

---
*Dokumen ini dibuat otomatis dan terintegrasi dalam repository kerja PUTA-Monitor.*
