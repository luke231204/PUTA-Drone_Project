# JAWABAN & SINKRONISASI DATA TEKNIS IMPLEMENTASI "PUTA-MONITOR"
**Untuk Penyusunan Laporan Aktualisasi (Habituasi) Pelatihan Dasar CPNS Golongan III Kementerian Perhubungan**  
**Fokus Dokumen:** BAB III Subbab F: Penyelesaian Isu Berdasarkan Kedudukan dan Peran PNS Menuju Smart Governance (Smart ASN & Manajemen ASN)  
**Instansi:** Kantor Otoritas Bandar Udara Wilayah VI Padang  
**Coach Pembimbing:** Bapak Octadian Pratiwanggono, A.T.D., M.T.  
**Versi Aplikasi Terkini:** v1.6.0 (Stable Release)

---

## I. Ringkasan Eksekutif & Jawaban Rincian Teknis (Codebase State Terkini)

Dokumen ini menyajikan audit fakta teknis dari arsitektur *codebase* sistem **PUTA-Monitor v1.6.0 (Stable)** yang telah selesai dibangun dan diuji pada lingkungan operasional Kantor Otoritas Bandar Udara Wilayah VI Padang.

---

### A. Penanganan Data Izin & KKOP 13 Bandara

#### 1. Struktur Penyimpanan Data Izin Drone (Arsitektur Hibrida: Offline Cache vs. Supabase Cloud)
Sistem mengadopsi pola **Hybrid Offline-First Architecture** untuk menjamin kelancaran tugas inspektur di lapangan kendati jaringan internet terputus (*zero-downtime inspection*):
* **Penyimpanan Lokal (`data/permits.json` & Encrypted Cache):**
  * Data izin drone tersimpan secara terstruktur dalam format JSON lokal (`data/permits.json`) yang memuat atribut: `permit_id`, `operator_name`, `location`, `date_start`, `date_end`, `time_start`, `time_end`, `max_altitude_ft`, array koordinat poligon wilayah operasi (`coordinates`), daftar nama pilot teregistrasi SIDOPI (`pilot_name`), tanda registrasi PUTA (`puta_registry`), nama berkas salinan SK izin (`file_name`), referensi NOTAM (`notam_reference`), dan catatan plafon khusus (`altitude_ceiling_note`).
  * Saat aplikasi berjalan tanpa internet, sistem membaca cache lokal terenkripsi sehingga seluruh fitur pengawasan, inspeksi poligon, dan audit kepatuhan tetap berfungsi 100%.
* **Sinkronisasi Awan (Supabase Cloud Database):**
  * Terhubung secara aman melalui REST API / WebSocket ke PostgreSQL Supabase pada tabel `drone_permits` dan tabel audit log.
  * Dilengkapi mekanisme *Row Level Security (RLS)* dan sinkronisasi berkas Google Drive untuk pengarsipan dokumen izin PDF asli secara terpusat antarseksi di lingkungan OTBAN Wilayah VI.
* **Logika Status Izin 4-Tahap (Real-Time State Engine):**
  * Fungsi `getPermitStatus(permit)` dan `getPermitCategory(permit)` mengevaluasi tanggal kalender dan jam jendela operasional harian secara presisi:
    1. **`ACTIVE`**: Izin berada dalam rentang tanggal berlaku DAN waktu lokal saat ini berada dalam jendela jam terbang harian (misal: 08:00–16:00 WIB).
    2. **`OFF_HOURS`**: Tanggal izin masih berlaku (belum kedaluwarsa), namun jam operasional hari ini telah selesai (misal: pk. 18:00 WIB). Status ini ditandai dengan badge biru *DAILY OFF-HOURS (STANDBY)* dan countdown otomatis menghitung mundur waktu buka jam terbang esok pagi (`RESUMES IN: [HH:MM:SS]`), bukan keliru dicap kedaluwarsa.
    3. **`PENDING`**: Tanggal penerbangan belum dimulai (operasi masa depan) atau jam terbang hari ini belum dibuka.
    4. **`EXPIRED`**: Tanggal akhir izin telah terlampaui.

