# LAPORAN PANDUAN DESAIN SISTEM DAN SPESIFIKASI ANTARMUKA PENGGUNA
# (*UI/UX DESIGN SYSTEM GUIDE & INTERFACE SPECIFICATIONS*)

**Nama Sistem:** Dashboard Pemantauan Lapangan Sensus Ekonomi 2026 (SE2026) & Multi-Survei BPS PPU (Pananyo Taka)  
**Institusi Pengembang:** Badan Pusat Statistik (BPS) Kabupaten Penajam Paser Utara  
**Versi Sistem:** 2.3.0  
**Penyusun:** Yahya Abdurrohman  
**Pengesah / Mentor:** Ketua Tim IPJKD & DLS BPS Kab. PPU (Ketua Tim IPJKD & DLS BPS Kabupaten Penajam Paser Utara)  
**Tanggal Rilis:** Agustus 2026  
**Klasifikasi Dokumen:** Laporan Teknis Standar Desain Antarmuka (*Technical Interface Design Guideline*)

---

## LEMBAR PENGESAHAN PANDUAN DESAIN SISTEM

Dokumen Laporan Panduan Desain Sistem dan Spesifikasi Antarmuka Pengguna (*UI/UX Design System Guide*) ini telah ditelaah, diverifikasi, dan disahkan sebagai acuan baku perancangan antarmuka pengguna pada Sistem Informasi Dasbor Pemantauan Sensus dan Survei (Pananyo Taka) Badan Pusat Statistik Kabupaten Penajam Paser Utara.

| Peran | Nama & Gelar | Jabatan / Unit Kerja | Tanda Tangan & Persetujuan |
| :--- | :--- | :--- | :--- |
| **Penyusun** | Yahya Abdurrohman | Pranata Komputer Ahli Pertama / Peserta Latsar CPNS Gol. III | *(Disahkan)* |
| **Mentor / Pengesah** | Ketua Tim IPJKD & DLS BPS Kab. PPU | Ketua Tim IPJKD & DLS BPS Kabupaten Penajam Paser Utara | *(Disetujui)* |
| **Reviewer Teknis** | Tim IT Seksi Pengolahan & Tim IPJKD & DLS Data & Tim IPJKD & DLS | Seksi Pengolahan & TI BPS Kabupaten Penajam Paser Utara | *(Terverifikasi)* |

---

