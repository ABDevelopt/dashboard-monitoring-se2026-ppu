# LAPORAN AKHIR KEGIATAN 2
# PERANCANGAN SISTEM DAN PERANGKAT LUNAK
# *(SYSTEM & SOFTWARE DESIGN — SDLC PHASE 2)*

---

| **Nama Sistem** | Dashboard Pemantauan Lapangan Sensus dan Survei Berbasis Web dan Kecerdasan Buatan ("Pananyo Taka") |
| :--- | :--- |
| **Institusi** | Badan Pusat Statistik (BPS) Kabupaten Penajam Paser Utara |
| **Versi Sistem** | 1.0.0 (Produksi) |
| **Penyusun** | Yahya Abdurrohman, S.Tr.Stat. (NIP. 20021106 202603 1 003) |
| **Jabatan** | Pranata Komputer Ahli Pertama |
| **Mentor / Pengesah** | Baihaqi Ilham Syah, S.Tr.Stat. (NIP. 19980820 202201 1 001) |
| **Tanggal Dokumen** | 15 Agustus 2026 |
| **Klasifikasi** | Laporan Teknis Resmi — Rekayasa Perangkat Lunak |

---

## LEMBAR PENGESAHAN

Laporan Akhir Kegiatan 2: Perancangan Sistem dan Perangkat Lunak (*System & Software Design — SDLC Phase 2*) ini telah disusun, ditelaah, dan disahkan sebagai dokumen teknis resmi dalam rangka Pelaksanaan Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026.

| Peran | Nama & Gelar | Jabatan / Unit Kerja | Persetujuan |
| :--- | :--- | :--- | :--- |
| **Penyusun** | **Yahya Abdurrohman, S.Tr.Stat.**<br/>NIP. 20021106 202603 1 003 | Pranata Komputer Ahli Pertama / Peserta Latsar CPNS Gol. III | *(Disahkan)* |
| **Mentor / Pengesah** | **Baihaqi Ilham Syah, S.Tr.Stat.**<br/>NIP. 19980820 202201 1 001 | Ketua Tim IPJKD & DLS BPS Kab. Penajam Paser Utara | *(Disetujui)* |
| **Reviewer Teknis** | **Tim TI / Seksi Pengolahan Data** | Seksi Pengolahan & TI BPS Kab. Penajam Paser Utara | *(Terverifikasi)* |

**Penajam, 15 Agustus 2026**

---