#### 2. Pemetaan Spasial 13 Bandara Yurisdiksi OTBAN Wilayah VI Padang
Sistem menanamkan (*hardcoded constant matrix*) data geospasial 13 bandar udara di bawah wilayah kerja OTBAN Wilayah VI Padang pada array `REGION_AIRPORTS` di pustaka Leaflet.js:
1. **Bandara Internasional Minangkabau (BIM / WIEE)** — Padang Pariaman (Pusat Otoritas)
2. **Bandara Sultan Syarif Kasim II (PKU / WIBB)** — Pekanbaru
3. **Bandara Raja Haji Fisabilillah (TNJ / WIDN)** — Tanjungpinang
4. **Bandara Depati Amir (PGK / WIPK)** — Pangkalpinang
5. **Bandara H.A.S. Hanandjoeddin (TJQ / WIDT)** — Belitung
6. **Bandara Dabo (SIQ / WIDS)** — Dabo Singkep
7. **Bandara Raja Haji Abdullah (TJB / WIBT)** — Sei Bati, Karimun
8. **Bandara Ranai / Raden Sadjad (NTX / WION)** — Natuna
9. **Bandara Letung (LUW / WIDL)** — Kepulauan Anambas
10. **Bandara Tambelan (TBX / WIDO)** — Kepulauan Tambelan
11. **Bandara Pasaman Barat / Pusako Anak Nagari (PSB / WIPI)** — Simpang Ampek
12. **Bandara Rokot / Sipora (RKI / WIBR)** — Kepulauan Mentawai
13. **Bandara Tuanku Tambusai (PPR / WIBR)** — Pasir Pengaraian, Rokan Hulu

* **Visualisasi Spasial KKOP:** Masing-masing bandara dipetakan dengan marker taktis aeronautika beserta lapisan lingkaran radius batas Kawasan Keselamatan Operasi Penerbangan (KKOP) 5.000 meter (5 km Inner Safety Buffer Zone) dan 15.000 meter (15 km Outer Conical Surface Zone).
* **Algoritma Deteksi Konflik Spasial Lateral (`computeSpatialConflictMatrix`):**
  Menggunakan rumus geodesi *Haversine Spherical Distance* untuk mengukur jarak terdekat antara poligon rencana terbang drone terhadap ARP (*Aerodrome Reference Point*) masing-masing bandara. Jika poligon drone bersinggungan atau masuk dalam radius 5 km KKOP, sistem langsung memunculkan peringatan kontur merah berkedip (*KKOP Proximity Warning*).

---

### B. Mesin Parser Log Telemetri (Dual-Engine: PX4 ULog & DJI Encrypted)

#### 1. Arsitektur Dual-Engine Parser
Aplikasi tidak bergantung pada satu pabrikan drone saja, melainkan memiliki mesin ganda:
* **Engine 1: Open-Source Autopilot PX4 / ArduPilot (`.ulg` / `.bin`):**
  * Ditenagai oleh sub-proses native Node.js yang mengeksekusi modul `ulg_converter.py` berbasis pustaka standar `pyulog`.
  * Mengekstraksi topik biner frekuensi tinggi: `vehicle_gps_position`, `vehicle_local_position`, `battery_status`, `actuator_outputs`, dan `vehicle_attitude`.
* **Engine 2: Komersial DJI Proprietary Log (`.txt` / `.dat` / `.kml` / `.csv`):**
  * Mengintegrasikan modul `dji-log-parser-js` dan kompilasi WebAssembly (Wasm) untuk mendekripsi struktur biner rekaman penerbangan drone seri DJI Enterprise (Matrice 300/350 RTK, Mavic 3 Enterprise, Phantom 4 RTK).

#### 2. Mekanisme Brankas Kunci Lokal (*Keychain Vault Offline*)
* Dekripsi log biner DJI versi terbaru (versi enkripsi v7 ke atas) memerlukan pasangan *App Key*.
* Aplikasi PUTA-Monitor menyediakan antarmuka **DJI Keychain Settings Vault** di dalam jendela Flight Studio. Kunci API disimpan secara lokal di dalam penyimpanan aman desktop pengguna (`localStorage` / encrypted configuration).
* **Kedaulatan Data Penuh (Data Sovereignty):** Proses dekripsi biner dilakukan secara lokal pada CPU laptop dinas tanpa mengirimkan berkas log koordinat sensitif ke server asing (seperti server publik pihak ketiga *Airdata UAV* di Amerika Serikat/Eropa). Hal ini krusial untuk melindungi koordinat pemetaan fasilitas vital negara (misal: objek tambang strategis nasional PT Timah atau jalur pipa minyak di Riau).

