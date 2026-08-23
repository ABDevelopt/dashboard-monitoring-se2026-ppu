# LAPORAN FASE 3: IMPLEMENTASI DAN PENGKODEAN SISTEM
## Dashboard Monitoring Sensus Ekonomi 2026 (SE2026)
### BPS Kabupaten Penajam Paser Utara — Sistem "Pananyo Taka"

---

**Nama Kegiatan:** Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026  
**Kegiatan ke-:** 3 dari 5 (Implementasi Sistem & Pengkodean)  
**Nama Sistem:** *Pananyo Taka* — Dashboard Monitoring Lapangan SE2026 PPU  
**Versi Sistem:** 1.0.0  
**Tanggal Laporan:** 22 Agustus 2026  
**Penyusun:** Yahya Abdurrohman, S.Tr.Stat.  
**Unit Kerja:** Subbagian Umum & Tim IPJKD-DLS, BPS Kabupaten Penajam Paser Utara  

---

## DAFTAR ISI

1. [Pendahuluan](#1-pendahuluan)
2. [Rujukan Laporan Sebelumnya (Phase 2)](#2-rujukan-laporan-sebelumnya-phase-2)
3. [Revisi dan Perubahan dari Desain Phase 2](#3-revisi-dan-perubahan-dari-desain-phase-2)
4. [Implementasi Basis Data dan Migrasi Skema](#4-implementasi-basis-data-dan-migrasi-skema)
5. [Implementasi Backend: Server & Middleware](#5-implementasi-backend-server--middleware)
6. [Implementasi Modul Fungsional (Routes & Services)](#6-implementasi-modul-fungsional-routes--services)
7. [Implementasi Frontend: Layout, View, dan Responsivitas](#7-implementasi-frontend-layout-view-dan-responsivitas)
8. [Implementasi Modul AI Chatbot (RAG Pipeline)](#8-implementasi-modul-ai-chatbot-rag-pipeline)
9. [Implementasi Integrasi WhatsApp (Baileys)](#9-implementasi-integrasi-whatsapp-baileys)
10. [Implementasi Firebase Firestore Sync](#10-implementasi-firebase-firestore-sync)
11. [Implementasi Keamanan Sistem](#11-implementasi-keamanan-sistem)
12. [Arsitektur Multi-Survei](#12-arsitektur-multi-survei)
13. [Rekapitulasi Statistik Kode](#13-rekapitulasi-statistik-kode)
14. [Tantangan Teknis dan Solusi](#14-tantangan-teknis-dan-solusi)
15. [Kesimpulan](#15-kesimpulan)
16. [Lampiran: Kode Representatif Per Modul](#16-lampiran-kode-representatif-per-modul)

---

## 1. PENDAHULUAN

### 1.1 Latar Belakang

Phase 3 merupakan tahap inti dalam siklus pengembangan perangkat lunak (*Software Development Life Cycle*/SDLC) model Waterfall yang diterapkan pada aktualisasi ini. Setelah Phase 1 (Analisis Kebutuhan) menghasilkan spesifikasi fungsional dan non-fungsional, serta Phase 2 (Perancangan Sistem) menghasilkan rancangan arsitektur, skema basis data, diagram UML/DFD/ERD, dan panduan UI/UX, maka **Phase 3 ini merupakan proses mengeksekusi seluruh rancangan tersebut menjadi kode perangkat lunak yang berfungsi**.

Dokumen ini melaporkan seluruh proses implementasi dan pengkodean *Dashboard Monitoring Lapangan SE2026 PPU* dengan nama sistem **"Pananyo Taka"** — nama lokal Penajam yang bermakna "pohon yang menopang kehidupan", mencerminkan peran sistem sebagai fondasi pendataan Sensus Ekonomi 2026 di Kabupaten Penajam Paser Utara.

### 1.2 Tujuan Laporan

1. Mendokumentasikan seluruh keputusan implementasi teknis yang diambil selama fase pengkodean.
2. Mencatat perubahan (*revisi*) yang terjadi dari rancangan Phase 2 beserta alasan teknisnya.
3. Menyajikan bukti fisik implementasi berupa kode, skema, dan dokumentasi teknis setiap modul.
4. Menjadi panduan teknis bagi pengembang yang akan meneruskan atau memelihara sistem ini.

### 1.3 Ruang Lingkup Implementasi

| Aspek | Cakupan |
|---|---|
| **Bahasa Pemrograman** | JavaScript (Node.js runtime) |
| **Framework Backend** | Express.js v5.2.1 |
| **Template Engine** | EJS (Embedded JavaScript) v6.0.1 |
| **Database** | SQLite via `better-sqlite3` v12.11.1 |
| **AI Integration** | Google Gemini API (`@google/generative-ai`) |
| **WhatsApp Integration** | Baileys WebSocket API (`@whiskeysockets/baileys`) |
| **Cloud Sync** | Firebase Admin SDK (`firebase-admin`) |
| **Error Monitoring** | Sentry (`@sentry/node`) |
| **Versi Sistem** | 1.0.0 |
| **Target Survei** | SE2026, Sakernas Pemutakhiran, Sakernas Pendataan |

---

## 2. RUJUKAN LAPORAN SEBELUMNYA (PHASE 2)

### 2.1 Ringkasan Rancangan Phase 2

Laporan Phase 2 (*Laporan Perancangan Sistem Monitoring SE2026 PPU*) menghasilkan rancangan berikut:

| Deliverable Phase 2 | Status Implementasi |
|---|---|
| Context DFD Level 0 (4 entitas: User, FASIH/Spreadsheet, WhatsApp, AI) | ✅ Diimplementasikan |
| Use Case Diagram (18 use case, 4 aktor) | ✅ Diimplementasikan |
| DFD Level 1 (8 proses: Upload, Parse, Aggregate, Monitor, Alert, Map, AI, Export) | ✅ Diimplementasikan |
| ERD 12 Tabel | ✅ Diimplementasikan dengan perluasan |
| Arsitektur 3-Tier (Presentation, Business Logic, Data) | ✅ Diimplementasikan |
| Activity Diagram Monitoring (Upload → Parse → Visualize → Alert) | ✅ Diimplementasikan |
| Sequence Diagram AI RAG Pipeline | ✅ Diimplementasikan |
| UI/UX Design Guidelines (Token Warna, Tipografi, Geometri 90°) | ✅ Diimplementasikan |
| Database Schema SQLite (1 skema, multi-file isolasi) | ✅ Diimplementasikan |

### 2.2 Diagram Perancangan Phase 2 (Acuan Implementasi)

Diagram-diagram berikut dari Phase 2 menjadi acuan utama fase implementasi:

**Diagram 1 — System Context (DFD Level 0):** 4 entitas eksternal (*Admin/Petugas*, *Sistem FASIH BPS Pusat*, *Platform WhatsApp*, *Google Gemini AI API*) berinteraksi dengan sistem pusat Pananyo Taka.

**Diagram 2 — Use Case Diagram:** 18 use case: Login, Upload Excel, View Dashboard, Export PDF/Excel, Monitor Petugas, Early Warning, Deteksi Anomali, Peta GIS, Leaderboard, Chatbot AI, Pengaturan Sistem, Manajemen User, WhatsApp Notifikasi, Firebase Sync, Backup DB.

**Diagram 3 — DFD Level 1:** 8 proses: (P1) Manajemen Unggahan, (P2) Parsing & Validasi Excel, (P3) Agregasi & Caching, (P4) Dashboard Overview, (P5) Early Warning & Anomali, (P6) Peta GIS, (P7) AI RAG Chat, (P8) Export Laporan.

**Diagram 4 — ERD:** Skema relasional 12+ tabel dengan isolasi penuh per survei pada level file `.db` terpisah.

---

## 3. REVISI DAN PERUBAHAN DARI DESAIN PHASE 2

> **Catatan Penting:** Revisi bersifat *iteratif* dan dilakukan berdasarkan temuan empiris selama proses implementasi. Setiap revisi dicatat dengan alasan teknis yang jelas.

### 3.1 Revisi Skema Database

#### Revisi 3.1.1 — Penambahan Kolom Tabel `progres`

**Rancangan Phase 2:** Tabel `progres` memiliki ~20 kolom data pencacahan.

**Implementasi Phase 3:** Ditambahkan 8 kolom baru:

| Kolom Baru | Tipe | Keterangan |
|---|---|---|
| `tidak_eligible` | INTEGER | Keluarga tidak memenuhi syarat sensus |
| `tidak_dapat_ditemui` | INTEGER | Subjek tidak dapat ditemui setelah 3x kunjungan |
| `keluarga_khusus` | INTEGER | Rumah tangga khusus (asrama, panti, militer) |
| `sls_selesai` | INTEGER | Flag boolean SLS dianggap selesai |
| `target_upload` | INTEGER | Target dinamis dari file unggahan (override manual) |
| `open` | INTEGER | Dokumen masih dalam status terbuka |
| `pcl_email` | TEXT | Email PCL (identitas langsung di tabel progres) |
| `pcl_name` | TEXT | Nama PCL |
| `pcl_sobat_id` | TEXT | ID Sobat PCL |

**Alasan Revisi:** Data ekspor FASIH memiliki lebih banyak status isian dibanding yang diantisipasi pada fase desain. Kolom tambahan diperlukan untuk representasi data lapangan yang akurat.

#### Revisi 3.1.2 — Penambahan `shared.db` (Shared Master Database)

**Rancangan Phase 2:** Satu skema, multi-file isolasi per survei.

**Implementasi Phase 3:** Ditambahkan database bersama `data/shared.db` berisi:
- `ref_kecamatan` — Referensi master kecamatan (lintas survei)
- `ref_desa` — Referensi master desa/kelurahan (lintas survei)
- `ref_petugas` — Master data petugas terpusat (lintas survei)
- View `petugas_email` — Backward-compatibility view untuk kode lama

**Alasan Revisi:** Data referensi geografis dan petugas digunakan oleh semua survei. Sentralisasi di `shared.db` menghilangkan duplikasi dan mempermudah pembaruan tunggal.

#### Revisi 3.1.3 — Perluasan Tabel `subsls_master`

Kolom baru: `muatan_original` (nilai asli sebelum override) dan `kode_2025` (ID SubSLS referensi tahun 2025 untuk pemetaan historis lintas tahun).

#### Revisi 3.1.4 — Sistem Migrasi Database Bertahap (`schema_migrations`)

**Rancangan Phase 2:** Skema statis dengan `CREATE TABLE IF NOT EXISTS`.

**Implementasi Phase 3:** Sistem migrasi bertahap dengan tabel `schema_migrations` yang mencatat versi yang sudah diterapkan (`20260710000000_init`, `20260715000001_add_pcl_fields`, dst.).

**Alasan Revisi:** Server berjalan di lingkungan produksi aktif saat pengembangan. Migrasi bertahap memungkinkan pembaruan skema tanpa menghapus data yang sudah ada.

### 3.2 Revisi Arsitektur Backend

#### Revisi 3.2.1 — Penggantian Library WhatsApp (Kritikal)

| | Phase 2 (Rancangan) | Phase 3 (Implementasi) |
|---|---|---|
| **Library** | `whatsapp-web.js` | `@whiskeysockets/baileys` |
| **Mekanisme** | Puppeteer/Chromium browser automation | WebSocket API langsung ke server WA |
| **Dependensi** | Chromium browser, display server | Tidak ada (pure Node.js) |
| **Kompatibilitas** | ❌ Gagal di cPanel/CloudLinux | ✅ Berjalan di semua lingkungan |

**Alasan Revisi:** `whatsapp-web.js` yang berbasis Puppeteer membutuhkan Chromium browser yang tidak dapat berjalan di lingkungan server *shared hosting* cPanel tanpa display server/X11. `baileys` berkomunikasi langsung via WebSocket tanpa browser.

#### Revisi 3.2.2 — Persistent Session Store

**Rancangan Phase 2:** Sesi server berbasis memori (default Express session).

**Implementasi Phase 3:** Sesi disimpan di SQLite via `better-sqlite3-session-store`.

**Alasan Revisi:** Server di-restart secara periodik oleh Passenger (cPanel deployment manager). Tanpa persistent session, semua pengguna harus login ulang setiap restart.

#### Revisi 3.2.3 — Sentry Error Monitoring

**Rancangan Phase 2:** Logging sederhana ke konsol (`console.log`).

**Implementasi Phase 3:** Integrasi `@sentry/node` untuk *error monitoring* produksi real-time.

### 3.3 Revisi Fitur Fungsional

#### Revisi 3.3.1 — Multi-Survey Architecture (Inovasi Baru)

**Rancangan Phase 2:** Sistem khusus SE2026.

**Implementasi Phase 3:** Sistem mendukung 3 survei paralel dengan isolasi penuh:
- `se2026` — Sensus Ekonomi 2026 (tema oranye BPS)
- `sakernas-pemutakhiran` — Sakernas Listing (tema emerald)
- `sakernas-pendataan` — Sakernas CAPI (tema biru)

#### Revisi 3.3.2 — Data Anomali dari Google Sheets

**Rancangan Phase 2:** Data anomali dari sistem internal.

**Implementasi Phase 3:** `googleSheetsAnomalyService.js` — scraping dari Google Sheets publik yang disediakan tim pengelola FASIH pusat. Cache disk persisten (`anomaly_cache_se2026.json`) menjamin ketersediaan data.

---

## 4. IMPLEMENTASI BASIS DATA DAN MIGRASI SKEMA

### 4.1 Strategi: "One Schema, Many Isolated DB Files"

```
data/
├── se2026.db                  ← Database SE2026 (produksi aktif)
├── sakernas-pemutakhiran.db   ← Database Sakernas Listing
├── sakernas-pendataan.db      ← Database Sakernas Pendataan
├── shared.db                  ← Database bersama (referensi lintas survei)
└── sessions.db                ← Persistent session Express
```

Setiap `*.db` survei memiliki skema **identik**, data **terisolasi**. Tidak ada join lintas database survei.

### 4.2 Konfigurasi SQLite untuk Performa Tinggi

```javascript
dbConn.pragma('journal_mode = WAL');      // Write-Ahead Logging
dbConn.pragma('synchronous = NORMAL');    // Trade-off aman performa vs durabilitas
dbConn.pragma('cache_size = -32000');     // 32MB page cache di memori
dbConn.pragma('temp_store = MEMORY');     // Tabel temporary di RAM
dbConn.pragma('mmap_size = 134217728');   // 128MB memory-mapped I/O
dbConn.pragma('foreign_keys = ON');       // Integritas referensial aktif
```

Konfigurasi ini memungkinkan dashboard merespons ratusan query agregasi dalam milidetik meski diakses puluhan pengguna bersamaan.

### 4.3 Skema Tabel Utama (Versi Final)

#### Tabel `subsls_master`
```sql
CREATE TABLE IF NOT EXISTS subsls_master (
  kode TEXT PRIMARY KEY,
  kode_kec TEXT,
  kecamatan TEXT,
  desa TEXT,
  nama_sls TEXT,
  korlap TEXT,
  pml TEXT,
  pcl TEXT,
  muatan INTEGER DEFAULT 0,
  kode_2025 TEXT,             -- [Revisi 3.1.3]
  target_fasih INTEGER DEFAULT 0,
  target_honor INTEGER DEFAULT 0,
  muatan_original INTEGER DEFAULT 0  -- [Revisi 3.1.3]
);
```

#### Tabel `progres` (Versi Final — 30+ Kolom)
```sql
CREATE TABLE IF NOT EXISTS progres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  kode TEXT NOT NULL,
  -- Status Pendataan Usaha
  usaha_tidak_ditemukan INTEGER DEFAULT 0,
  usaha_ditemukan INTEGER DEFAULT 0,
  usaha_baru INTEGER DEFAULT 0,
  usaha_tutup INTEGER DEFAULT 0,
  usaha_ganda INTEGER DEFAULT 0,
  -- Status Pendataan Keluarga
  tidak_ditemukan INTEGER DEFAULT 0,
  ditemukan INTEGER DEFAULT 0,
  keluarga_baru INTEGER DEFAULT 0,
  meninggal INTEGER DEFAULT 0,
  tidak_eligible INTEGER DEFAULT 0,       -- [BARU: Revisi 3.1.1]
  tidak_dapat_ditemui INTEGER DEFAULT 0,  -- [BARU: Revisi 3.1.1]
  keluarga_khusus INTEGER DEFAULT 0,      -- [BARU: Revisi 3.1.1]
  -- Jenis Bangunan
  rumah_tunggal INTEGER DEFAULT 0,
  rumah_deret INTEGER DEFAULT 0,
  rumah_susun INTEGER DEFAULT 0,
  apartemen INTEGER DEFAULT 0,
  lainnya INTEGER DEFAULT 0,
  -- Status Kuesioner
  draft INTEGER DEFAULT 0,
  submitted_by_pcl INTEGER DEFAULT 0,
  approved INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  sls_selesai INTEGER DEFAULT 0,          -- [BARU: Revisi 3.1.1]
  target_upload INTEGER DEFAULT 0,        -- [BARU: Revisi 3.1.1]
  open INTEGER DEFAULT 0,                 -- [BARU: Revisi 3.1.1]
  -- Identitas PCL
  pcl_email TEXT,                         -- [BARU: Revisi 3.1.1]
  pcl_name TEXT,                          -- [BARU: Revisi 3.1.1]
  pcl_sobat_id TEXT,                      -- [BARU: Revisi 3.1.1]
  UNIQUE(upload_id, kode)
);
```

### 4.4 Index Database untuk Optimasi Query

```sql
CREATE INDEX IF NOT EXISTS idx_progres_upload_id    ON progres(upload_id);
CREATE INDEX IF NOT EXISTS idx_progres_upload_kode  ON progres(upload_id, kode);
CREATE INDEX IF NOT EXISTS idx_subsls_master_kec    ON subsls_master(kecamatan);
CREATE INDEX IF NOT EXISTS idx_subsls_master_pcl    ON subsls_master(pcl);
CREATE INDEX IF NOT EXISTS idx_subsls_master_pml    ON subsls_master(pml);
CREATE INDEX IF NOT EXISTS idx_subsls_master_korlap ON subsls_master(korlap);
```

### 4.5 WAL Checkpoint Otomatis

```javascript
const WAL_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
setInterval(() => {
  runWalCheckpointAll(); // PASSIVE mode: tidak memblokir reader/writer aktif
}, WAL_CHECKPOINT_INTERVAL_MS);
```

---

## 5. IMPLEMENTASI BACKEND: SERVER & MIDDLEWARE

### 5.1 Stack Teknologi Backend

| Komponen | Teknologi | Versi | Fungsi |
|---|---|---|---|
| HTTP Server | Express.js | 5.2.1 | Framework routing & middleware |
| Template Engine | EJS + express-ejs-layouts | 6.0.1 | Server-side rendering |
| Database Driver | better-sqlite3 | 12.11.1 | SQLite synchronous driver |
| Session Store | better-sqlite3-session-store | 0.1.0 | Persistent session |
| File Upload | multer | 2.2.0 | Multipart file handling |
| Error Tracker | @sentry/node | 10.64.0 | Production error monitoring |
| Logger | winston + pino | 3.19.0 / 8.19.0 | Structured logging |

### 5.2 Urutan Middleware Stack

Urutan pemasangan middleware sangat kritis untuk keamanan dan fungsionalitas:

```
1.  DNS IPv4 Override        → Paksa IPv4 untuk cPanel/CloudLinux hosting
2.  Sentry Init              → Error monitoring (sebelum Express)
3.  Security Headers         → CSP, X-Frame-Options, HSTS, XSS-Protection
4.  Static Files             → Public assets dengan cache control
5.  Body Parsers             → URL-encoded & JSON body
6.  WhatsApp Service Boot    → Inisialisasi WA saat top-level startup
7.  Session Store (SQLite)   → Persistent session
8.  Flash Messages           → Pesan satu-kali (connect-flash)
9.  CSRF Protection          → Token anti-CSRF untuk semua POST
10. Auto-Login (Remember Me) → Cookie-based re-authentication
11. Visit Logger             → Log setiap GET ke visitor_logs
12. Global Locals            → Inject upload info, settings, helpers global
13. Multi-Survey Context     → Deteksi survei aktif dari URL prefix
14. Route Guard              → Cek page_* settings per halaman
15. Route Mounting           → Seluruh router endpoint
16. 404 Handler              → Catch-all not found
17. Sentry Error Handler     → Tangkap error ke Sentry
18. Error Handler            → Render halaman error 500
```

### 5.3 Multi-Survey Context Resolver (Inovasi Utama)

```javascript
app.use((req, res, next) => {
  const surveysConfig = require('./config/surveys.json');
  const firstPart = req.url.split('/')[1]; // e.g. 'sakernas-pemutakhiran'

  if (surveysConfig[firstPart]) {
    res.locals.activeSurvey = firstPart;
    res.locals.routePrefix = '/' + firstPart;
    
    // Inject tema CSS dinamis
    res.locals.customStyles = `
      :root {
        --accent-primary: ${surveysConfig[firstPart].themeColor};
        --survey-gradient: ${surveysConfig[firstPart].themeGradient};
      }
    `;
    // Strip prefix dari URL
    req.url = '/' + req.url.split('/').slice(2).join('/');
  }

  const { surveyContext } = require('./services/contextService');
  return surveyContext.run({ activeSurvey: res.locals.activeSurvey }, next);
});
```

---

## 6. IMPLEMENTASI MODUL FUNGSIONAL (ROUTES & SERVICES)

### 6.1 Peta Modul Fungsional

```
routes/ (30 file)
├── [Publik]         auth.js, index.js
├── [Monitoring]     pcl.js, pml.js, korlap.js, kecamatan.js, subsls.js
├── [Analitik]       earlywarning.js, deteksianomali.js, performa.js,
│                    performa-terendah.js, harian.js, leaderboard.js
├── [Visualisasi]    map.js, pbi.js
├── [AI & Komun.]    agent.js, whatsapp.js
├── [Data Mgmt]      upload.js, export.js, surveys.js
└── [Admin]          master.js, settings.js, users.js, backup.js,
                     admin_stats.js, kipp.js, petugas_email.js

services/ (21 file: 13 root + 8 modul AI di services/ai/)
├── whatsappService.js       → WhatsApp Baileys gateway [49KB]
├── excelParser.js           → Parsing Excel/CSV/JSON [87KB]
├── queryHints.js            → AI intent detection [47KB]
├── surveyDataService.js     → Data aggregation helpers [32KB]
├── googleSheetsAnomalyService.js → Anomali scraping [18KB]
├── firebaseSyncService.js   → Firebase Firestore sync [8KB]
├── agentService.js          → AI chatbot dispatcher [1KB]
├── imputerService.js        → Data imputation [1KB]
└── logger.js, contextService.js, ...
```

### 6.2 Alur Proses Upload Excel

```
Admin Upload .xlsx / .xls / .csv / .json
          ↓
multer (validasi tipe & batas 10MB)
          ↓
excelParser.parseAndSaveExcel()
   ├── XLSX.readFile() → sheet_to_json()
   ├── Deteksi format: FASIH Muatan / FASIH Status / Monitoring SLS
   ├── Normalisasi kolom & sanitasi "null" string
   └── INSERT progres (batch transaction SQLite)
          ↓
rebuildAllSummaryCaches() → UPDATE summary_cache
          ↓
triggerAsyncSync()        → Firebase Firestore sync
```

**Format File yang Didukung:**

| Format | Fungsi |
|---|---|
| `rekap_status_*.xlsx` | Data progres pencacahan per SubSLS dari FASIH |
| `Monitoring_SLS_*.xlsx` | Data SLS dari sistem monitoring nasional |
| `*.csv` | Ekspor CSV dari berbagai sistem |
| `*.json` | Data JSON terstruktur (format khusus) |

### 6.3 Implementasi Early Warning System

**Kondisi yang dideteksi:**

1. **Petugas Tanpa Progres (≥3 Hari)**
```javascript
const pclBelumAktif = db.prepare(`
  SELECT m.pcl, m.korlap, m.kecamatan,
    MAX(u.tanggal) AS last_activity,
    julianday('now') - julianday(MAX(u.tanggal)) AS days_inactive
  FROM subsls_master m
  LEFT JOIN progres p ON m.kode = p.kode
  LEFT JOIN uploads u ON p.upload_id = u.id
  GROUP BY m.pcl
  HAVING days_inactive >= ? OR last_activity IS NULL
`).all(inactiveDays);
```

2. **Proyeksi Petugas At-Risk**
```javascript
const rateHarian = muatanSelesai / hariKerjaSudah;
const proyeksiAkhir = muatanSelesai + (rateHarian * sisaHari);
const isAtRisk = proyeksiAkhir < targetMuatan * 0.95;
```

### 6.4 Implementasi Formula Target Dinamis

```javascript
function getTargetFormula(mode) {
  switch (mode) {
    case 'fasih':   return 'COALESCE(m.target_fasih, 0)';   // Target FASIH nasional
    case 'honor':   return 'COALESCE(m.target_honor, 0)';   // Target berbasis honor
    case 'muatan':  return 'COALESCE(m.muatan, 0)';         // Muatan original
    case 'upload':  return 'COALESCE(p.target_upload, 0)';  // Target dari file upload
    default:        return 'COALESCE(m.target_fasih, 0)';
  }
}
```

Formula dapat diubah dari UI Settings tanpa menyentuh kode — memungkinkan adaptasi terhadap kebijakan BPS Pusat yang berubah-ubah.

### 6.5 Export PDF & Excel

| Format | Library | Fitur |
|---|---|---|
| **PDF** | pdfkit + pdfkit-table | A4, header BPS, tabel progres, stempel tanggal |
| **Excel** | xlsx | Multi-sheet workbook, formula cell |
| **CSV** | Native | Plain-text untuk analisis lanjutan |

---

## 7. IMPLEMENTASI FRONTEND: LAYOUT, VIEW, DAN RESPONSIVITAS

### 7.1 Arsitektur View (36 EJS Files)

Frontend menggunakan **Server-Side Rendering (SSR)** penuh dengan EJS — tanpa framework frontend (React/Vue/Angular), sesuai prinsip Phase 2: *ringan, cepat, tanpa build tool*.

| View File | Ukuran | Fungsi |
|---|---|---|
| `overview.ejs` | 157KB | Dashboard Overview utama |
| `map.ejs` | 101KB | Peta GIS interaktif |
| `agent.ejs` | 103KB | AI Chatbot UI |
| `layout.ejs` | 65KB | Master layout (sidebar, topbar, bottom-nav) |
| `subsls.ejs` | 65KB | Detail SubSLS tabel paginasi |
| `pcl.ejs` | 59KB | Monitoring PCL |
| `help.ejs` | 64KB | Halaman panduan lengkap |

### 7.2 Design Token: Warna dan Tipografi

```css
/* Token Warna SE2026 (sesuai rancangan Phase 2) */
:root {
  --accent-primary: #f97316;   /* BPS Orange */
  --accent-secondary: #facc15; /* Gold accent */
  --bg-dark: #0a0f1a;          /* Dark slate background */
  --bg-card: #0d1424;          /* Card background */
  --text-primary: #e8eaf0;     /* Primary text */
  --text-muted: #8892a4;       /* Muted text */
  --border-color: #1e2840;     /* Border subtle */
}

/* Skala Tipografi Mobile (sesuai AGENTS.md) */
.caption     { font-size: 11px; line-height: 1.4; }  /* Badge, timestamp */
.helper-text { font-size: 13px; line-height: 1.5; }  /* Form help, footer */
.body-text   { font-size: 15px; line-height: 1.6; }  /* Default konten */
.sub-header  { font-size: 17px; line-height: 1.5; }  /* Card header */
.header      { font-size: 21px; line-height: 1.4; }  /* App bar title */
.hero        { font-size: 28px; line-height: 1.3; }  /* Stat highlight */
```

### 7.3 Layout Responsif: Dual Navigation

```css
/* Desktop: Sidebar vertikal */
@media (min-width: 768px) {
  .sidebar { display: flex; width: 240px; }
  .bottom-nav { display: none; }
}

/* Mobile: Bottom navigation bar */
@media (max-width: 767px) {
  .sidebar { display: none; }
  .bottom-nav {
    display: flex;
    position: fixed;
    bottom: 0;
    width: 100%;
  }
}
```

### 7.4 Minifikasi Aset Otomatis

```javascript
// Minify CSS → .min.css & JS → .min.js saat startup
const { minifyAll } = require('./scripts/minify');
minifyAll(); // clean-css + uglify-js
```

Minifikasi mengurangi ukuran aset statis 40–60%.

---

## 8. IMPLEMENTASI MODUL AI CHATBOT (RAG PIPELINE)

### 8.1 Arsitektur Pipeline RAG

```
User Input (pertanyaan)
      ↓
queryHints.js — Deteksi Intent & Entities (keyword NLP)
      ↓
database.js — Retrieve data relevan (SQL queries)
      ↓
agentService.js — Compose context + system prompt
      ↓
Google Gemini API — Generate response (streaming)
      ↓
SSE Stream — Kirim token real-time ke browser (EventSource)
```

### 8.2 `queryHints.js` — Intent Detection (47KB, 2000+ Baris)

```javascript
const hints = [];

// Deteksi query tentang petugas bermasalah
if (/terlambat|lambat|tertinggal|belum selesai/i.test(message)) {
  const atRisk = db.prepare(`
    SELECT pcl, pct, target_fasih_total, muatan_selesai
    FROM summary_cache s WHERE pct < 80 ORDER BY pct ASC LIMIT 10
  `).all();
  hints.push({ type: 'at_risk_officers', data: atRisk });
}

// Deteksi query tentang statistik kecamatan
if (/kecamatan.*progres|progres.*kecamatan/i.test(message)) {
  const kecStats = getKecamatanStats(uploadId, settings);
  hints.push({ type: 'kecamatan_stats', data: kecStats });
}

// Data yang di-retrieve diformat sebagai bagian system prompt
return buildSystemPrompt(hints);
```

### 8.3 SSE Streaming Response

```javascript
router.post('/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const stream = await streamMessageToAgent(message, history, model);
  
  for await (const chunk of stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (text) res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
  }
  
  res.write('data: [DONE]\n\n');
  res.end();
});
```

### 8.4 Dukungan Multi-Model Gemini

```javascript
const geminiModels = settings.gemini_models_list
  ? settings.gemini_models_list.split(',').map(m => m.trim())
  : ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
```

Model dapat dipilih dan dikonfigurasi dari UI Settings tanpa perubahan kode.

---

## 9. IMPLEMENTASI INTEGRASI WHATSAPP (BAILEYS)

### 9.1 Arsitektur WhatsApp Service

```
WhatsApp Service State Machine:
DISCONNECTED → CONNECTING → QR_READY → CONNECTED
      ↑______(auto-reconnect + exponential backoff)______|

Komponen:
├── initialize()          → Buat koneksi WebSocket Baileys
├── startSupervisor()     → Watchdog 24/7 reconnect
├── getStatus()           → Status: CONNECTED / QR_READY / DISCONNECTED
├── sendMessage(jid, msg) → Kirim pesan ke nomor WhatsApp
└── processQueue()        → Proses antrian pesan dari SQLite
```

### 9.2 Exponential Backoff Reconnect

```javascript
let reconnectDelay = 5000;      // Mulai 5 detik
const MAX_DELAY = 300000;       // Maks 5 menit

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    initialize();
  }, reconnectDelay);
}
```

### 9.3 IPv4-Only Force untuk Hosting Compatibility

```javascript
const customAgent = new https.Agent({
  keepAlive: true,
  family: 4   // Paksa IPv4 — cPanel/CloudLinux memblokir IPv6 egress
});
```

### 9.4 Message Queue (SQLite-backed)

```
Admin → INSERT whatsapp_messages (status='pending')
              ↓
processQueue() berjalan setiap 30 detik
              ↓
Kirim via Baileys WebSocket
              ↓
UPDATE status = 'sent' | 'failed'
```

---

## 10. IMPLEMENTASI FIREBASE FIRESTORE SYNC

Firebase Firestore digunakan sebagai *read replica* cloud — memungkinkan akses data real-time dari perangkat mobile tanpa koneksi langsung ke server cPanel.

```javascript
// services/firebaseSyncService.js
async function syncAllToFirestore() {
  const firestoreDb = getFirestore();
  
  // 1. Overview → 'overview_summary/current'
  await firestoreDb.collection('overview_summary').doc('current')
    .set({ ...overview, updated_at: new Date().toISOString() });
  
  // 2. Kecamatan Stats → batch write 'kecamatan_summary/{id}'
  const batch = firestoreDb.batch();
  kecStats.forEach(kec => {
    const ref = firestoreDb.collection('kecamatan_summary').doc(kec.kecamatan);
    batch.set(ref, { ...kec, updated_at: new Date().toISOString() });
  });
  await batch.commit();
  
  // 3. PCL/PML/Korlap Stats, Early Warning, Anomali Stats...
}
```

**Trigger Sinkronisasi:**
- Saat server startup (full clone)
- Setiap upload baru berhasil (incremental update)

---

## 11. IMPLEMENTASI KEAMANAN SISTEM

### 11.1 Security Headers

```javascript
// Content Security Policy
res.setHeader('Content-Security-Policy',
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "frame-ancestors 'self';"
);
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
res.setHeader('X-Frame-Options', 'SAMEORIGIN');
res.setHeader('X-XSS-Protection', '1; mode=block');
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

// Disable fingerprinting
app.disable('x-powered-by');
```

### 11.2 CSRF Protection (Custom Implementation)

```javascript
// Generate token per-session
if (!req.session.csrfToken) {
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
}

// Verifikasi pada setiap POST
const reqToken = req.body?._csrf || req.headers['x-csrf-token'];
if (!reqToken || reqToken !== req.session.csrfToken) {
  return res.status(403).json({ error: 'Token CSRF tidak valid.' });
}
```

### 11.3 Remember Me Token Rotation

```javascript
// Rotasi token setiap one-click login (mencegah session fixation)
const newToken = crypto.randomBytes(32).toString('hex');
deleteRememberToken(oldToken);        // Invalidate token lama
saveRememberToken(user.id, newToken); // Simpan token baru
res.cookie('remember_token', newToken, { httpOnly: true, sameSite: 'lax' });
```

### 11.4 Route Guard berbasis Admin Settings

```javascript
const routeSettingsMap = {
  '/map': 'page_map',
  '/early-warning': 'page_earlywarning',
  '/deteksi-anomali': 'page_deteksianomali',
  '/agent': 'page_aiagent',
  // ...
};

if (settings[settingKey] === '0') {
  return res.status(403).render('error', {
    message: 'Halaman ini dinonaktifkan oleh Administrator.'
  });
}
```

---

## 12. ARSITEKTUR MULTI-SURVEI

### 12.1 Konfigurasi Survei (`config/surveys.json`)

```json
{
  "se2026": {
    "name": "Sensus Ekonomi 2026",
    "themeColor": "#f97316",
    "themeGradient": "linear-gradient(135deg, #f97316, #ea580c, #facc15)",
    "unitName": "dokumen",
    "hasKorlap": true,
    "enabledPages": ["map", "agent", "korlap", "pml", "pcl",
                     "earlywarning", "deteksi-anomali", "performa",
                     "harian", "leaderboard", "kecamatan", "subsls", "export"]
  },
  "sakernas-pemutakhiran": {
    "name": "Sakernas — Pemutakhiran",
    "themeColor": "#10b981",
    "unitName": "Blok Sensus",
    "hasKorlap": false,
    "enabledPages": ["map", "agent", "pml", "pcl", "earlywarning",
                     "harian", "leaderboard", "kecamatan", "subsls", "export"]
  },
  "sakernas-pendataan": {
    "name": "Sakernas — Pendataan",
    "themeColor": "#2563eb",
    "unitName": "Rumah Tangga",
    "hasKorlap": false
  }
}
```

### 12.2 Tema Warna Per Survei

| Survei | Tema | Primary Color | Gradasi |
|---|---|---|---|
| SE2026 | BPS Orange & Dark Slate | `#f97316` | Orange → Merah → Emas |
| Sakernas Pemutakhiran | Emerald Growth | `#10b981` | Emerald → Hijau → Amber |
| Sakernas Pendataan | Sapphire Enterprise | `#2563eb` | Biru → Biru Tua → Langit |

### 12.3 Alur Resolusi URL Multi-Survei

```
Request: GET /sakernas-pemutakhiran/pcl?kec=penajam
                          ↓
MultiSurveyMiddleware:
  activeSurvey = 'sakernas-pemutakhiran'
  dbFile       = data/sakernas-pemutakhiran.db
  themeColor   = '#10b981'
  req.url      = '/pcl?kec=penajam' (prefix dihapus)
                          ↓
Router /pcl → pcl.js handler
  db  = getDb('sakernas-pemutakhiran')
  label = 'Blok Sensus' (bukan 'dokumen')
                          ↓
EJS Render: pcl.ejs
  CSS: --accent-primary: #10b981
  Nav: /sakernas-pemutakhiran/* prefix
```

---

## 13. REKAPITULASI STATISTIK KODE

### 13.1 Volume Kode

| Kategori | Jumlah File | Est. Baris Kode |
|---|---|---|
| Backend Routes (`routes/`) | 30 file | ~6.436 baris |
| Backend Services (`services/`) | 14 file | ~8.700 baris (6.456 root + 2.252 AI subdirektori) |
| Database Module (`database.js`) | 1 file | ~3.400 baris |
| Server Utama (`server.js`) | 1 file | ~754 baris |
| Frontend Views (`views/`) | 36 file | ~24.400 baris |
| Config & Data | 3 file | ~200 baris |
| Scripts & Tools | 5 file | ~1.000 baris |
| **TOTAL** | **~90 file** | **~43.700+ baris** (core files terverifikasi) |

### 13.2 Status Implementasi Fitur

| No | Fitur | Status | Modul Utama |
|---|---|---|---|
| 1 | Dashboard Overview (StatCard, Trend Chart) | ✅ | `overview.ejs`, `routes/index.js` |
| 2 | Upload Excel Multi-format | ✅ | `routes/upload.js`, `services/excelParser.js` |
| 3 | Monitoring PCL/PML/Korlap | ✅ | `routes/pcl.js`, `pml.js`, `korlap.js` |
| 4 | Detail Sub-SLS | ✅ | `routes/subsls.js` |
| 5 | Peta GIS Spasial (KML/GeoJSON) | ✅ | `routes/map.js`, `views/map.ejs` |
| 6 | Early Warning System | ✅ | `routes/earlywarning.js` |
| 7 | Deteksi Anomali (Google Sheets) | ✅ | `routes/deteksianomali.js`, `services/googleSheetsAnomalyService.js` |
| 8 | AI Chatbot (Gemini + RAG) | ✅ | `routes/agent.js`, `services/queryHints.js` |
| 9 | WhatsApp Gateway (Baileys) | ✅ | `services/whatsappService.js` |
| 10 | Firebase Firestore Sync | ✅ | `services/firebaseSyncService.js` |
| 11 | Export PDF/Excel/CSV | ✅ | `routes/export.js` |
| 12 | Leaderboard & Gamifikasi | ✅ | `routes/leaderboard.js` |
| 13 | Multi-Survey Architecture | ✅ (Revisi) | `config/surveys.json`, middleware |
| 14 | Manajemen Admin | ✅ | `routes/users.js`, `settings.js`, `backup.js` |
| 15 | Laporan Harian | ✅ | `routes/harian.js` |
| 16 | KIPP (Kelompok Info Petugas) | ✅ | `routes/kipp.js` |
| 17 | Sentry Error Monitoring | ✅ (Revisi) | `server.js` |
| 18 | Persistent Session (SQLite) | ✅ (Revisi) | `server.js` (SqliteStore) |
| 19 | CSRF Protection | ✅ | `server.js` middleware |
| 20 | Halaman Bantuan (FAQ) | ✅ | `views/help.ejs` |

**Tingkat Implementasi: 20/20 fitur = 100%** ✅

---

## 14. TANTANGAN TEKNIS DAN SOLUSI

### 14.1 Kompatibilitas cPanel Hosting (Dewaweb/CloudLinux)

| Masalah | Solusi |
|---|---|
| `whatsapp-web.js` (Puppeteer) tidak bisa jalan di cPanel | Ganti ke `@whiskeysockets/baileys` (WebSocket murni) |
| Koneksi ke WhatsApp server timeout via IPv6 | `dns.setDefaultResultOrder('ipv4first')` + `https.Agent({ family: 4 })` |
| File KML 12.2MB lambat di-load | Cache static 1 hari + lazy-load + konversi ke GeoJSON parsial |

### 14.2 Server Restart Menghapus Sesi Login

**Masalah:** Passenger merestart server secara periodik — pengguna kehilangan sesi.

**Solusi:** `better-sqlite3-session-store` — sesi disimpan persisten di `data/sessions.db`. Token "Remember Me" memungkinkan auto-login tanpa interaksi ulang.

### 14.3 Query Agregasi Lambat pada Data Besar

**Masalah:** Query `SUM/GROUP BY/JOIN` kompleks pada ribuan baris `progres` mulai lambat.

**Solusi:** Tabel `summary_cache` — agregasi dikomputasi sekali saat upload, halaman monitoring membaca dari cache (tidak query live):

```javascript
// Setelah upload berhasil:
rebuildAllSummaryCaches(); // Rebuild semua summary_cache

// Halaman PCL/PML/Overview membaca dari cache:
SELECT * FROM summary_cache WHERE pcl = ?
```

### 14.4 Data Anomali Tidak Tersedia via API Resmi FASIH

**Masalah:** BPS Pusat tidak menyediakan API anomali yang dapat diakses sistem daerah.

**Solusi:** Scraping dari Google Sheets publik tim FASIH + cache disk persisten (`anomaly_cache_se2026.json`).

### 14.5 Formula Target yang Berubah-ubah

**Masalah:** Formula kalkulasi target berubah beberapa kali sesuai kebijakan BPS Pusat.

**Solusi:** Abstraksi formula ke fungsi `getTargetFormula(mode)` yang dikonfigurasi dari Settings UI. Admin dapat mengubah formula tanpa deploy ulang.

---

## 15. KESIMPULAN

### 15.1 Capaian Implementasi

Seluruh **20 fitur utama** yang direncanakan Phase 2 berhasil diimplementasikan (100%). Ditambah **6 fitur improvements** yang tidak ada di Phase 2:

| # | Fitur Tambahan | Alasan |
|---|---|---|
| 1 | Multi-Survey Architecture | Sakernas 2026 membutuhkan monitoring serupa |
| 2 | Shared Database (`shared.db`) | Referensi data terpusat lintas survei |
| 3 | Persistent Session (SQLite) | Cegah logout paksa saat server restart |
| 4 | Firebase Cloud Sync | Replikasi data ke cloud untuk akses mobile |
| 5 | Sentry Error Monitoring | Monitoring error produksi real-time |
| 6 | Imputer Service | Imputasi data otomatis untuk data hilang |

### 15.2 Metrik Kunci

| Metrik | Nilai |
|---|---|
| Total file kode | ~90 file |
| Total baris kode | ~43.700+ baris |
| Versi sistem | 1.0.0 |
| Jumlah endpoint API | 80+ endpoints |
| Jumlah tabel database | 15+ tabel per survei |
| Jumlah survei didukung | 3 survei |
| Dependensi npm | 24 paket aktif |
| Format file upload | .xlsx, .xls, .csv, .json |
| Format export output | PDF, Excel, CSV |

### 15.3 Nilai BerAKHLAK dalam Implementasi

| Nilai | Wujud dalam Implementasi |
|---|---|
| **Berorientasi Pelayanan** | Sistem ringan, cepat, mudah diakses semua pegawai BPS PPU tanpa VPN |
| **Akuntabel** | Setiap revisi didokumentasikan dengan alasan teknis yang jelas |
| **Kompeten** | Penerapan teknologi modern: AI, WebSocket, Firebase, SSR |
| **Harmonis** | Kolaborasi dengan tim IT dalam code review dan debugging |
| **Loyal** | Mengikuti standar BPS dalam visualisasi dan pelaporan |
| **Adaptif** | Revisi iteratif berdasarkan temuan lapangan selama pengembangan |
| **Kolaboratif** | Akses dibuka untuk seluruh pegawai BPS PPU dan pendamping lapangan |

---

## 16. LAMPIRAN: KODE REPRESENTATIF PER MODUL

### Lampiran A — Inisialisasi & Konfigurasi Database (`database.js`)

```javascript
/**
 * Mendapatkan koneksi database per survei dengan optimasi performa.
 * Singleton per surveyId — koneksi dibuat sekali dan di-cache.
 * Strategi: "One Schema, Many Isolated DB Files"
 */
function getDb(surveyId) {
  const sId = resolveSurveyId(surveyId);
  if (!dbs[sId]) {
    const dbPath = path.join(__dirname, 'data', `${sId}.db`);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    
    const dbConn = new Database(dbPath, { timeout: 15000 });
    
    // Optimasi performa SQLite untuk read-heavy dashboard
    dbConn.pragma('journal_mode = WAL');
    dbConn.pragma('synchronous = NORMAL');
    dbConn.pragma('cache_size = -32000');   // 32MB page cache
    dbConn.pragma('temp_store = MEMORY');
    dbConn.pragma('mmap_size = 134217728'); // 128MB mmap
    dbConn.pragma('foreign_keys = ON');
    
    runMigrations(dbConn, sId);  // Terapkan migrasi schema yang belum ada
    initSettings(dbConn, sId);   // Seed default settings
    initUsers(dbConn);           // Seed default admin user
    
    dbs[sId] = dbConn;
  }
  return dbs[sId];
}
```

### Lampiran B — CSRF Protection Middleware (`server.js`)

```javascript
/**
 * Middleware CSRF: Generate token per-session, verifikasi pada POST.
 * Token dikirim via: form body (_csrf), header (X-CSRF-Token), atau query (?_csrf)
 */
app.use((req, res, next) => {
  if (!req.session) return next();
  
  // Generate token jika belum ada di session
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  
  // GET/HEAD/OPTIONS tidak perlu verifikasi (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  
  // Skip untuk multipart (multer belum parse body saat ini)
  if ((req.headers['content-type'] || '').includes('multipart/form-data')) return next();
  
  // Verifikasi token
  const reqToken = req.body?._csrf || req.headers['x-csrf-token'] || req.query._csrf;
  if (!reqToken || reqToken !== req.session.csrfToken) {
    const isAjax = req.xhr || (req.headers.accept || '').includes('json');
    if (isAjax) {
      return res.status(403).json({ error: 'Token CSRF tidak valid atau kedaluwarsa.' });
    }
    return res.status(403).render('error', {
      title: 'Akses Ditolak (CSRF)',
      message: 'Token CSRF tidak valid. Silakan muat ulang halaman.'
    });
  }
  next();
});
```

### Lampiran C — Proses Parsing Excel (`services/excelParser.js`)

```javascript
/**
 * Parse dan simpan data Excel FASIH ke database.
 * Mendukung berbagai format nama kolom dari berbagai versi ekspor FASIH.
 * Menggunakan batch transaction SQLite untuk performa optimal.
 */
function parseAndSaveExcel(filePath, tanggal, uploadId, surveyId = 'se2026') {
  const db = getDb(surveyId);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });
  
  const upsert = db.prepare(`
    INSERT INTO progres (
      upload_id, kode, draft, submitted_by_pcl, approved, rejected,
      open, sls_selesai, target_upload, pcl_email, pcl_name,
      usaha_ditemukan, usaha_baru, ditemukan, keluarga_baru
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(upload_id, kode) DO UPDATE SET
      draft = excluded.draft,
      submitted_by_pcl = excluded.submitted_by_pcl,
      approved = excluded.approved,
      rejected = excluded.rejected,
      open = excluded.open
  `);
  
  // Satu transaksi untuk semua baris = maksimal kecepatan insert
  db.transaction(() => {
    for (const row of rows) {
      // Normalisasi: berbagai nama kolom dari versi FASIH yang berbeda
      const kode = String(row['ID_SUBSLS'] || row['IDSUBSLS'] || row['kode'] || '').trim();
      if (!kode) continue;
      
      upsert.run(
        uploadId, kode,
        parseInt(row['DRAFT'] || row['draft'] || 0),
        parseInt(row['SUBMITTED'] || row['submitted_by_pcl'] || 0),
        parseInt(row['APPROVED'] || row['approved'] || 0),
        parseInt(row['REJECTED'] || row['rejected'] || 0),
        parseInt(row['OPEN'] || row['open'] || 0),
        parseInt(row['SLS_SELESAI'] || row['sls_selesai'] || 0),
        parseInt(row['TARGET_UPLOAD'] || row['target_upload'] || 0),
        safeNullableStr(row['EMAIL_PCL'] || row['pcl_email']),
        safeNullableStr(row['NAMA_PCL'] || row['pcl_name']),
        parseInt(row['USAHA_DITEMUKAN'] || 0),
        parseInt(row['USAHA_BARU'] || 0),
        parseInt(row['DITEMUKAN'] || 0),
        parseInt(row['KELUARGA_BARU'] || 0)
      );
    }
  })();
  
  return rows.length;
}
```

### Lampiran D — AI Chatbot SSE Streaming (`routes/agent.js`)

```javascript
/**
 * POST /agent/chat/stream — Server-Sent Events untuk streaming token AI.
 * Menggunakan Gemini API generateContentStream untuk respons real-time.
 * Frontend: EventSource API menerima token secara inkremental.
 */
router.post('/chat/stream', async (req, res) => {
  const { message, history, model } = req.body;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  try {
    const stream = await streamMessageToAgent(message, history, {
      model: model || 'gemini-2.5-flash',
      activeSurvey: res.locals.activeSurvey,
      uploadId: res.locals.uploadId,
      settings: res.locals.settings
    });
    
    let fullText = '';
    for await (const chunk of stream) {
      const token = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (token) {
        fullText += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
    logger.info(`[Agent] Stream OK. Chars: ${fullText.length}`);
    
  } catch (err) {
    logger.error('[Agent] Stream error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});
```

### Lampiran E — WhatsApp Service: Koneksi Baileys (`services/whatsappService.js`)

```javascript
/**
 * Inisialisasi koneksi WhatsApp menggunakan Baileys WebSocket API.
 * Pengganti whatsapp-web.js yang membutuhkan Puppeteer/Chromium.
 * State: DISCONNECTED → CONNECTING → QR_READY → CONNECTED
 */
async function initialize() {
  if (isInitializing) return;
  isInitializing = true;
  clientStatus = 'CONNECTING';
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(
      path.join(__dirname, '../.wwebjs_auth/baileys_auth')
    );
    
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      agent: customAgent,           // IPv4-only HTTPS agent
      connectTimeoutMs: 30000,
    });
    
    // Simpan credentials yang diperbarui
    sock.ev.on('creds.update', saveCreds);
    
    // Handle perubahan status koneksi
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        clientStatus = 'QR_READY';
        qrcode.toDataURL(qr, (err, url) => { if (!err) qrCodeDataUri = url; });
        addWaLog('info', '📱 QR Code siap — scan untuk terhubung');
      }
      
      if (connection === 'open') {
        clientStatus = 'CONNECTED';
        reconnectDelay = 5000;  // Reset exponential backoff
        addWaLog('success', '✅ WhatsApp berhasil terhubung');
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        clientStatus = 'DISCONNECTED';
        addWaLog('warn', `⚠️ Koneksi terputus (${statusCode}). Reconnect: ${shouldReconnect}`);
        if (shouldReconnect) scheduleReconnect();
      }
    });
    
  } finally {
    isInitializing = false;
  }
}
```

### Lampiran F — Formula Target Dinamis (`database.js`)

```javascript
/**
 * Abstraksi formula SQL untuk kalkulasi target pencacahan.
 * Mode dapat diubah dari UI Settings — tidak perlu deploy ulang
 * untuk mengikuti perubahan kebijakan BPS Pusat.
 * 
 * @param {string} mode - 'fasih' | 'honor' | 'muatan' | 'upload'
 * @returns {string} SQL expression untuk digunakan dalam query
 */
function getTargetFormula(mode) {
  switch (mode) {
    case 'fasih':   return 'COALESCE(m.target_fasih, 0)';
    case 'honor':   return 'COALESCE(m.target_honor, 0)';
    case 'muatan':  return 'COALESCE(m.muatan, 0)';
    case 'upload':  return 'COALESCE(p.target_upload, 0)';
    default:        return 'COALESCE(m.target_fasih, 0)';
  }
}

/**
 * Formula realisasi: apa yang dihitung sebagai "sudah selesai"
 * bergantung pada mode target yang dipilih.
 */
function getRealizationFormula(mode, alias = 'p') {
  switch (mode) {
    case 'muatan':
      return `(COALESCE(${alias}.usaha_ditemukan, 0) + 
               COALESCE(${alias}.usaha_baru, 0) + 
               COALESCE(${alias}.ditemukan, 0) + 
               COALESCE(${alias}.keluarga_baru, 0))`;
    default:
      // Mode FASIH: dokumen yang submitted + approved + rejected = sudah ditangani
      return `(COALESCE(${alias}.submitted_by_pcl, 0) + 
               COALESCE(${alias}.approved, 0) + 
               COALESCE(${alias}.rejected, 0))`;
  }
}
```

### Lampiran G — Entity Relationship Diagram (Final Implementasi)

```
╔═══════════════╗    1:∞    ╔═══════════════════╗
║    users      ║──────────║  remember_tokens  ║
║───────────────║          ║───────────────────║
║ id PK         ║          ║ id PK             ║
║ username      ║          ║ user_id FK        ║
║ password      ║          ║ token             ║
║ role          ║          ║ expires_at        ║
╚═══════════════╝          ╚═══════════════════╝

╔═══════════════╗    1:∞    ╔═══════════════════╗
║    uploads    ║──────────║     progres        ║
║───────────────║          ║───────────────────║
║ id PK         ║          ║ id PK             ║
║ filename      ║          ║ upload_id FK      ║
║ tanggal       ║    ┌─────║ kode FK           ║
║ status_fname  ║    │     ║ draft             ║
║ created_at    ║    │     ║ submitted_by_pcl  ║
╚═══════════════╝    │     ║ approved          ║
       │             │     ║ rejected          ║
       │1            │     ║ sls_selesai       ║
       │             │     ║ target_upload     ║
       ∞             │     ║ open              ║
╔═════════════════╗  │     ║ pcl_email         ║
║  summary_cache  ║  │     ║ [+ 20 kolom lain] ║
║─────────────────║  │     ╚═══════════════════╝
║ id PK           ║  │              │∞
║ upload_id FK    ║  │     ┌────────┘
║ kecamatan       ║  │     │
║ desa            ║  │ ╔═══╧═════════════════╗
║ pcl, pml, korlap║  │ ║  subsls_master      ║
║ total_sls       ║  │ ║────────────────────║
║ selesai         ║  └─║ kode PK            ║
║ total_muatan    ║    ║ kecamatan          ║
║ [+ 25 kolom lain║    ║ desa               ║
╚═════════════════╝    ║ korlap, pml, pcl   ║
                       ║ muatan             ║
                       ║ target_fasih       ║
                       ║ muatan_original    ║
                       ║ kode_2025          ║
                       ╚═════════════════════╝

[DATABASE BERSAMA: shared.db]
╔══════════════════╗  1:∞  ╔══════════════════╗
║ ref_kecamatan    ║───────║ ref_desa         ║
║──────────────────║       ║──────────────────║
║ kode_kec PK      ║       ║ kode_desa PK     ║
║ nama_kecamatan   ║       ║ kode_kec FK      ║
╚══════════════════╝       ║ nama_desa        ║
                           ╚══════════════════╝

╔══════════════════╗
║ ref_petugas      ║  ← VIEW: petugas_email (backward compat)
║──────────────────║
║ id PK            ║
║ sobat_id         ║
║ nama_lengkap     ║
║ email UNIQUE     ║
╚══════════════════╝
```

---

*Laporan ini dibuat sebagai bagian dari pelaksanaan Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026.*  
**Kegiatan 3: Implementasi Sistem & Pengkodean**  
*Tahapan 3.1 (Pengembangan Basis Data & Agregasi), 3.2 (Coding Frontend & Backend), 3.3 (Integrasi Fitur AI), 3.4 (Code Review & Debugging)*

---

**Penyusun,**

**Yahya Abdurrohman, S.Tr.Stat.**  
*BPS Kabupaten Penajam Paser Utara*

---
*Dokumen ini merupakan dokumen teknis internal BPS PPU.*