## DAFTAR ISI

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Tujuan & Ruang Lingkup Kegiatan 2](#2-tujuan--ruang-lingkup-kegiatan-2)
3. [Tahapan Kegiatan & Luaran](#3-tahapan-kegiatan--luaran)
   - 3.1. Tahapan 2.1 — Perancangan Skema Relasional Basis Data
   - 3.2. Tahapan 2.2 — Panduan Desain Sistem & UI/UX
   - 3.3. Tahapan 2.3 — Arsitektur Modul AI (RAG Pipeline)
   - 3.4. Tahapan 2.4 — Review Desain Teknis Bersama Tim IT
4. [Analisis Kebutuhan Sistem](#4-analisis-kebutuhan-sistem)
5. [Arsitektur Perangkat Lunak](#5-arsitektur-perangkat-lunak)
6. [PILAR 1: Pemodelan Proses (Process Modeling)](#6-pilar-1-pemodelan-proses-process-modeling)
   - 6.1. System Context Diagram (DFD Level 0)
   - 6.2. Use Case Diagram Sistem
   - 6.3. Data Flow Diagram (DFD) Level 1
   - 6.4. Activity Diagram Alur Pemantauan Sensus
   - 6.5. Sequence Diagram AI RAG Pipeline (KIPP Agent)
7. [PILAR 2: Pemodelan Data (Data Modeling)](#7-pilar-2-pemodelan-data-data-modeling)
   - 7.1. Entity Relationship Diagram (ERD Relasional 19 Tabel 3NF)
   - 7.2. Kamus Data & Desain Skema Database SQLite WAL
8. [PILAR 3: Desain Antarmuka Pengguna & Arsitektur Sistem](#8-pilar-3-desain-antarmuka-pengguna--arsitektur-sistem)
   - 8.1. Principles & Design System Guide (UI/UX)
   - 8.2. 3-Tier Layered System Architecture Model
9. [Arsitektur Modul Fungsional Utama](#9-arsitektur-modul-fungsional-utama)
10. [Aspek Keamanan, Keandalan & Kinerja](#10-aspek-keamanan-keandalan--kinerja)
11. [Rencana Implementasi (Fase 3)](#11-rencana-implementasi-fase-3)
12. [Kesimpulan](#12-kesimpulan)
13. [Lampiran — Daftar Dokumen Pendukung](#13-lampiran--daftar-dokumen-pendukung)

---

## 1. Ringkasan Eksekutif

Kegiatan 2 (Perancangan Sistem dan Perangkat Lunak) merupakan tahap kedua dari siklus pengembangan perangkat lunak (*Software Development Life Cycle* — SDLC) model Waterfall yang diterapkan dalam aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026. Kegiatan ini berpedoman pada hasil Analisis Kebutuhan yang telah disahkan pada Kegiatan 1 (Fase 1).

Pada fase ini, seluruh cetak biru teknis (*technical blueprint*) sistem **Pananyo Taka** — Dashboard Pemantauan Lapangan Sensus dan Survei Berbasis Web dan Kecerdasan Buatan pada BPS Kabupaten Penajam Paser Utara — berhasil dirancang secara komprehensif, mencakup:

- **7 (tujuh) Diagram Perancangan Sistem** standar rekayasa perangkat lunak (System Context DFD Level 0, Use Case Diagram, DFD Level 1, ERD 19 Tabel 3NF, 3-Tier Layered Architecture, Activity Diagram, dan Sequence Diagram AI RAG Pipeline).
- **Panduan Desain Sistem & UI/UX** (*Design System Guide*) dengan standar aksesibilitas WCAG 2.1 AA dan skala tipografi mobile (12px–22px).
- **Spesifikasi Skema Basis Data** relasional 19 tabel SQLite dengan mode Write-Ahead Logging (WAL).
- **Arsitektur Modul AI** berbasis Retrieval-Augmented Generation (RAG) dengan integrasi Google Gemini LLM dan sandbox kueri read-only.
- **Berita Acara Review Desain Teknis** Nomor BA-02.04/BPS/6409/08/2026 bersama Tim IT Seksi Pengolahan Data BPS Kabupaten Penajam Paser Utara.

Seluruh luaran Kegiatan 2 berfungsi sebagai acuan baku dan landasan formal bagi pelaksanaan Kegiatan 3 (Implementasi & Coding — SDLC Phase 3).

---

## 2. Tujuan & Ruang Lingkup Kegiatan 2

### 2.1. Tujuan
1. Merancang arsitektur teknis sistem **Pananyo Taka** secara utuh dan terstruktur menggunakan notasi desain perangkat lunak standar (UML, DFD, ERD).
2. Menetapkan spesifikasi skema basis data SQLite relasional yang siap diimplementasikan pada fase pengkodean.
3. Menyusun panduan desain antarmuka pengguna yang konsisten, aksesibel, dan responsif terhadap kebutuhan lapangan BPS PPU.
4. Merancang arsitektur modul kecerdasan buatan (*AI Module Architecture*) berbasis RAG untuk mendukung analitik bahasa alami.
5. Mendapatkan validasi teknis dan persetujuan formal dari pemangku kepentingan (Mentor dan Tim IT) atas seluruh rancangan sistem.

### 2.2. Ruang Lingkup
Perancangan sistem pada Kegiatan 2 mencakup:
- Sistem utama: Dashboard Pemantauan Lapangan Sensus Ekonomi 2026 (SE2026) PPU
- Arsitektur multi-survei dinamis: Integrasi survei rutin (Sakernas Pemutakhiran Listing & Sakernas Pendataan Sampel)
- Modul KIPP (Kelompok Informasi dan Performa Petugas): Asisten virtual berbasis AI
- Subsistem notifikasi otomatis: Gateway WhatsApp Baileys
- Subsistem pemetaan spasial: GIS Leaflet dengan data KML Batas Wilayah PPU

---

## 3. Tahapan Kegiatan & Luaran

### 3.1. Tahapan 2.1 — Perancangan Skema Relasional Basis Data
- **Deskripsi:** Merancang struktur skema relasional 19 tabel basis data lokal SQLite WAL mencakup 4 zona data (Master Wilayah, Transaksi Lapangan, Autentikasi RBAC, dan Registri Multi-Survei) guna menjamin latensi kueri agregasi di bawah 15 ms.
- **Luaran:** Dokumen Spesifikasi Skema Basis Data Relasional SQLite (`Dokumen_Spesifikasi_Skema_Basis_Data_12_Tabel_SQLite.docx`).

### 3.2. Tahapan 2.2 — Panduan Desain Sistem & UI/UX
- **Deskripsi:** Menyusun panduan desain sistem antarmuka pengguna berbasis standar aksesibilitas internasional WCAG 2.1 AA, aturan tipografi mobile (12px–22px), geometri sudut tegas 90 derajat (*border-radius: 0*), dan pola *Dual Navigation*.
- **Luaran:** Dokumen Panduan Desain UI/UX Pananyo Taka (`Dokumen_Panduan_Desain_UIUX_Pananyo_Taka.docx`).

### 3.3. Tahapan 2.3 — Arsitektur Modul AI (RAG Pipeline)
- **Deskripsi:** Merancang modul cerdas AI berbasis Large Language Model (Google Gemini) yang memadukan kamus metadata `queryHints.js`, sandbox SQL Read-Only, prompt builder kontekstual, dan Server-Sent Events (SSE) streaming.
- **Luaran:** Dokumen Rancangan Arsitektur Modul Cerdas AI (`Dokumen_Rancangan_Arsitektur_Modul_AI_RAG_Pipeline.docx`).

### 3.4. Tahapan 2.4 — Review Desain Teknis Bersama Tim IT
- **Deskripsi:** Menyelenggarakan sesi evaluasi teknis formal bersama Mentor dan Tim TI Seksi Pengolahan Data BPS Kabupaten Penajam Paser Utara guna memvalidasi kelayakan arsitektur sistem.
- **Luaran:** Berita Acara Review Desain Teknis Nomor BA-02.04/BPS/6409/08/2026 (`Berita_Acara_Review_Desain_Teknis_bersama_Tim_IT.docx`).

---

## 4. Analisis Kebutuhan Sistem

### 4.1. Kebutuhan Fungsional (*Functional Requirements*)

| Kode FR | Modul / Fitur | Deskripsi Kebutuhan |
| :--- | :--- | :--- |
| **FR-01** | **Otentikasi & RBAC** | Pengelolaan hak akses berjenjang (Administrator, Korlap, User/Guest) dengan sesi persisten SQLite dan proteksi CSRF. |
| **FR-02** | **Unggah & Rekonsiliasi Data** | Unggah berkas Excel rekap progres FASIH harian, deteksi header otomatis, parsing muatan dokumen/usaha/keluarga, dan peremajaan basis data. |
| **FR-03** | **Dasbor Metrik & Tren Harian** | Visualisasi KPI agregat (Total SLS, Dokumen Selesai, Usaha Ditemukan, Beban Honor), progress bar milestone, dan grafik tren kumulatif harian. |
| **FR-04** | **Hierarki Pemantauan Wilayah** | Drill-down statistik bertingkat: Kecamatan → Desa/Kelurahan → Satuan Lingkungan Setempat (SLS/Sub-SLS). |
| **FR-05** | **Pemantauan Performa Petugas** | Dasbor analitik kinerja individual dan grup untuk PCL, PML, dan Korlap, termasuk rasio verifikasi dan beban kerja per orang. |
| **FR-06** | **Early Warning System (EWS)** | Identifikasi otomatis petugas *stuck* (tanpa progres ≥ 3 hari), petugas berisiko gagal deadline (*at-risk*), serta peringkat performa terendah. |
| **FR-07** | **Peta Sebaran GIS** | Peta interaktif berbasis Leaflet dengan layer poligon batas wilayah KML PPU yang diberi warna tematik (*choropleth*) sesuai persentase progres. |
| **FR-08** | **Deteksi Anomali Google Sheets** | Sinkronisasi dua arah/real-time dengan Google Sheets daftar anomali isian lapangan untuk pembinaan teknis petugas. |
| **FR-09** | **Asisten Virtual AI (KIPP)** | Chatbot interaktif menggunakan model Google Gemini dengan fungsi kueri database cerdas (*NL-to-SQL execution*) dan ringkasan eksekutif otomatis. |
| **FR-10** | **Automasi Pesan WhatsApp** | Integrasi gateway WhatsApp (Baileys) untuk broadcast progres massal, kirim kartu kinerja personal PCL/PML, dan alert anomali. |
| **FR-11** | **Ekspor Laporan Formal** | Generator laporan terformat dalam bentuk dokumen PDF siap cetak (`pdfkit`) dan berkas spreadsheet Excel (`xlsx`). |
| **FR-12** | **Multi-Survei Dinamis** | Kemampuan menjalankan isolasi survei (SE2026, Sakernas Listing, Sakernas CAPI) melalui parameter URL dengan tema warna dan metrik dinamis. |

### 4.2. Kebutuhan Non-Fungsional (*Non-Functional Requirements*)

| Kode NFR | Kategori | Spesifikasi |
| :--- | :--- | :--- |
| **NFR-01** | Kinerja | Waktu respons halaman ≤ 150 ms berkat agregasi terindeks (`summary_cache`) dan SQLite WAL |
| **NFR-02** | Portabilitas | Dapat dijalankan pada server lokal, VPS Linux/Windows, maupun shared hosting cPanel |
| **NFR-03** | Keamanan | CSP, CSRF token 32-byte, proteksi anti-clickjacking, sanitasi XSS, rate-limiting API |
| **NFR-04** | Aksesibilitas | Skala font 12px–22px (Mobile Typography Guidelines), kontras warna ≥ 4.5:1 (WCAG 2.1 AA) |
| **NFR-05** | Keandalan | Error tracking via Sentry, graceful crash prevention, session persistence via SQLite |
| **NFR-06** | Pemeliharaan | Arsitektur MVC modular, kode terdokumentasi, migrasi skema terversi (`schema_migrations`) |

---

## 5. Arsitektur Perangkat Lunak

Sistem dibangun menggunakan pendekatan **Arsitektur MVC Berlapis** (*Layered MVC Architecture*) yang dikombinasikan dengan **Komponen Logika Bisnis Berorientasi Layanan** (*Service-Oriented Business Logic Components*):

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  • EJS Templates (Responsive Layout & Micro-animations)      │
│  • Client-side: Vanilla JS, Chart.js, Leaflet GIS,           │
│    DataTables, Select2                                        │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP / HTTPS / REST JSON
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONTROLLER LAYER                          │
│  • Express.js 5.x Routers (routes/*.js)                      │
│  • Context Injector Middleware (Multi-Survey Route Prefix)   │
│  • Security & Session Middlewares: CSRF, SQLite Session      │
│    Store, Content Security Policy, Authentication Guard      │
└─────────────────────────────┬───────────────────────────────┘
                              │ Service Invocations
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER                            │
│  • excelParser.js          : ETL & Excel Reconciliation      │
│  • agentService.js         : AI Agent Gemini & NL-to-SQL     │
│  • whatsappService.js      : WhatsApp Baileys Multi-Device   │
│  • googleSheetsAnomalyService: Real-time Anomaly Sync        │
│  • imputerService.js       : Projection & Estimation Engine  │
└─────────────────────────────┬───────────────────────────────┘
                              │ Data Access Operations
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   PERSISTENCE LAYER                          │
│  • SQLite (better-sqlite3) — WAL Mode & In-Memory MMAP       │
│  • Database Context Manager (AsyncLocalStorage Isolation)    │
│  • 19 Tabel Relasional & Summary Pre-calculation Cache       │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. PILAR 1: Pemodelan Proses (Process Modeling)

Pemodelan proses merinci seluruh aliran data, alur kerja operasional, dan interaksi kasus penggunaan sistem Pananyo Taka melalui 5 diagram perancangan standar rekayasa perangkat lunak:

---

### 6.1. System Context Diagram (DFD Level 0)

**Deskripsi:** Memodelkan batasan sistem (*system boundary*) dan interaksi pertukaran data dua arah antara Sistem Pananyo Taka (Proses 0.0) dengan 8 entitas eksternal secara teratur.
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/01_system_context_diagram.png`)*

```mermaid
flowchart TD
    classDef sysBox fill:#0B132B,stroke:#0284C7,stroke-width:3px,color:#FFFFFF;
    classDef actorUser fill:#1E293B,stroke:#10B981,stroke-width:2px,color:#F8FAFC;
    classDef actorSys fill:#1E293B,stroke:#8B5CF6,stroke-width:2px,color:#F8FAFC;
    classDef actorCloud fill:#1E293B,stroke:#D97706,stroke-width:2px,color:#F8FAFC;

    SYS(("0.0
SISTEM DASBOR
PANANYO TAKA
(Monitoring Sensus & Survei)")):::sysBox

    %% 8 Entitas Eksternal
    E_ADMIN["👨‍💻 Admin TI BPS"]:::actorUser
    E_PIMPINAN["👔 Pimpinan Satker & Publik"]:::actorUser
    E_KORLAP["📋 Korlap & PML Organik"]:::actorUser
    E_PCL["📝 Pencacah Lapangan (PCL)"]:::actorUser

    E_FASIH["🏢 Server Aplikasi FASIH BPS"]:::actorSys
    E_GSHEET["📊 Google Spreadsheets (Audit Anomali)"]:::actorCloud
    E_GEMINI["🧠 Google Gemini LLM API"]:::actorCloud
    E_WEATHER["🌤️ Open-Meteo Weather API"]:::actorCloud

    %% Aliran Interaksi 2 Arah
    E_ADMIN -->|"Upload File Excel Rekap (.xlsx)"| SYS
    SYS -->|"Status Ingesti & Log Audit"| E_ADMIN

    SYS -->|"Visualisasi KPI & Ringkasan Eksekutif"| E_PIMPINAN
    E_PIMPINAN -->|"Kueri Filter Wilayah & Ekspor PDF"| SYS

    SYS -->|"Alert EWS & Kartu Performa Petugas"| E_KORLAP
    E_KORLAP -->|"Verifikasi Progres Sub-SLS"| SYS

    SYS -->|"Peringkat Leaderboard & Target Harian"| E_PCL

    E_FASIH -->|"Ekspor Data Progres Lapangan"| SYS

    E_GSHEET -->|"Data Anomali Isian Lapangan"| SYS
    SYS -->|"Sinkronisasi Status Anomali"| E_GSHEET

    SYS -->|"Prompt & Payload Skema Data"| E_GEMINI
    E_GEMINI -->|"Hasil Inferensi & Sintesis AI"| SYS

    E_WEATHER -->|"Data Cuaca & Curah Hujan Lapangan"| SYS
```

---

### 6.2. Use Case Diagram Sistem

**Deskripsi:** Memodelkan 8 use case fungsional utama (UC-01 s.d. UC-08) dan interaksinya dengan 4 aktor pengguna sistem (Publik/Pengawas, Petugas Lapangan, Admin TI, dan External Cloud Services).
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/02_use_case_diagram.png`)*

```mermaid
flowchart LR
    classDef actorBox fill:#1E293B,stroke:#0284C7,stroke-width:2px,color:#F8FAFC;
    classDef ucBox fill:#0B132B,stroke:#10B981,stroke-width:2px,color:#FFFFFF;

    subgraph ACTORS["AKTOR PENGGUNA"]
        A_PUB["👤 Publik / Pimpinan BPS"]:::actorBox
        A_PET["📝 Petugas Lapangan (PCL/PML)"]:::actorBox
        A_ADM["👨‍💻 Admin TI BPS"]:::actorBox
        A_AI["🧠 Cloud LLM Services"]:::actorBox
    end

    subgraph USECASES["KASUS PENGGUNAAN (USE CASES)"]
        UC01(["UC-01: Melihat Dasbor Ringkasan & Tren Progres"]):::ucBox
        UC02(["UC-02: Melakukan Filter Spasial & Peta GIS"]):::ucBox
        UC03(["UC-03: Memantau Kinerja & Beban Petugas"]):::ucBox
        UC04(["UC-04: Mengakses Early Warning System (EWS)"]):::ucBox
        UC05(["UC-05: Berinteraksi dengan Asisten Cerdas AI"]):::ucBox
        UC06(["UC-06: Mengunggah & Rekonsiliasi Data FASIH"]):::ucBox
        UC07(["UC-07: Mengelola User, Hak Akses & Sesi (RBAC)"]):::ucBox
        UC08(["UC-08: Mengunduh Laporan Formal & Broadcast WA"]):::ucBox
    end

    A_PUB --> UC01
    A_PUB --> UC02
    A_PUB --> UC05

    A_PET --> UC01
    A_PET --> UC03
    A_PET --> UC04

    A_ADM --> UC06
    A_ADM --> UC07
    A_ADM --> UC08

    UC05 -.->|"invoke"| A_AI
    UC04 -.->|"include"| UC08
```

---

### 6.3. Data Flow Diagram (DFD) Level 1

**Deskripsi:** Memodelkan dekomposisi 6 proses fungsional internal sistem, aliran data dari entitas eksternal, serta penyimpanan ke 5 data store basis data SQLite dengan 29 aliran data 1-arah presisi.
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/03_dfd_level_1_diagram.png`)*

```mermaid
flowchart TB
    classDef default fill:#1E293B,stroke:#0284C7,stroke-width:2px,color:#F8FAFC;
    classDef procBlue fill:#0B132B,stroke:#0284C7,stroke-width:2.5px,color:#FFFFFF;
    classDef procPurple fill:#0B132B,stroke:#8B5CF6,stroke-width:2.5px,color:#FFFFFF;
    classDef procAmber fill:#0B132B,stroke:#D97706,stroke-width:2.5px,color:#FFFFFF;
    classDef procGreen fill:#0B132B,stroke:#10B981,stroke-width:2.5px,color:#FFFFFF;
    classDef procRed fill:#0B132B,stroke:#EF4444,stroke-width:2.5px,color:#FFFFFF;
    classDef storeBox fill:#111C38,stroke:#38BDF8,stroke-width:2px,color:#38BDF8;

    subgraph SOURCES["ENTITAS EKSTERNAL & PENGGUNA"]
        E_ADMIN["👨‍💻 Admin TI BPS"]:::default
        E_FASIH["🏢 Server FASIH BPS"]:::default
        E_USER["👔 Pegawai BPS / Pengawas"]:::default
    end

    subgraph PROCESSES["PROSES KOMPUTASI INTERNAL (PANANYO TAKA)"]
        P1(("1.0
Autentikasi &
Manajemen Sesi")):::procPurple
        P2(("2.0
Ingesti, Validasi &
Parsing Excel")):::procBlue
        P3(("3.0
Kalkulasi Agregasi &
Summary Cache")):::procAmber
        P4(("4.0
Visualisasi GIS,
Speedometer & Tren")):::procGreen
        P5(("5.0
AI Agent RAG &
SQL Sandbox")):::procPurple
        P6(("6.0
Early Warning EWS &
Audit Anomali")):::procRed
    end

    subgraph DATASTORES["DATA STORES (BASIS DATA SQLITE WAL)"]
        D1[("D1: users & remember_tokens")]:::storeBox
        D2[("D2: uploads & progres (Transaksi)")]:::storeBox
        D3[("D3: subsls_master & ref_wilayah")]:::storeBox
        D4[("D4: summary_cache (Cache Agregasi)")]:::storeBox
        D5[("D5: settings & surveys_registry")]:::storeBox
    end

    subgraph EXTERNAL_SERVICES["LAYANAN CLOUD EKSTERNAL"]
        E_AI["🧠 Cloud Gemini LLM API"]:::default
    end

    %% Aliran Proses 1.0 (Autentikasi)
    E_USER -->|"1. Kredensial Login"| P1
    P1 -->|"2. Kueri User & Hash Password"| D1
    D1 -->|"3. Data User & Token Sesi"| P1
    P1 -->|"4. Status Sesi Terotentikasi"| E_USER

    %% Aliran Proses 2.0 (Ingesti Excel)
    E_ADMIN -->|"5. Upload File Excel FASIH (.xlsx)"| P2
    E_FASIH -->|"6. Data Rekapitulasi Progres"| P2
    P2 -->|"7. Validasi Kode SLS & Target"| D3
    D3 -->|"8. Master SLS & Alokasi Petugas"| P2
    P2 -->|"9. Simpan Upload & Transaksi Progres"| D2
    P2 -->|"10. Sinyal Ingesti Selesai"| P3

    %% Aliran Proses 3.0 (Kalkulasi Agregasi)
    D2 -->|"11. Data Transaksi Harian"| P3
    P3 -->|"12. Tulis Hasil Pra-Kalkulasi Agregat"| D4
    P3 -->|"13. Trigger Evaluasi EWS"| P6

    %% Aliran Proses 4.0 (Visualisasi GIS & Dasbor)
    E_USER -->|"14. Request View & Filter Wilayah"| P4
    D4 -->|"15. Data Agregat Pra-Kalkulasi (<5ms)"| P4
    D3 -->|"16. Poligon Batas Desa GeoJSON"| P4
    P4 -->|"17. Render Speedometer, Peta & Grafik"| E_USER

    %% Aliran Proses 5.0 (AI Agent RAG & SQL Sandbox)
    E_USER -->|"18. Pertanyaan Bahasa Alami (NL Query)"| P5
    D5 -->|"19. Metadata Skema & Query Hints"| P5
    P5 -->|"20. Context Prompt & System Hints"| E_AI
    E_AI -->|"21. Request Function Call SQL"| P5
    P5 -->|"22. Eksekusi SQL Read-Only Sandbox"| D2
    D2 -->|"23. Recordset Hasil Kueri"| P5
    P5 -->|"24. Payload Hasil Recordset"| E_AI
    E_AI -->|"25. Narasi Analisis Eksekutif"| P5
    P5 -->|"26. Respon Jawaban Cerdas AI"| E_USER

    %% Aliran Proses 6.0 (Early Warning & Anomali)
    D2 -->|"27. Data Histori Pendataan Petugas"| P6
    P6 -->|"28. Identifikasi Petugas Stuck (≥3 Hari)"| P6
    P6 -->|"29. Alert Warning & Broadcast WA"| E_USER
```

---

### 6.4. Activity Diagram Alur Pemantauan Sensus

**Deskripsi:** Memodelkan alur kerja pengawasan sensus dalam 5 *swimlanes* (PCL, Server FASIH BPS, PML, Admin TI, Dasbor Pananyo Taka) mulai dari pendataan CAPI s.d. visualisasi dasbor.
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/06_activity_diagram_monitoring.png`)*

```mermaid
sequenceDiagram
    autonumber
    actor PCL as Pencacah (PCL)
    participant FASIH as Server FASIH BPS
    actor PML as Pengawas (PML)
    actor Admin as Admin TI BPS PPU
    participant PT as Dasbor Pananyo Taka

    PCL->>FASIH: 1. Input data CAPI lapangan (Status [DRAFT]) & Submit
    Note over FASIH: Status dokumen berubah menjadi [SUBMITTED]
    PML->>FASIH: 2. Verifikasi isian dokumen [SUBMITTED]
    alt Dokumen Valid
        PML->>FASIH: 3a. Approve dokumen (Status [APPROVED])
    else Ada Isian Anomali / Error
        PML->>FASIH: 3b. Reject dokumen (Status [REJECTED]) + Catatan
        FASIH-->>PCL: Kembalikan dokumen untuk perbaikan lapangan
    end

    Admin->>FASIH: 4. Unduh berkas rekapitulasi progres harian (.xlsx)
    Admin->>PT: 5. Unggah berkas (.xlsx) ke portal Pananyo Taka
    Note over PT: 6. Validasi skema, parsing data, & simpan ke SQLite WAL
    Note over PT: 7. Re-agregasi cache ringkasan (<5ms) & evaluasi EWS
    PT-->>Admin: 8. Tampilkan notifikasi ingesti sukses & metrik KPI terbaru
    PT-->>PML: 9. Sajikan peta tematik GIS, tren harian & peringatan dini
```

---

### 6.5. Sequence Diagram AI RAG Pipeline (KIPP Agent)

**Deskripsi:** Memodelkan urutan interaksi multi-langkah query natural language pengguna, Query Hints Engine, SQLite Read-Only Sandbox, dan Google Gemini LLM API melalui Server-Sent Events (SSE).
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/07_sequence_diagram_rag_ai.png`)*

```mermaid
sequenceDiagram
    autonumber
    actor User as Pengguna (Browser)
    participant UI as Chat Web Interface
    participant SSE as SSE Controller (/chat/stream)
    participant QH as QueryHints & FastPath Engine
    participant LLM as Google Gemini API
    participant SB as SQLite Read-Only Sandbox
    participant DB as Basis Data (se2026.db)

    User->>UI: 1. Ketik pertanyaan: "Berapa progres Kecamatan Sepaku hari ini?"
    UI->>SSE: 2. POST /agent/chat/stream { message, surveyId }
    SSE-->>UI: 3. event: start { status: "Menganalisis pertanyaan..." }

    alt Pertanyaan Cocok dengan Pola Fast-Path
        SSE->>QH: 4a. Evaluasi regex fast-path
        QH-->>SSE: 5a. Kembalikan data instan dari summary_cache
        SSE-->>UI: 6a. event: chunk { text: "Progres Sepaku: 87,25%..." }
    else Memerlukan Inferensi LLM & RAG
        SSE->>QH: 4b. Ekstrak metadata skema & kamus kueri
        QH-->>SSE: 5b. Injeksi context prompt & system instructions
        SSE->>LLM: 6b. Kirim Prompt + Context + Tool Declarations
        LLM-->>SSE: 7b. Respon Function Call: query_data({ sql: "SELECT..." })
        SSE-->>UI: 8b. event: tool_start { tool: "query_data" }

        SSE->>SB: 9b. Validasi kueri SQL (cek SELECT, larang mutasi, inject LIMIT 200)
        SB->>DB: 10b. Eksekusi kueri read-only
        DB-->>SB: 11b. Hasil recordset data
        SB-->>SSE: 12b. Payload data tervalidasi
        SSE-->>UI: 13b. event: tool_end { count: rows.length }

        SSE->>LLM: 14b. Kirim hasil recordset kembali ke LLM
        LLM-->>SSE: 15b. Stream token jawaban sintetis analitik
        SSE-->>UI: 16b. event: chunk { text: "..." }
    end

    SSE-->>UI: 17. event: done { executionTimeMs: 420 }
    UI-->>User: 18. Tampilkan jawaban lengkap & visualisasi tabel
```

---

## 7. PILAR 2: Pemodelan Data (Data Modeling)

Pemodelan data menetapkan struktur skema relasional, aturan integritas referensial, dan kamus data 19 tabel SQLite operasional sistem monitoring SE2026 PPU.

---

### 7.1. Entity Relationship Diagram (ERD Relasional 19 Tabel 3NF)

**Deskripsi:** Memodelkan skema basis data SQLite aktual (`data/se2026.db`) 19 tabel dalam 4 zona relasional dengan integritas referensial `ON DELETE CASCADE`.
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/04_entity_relationship_diagram.png`)*

```mermaid
erDiagram
    ref_kecamatan ||--o{ ref_desa : "memiliki"
    ref_kecamatan ||--o{ subsls_master : "mencakup"
    ref_desa ||--o{ subsls_master : "memiliki"
    ref_petugas ||--o{ subsls_master : "ditugaskan"

    uploads ||--o{ progres : "memuat (CASCADE)"
    uploads ||--o{ summary_cache : "menghasilkan (CASCADE)"
    subsls_master ||--o{ progres : "ditransaksikan"

    users ||--o{ remember_tokens : "memiliki (CASCADE)"

    surveys_registry ||--|| survey_themes : "konfigurasi tema (CASCADE)"
    surveys_registry ||--|| survey_collection_config : "konfigurasi muatan (CASCADE)"
    surveys_registry ||--o{ survey_subsls : "alokasi SLS"

    ref_kecamatan {
        TEXT kode_kec PK
        TEXT nama_kecamatan
    }

    ref_desa {
        TEXT kode_desa PK
        TEXT kode_kec FK
        TEXT nama_desa
    }

    ref_petugas {
        INTEGER id PK
        TEXT sobat_id UK
        TEXT nama_lengkap
        TEXT email UK
        TEXT jenis_kelamin
        INTEGER kode_kab
        DATETIME created_at
    }

    subsls_master {
        TEXT kode PK "Kode SLS 16 Digit"
        TEXT kode_kec FK
        TEXT kecamatan
        TEXT desa
        TEXT nama_sls
        TEXT korlap
        TEXT pml
        TEXT pcl
        INTEGER muatan
        INTEGER target_fasih
        INTEGER target_honor
        TEXT pcl_email
        TEXT pml_email
        TEXT korlap_email
        INTEGER korlap_id FK
    }

    uploads {
        INTEGER id PK
        TEXT filename
        INTEGER file_size
        DATETIME upload_timestamp
        TEXT upload_by
        TEXT status
        INTEGER total_records
    }

    progres {
        INTEGER id PK
        INTEGER upload_id FK
        TEXT kode_subsls FK
        TEXT status_sls
        INTEGER target_upload
        INTEGER submitted
        INTEGER approved
        INTEGER rejected
        INTEGER target_selesai
        INTEGER target_belum_selesai
        REAL persen_selesai
        INTEGER beban_dokumen
        INTEGER jml_usaha_all
        INTEGER jml_usaha_eligible
        INTEGER jml_usaha_not_eligible
        INTEGER jml_keluarga
        INTEGER status_stuck
        INTEGER hari_tanpa_progres
        DATE tgl_update_terakhir
    }

    summary_cache {
        INTEGER id PK
        INTEGER upload_id FK
        TEXT scope_level "KAB / KEC / DESA"
        TEXT scope_id
        INTEGER total_subsls
        INTEGER total_target
        INTEGER total_selesai
        INTEGER total_belum
        REAL persen_selesai
        INTEGER total_usaha
        DATETIME updated_at
    }

    users {
        INTEGER id PK
        TEXT username UK
        TEXT password_hash
        TEXT role "admin / korlap / user"
        TEXT full_name
        TEXT email UK
        DATETIME created_at
    }

    remember_tokens {
        INTEGER id PK
        INTEGER user_id FK
        TEXT token_hash UK
        DATETIME expires_at
    }

    surveys_registry {
        TEXT id PK "se2026 / sakernas / ..."
        TEXT name
        TEXT description
        INTEGER is_active
        DATETIME created_at
    }

    survey_themes {
        TEXT survey_id PK, FK
        TEXT primary_color
        TEXT secondary_color
        TEXT accent_color
    }

    survey_collection_config {
        TEXT survey_id PK, FK
        INTEGER target_type
        TEXT unit_name
        INTEGER allow_batch_upload
    }

    survey_subsls {
        INTEGER id PK
        TEXT survey_id FK
        TEXT kode_subsls FK
        INTEGER target_custom
    }
```

---

### 7.2. Kamus Data & Desain Skema Database SQLite WAL

Skema basis data dirancang mengikuti prinsip normalisasi 3NF, mode Write-Ahead Logging (WAL), dan isolasi per-survei dalam 4 zona data terstruktur:
1. **Zona 1: Master Wilayah & Referensi Petugas** (`ref_kecamatan`, `ref_desa`, `ref_petugas`, `subsls_master`).
2. **Zona 2: Transaksi Progres Lapangan & Cache** (`uploads`, `progres`, `summary_cache`).
3. **Zona 3: Keamanan, Autentikasi & Audit Log** (`users`, `remember_tokens`, `visitor_logs`, `schema_migrations`).
4. **Zona 4: Konfigurasi Multi-Survei Dinamis & Operasional** (`surveys_registry`, `survey_themes`, `survey_collection_config`, `survey_subsls`, `settings`, `weather_history`).

---

## 8. PILAR 3: Desain Antarmuka Pengguna & Arsitektur Sistem

---

### 8.1. Principles & Design System Guide (UI/UX)

Panduan desain sistem antarmuka pengguna menetapkan acuan visual baku yang memadukan keandalan teknis dengan kenyamanan pengguna gawai bergerak di lapangan:
- **Geometri Sudut Tegas:** Seluruh komponen tombol, kartu metrik, dan modal menggunakan sudut siku 90 derajat (*border-radius: 0*) untuk memaksimalkan area kerja data visual.
- **Skala Tipografi Mobile-Friendly:** Mengacu pada standar aksesibilitas WCAG 2.1 AA dengan ukuran teks minimal 12px untuk teks bacaan dan 16px untuk judul kartu guna mencegah kelelahan mata petugas lapangan.
- **Pola Dual Navigation:** Menyediakan *Sidebar Navigation* pada resolusi layar desktop (≥1024px) dan secara otomatis bertransformasi menjadi *Bottom Navigation Bar* pada layar smartphone (<768px).

---

### 8.2. 3-Tier Layered System Architecture Model

**Deskripsi:** Memodelkan arsitektur 3 lapisan sistem (*Presentation Layer*, *Application & Logic Layer*, dan *Data & Persistence Layer*).
*(Berkas gambar resolusi tinggi: `laporan/02_Phase_2_System_Design/diagrams/05_system_architecture_diagram.png`)*

```mermaid
flowchart TB
    classDef clientTier fill:#0B132B,stroke:#0284C7,stroke-width:2.5px,color:#FFFFFF;
    classDef appTier fill:#0B132B,stroke:#8B5CF6,stroke-width:2.5px,color:#FFFFFF;
    classDef dataTier fill:#0B132B,stroke:#10B981,stroke-width:2.5px,color:#FFFFFF;

    subgraph TIER1["TIER 1: PRESENTATION LAYER (CLIENT & UI)"]
        UI_WEB["🌐 Responsive Web Browser (Desktop & Mobile)"]:::clientTier
        UI_COMP["🧩 UI Components: Chart.js, Leaflet GIS, DataTables, Select2"]:::clientTier
        UI_EJS["📄 Server-Side Rendered EJS Templates (Dual Navigation Pattern)"]:::clientTier
    end

    subgraph TIER2["TIER 2: APPLICATION & BUSINESS LOGIC LAYER"]
        APP_EXPRESS["⚡ Node.js & Express.js 5.x Application Server"]:::appTier
        APP_SEC["🛡️ Middleware Pipeline: CSRF, Helmet CSP, Session Guard, Rate Limiter"]:::appTier
        APP_SERVICES["⚙️ Domain Services: excelParser, imputerService, whatsappService"]:::appTier
        APP_AI["🧠 AI Subsystem: fastPathHandler, toolRegistry, SQL Read-Only Sandbox"]:::appTier
    end

    subgraph TIER3["TIER 3: DATA & PERSISTENCE LAYER"]
        DATA_SQLITE["🗄️ SQLite Engine (better-sqlite3) with Write-Ahead Logging (WAL)"]:::dataTier
        DATA_CACHE["⚡ In-Memory MMAP & Pre-calculated summary_cache"]:::dataTier
        DATA_ISOLATION["📁 Multi-Database File Isolation (se2026.db, sakernas, shared, sessions)"]:::dataTier
        DATA_EXTERNAL["☁️ External Cloud Services: Google Gemini LLM API, Open-Meteo, WhatsApp"]:::dataTier
    end

    TIER1 <-->|"HTTPS / REST JSON / Server-Sent Events (SSE)"| TIER2
    TIER2 <-->|"In-Process C++ Native Driver & Socket Calls"| TIER3
```

---

## 9. Arsitektur Modul Fungsional Utama

1. **Modul Ingesti & ETL FASIH (`services/excelParser.js`):** Menangani ingesti berkas spreadsheet hasil ekspor FASIH secara toleran terhadap perbedaan nama kolom dan header bertingkat.
2. **Modul Pre-calculated Aggregation (`database.js`):** Menggunakan fungsi `rebuildAllSummaryCaches()` untuk mengompilasi statistik seluruh tingkatan wilayah ke dalam tabel `summary_cache`.
3. **Modul Early Warning System (`services/imputerService.js`):** Mendeteksi petugas stuck (tanpa progres ≥ 3 hari) dan memproyeksikan estimasi hari penyelesaian target.
4. **Modul WhatsApp Gateway (`services/whatsappService.js`):** Menggunakan pustaka native WebSocket `@whiskeysockets/baileys` v6.7.9 dengan dukungan distributed process lock.
5. **Modul Cerdas AI KIPP (`services/ai/orchestrator.js`):** Menggabungkan fast-path regex dengan sandbox SQL Read-Only dan streaming respons via Server-Sent Events (SSE).

---

## 10. Aspek Keamanan, Keandalan & Kinerja

- **Keamanan Data:** Token CSRF 32-byte pada setiap form mutasi, validasi sintaks kueri SQL AI untuk mencegah SQL injection, dan proteksi sesi login persisten.
- **Keandalan Server:** Mekanisme distributed mutex pada tabel `process_locks` untuk mencegah perebutan socket WhatsApp pada arsitektur multi-worker Passenger.
- **Kinerja Ekstra Kilat:** Pemanfaatan mode Write-Ahead Logging (WAL) dan indeks B-Tree menghasilkan latensi kueri agregasi rata-rata di bawah 10 ms pada pengujian beban tinggi.

---

## 11. Rencana Implementasi (Fase 3)

Berdasarkan pengesahan cetak biru perancangan sistem pada Fase 2, kegiatan aktualisasi dilanjutkan ke **SDLC Phase 3 (Kegiatan 3: Implementasi & Coding)** yang mencakup:
1. Pembuatan skrip basis data SQLite WAL dan otomasi cache agregasi (`Tahapan 3.1`).
2. Pengkodean frontend responsif EJS dan backend Express.js (`Tahapan 3.2`).
3. Pengintegrasian modul cerdas AI Gemini RAG dan WhatsApp Baileys (`Tahapan 3.3`).
4. Pelaksanaan code review internal dan debugging mandiri secara berkala (`Tahapan 3.4`).

---

## 12. Kesimpulan

Seluruh rancangan sistem dan perangkat lunak dalam laporan ini telah melalui penelaahan teknis bersama Mentor dan Tim IT Seksi Pengolahan Data BPS Kabupaten Penajam Paser Utara, dinyatakan **MEMENUHI SYARAT KELAYAKAN TEKNIS, DISAHKAN, dan SIAP DILANJUTKAN** ke tahap pemrograman (SDLC Phase 3).

---

## 13. Lampiran — Daftar Dokumen Pendukung

1. Berita Acara Review Desain Teknis Nomor BA-02.04/BPS/6409/08/2026
2. Dokumen Spesifikasi Skema Basis Data Relasional SQLite WAL
3. Dokumen Panduan Desain Sistem Antarmuka Pengguna (UI/UX Design System Guide)
4. Dokumen Rancangan Arsitektur Modul Cerdas AI (RAG Pipeline & SQL Sandbox)
5. Berkas Master Multi-Tab Diagram Draw.io (`diagrams_perancangan_sistem_pananyo_taka.drawio`)