#### 3. Validasi Integritas Berkas (*Anti-Garbage Filter*)
Untuk mencegah kegagalan sistem akibat evaluator salah mengunggah berkas sampah (misalnya berkas log teks cache aplikasi Android DJI Pilot yang hanya berisi baris teks diagnostik OS ponsel):
* Sistem menerapkan pemeriksaan *Magic Bytes Signature*:
  * Pada berkas `.ulg`, sistem memvalidasi header biner 7-byte pertama bernilai wajib `0x55 0x4C 0x6F 0x67 0x01 0x12 0x35` (ASCII: `ULog\x01\x125`).
  * Pada berkas KML/CSV, sistem memeriksa keberadaan tag koordinat XML `<coordinates>` atau header kolom wajib `[Latitude, Longitude, Altitude, Time]`.
* Jika berkas tidak memenuhi tanda tangan struktur biner penerbangan yang valid, sistem langsung menolak berkas sebelum dieksekusi (*early rejection*) dan menampilkan notifikasi ramah: *"Format log tidak valid: Berkas terdeteksi sebagai cache aplikasi, silakan unggah berkas log penerbangan pesawat asli."*

---

### C. Logika Audit Kepatuhan Otomatis (*Post-Flight 3D Airspace Corridor Audit*)

Algoritma audit kepatuhan post-flight mengevaluasi seluruh titik koordinat GPS telemetri penerbangan aktual secara objektif matematis melalui fungsi `computeSortieAuditSummary()`:

#### 1. Audit Kepatuhan Batas Elevasi / Ketinggian (AMSL vs AGL)
* **Adopsi Referensi Utama Klausul NOTAM AMSL:**
  Fungsi `getPermitCeilingReference(permit)` mengidentifikasi dokumen izin dan NOTAM terkait:
  * Jika pada izin terdapat klausul batas ketinggian berbasis laut (contoh pada izin PT Timah: *"1000 FT AMSL As per NOTAM B0598/26"*), sistem otomatis mengunci datum pengujian pada **AMSL (Above Mean Sea Level)**.
  * Sistem menghitung ketinggian riil AMSL pada tiap titik terbang dengan rumus:
    $$\text{Altitude AMSL} = \text{Tinggi Sensor AGL} + \text{Elevasi Titik Lepas Landas (Takeoff AMSL)}$$
  * **Bukti Kasus Riil PT Timah Bangka:**
    Drone lepas landas pada elevasi tanah 97,6 kaki AMSL dan terbang setinggi 998 kaki AGL. Ketinggian puncak drone terbaca **1.095,7 kaki AMSL**. Karena melampaui batas NOTAM 1.000 kaki AMSL sebesar 95,7 kaki, sistem langsung mendeteksi **1 Ceiling Breach (84% waktu terbang berada di atas plafon NOTAM)**.
* Jika tidak terdapat klausul NOTAM AMSL, sistem mengevaluasi berdasarkan batas standar vertikal 400 kaki AGL (atau nilai ketinggian khusus AGL pada SK izin).

#### 2. Audit Kepatuhan Batas Lateral / Horizontal (Geofence In-Polygon)
* Mengimplementasikan algoritma komputasi geometri **Ray-Casting Point-in-Polygon (PIP)**.
* Setiap koordinat GPS lintasan drone diuji apakah berada di dalam batas poligon izin yang diterbitkan Direktorat Navigasi Penerbangan.
* Jika drone keluar batas poligon, sistem mencatat jumlah kejadian pelanggaran perimeter (*perimeter breach count*) dan memotong segmen lintasan peta menjadi warna merah kontras (*Breach Polyline*).

