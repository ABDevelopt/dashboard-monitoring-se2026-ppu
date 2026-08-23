# DOKUMEN SPESIFIKASI BASIS DATA LOKAL TERSTRUKTUR DAN SKRIP AGREGASI DATA
## Dashboard Monitoring Sensus Ekonomi 2026 (SE2026) BPS Kabupaten Penajam Paser Utara
### Tahapan 3.1: Pengembangan Basis Data dan Agregasi

---

**Nama Sistem:** Pananyo Taka — Dashboard Monitoring SE2026 PPU
**Versi Sistem:** v1.0.0 (Node.js 20+, Express 5, Better-SQLite3, Baileys WA, Gemini AI)
**Mentor:** Baihaqi Ilham Syah, S.Tr.Stat.
**Penyusun:** Yahya Abdurrohman, S.Tr.Stat. | BPS Kabupaten Penajam Paser Utara
**Tanggal:** 22 Agustus 2026

---

## 1. PENDAHULUAN & RUANG LINGKUP BASIS DATA

Dokumen ini merupakan laporan luaran fisik **Tahapan 3.1: Pengembangan Basis Data dan Agregasi** pada Kegiatan 3 Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026.

Tahapan ini berfokus pada:
1. Mengimplementasikan skema relasional SQLite 15+ tabel yang telah dirancang pada Phase 2.
2. Menerapkan konfigurasi *high-performance pragma* pada engine SQLite `better-sqlite3` v12.11.1.
3. Mengembangkan skrip agregasi bertingkat (*summary caching*) untuk komputasi kueri < 15ms.
4. Mengembangkan mekanisme migrasi skema database bertahap (`schema_migrations`).
5. Membangun database referensi terpusat lintas survei (`shared.db`).

> **Catatan Revisi dari Phase 2:** Skema awal 12 tabel pada Phase 2 diperluas menjadi 15+ tabel. Penambahan utama: `schema_migrations`, `visitor_logs`, `whatsapp_messages`, dan perluasan kolom tabel `progres` (8 kolom baru) dan `subsls_master` (2 kolom baru). Selain itu, database `shared.db` ditambahkan sebagai repositori referensi master lintas survei yang tidak diantisipasi di Phase 2.

---

## 2. ARSITEKTUR FISIK BASIS DATA (MULTI-DB ISOLATION)

Sistem menggunakan strategi **"One Schema, Many Isolated DB Files"**:

```
data/
├── se2026.db                  ← Database SE2026 (produksi aktif)
├── sakernas-pemutakhiran.db   ← Database Sakernas Listing
├── sakernas-pendataan.db      ← Database Sakernas Pendataan
├── shared.db                  ← Database bersama (referensi kecamatan, desa, petugas)
└── sessions.db                ← Persistent session storage (Express Session)
```

Setiap file `*.db` survei memiliki skema **identik**, data **terisolasi**. Tidak ada JOIN lintas database survei. `shared.db` adalah pengecualian: berisi tabel referensi yang digunakan oleh semua survei (`ref_kecamatan`, `ref_desa`, `ref_petugas`).

### Konfigurasi Pragma Performa Tinggi SQLite

```javascript
// database.js: Konfigurasi pragma untuk kecepatan read-heavy dashboard
const dbConn = new Database(dbPath, { timeout: 15000 });
dbConn.pragma('journal_mode = WAL');      // Write-Ahead Logging (concurrency tinggi)
dbConn.pragma('synchronous = NORMAL');    // Optimasi I/O disk aman
dbConn.pragma('cache_size = -32000');     // 32MB page cache di RAM
dbConn.pragma('temp_store = MEMORY');     // Tabel sementara disimpan di memori
dbConn.pragma('mmap_size = 134217728');   // 128MB Memory-mapped I/O
dbConn.pragma('foreign_keys = ON');       // Integritas referensial aktif
```

### WAL Checkpoint Otomatis (6 Jam)

```javascript
// Checkpoint otomatis mencegah file WAL membengkak tanpa batas
const WAL_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
setInterval(() => {
  runWalCheckpointAll(); // PASSIVE mode — tidak memblokir reader/writer aktif
}, WAL_CHECKPOINT_INTERVAL_MS);
```

---

## 3. DDL SKEMA TABEL UTAMA (DATA DEFINITION LANGUAGE)

### 3.1 Tabel `uploads` (Riwayat Unggahan Berkas)
```sql
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  stored_filename TEXT,
  tanggal DATE NOT NULL,
  total_subsls_terisi INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status_filename TEXT,
  stored_status_filename TEXT
);
```

