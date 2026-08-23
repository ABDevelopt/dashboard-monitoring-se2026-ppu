# DOKUMEN SPESIFIKASI SOURCE CODE PROGRAM DASBOR PEMANTAUAN LOKAL
## Dashboard Monitoring Sensus Ekonomi 2026 (SE2026) BPS Kabupaten Penajam Paser Utara
### Tahapan 3.2: Coding Frontend dan Backend

---

**Nama Sistem:** Pananyo Taka — Dashboard Monitoring SE2026 PPU
**Versi Sistem:** v1.0.0 (Node.js 20+, Express 5, Better-SQLite3, Baileys WA, Gemini AI)
**Mentor:** Baihaqi Ilham Syah, S.Tr.Stat.
**Penyusun:** Yahya Abdurrohman, S.Tr.Stat. | BPS Kabupaten Penajam Paser Utara
**Tanggal:** 22 Agustus 2026

---

## 1. PENDAHULUAN & ARSITEKTUR KODE

Dokumen ini merupakan laporan luaran fisik **Tahapan 3.2: Coding Frontend dan Backend** pada Kegiatan 3 Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026.

Sistem dibangun menggunakan arsitektur **Express.js (Node.js runtime)** pada backend dan **Embedded JavaScript (EJS)** pada frontend dengan paradigma Server-Side Rendering (SSR) yang ringan, cepat, dan tidak membutuhkan build-step yang rumit.

---

## 2. STRUKTUR DIREKTORI SOURCE CODE

Sistem tersusun atas **30 modul routing**, **21 modul service** (13 root + 8 modul AI subdirektori), dan **36 template view EJS**:

```
monitoring-se2026-ppu/
├── server.js                     <- Titik masuk server utama & middleware stack (753 baris)
├── database.js                   <- Data Access Layer & kueri SQL (3.396 baris)
├── package.json                  <- Manifest dependensi & skrip npm (v1.0.0, 24 paket)
├── routes/                       <- Modul routing Express.js (30 file, 6.436 baris)
│   ├── auth.js                   <- Login, Remember Me token, Logout
│   ├── index.js                  <- Dashboard overview & tren pencacahan
│   ├── pcl.js, pml.js, korlap.js <- Monitoring performa per jenjang petugas
│   ├── kecamatan.js, subsls.js   <- Monitoring agregasi wilayah
│   ├── earlywarning.js           <- Deteksi petugas terlambat & at-risk
│   ├── deteksianomali.js         <- Audit anomali data (Google Sheets)
│   ├── map.js                    <- Peta GIS interaktif wilayah PPU
│   ├── upload.js                 <- Form unggah & validasi berkas Excel
│   ├── export.js                 <- Ekspor laporan PDF & Excel
│   ├── agent.js                  <- AI Chatbot SSE endpoint
│   ├── harian.js                 <- Laporan tren harian
│   ├── leaderboard.js            <- Leaderboard gamifikasi
│   ├── pbi.js                    <- Integrasi Power BI embed
│   ├── backup.js                 <- Backup database
│   ├── surveys.js                <- Manajemen multi-survei
│   ├── whatsapp.js               <- WhatsApp Gateway UI
│   ├── search.js                 <- Pencarian global
│   ├── kipp.js                   <- Kelompok Info Petugas Pengawas
│   ├── performa.js               <- Analitik performa
│   ├── performa-terendah.js      <- Deteksi petugas performa terendah
│   ├── master.js                 <- Manajemen data master
│   ├── petugas_email.js          <- Manajemen email petugas
│   └── settings.js, users.js, admin_stats.js, admin_spreadsheet.js
├── services/                     <- Layanan logika bisnis (13 file root)
│   ├── excelParser.js            <- Parser multi-format FASIH Excel (85 KB, 2.077 baris)
│   ├── surveyDataService.js      <- Helper agregasi data per survei (30 KB, 752 baris)
│   ├── whatsappService.js        <- WhatsApp Baileys gateway (48 KB, 1.316 baris)
│   ├── queryHints.js             <- Deteksi intent NLP untuk AI (46 KB, 1.045 baris)
│   ├── googleSheetsAnomalyService.js <- Parser data anomali Google Sheets (17 KB)
│   ├── firebaseSyncService.js    <- Sinkronisasi data ke Firebase Cloud (8 KB)
│   ├── agentService.js           <- AI chatbot dispatcher entry point (1 KB)
│   ├── dbSchema.js               <- Skema introspeksi database untuk AI (7 KB)
│   ├── imputerService.js         <- Imputasi data otomatis (1.3 KB)
│   ├── surveyRegistry.js         <- Registry konfigurasi multi-survei (7 KB)
│   ├── contextService.js         <- Context resolver AsyncLocalStorage (137 bytes)
│   └── logger.js                 <- Logging terstruktur Winston (1.8 KB)
│   └── ai/                       <- Modul AI lanjutan (8 file, 2.252 baris)
│       ├── orchestrator.js       <- Orkestrator utama pipeline AI (27 KB)
│       ├── llmGateway.js         <- Gateway multi-provider LLM (18 KB)
│       ├── toolRegistry.js       <- Registry fungsi/tool AI (18 KB)
│       ├── contextBuilder.js     <- Pembangun konteks dinamis untuk prompt (6 KB)
│       ├── keyPool.js            <- Pengelola pool API key Gemini (14 KB)
│       ├── fastPathHandler.js    <- Handler jalur cepat untuk query sederhana (6 KB)
│       ├── memoryManager.js      <- Manajemen memori percakapan (3 KB)
│       └── cacheManager.js       <- Cache respons AI (2 KB)
└── views/                        <- Template antarmuka EJS (36 file, 24.391 baris)
    ├── layout.ejs                <- Layout master responsif desktop/mobile (63 KB, 1.202 baris)
    ├── overview.ejs              <- Tampilan dasbor analitik utama (153 KB, 2.714 baris)
    ├── map.ejs                   <- Peta spasial GIS Leaflet (101 KB)
    ├── agent.ejs                 <- Antarmuka AI Chatbot (100 KB, 2.693 baris)
    ├── help.ejs                  <- Halaman panduan interaktif (64 KB)
    └── subsls.ejs, pcl.ejs, pml.ejs, korlap.ejs, kecamatan.ejs, ...
```