#### 3. Audit Volume 3D (*3D Airspace Corridor Adherence*)
* Indikator gauge lingkaran pada panel inspektur merupakan **Gauge Kepatuhan Koridor Ruang Udara 3D** yang menghitung rasio titik penerbangan yang memenuhi kriteria ganda secara bersamaan:
  $$\text{Titik Patuh 3D} = (\text{Di Dalam Poligon 2D}) \textbf{ DAN } (\text{Di Bawah Plafon NOTAM AMSL})$$
  $$\text{3D Adherence \%} = \frac{\text{Jumlah Titik Patuh 3D}}{\text{Total Titik GPS Telemetri}} \times 100\%$$
* Pada kasus PT Timah, karena drone keluar batas atas NOTAM sebesar 84% waktu terbang, gauge langsung menunjukkan skor **`16% 3D Corridor Adherence`** dengan status merah peringatan, memberikan transparansi penuh kepada evaluator.

#### 4. Audit Batas Kecepatan & KKOP
* **Kecepatan:** Membandingkan kecepatan mendatar (*ground speed*) terhadap batas maksimum CASR 107 / PM 63 Tahun 2021 yaitu **87 knots** (161 km/jam).
* **KKOP Buffer:** Memverifikasi apakah ada titik terbang drone di luar izin yang mendekati atau menembus batas 5.000 meter KKOP bandara aktif terdekat.

---

### D. Antarmuka, Perbaikan Bug, & Portabilitas Sistem

1. **Kalibrasi Normalisasi Tuas Kendali 11-Bit (Virtual Joysticks HUD):**
   * Format sinyal kendali PWM/RC (PX4 & DJI) memiliki rentang nilai biner mentah 11-bit dari `1000 µs` (minimum) hingga `2000 µs` (maksimum) dengan titik netral di `1500 µs`.
   * Sistem melakukan pemetaan matematis (*linear clamping*):
     $$\text{Posisi Sumbu (-1.0 s.d. +1.0)} = \frac{\text{Nilai Raw} - 1500}{500}$$
   * Ditampilkan secara real-time pada HUD virtual stik kemudi (kiri: Throttle/Yaw, kanan: Pitch/Roll) yang bergerak presisi saat inspektur memutar ulang simulasi penerbangan (*flight replay*).
2. **Penanganan Hierarki Layer Antarmuka (CSS Z-Index Layering):**
   * Kanvas Leaflet.js yang memiliki komponen interaktif (`.leaflet-pane`) diberikan pembatas z-index dinamis (`z-0` hingga `z-[10]`).
   * Tombol kontrol pemutar ulang (*Flight Replay HUD*), sakelar kecepatan (1x, 2x, 5x, 10x), serta tuas kemudi virtual diatur dengan *stacking context* absolut pada kelas Tailwind `z-[1000]` dengan `pointer-events-auto`, sehingga interaksi klik, seek bar waktu, dan tombol play/pause tidak pernah terblokir oleh lapisan peta Leaflet.
3. **Portabilitas & Penanganan Keamanan Windows DPAPI:**
   * Alih-alih mengikat penyimpanan sesi ke kredensial Windows DPAPI laptop tertentu yang menyebabkan aplikasi *crash* atau meminta login ulang saat folder aplikasi dipindahkan ke laptop dinas lain, sistem menggunakan penyimpanan sesi lokal terstruktur (*standalone encrypted session*).
   * Aplikasi dapat dijalankan secara portabel (*plug-and-play*) dari media penyimpanan dinas (flashdisk/hard disk eksternal) pada seluruh komputer evaluator di kantor OTBAN Wilayah VI tanpa kendala ketergantungan *registry*.
4. **Fitur Ekspor Gambar Grafik Ultra-HD (3x Resolution):**
   * Di dalam Flight Studio, ditambahkan mesin ekspor instan grafik telemetri (*Altitude AGL, AMSL, Velocity, Battery*) menjadi berkas gambar **PNG resolusi tinggi (skala 3x / Retina Display)** dan **JPG**.
   * Gambar hasil ekspor secara otomatis dilengkapi *watermark header* resmi berisi: Nama Operator, Nomor Registrasi Izin PUTA, Jenis Profil Grafik, Waktu Ekspor, dan Tanda Pengenal OTBAN Wilayah VI Padang untuk dilampirkan langsung ke naskah dinas/laporan inspeksi.