## DAFTAR ISI
1. [Ringkasan Eksekutif & Prinsip Desain Utama](#1-ringkasan-eksekutif--prinsip-desain-utama)
2. [Paket Warna Lengkap & Sistem Tema Multi-Survei](#2-paket-warna-lengkap--sistem-tema-multi-survei)
3. [Standar Tipografi & Skala Keterbacaan Mobile (WCAG 2.1 AA)](#3-standar-tipografi--skala-keterbacaan-mobile-wcag-21-aa)
4. [Geometri, Spacing, Elevasi & Tata Visual](#4-geometri-spacing-elevasi--tata-visual)
5. [Spesifikasi Komponen Antarmuka Inti](#5-spesifikasi-komponen-antarmuka-inti)
6. [Standardisasi Notasi Bracket Status Kinerja](#6-standardisasi-notasi-bracket-status-kinerja)
7. [Tata Letak Responsif & Panduan Viewport Multi-Perangkat](#7-tata-letak-responsif--panduan-viewport-multi-perangkat)
8. [Matriks Larangan & Praktik Terbaik (Do's & Don'ts)](#8-matriks-larangan--praktik-terbaik-dos--donts)
9. [Panduan Implementasi Pengembang (Developer Handoff Guide)](#9-panduan-implementasi-pengembang-developer-handoff-guide)

---

## 1. Ringkasan Eksekutif & Prinsip Desain Utama

### 1.1. Latar Belakang Desain
Aplikasi **Pananyo Taka** dirancang untuk menjawab tantangan pengawasan lapangan Sensus Ekonomi 2026 (SE2026) dan berbagai survei statistik rutin BPS di wilayah Kabupaten Penajam Paser Utara (PPU). Mengingat pengguna sistem mencakup beragam tingkatan—mulai dari Pimpinan Satuan Kerja, Koordinator Lapangan (Korlap), Pengawas Lapangan (PML), hingga Petugas Pencacah Lapangan (PCL) di pelosok desa—antarmuka sistem dituntut memiliki:
* **Keterbacaan Sangat Tinggi:** Dapat dibaca dengan jelas di layar ponsel saat kondisi pencahayaan terik matahari di lapangan.
* **Kecepatan Akses Visual:** Menampilkan status anomali dan peringatan dini secara instan tanpa membuat pengguna bingung oleh ornamen grafis yang tidak esensial.
* **Keseragaman Visual (Konsistensi Sistem):** Mengadopsi arsitektur desain terpadu yang dapat digunakan oleh seluruh kegiatan survei statistik BPS secara modular (*theme-isolated architecture*).

### 1.2. Empat Pilar Prinsip Desain Utama
1. **Precision & Data-Centric (Berorientasi Presisi Data):**  
   Setiap komponen visual dibangun untuk mempercepat pemahaman data statistik sensus. Angka realisasi, deviasi target, dan status verifikasi disajikan secara transparan.
2. **Strict Geometric Discipline (Geometri Sudut Tegas 90°):**  
   Menerapkan sudut tajam (order-radius: 0px / 
ounded: 0) pada kontainer kartu, tombol tindakan, badge status, dan tabel untuk menciptakan karakter visual yang kokoh, berorientasi analitik, dan berstandar *enterprise*.
3. **High-Contrast Visual Accessibility (Kepatuhan WCAG 2.1 AA):**  
   Rasio kontras warna teks terhadap latar belakang dipertahankan **minimal 4.5:1** untuk teks isi normal dan **minimal 3:1** untuk teks judul/angka besar.
4. **Structured Bracket Status Indicators (Standar Teks Bracket):**  
   Seluruh status operasional disajikan dalam format teks bracket terstruktur (contoh: [ON-TRACK], [ALERT STAGNAN], [PRIORITAS 1]) untuk menggantikan penggunaan emoji informal dalam laporan kedinasan.

---

## 2. Paket Warna Lengkap & Sistem Tema Multi-Survei

Sistem antarmuka Pananyo Taka mengadopsi sistem **Dual-Mode (Dark Mode & Light Mode)** dengan dukungan isolasi tema otomatis per kegiatan survei.

### 2.1. Token Warna Dasar Kanvas & Permukaan (*Base Surface Tokens*)

| Token CSS | Mode Gelap (Dark Slate - Default) | Mode Terang (Sand Ceramic) | Peruntukan Visual |
| :--- | :--- | :--- | :--- |
| --bg-primary | #0F0F12 | #F5EFE6 | Latar belakang kanvas utama aplikasi |
| --bg-secondary | #15151B | #FDFCFB | Latar panel samping & sub-header |
| --bg-card | #1B1B24 | #FDFCFB | Latar kartu metrik, grafik, dan tabel data |
| --bg-card-hover | #23232F | #EBE4D8 | Latar kartu saat kursor diarahkan (*hover*) |
| --border | #292938 | #DFD5C6 | Garis pembatas kartu & header tabel (1px) |
| --border-light | #353549 | #D3C9B8 | Garis pemisah baris data (*table divider*) |
| --text-primary | #F1F5F9 | #3C332E | Teks judul utama, angka KPI, label tebal |
| --text-secondary | #94A3B8 | #52473F | Teks keterangan, tanggal, label statistik |
| --text-muted | #8E9EAB | #5D5248 | Teks bantuan (*helper*), watermark, placeholder |

### 2.2. Paket Warna Tema Multi-Survei (*Survey Theme Packs*)

`
[1. SENSUS EKONOMI 2026 (SE2026) - THEME ORANGE (BRAND UTAMA)]
• Primary Accent       : #F97316 (Vivid BPS Orange)
• Primary Hover        : #EA580C (Deep Amber Orange)
• Secondary Accent     : #FACC15 (Golden Sun)
• Gradient Hero        : linear-gradient(135deg, #F97316 0%, #EA580C 50%, #FACC15 100%)
• Glow Effect          : 0 16px 36px -8px rgba(249, 115, 22, 0.35)
• Badge Tag Background : rgba(249, 115, 22, 0.12) | Border: rgba(249, 115, 22, 0.35)

[2. SAKERNAS PEMUTAKHIRAN - THEME CYAN & OCEANIC TEAL]
• Primary Accent       : #06B6D4 (Electric Cyan)
• Primary Hover        : #0891B2
• Secondary Accent     : #10B981 (Emerald Mint)
• Gradient Hero        : linear-gradient(135deg, #06B6D4 0%, #0891B2 50%, #10B981 100%)
• Glow Effect          : 0 16px 36px -8px rgba(6, 182, 212, 0.35)

[3. SAKERNAS PENDATAAN - THEME ROYAL INDIGO & VIOLET]
• Primary Accent       : #8B5CF6 (Royal Violet)
• Primary Hover        : #7C3AED
• Secondary Accent     : #6366F1 (Indigo Pulse)
• Gradient Hero        : linear-gradient(135deg, #8B5CF6 0%, #7C3AED 50%, #6366F1 100%)
• Glow Effect          : 0 16px 36px -8px rgba(139, 92, 246, 0.35)
`

### 2.3. Token Warna Semantik Operasional Lapangan

| Status Semantik | Kode HEX (Dark) | Kode HEX (Light) | Latar Badge (Alpha 12%) | Penerapan Fungsional |
| :--- | :--- | :--- | :--- | :--- |
| 🟢 **Success / Aman** | #34D399 | #047857 | 
gba(52, 211, 153, 0.12) | Dokumen Approved, progres $\ge 80\%$, on-track |
| 🟡 **Warning / Waspada**| #FBBF24 | #D97706 | 
gba(251, 191, 36, 0.12) | Dokumen draft, progres \%-79\%$, at-risk |
| 🔴 **Danger / Kritis** | #F87171 | #B91C1C | 
gba(248, 113, 113, 0.12)| Petugas stuck $\ge 3$ hari, anomali data, progres $<40\%$ |
| 🔵 **Info / Submitted**| #0284C7 | #0369A1 | 
gba(2, 132, 199, 0.12) | Dokumen dikirim PCL menunggu review PML |
| 🟣 **AI Intelligence** | #A78BFA | #6D28D9 | 
gba(167, 139, 250, 0.12)| Asisten cerdas KIPP, kueri SQL otomatis |

---

## 3. Standar Tipografi & Skala Keterbacaan Mobile

Sistem menggunakan rangkaian font **Inter** sebagai tipografi utama yang dioptimalkan untuk perangkat layar beresolusi tinggi maupun layar smartphone entry-level.

### 3.1. Matriks Skala Tipografi Baku

`
┌──────────────────────────┬───────────┬──────────────┬─────────────┬──────────────────────────────┐
│ Hierarki Teks            │ Ukuran px │ Font Weight  │ Line Height │ Kegunaan / Target Komponen   │
├──────────────────────────┼───────────┼──────────────┼─────────────┼──────────────────────────────┤
│ 1. Hero / Big Stat       │ 24px–28px │ 800 (Bold)   │ 1.2         │ Angka total capaian sensus   │
│ 2. Header / Title Large  │ 20px–22px │ 700 (Bold)   │ 1.3         │ Judul halaman & nama menu    │
│ 3. Sub-Header / Card     │ 16px–18px │ 600 (Semi)   │ 1.4         │ Judul kartu dasbor & modal   │
│ 4. Body Text (Primary)   │ 14px–15px │ 400 / 500    │ 1.5         │ Isi tabel, teks paragraf     │
│ 5. Helper / Small Text   │ 12px–13px │ 500 (Medium) │ 1.4         │ Sub-label, keterangan status │
│ 6. Caption / Micro Badge │ 10px–11px │ 700 (Bold)   │ 1.2         │ Badge bracket, timestamp jam │
└──────────────────────────┴───────────┴──────────────┴─────────────┴──────────────────────────────┘
`

### 3.2. Pedoman Aksesibilitas Tipografi Mobile
* **Batas Ukuran Minimal Teks Kritis:** Seluruh informasi krusial (angka beban kerja, nama wilayah, status verifikasi) tidak boleh lebih kecil dari **12px**. Ukuran **10px–11px** hanya diizinkan untuk teks non-kritis seperti timestamp detik jam atau badge status mikro.
* **Line-Height Standar:** Rentang line height dipertahankan antara **1.4 s.d. 1.6** dari ukuran font guna mencegah tumpang tindih teks pada layar kecil.

---

## 4. Geometri, Spacing, Elevasi & Tata Visual

### 4.1. Spesifikasi Geometri & Sudut
* **Kontainer Kartu Metrik:** order-radius: 0px; (Sudut Siku 90°)
* **Tombol Aksi Utama & Sekunder:** order-radius: 0px; (atau maksimal 4px untuk tombol ikon mikro)
* **Badge Tag Bracket:** order-radius: 0px;
* **Input Formulir & Dropdown:** order-radius: 0px;

### 4.2. Sistem Jarak (*Spacing System*)
Mengadopsi sistem kelipatan baku **4px / 8px**:
* **Padding Kontainer Kartu (Desktop):** 20px 24px
* **Padding Kontainer Kartu (Mobile):** 14px 16px
* **Gap Grid Antar Kartu:** 16px s.d. 20px
* **Margin Pemisah Antar Bab:** 24px s.d. 32px

### 4.3. Lapisan Kaca & Elevasi (*Dark Glassmorphism*)
* **Border:** 1px solid var(--border)
* **Backdrop Blur:** ackdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
* **Bayangan (Dark Mode):** ox-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
* **Bayangan (Light Mode):** ox-shadow: 0 4px 20px rgba(60, 51, 46, 0.05);

---

## 5. Spesifikasi Komponen Antarmuka Inti

### 5.1. Kartu Metrik Speedometer & Proyeksi Selesai
* Menampilkan persentase pencapaian total di tengah dengan gauge setengah lingkaran (*speedometer*).
* Menampilkan perbandingan angka absolut: Realisasi Dokumen / Total Target FASIH-SM.
* Menampilkan teks proyeksi estimasi tanggal selesai (*Burn-down Date*) dan status ketercapaian [ON-TRACK] atau [AT-RISK].

### 5.2. Indikator Milestone Target Nasional
* **Milestone 1 (Target 25% - 30 Juni):** Menampilkan status [TERCAPAI 100%] (Warna Emerald).
* **Milestone 2 (Target 40% - 15 Juli):** Menampilkan status [TERCAPAI 100%] (Warna Emerald).
* **Milestone 3 (Target 100% - 31 Juli):** Menampilkan bar progres aktif dengan animasi pulsa oranye.

### 5.3. Peta Tematik Spasial GIS (Leaflet GeoJSON)
* Memvisualisasikan batas poligon 4 kecamatan dan 54 desa/kelurahan di PPU (Batas Wilayah PPU.kml).
* **Skema Warna Choropleth:**
  - 🟢 Hijau Emerald (#34D399, Opasitas 0.70): Progres $\ge 80\%$
  - 🟡 Kuning Amber (#FBBF24, Opasitas 0.70): Progres \% - 79\%$
  - 🔴 Merah Crimson (#F87171, Opasitas 0.75): Progres $< 40\%$
* **Popup Card Interaktif:** Menyajikan Nama Desa, Target Dokumen, Dokumen Approved, dan Nama PML Penanggung Jawab.

### 5.4. Grafik Tren Progres Harian & Heatmap Aktivitas
* **Grafik Garis Ganda (Chart.js):** Garis Oranye Solid (Realisasi Dokumen Selesai) vs Garis Putih Putus-putus (Target Ideal Proyeksi).
* **Heatmap Aktivitas Harian (30 Hari):** Matriks kotak gaya GitHub yang menampilkan volume penyelesaian harian (gradasi warna abu-abu ke hijau tua).

### 5.5. Tabel Analitik Rekapitulasi Wilayah & Petugas
* **Header Tabel:** Huruf kapital penuh (*uppercase*), ukuran 11px, font-weight 700, dengan fitur penyortiran dan filter kolom langsung (*Excel-like live filter*).
* **Baris Data:** Dilengkapi penanda badge status bracket dan tombol aksi cepat drill-down.

### 5.6. Modul Asisten Cerdas KIPP (AI Agent Sandbox)
* Antarmuka ruang obrolan cerdas (*chat container*) dengan saran pertanyaan instan (*quick prompt chips*).
* Penyajian hasil kueri dalam format narasi eksekutif berbahasa Indonesia formal disertai tabel data tabular hasil eksekusi kueri SQL.

---

## 6. Standardisasi Notasi Bracket Status Kinerja

| Format Teks Bracket | Warna Teks & Border | Latar Badge | Kondisi Penggunaan |
| :--- | :--- | :--- | :--- |
| [ON-TRACK] | #34D399 | 
gba(52, 211, 153, 0.12) | Capaian memenuhi target milestone dan laju harian normal |
| [ALERT STAGNAN] | #F87171 | 
gba(248, 113, 113, 0.12) | Petugas tidak memiliki penambahan progres $\ge 3$ hari |
| [AT-RISK] | #FBBF24 | 
gba(251, 191, 36, 0.12) | Laju harian rendah, diproyeksikan melewati batas waktu |
| [PRIORITAS 1] | #F97316 | 
gba(249, 115, 22, 0.12) | Wilayah/petugas wajib dikunjungi supervisi lapangan |
| [MENUNGGU VERIFIKASI]| #0284C7 | 
gba(2, 132, 199, 0.12) | Dokumen berstatus submitted dari PCL menunggu persetujuan PML |
| [SELESAI 100%] | #34D399 | 
gba(52, 211, 153, 0.12) | Seluruh target beban dokumen telah diverifikasi approved |

---

## 7. Tata Letak Responsif & Panduan Viewport Multi-Perangkat

### 7.1. Breakpoints Tata Letak
* **Mobile Viewport (Smartphone):** 320px – 480px (Target Optimal: 390px / 414px)
* **Tablet Viewport (iPad/Tablet):** 481px – 1024px (Target Optimal: 768px / 820px)
* **Desktop Viewport (Monitor):** 1025px – 1920px (Target Optimal: 1920 × 1080 Full HD)

### 7.2. Tata Letak Khusus Mobile (< 768px)
1. **Fixed Bottom Navigation Bar (64px):**  
   Menyediakan 5 menu cepat di bagian bawah layar ponsel:
   - [🏠 Beranda] (Overview)
   - [🗺️ Peta GIS] (Spatial Progress)
   - [👥 Petugas] (PCL/PML Drilldown)
   - [⚠️ EWS] (Early Warning Alert)
   - [🤖 KIPP AI] (Asisten Virtual)
2. **Stacking Kartu Vertikal:**  
   Grid horizontal pada desktop diubah menjadi urutan tumpuk vertikal dengan jarak antar kartu 12px.
3. **Sticky Column Data:**  
   Kolom pertama tabel (Nama Wilayah / Petugas) dibuat tetap (*sticky left*) saat tabel digeser ke samping pada layar smartphone.
4. **Touch Target Size:**  
   Ukuran tombol dan ikon interaktif minimal **44 × 44 px** untuk mempermudah operasional sentuh.

---

## 8. Matriks Larangan & Praktik Terbaik (Do's & Don'ts)

### 8.1. Praktik Terbaik (*Do's*)
* Gunakan rasio kontras tinggi minimal 4.5:1 untuk menjamin keterbacaan data di bawah sinar matahari.
* Pertahankan sudut tegas 90° (
ounded: 0) pada kartu analitik untuk menjaga wibawa dan konsistensi desain sistem.
* Gunakan tag bracket [STATUS] formal untuk seluruh indikator kinerja lapangan.
* Sediakan tombol aksi cepat WhatsApp pada baris petugas bermasalah untuk mempermudah koordinasi PML/Korlap.
* Terapkan format angka ribuan berstandar Indonesia (titik sebagai pemisah ribuan: 24.500).

### 8.2. Larangan Keras (*Don'ts*)
* **DILARANG** menggunakan sudut membulat berlebihan (order-radius: 20px / 30px atau *pill-shaped*) pada kartu tabel data.
* **DILARANG** menggunakan emoji informal (seperti 🚀, 🔥, 🥳) sebagai status resmi dalam tabel atau laporan.
* **DILARANG** menggunakan teks abu-abu tipis (#CBD5E1) di atas latar putih pada Mode Terang.
* **DILARANG** menyajikan tabel data panjang tanpa fitur pencarian langsung (*live search*) atau filter kolom.
* **DILARANG** menggunakan ukuran font di bawah 12px untuk angka target dan informasi krusial.

---

## 9. Panduan Implementasi Pengembang (Developer Handoff Guide)

Seluruh token desain dalam dokumen ini telah terintegrasi langsung pada repositori sistem melalui berkas:
1. public/css/style.css: Berkas master CSS yang memuat variabel tema dasar, tipografi, dan komponen global.
2. public/css/survey-themes.css: Berkas modul isolasi tema multi-survei (SE2026, Sakernas Pemutakhiran, Sakernas Pendataan).
3. iews/layout.ejs: Master template EJS yang menyuntikkan class tema dinamis (survey-theme-se2026, light-mode) berdasarkan parameter sesi dan survei aktif.

---
*Laporan Panduan Desain Sistem ini disusun secara resmi sebagai bagian dari Dokumentasi Rekayasa Perangkat Lunak SDLC Phase 2 Sistem Pananyo Taka BPS Kabupaten Penajam Paser Utara.*