---

## 3. STATISTIK VOLUME KODE TERVERIFIKASI

| Kategori | Jumlah File | Baris Kode Terverifikasi |
|---|:---:|:---:|
| Backend Routes (`routes/`) | 30 file | 6.436 baris |
| Backend Services — root (`services/`) | 13 file | 6.456 baris |
| Backend Services — AI (`services/ai/`) | 8 file | 2.252 baris |
| Database Module (`database.js`) | 1 file | 3.396 baris |
| Server Utama (`server.js`) | 1 file | 753 baris |
| Frontend Views (`views/`) | 36 file | 24.391 baris |
| **TOTAL CORE FILES** | **~90 file** | **~43.700+ baris** |

> **Catatan Koreksi (dari Verifikasi Akurasi):** Total baris kode sebelumnya diestimasi ~46.000. Setelah penghitungan langsung terhadap kode sumber, total core files adalah ~43.700 baris. Selisih ~2.300 baris berasal dari file konfigurasi, script pendukung, dan file data yang tidak termasuk dalam hitungan utama.

---

## 4. DEPENDENSI NPM (24 PAKET AKTIF)

| Package | Versi | Fungsi |
|---|---|---|
| `express` | ^5.2.1 | HTTP framework & routing |
| `ejs` | ^6.0.1 | Server-side template engine |
| `express-ejs-layouts` | ^2.5.1 | Layout wrapper untuk EJS |
| `better-sqlite3` | ^12.11.1 | SQLite driver sinkron |
| `better-sqlite3-session-store` | ^0.1.0 | Persistent session store di SQLite |
| `express-session` | ^1.19.0 | Session management |
| `connect-flash` | ^0.1.1 | Flash messages |
| `@google/generative-ai` | ^0.24.1 | Google Gemini AI SDK |
| `@whiskeysockets/baileys` | ^6.7.9 | WhatsApp WebSocket API |
| `firebase-admin` | ^14.2.0 | Firebase Firestore cloud sync |
| `@sentry/node` | ^10.64.0 | Error monitoring produksi |
| `winston` | ^3.19.0 | Structured logging |
| `pino` | ^8.19.0 | High-performance logging |
| `multer` | ^2.2.0 | File upload handler |
| `xlsx` | ^0.18.5 | Excel parser & writer |
| `pdfkit` | ^0.19.1 | PDF generation |
| `pdfkit-table` | ^0.2.11 | PDF table extension |
| `clean-css` | ^5.3.3 | CSS minifier |
| `uglify-js` | ^3.19.3 | JavaScript minifier |
| `dotenv` | ^17.4.2 | Environment variable loader |
| `@turf/turf` | ^7.4.0 | GIS/spatial computation |
| `qrcode` | ^1.5.4 | QR code generator |
| `qrcode-terminal` | ^0.12.0 | QR code terminal display |
| `firebase-admin` | ^14.2.0 | Firebase Admin SDK |