5. **In-App Update Checker & GitHub Releases Integration:**
   * Di sebelah logo header aplikasi, terpasang tombol interaktif **`Check Update`**.
   * Sistem langsung menghubungi GitHub REST API repositori resmi (`luke231204/PUTA-Drone_Project`) untuk memverifikasi versi terbaru, menampilkan changelog perbaikan bug, dan menyediakan tautan unduh pembaruan rilis secara otomatis.

---

## II. Matriks Komparasi Sebelum vs Sesudah Aktualisasi (Bahan Tabel Subbab F)

Tabel berikut dirancang khusus untuk mempermudah penyusunan **Tabel Komparasi Evaluasi Kondisi Sebelum dan Sesudah Aktualisasi** pada **Laporan Akhir BAB III Subbab F**:

| No | Parameter Komparasi | Kondisi SEBELUM Aktualisasi (Konvensional) | Kondisi SESUDAH Aktualisasi (Menggunakan PUTA-Monitor v1.6.0) | Keterkaitan Nilai BerAKHLAK & Smart ASN |
|:--:|:-------------------|:------------------------------------------|:-------------------------------------------------------------|:----------------------------------------|
| **1** | **Metode Pengecekan Wilayah Izin Operasi Drone** | **Manual Visual Mata:** Evaluator mengecek koordinat derajat-menit-detik pada SK izin satu per satu atau mengetik ulang titik di Google Earth. Sangat lambat dan rawan *human error*. | **Digital Spasial Otomatis:** Seluruh poligon izin terpetakan otomatis di peta Leaflet.js dengan batas jelas, warna tematik, serta filter izin aktif/pending/off-hours. | **Smart ASN:** *Digital Skills*<br>**BerAKHLAK:** *Adaptif* & *Kompeten* |
| **2** | **Identifikasi Potensi Bahaya KKOP 13 Bandara** | **Menebak Jarak / Perkiraan Kasar:** Evaluator kesulitan memastikan apakah lokasi drone masuk radius KKOP bandara tanpa alat ukur geodesi instan. | **Deteksi Geodesi Real-Time:** Sistem otomatis menghitung jarak terdekat poligon ke 13 bandara OTBAN VI, memunculkan lingkaran batas KKOP 5 km & 15 km, dan memberi alarm visual merah jika melanggar. | **Manajemen ASN:** *Profesionalisme Tusi Keselamatan Penerbangan*<br>**BerAKHLAK:** *Akuntabel* |
| **3** | **Evaluasi Kepatuhan Pasca-Terbang (*Post-Flight Audit*)** | **Nir-Audit (Hanya Asumsi Administratif):** Tidak ada sarana membaca log data hitam penerbangan drone (hanya percaya pada laporan tertulis operator tanpa bukti telemetri). | **Audit Forensik Telemetri Ganda (PX4 & DJI):** Sistem membedah berkas log biner biner `.ulg`, `.bin`, `.txt`, `.csv`, `.kml` hingga puluhan ribu titik GPS dan parameter instrumen drone. | **Smart ASN:** *Digital Skills*<br>**BerAKHLAK:** *Akuntabel* & *Transparan* |
| **4** | **Pengawasan Plafon Ketinggian (AGL vs NOTAM AMSL)** | **Batas Standar Kaku (Sering Miss):** Petugas hanya mengacu pada aturan umum 400 kaki AGL, sering kecolongan pada elevasi daratan tinggi atau klausul khusus NOTAM AMSL. | **Audit Ketinggian Dinamis Berbasis NOTAM:** Sistem secara cerdas memprioritaskan klausul NOTAM AMSL jika ada, menghitung tinggi gabungan daratan + AGL, dan mendeteksi breach secara objektif. | **Smart ASN:** *Digital Ethics*<br>**BerAKHLAK:** *Kompeten* & *Kepastian Hukum* |
| **5** | **Pengukuran Kepatuhan Koridor Ruang Udara** | **Kualitatif / Subjektif:** Pernyataan patuh hanya didasarkan klaim operator tanpa angka persentase terukur. | **Kuantitatif Presisi (Gauge 3D Corridor Adherence):** Menghasilkan persentase riil (misal: 16% patuh, 84% breach) berdasarkan analisis matematis volume ruang udara 3 dimensi. | **Manajemen ASN:** *Akuntabilitas Pelaporan Kedinasan*<br>**BerAKHLAK:** *Akuntabel* |
| **6** | **Keamanan Data Strategis Nasional (*Data Safety*)** | **Ketergantungan Server Asing (Beresiko Spionase):** Jika staf ingin melihat log drone, berkas diunggah ke platform publik luar negeri (Airdata UAV di AS/Eropa), mengekspos koordinat instalasi vital negara. | **Kedaulatan Data Penuh (*Offline-First*):** Dekripsi dan analisis biner dilakukan 100% lokal pada CPU komputer dinas tanpa transmisi ke server asing. | **Smart ASN:** *Digital Safety*<br>**BerAKHLAK:** *Loyal* (Menjaga Rahasia Negara) |
| **7** | **Penyusunan Alat Bukti Laporan Inspeksi** | **Tangkapan Layar Seadanya:** Pengambilan bukti grafik manual beresolusi rendah, teks tidak terbaca saat dicetak di naskah dinas. | **Ekspor Gambar Ultra-HD Ber-Watermark Otomatis:** Tombol ekspor 1-klik menghasilkan gambar PNG/JPG skala 3x resolusi tajam dengan kop keterangan resmi instansi OTBAN VI. | **BerAKHLAK:** *Pelayanan Prima* & *Kolaboratif* |
| **8** | **Pemeliharaan & Pembaruan Aplikasi** | **Instalasi Ulang Manual:** Setiap perbaikan kode harus dikirim ulang manual antarkomputer, versi aplikasi tidak seragam. | **In-App GitHub Update Checker:** Tombol *Check Update* memeriksa versi rilis GitHub secara real-time dan menampilkan changelog pembaruan langsung di aplikasi. | **Smart ASN:** *Digital Culture* (Kultur Kerja Tangkas/Agile) |