### 3.2 Tabel `subsls_master` (Master Wilayah & Alokasi Petugas — Revisi Phase 3)
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
  kode_2025 TEXT,             -- [BARU: Revisi 3.1.3 — Pemetaan historis ID SubSLS 2025]
  target_fasih INTEGER DEFAULT 0,
  target_honor INTEGER DEFAULT 0,
  muatan_original INTEGER DEFAULT 0  -- [BARU: Revisi 3.1.3 — Nilai muatan sebelum override]
);
```

### 3.3 Tabel `progres` (Data Progres Pencacahan Lapangan — 30+ Kolom, Versi Final)
```sql
CREATE TABLE IF NOT EXISTS progres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  kode TEXT NOT NULL,
  -- Status Usaha
  usaha_tidak_ditemukan INTEGER DEFAULT 0,
  usaha_ditemukan INTEGER DEFAULT 0,
  usaha_baru INTEGER DEFAULT 0,
  usaha_tutup INTEGER DEFAULT 0,
  usaha_ganda INTEGER DEFAULT 0,
  -- Status Keluarga
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
  -- Status Kuesioner FASIH
  draft INTEGER DEFAULT 0,
  submitted_by_pcl INTEGER DEFAULT 0,
  approved INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  sls_selesai INTEGER DEFAULT 0,          -- [BARU: Revisi 3.1.1]
  target_upload INTEGER DEFAULT 0,        -- [BARU: Revisi 3.1.1]
  open INTEGER DEFAULT 0,                 -- [BARU: Revisi 3.1.1]
  -- Petugas Lapangan
  pcl_email TEXT,                         -- [BARU: Revisi 3.1.1]
  pcl_name TEXT,                          -- [BARU: Revisi 3.1.1]
  pcl_sobat_id TEXT,                      -- [BARU: Revisi 3.1.1]
  UNIQUE(upload_id, kode)
);
```

### 3.4 Tabel `summary_cache` (Agregasi Cepat Bertingkat)
```sql
CREATE TABLE IF NOT EXISTS summary_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  kecamatan TEXT,
  desa TEXT,
  korlap TEXT,
  pml TEXT,
  pcl TEXT,
  total_sls INTEGER DEFAULT 0,
  selesai INTEGER DEFAULT 0,
  total_muatan INTEGER DEFAULT 0,
  muatan_selesai INTEGER DEFAULT 0,
  usaha_total INTEGER DEFAULT 0,
  keluarga_total INTEGER DEFAULT 0,
  draft_total INTEGER DEFAULT 0,
  open_total INTEGER DEFAULT 0,
  submitted_total INTEGER DEFAULT 0,
  approved_total INTEGER DEFAULT 0,
  rejected_total INTEGER DEFAULT 0,
  target_fasih_total INTEGER DEFAULT 0,
  target_static_total INTEGER DEFAULT 0,
  target_upload_total INTEGER DEFAULT 0,
  target_honor_total INTEGER DEFAULT 0,
  pct REAL DEFAULT 0.0
);
```

### 3.5 Indeks Database untuk Optimasi Query

```sql
CREATE INDEX IF NOT EXISTS idx_progres_upload_id    ON progres(upload_id);
CREATE INDEX IF NOT EXISTS idx_progres_upload_kode  ON progres(upload_id, kode);
CREATE INDEX IF NOT EXISTS idx_subsls_master_kec    ON subsls_master(kecamatan);
CREATE INDEX IF NOT EXISTS idx_subsls_master_pcl    ON subsls_master(pcl);
CREATE INDEX IF NOT EXISTS idx_subsls_master_pml    ON subsls_master(pml);
CREATE INDEX IF NOT EXISTS idx_subsls_master_korlap ON subsls_master(korlap);
```

---

## 4. SKRIP AGREGASI DATA & FORMULA PERHITUNGAN

### 4.1 Skrip Rebuild Cache Otomatis (`rebuildAllSummaryCaches`)

```javascript
/**
 * Komputasi ulang seluruh agregasi statistik per-PCL, PML, Korlap, Desa, dan Kecamatan
 * Dijalankan otomatis setiap kali berkas Excel baru selesai diunggah.
 */