> **Catatan:** `whatsapp-web.js` v1.34.7 masih ada di `package.json` sebagai *legacy entry* (sebelum migrasi ke Baileys) namun sudah tidak aktif digunakan. Sebaiknya dihapus pada pembaruan berikutnya untuk menjaga kebersihan dependensi.

---

## 5. IMPLEMENTASI MODUL BACKEND UTAMA

### 5.1 Pipeline Inisialisasi Server (`server.js`)

```javascript
// Global Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "frame-ancestors 'self';"
  );
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Sesi Persisten Menggunakan SQLite
const SqliteStore = require('better-sqlite3-session-store')(session);
const sessionDb = new sqlite3(path.join(__dirname, 'data/sessions.db'));

app.use(session({
  store: new SqliteStore({ client: sessionDb, expired: { clear: true, intervalMs: 900000 } }),
  secret: 'se2026-ppu-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));
```

### 5.2 Urutan Lengkap 18 Layer Middleware Stack

```
1.  DNS IPv4 Override        -> Paksa IPv4 untuk cPanel/CloudLinux hosting
2.  Sentry Init              -> Error monitoring (sebelum Express)
3.  Security Headers         -> CSP, X-Frame-Options, HSTS, XSS-Protection
4.  Static Files             -> Public assets dengan cache control
5.  Body Parsers             -> URL-encoded & JSON body
6.  WhatsApp Service Boot    -> Inisialisasi WA saat top-level startup
7.  Session Store (SQLite)   -> Persistent session
8.  Flash Messages           -> Pesan satu-kali (connect-flash)
9.  CSRF Protection          -> Token anti-CSRF untuk semua POST
10. Auto-Login (Remember Me) -> Cookie-based re-authentication
11. Visit Logger             -> Log setiap GET ke visitor_logs
12. Global Locals            -> Inject upload info, settings, helpers global
13. Multi-Survey Context     -> Deteksi survei aktif dari URL prefix
14. Route Guard              -> Cek page_* settings per halaman
15. Route Mounting           -> Seluruh router endpoint
16. 404 Handler              -> Catch-all not found
17. Sentry Error Handler     -> Tangkap error ke Sentry
18. Error Handler            -> Render halaman error 500
```

### 5.3 Modul ETL Excel Parser (`services/excelParser.js`)