---

## III. Artikulasi Penyelesaian Isu Berdasarkan Kedudukan dan Peran PNS

Bagian ini merupakan naskah narasi siap pakai untuk mengisi pembahasan analitis pada **BAB III Subbab F Laporan Aktualisasi**:

### 1. Keterkaitan dengan Pilar Smart ASN

#### a. *Digital Skills* (Kecakapan Digital Aparatur)
Inovasi **PUTA-Monitor v1.6.0** membuktikan peningkatan kompetensi teknis aparatur dari evaluator konvensional yang pasif menjadi aparatur yang menguasai ekosistem rekayasa perangkat lunak modern:
* Menguasai arsitektur desktop multi-platform (*Electron framework, Node.js, HTML5/Tailwind CSS, dan Vanilla JavaScript*).
* Mampu merekayasa algoritma analisis spasial spasial (*Leaflet.js GIS, Geodesic Haversine Distance, dan Ray-Casting Polygon Intersection*).
* Mampu memprogram integrasi parser biner telemetri aeronautika tingkat lanjut (*PX4 pyulog converter dan WebAssembly-based DJI decryptor*) untuk membaca data instrumen black-box penerbangan tanpa awak.

#### b. *Digital Safety* (Keamanan Digital & Kedaulatan Data Nasional)
Aspek keselamatan dan kerahasiaan data merupakan nilai fundamental yang dijunjung tinggi dalam proyek ini:
* **Perlindungan Objek Vital Nasional:** Wilayah kerja OTBAN Wilayah VI mencakup fasilitas energi dan sumber daya alam strategis (seperti pertambangan timah di Bangka Belitung dan ladang minyak bumi di Riau/Kepri). Penggunaan sistem penganalisis log telemetri yang berjalan **100% *offline-first*** memastikan koordinat geospasial ketinggian, batas tambang, dan fasilitas vital tersebut tidak bocor ke server pihak ketiga di luar yurisdiksi Republik Indonesia (*zero-leakage data sovereignty*).
* **Keamanan Autentikasi dan Basis Data:** Menerapkan enkripsi sesi lokal dan kebijakan *Row Level Security (RLS)* pada basis data cloud Supabase guna mencegah akses tidak sah terhadap riwayat perizinan operasional drone dinas.