function rebuildSummaryCacheForUpload(uploadId, surveyId = 'se2026') {
  const db = getDb(surveyId);
  const settings = getSettings(surveyId);
  
  const targetFormula = getTargetFormula(settings.target_fasih_mode);
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  
  db.transaction(() => {
    // Hapus cache lama untuk upload_id terkait
    db.prepare('DELETE FROM summary_cache WHERE upload_id = ?').run(uploadId);
    
    // Insert agregasi baru per Petugas & Wilayah
    db.prepare(`
      INSERT INTO summary_cache (
        upload_id, kecamatan, desa, korlap, pml, pcl,
        total_sls, selesai, total_muatan, muatan_selesai,
        usaha_total, keluarga_total, draft_total, open_total,
        submitted_total, approved_total, rejected_total,
        target_fasih_total, target_static_total, pct
      )
      SELECT 
        ? AS upload_id,
        m.kecamatan, m.desa, m.korlap, m.pml, m.pcl,
        COUNT(m.kode) AS total_sls,
        SUM(COALESCE(p.sls_selesai, 0)) AS selesai,
        SUM(COALESCE(m.muatan, 0)) AS total_muatan,
        SUM(${realFormula}) AS muatan_selesai,
        SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) AS usaha_total,
        SUM(COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS keluarga_total,
        SUM(COALESCE(p.draft, 0)) AS draft_total,
        SUM(COALESCE(p.open, 0)) AS open_total,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(p.approved, 0)) AS approved_total,
        SUM(COALESCE(p.rejected, 0)) AS rejected_total,
        SUM(${targetFormula}) AS target_fasih_total,
        SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
        CASE WHEN SUM(${targetFormula}) > 0 
          THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0)) / SUM(${targetFormula}), 2)
          ELSE 0.0 END AS pct
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      GROUP BY m.kecamatan, m.desa, m.korlap, m.pml, m.pcl
    `).run(uploadId, uploadId);
  })();
}
```

### 4.2 Formula Target Dinamis Abstraktif

```javascript
function getTargetFormula(mode) {
  switch (mode) {
    case 'fasih':   return 'COALESCE(m.target_fasih, 0)';
    case 'honor':   return 'COALESCE(m.target_honor, 0)';
    case 'muatan':  return 'COALESCE(m.muatan, 0)';
    case 'upload':  return 'COALESCE(p.target_upload, 0)';
    default:        return 'COALESCE(m.target_fasih, 0)';
  }
}
```

Formula dapat diubah dari UI Settings tanpa menyentuh kode — memungkinkan adaptasi terhadap kebijakan BPS Pusat yang berubah-ubah.

---

## 5. SKRIP MIGRASI SKEMA BERTAHAP (`schema_migrations`)

```javascript
function runMigrations(dbConn, surveyId = 'se2026') {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = dbConn.prepare('SELECT version FROM schema_migrations').all().map(m => m.version);
  
  const migrations = [
    { version: '20260710000000_init', up: (db) => { /* Tabel uploads, master, progres awal */ } },
    { version: '20260715000001_add_pcl_fields', up: (db) => {
        db.exec("ALTER TABLE progres ADD COLUMN pcl_email TEXT;");
        db.exec("ALTER TABLE progres ADD COLUMN pcl_name TEXT;");
      }
    },
    { version: '20260720000002_add_target_upload', up: (db) => {
        db.exec("ALTER TABLE progres ADD COLUMN target_upload INTEGER DEFAULT 0;");
        db.exec("ALTER TABLE progres ADD COLUMN sls_selesai INTEGER DEFAULT 0;");
      }
    }
  ];

  for (const m of migrations) {
    if (!applied.includes(m.version)) {
      dbConn.transaction(() => {
        m.up(dbConn);
        dbConn.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
      })();
    }
  }
}
```

---

## 6. REKAPITULASI STATISTIK BASIS DATA

| Metrik Basis Data | Nilai |
|---|---|
| Jumlah file database | 5 file (.db) |
| Tabel per database survei | 15+ tabel |
| Konfigurasi pragma | 6 pragma (WAL, NORMAL, 32MB, MEMORY, 128MB mmap, FK ON) |
| Indeks database | 6 indeks komposit |
| Ukuran database.js | 3.396 baris (137 KB) |
| Target kecepatan kueri dashboard | < 15ms (tercapai dengan summary_cache) |
| Checkpoint interval WAL | Setiap 6 jam (PASSIVE mode) |

---

## 7. KESIMPULAN TAHAPAN 3.1

Tahapan 3.1 telah berhasil menghasilkan fondasi basis data yang tangguh, terstruktur, dan memiliki performa tinggi. Melalui optimasi WAL mode, indexing, dan sistem agregasi `summary_cache`, waktu eksekusi kueri dashboard pemantauan terpangkas dari **~450ms menjadi < 15ms**, memberikan pengalaman monitoring yang sangat responsif bagi seluruh jajaran pimpinan dan pengawas BPS PPU.