```javascript
/**
 * Mem-parsing berkas Excel ekspor FASIH dan menyimpan ke tabel progres
 * Menggunakan batch transaction untuk memproses ribuan baris dalam < 1 detik.
 * File: services/excelParser.js | 85 KB | 2.077 baris
 */
function parseAndSaveExcel(filePath, tanggal, uploadId, surveyId = 'se2026') {
  const db = getDb(surveyId);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });

  const stmt = db.prepare(`
    INSERT INTO progres (
      upload_id, kode, draft, submitted_by_pcl, approved, rejected,
      open, sls_selesai, target_upload, pcl_email, pcl_name,
      usaha_ditemukan, usaha_baru, ditemukan, keluarga_baru
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(upload_id, kode) DO UPDATE SET
      draft = excluded.draft,
      submitted_by_pcl = excluded.submitted_by_pcl,
      approved = excluded.approved,
      rejected = excluded.rejected
  `);

  db.transaction(() => {
    for (const row of rows) {
      const kode = String(row['ID_SUBSLS'] || row['IDSUBSLS'] || '').trim();
      if (!kode) continue;
      stmt.run(
        uploadId, kode,
        parseInt(row['DRAFT'] || 0),
        parseInt(row['SUBMITTED'] || 0),
        parseInt(row['APPROVED'] || 0),
        parseInt(row['REJECTED'] || 0),
        parseInt(row['OPEN'] || 0),
        parseInt(row['SLS_SELESAI'] || 0),
        parseInt(row['TARGET_UPLOAD'] || 0),
        safeNullableStr(row['EMAIL_PCL']),
        safeNullableStr(row['NAMA_PCL']),
        parseInt(row['USAHA_DITEMUKAN'] || 0),
        parseInt(row['USAHA_BARU'] || 0),
        parseInt(row['DITEMUKAN'] || 0),
        parseInt(row['KELUARGA_BARU'] || 0)
      );
    }
  })();
}
```

---

## 6. IMPLEMENTASI FRONTEND & DESAIN SISTEM

### 6.1 Dual Navigation Pattern (`views/layout.ejs`)

Frontend mengimplementasikan pola navigasi ganda:
- **Sidebar Navigasi Desktop:** Ditampilkan pada layar lebar (>=768px) dengan hierarki menu lengkap.
- **Bottom Navigation Mobile:** Bilah navigasi melayang di bagian bawah layar untuk ponsel (<768px).

```html
<!-- Mobile Bottom Navigation Bar -->
<nav class="bottom-nav d-md-none fixed-bottom bg-dark border-top border-secondary">
  <div class="d-flex justify-content-around py-2">
    <a href="<%= navPrefix %>/" class="bottom-nav-item <%= activePage === 'overview' ? 'active' : '' %>">
      <i class="bi bi-grid-fill"></i><span>Dasbor</span>
    </a>
    <a href="<%= navPrefix %>/pcl" class="bottom-nav-item <%= activePage === 'pcl' ? 'active' : '' %>">
      <i class="bi bi-people-fill"></i><span>PCL</span>
    </a>
    <a href="<%= navPrefix %>/early-warning" class="bottom-nav-item">
      <i class="bi bi-exclamation-triangle-fill"></i><span>EWS</span>
    </a>
    <a href="<%= navPrefix %>/map" class="bottom-nav-item">
      <i class="bi bi-map-fill"></i><span>Peta</span>
    </a>
    <a href="<%= navPrefix %>/agent" class="bottom-nav-item">
      <i class="bi bi-robot"></i><span>AI Chat</span>
    </a>
  </div>
</nav>
```

### 6.2 Skala Tipografi Mobile Standar (AGENTS.md Compliant)

Sesuai panduan `AGENTS.md`, seluruh halaman mematuhi standar tipografi mobile:

| Kelas CSS | Ukuran | Penggunaan |
|---|---|---|
| `.caption` | 11px, line-height 1.4 | Badge, timestamp, non-kritikal |
| `.helper-text` | 13px, line-height 1.5 | Form help, footer, sub-info |
| `.body-text` | 15px, line-height 1.6 | Konten utama tabel & deskripsi |
| `.sub-header` | 17px, line-height 1.5 | Card header, tombol utama |
| `.header` | 21px, line-height 1.4 | App bar title, nama menu |
| `.hero` | 28px, line-height 1.3 | Angka statistik highlight |

---

## 7. KESIMPULAN TAHAPAN 3.2

Tahapan 3.2 telah menghasilkan source code dasbor yang bersih, terstruktur rapi, menerapkan prinsip pemisahan tanggung jawab (*Separation of Concerns*), dan siap dideploy pada lingkungan server web cPanel BPS Kabupaten Penajam Paser Utara. Total **43.700+ baris kode** terverifikasi aktif mendukung 20 fitur utama monitoring lapangan SE 2026.