#### c. *Digital Culture* (Budaya Kerja Digital yang Terstandarisasi)
Aktualisasi ini merevolusi budaya kerja di Seksi Pengoperasian Bandar Udara dan Angkutan Udara OTBAN Wilayah VI Padang:
* Mengubah kultur birokrasi manual yang lambat, berbasis dokumen fisik (*paper-heavy*), dan penuh interpretasi visual subjektif menjadi **kultur kerja analitis berbasis bukti digital (*evidence-based analytical culture*)**.
* Menanamkan transparansi pengawasan ruang udara melalui visualisasi dasbor terintegrasi dan sistem pelaporan kepatuhan terstandarisasi.

#### d. *Digital Ethics* (Etika Digital & Akuntabilitas Evaluasi Publik)
Etika pengawasan penerbangan menuntut aparatur bersikap jujur, adil, dan tidak berpihak:
* Melalui algoritma audit otomatis, penetapan status kepatuhan (*Compliant* vs *Breach*) tidak didasarkan atas kedekatan atau kompromi dengan pihak operator drone, melainkan sepenuhnya didikte oleh data rekaman penerbangan faktual (*telemetry ground-truth*).
* Sistem memberikan kepastian hukum yang adil bagi operator: operator yang disiplin mendapatkan bukti kepatuhan 100%, sedangkan pelanggaran batas ruang udara (seperti kasus kelebihan batas plafon NOTAM 1000 ft AMSL) ditampilkan secara transparan dan akuntabel.

---

### 2. Keterkaitan dengan Nilai-Nilai Dasar Manajemen ASN

Penyelenggaraan fungsi pengawasan pengoperasian pesawat udara tanpa awak merupakan pengejawantahan dari pelaksanaan tugas dan fungsi jabatan PNS di Direktorat Jenderal Perhubungan Udara:

#### a. Peningkatan Profesionalisme Jabatan Pengevaluasi Penerbangan
Undang-Undang Nomor 20 Tahun 2023 tentang Aparatur Sipil Negara mewajibkan PNS memiliki kompetensi unggul di bidang keahliannya. Melalui inovasi PUTA-Monitor, evaluator tidak lagi bekerja secara kaku hanya mengecek tanda tangan berkas, namun memiliki kapabilitas forensik ruang udara:
* Mampu menganalisis dinamika ruang udara real-time (terintegrasi ADS-B Live Airspace Monitor untuk mitigasi risiko tabrakan drone dengan pesawat komersial).
* Mampu menjamin bahwa setiap izin yang diterbitkan OTBAN Wilayah VI terlaksana sesuai parameter keselamatan dokumen perizinan dan NOTAM dari Perum LPPNPI (AirNav Indonesia).

#### b. Akuntabilitas Kinerja Pelayanan Publik dan Keselamatan Penerbangan
Tolak ukur kinerja ASN di Kementerian Perhubungan adalah **Keselamatan dan Keamanan Penerbangan (*Aviation Safety & Security*)**:
* Adanya fitur audit 3D Airspace Corridor memastikan risiko penerbangan liar di ruang udara terkelola (*controlled airspace*) dan zona KKOP 13 bandara dapat ditekan hingga titik nol (*zero accidents*).
* Rekomendasi teknis yang dikeluarkan oleh staf evaluator kepada pimpinan OTBAN Wilayah VI Padang kini didukung oleh data forensik yang sahih, teruji, dan dapat dipertanggungjawabkan di hadapan hukum.

---

## IV. Petunjuk Penggunaan untuk Naskah Laporan Aktualisasi

1. **Untuk Tabel Subbab F:** Salin matriks komparasi pada **Bagian II** langsung ke format tabel Word Laporan Aktualisasi Anda pada kolom *"Kondisi Sebelum"* dan *"Kondisi Sesudah"*.
2. **Untuk Narasi Analisis Pembahasan:** Gunakan uraian pada **Bagian III** sebagai narasi pengantar dan penutup tabel untuk menjawab arahan Coach Octadian mengenai integrasi nyata Agenda III (Smart ASN & Manajemen ASN).
3. **Untuk Lampiran Bukti Teknis (Evidence):** Fitur ekspor grafik HD (`PNG/JPG`) dan tangkapan layar dasbor dasbor PUTA-Monitor v1.6.0 dapat langsung disematkan sebagai lampiran eviden pengujian sistem.
