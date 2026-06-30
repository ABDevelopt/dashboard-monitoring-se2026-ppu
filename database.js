const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'se2026.db');

let db;

const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function initUsers() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Clean up legacy petugas user
  try {
    db.prepare('DELETE FROM users WHERE username = ?').run('petugas');
  } catch (_) {}

  const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');
  stmt.run('admin', hashPassword('adminse2026'), 'admin');
  stmt.run('korlap', hashPassword('korlapse2026'), 'korlap');
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -32000');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 134217728');
    db.pragma('foreign_keys = ON');
    initSchema();
    migrateSchema();
    initSettings();
    initUsers();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Tabel upload history
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

    -- Master SubSLS dari JSON (Korlap, PML, PCL, muatan)
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
      kode_2025 TEXT,
      target_fasih INTEGER DEFAULT 0
    );

    -- Data progres per SubSLS per upload
    CREATE TABLE IF NOT EXISTS progres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      kode TEXT NOT NULL,
      usaha_tidak_ditemukan INTEGER DEFAULT 0,
      usaha_ditemukan INTEGER DEFAULT 0,
      usaha_baru INTEGER DEFAULT 0,
      usaha_tutup INTEGER DEFAULT 0,
      usaha_ganda INTEGER DEFAULT 0,
      tidak_ditemukan INTEGER DEFAULT 0,
      ditemukan INTEGER DEFAULT 0,
      keluarga_baru INTEGER DEFAULT 0,
      meninggal INTEGER DEFAULT 0,
      tidak_eligible INTEGER DEFAULT 0,
      tidak_dapat_ditemui INTEGER DEFAULT 0,
      rumah_tunggal INTEGER DEFAULT 0,
      rumah_deret INTEGER DEFAULT 0,
      rumah_susun INTEGER DEFAULT 0,
      apartemen INTEGER DEFAULT 0,
      lainnya INTEGER DEFAULT 0,
      draft INTEGER DEFAULT 0,
      submitted_by_pcl INTEGER DEFAULT 0,
      approved INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      UNIQUE(upload_id, kode)
    );

     CREATE INDEX IF NOT EXISTS idx_progres_upload ON progres(upload_id);
    CREATE INDEX IF NOT EXISTS idx_progres_kode ON progres(kode);
    CREATE INDEX IF NOT EXISTS idx_master_kecamatan ON subsls_master(kecamatan);
    CREATE INDEX IF NOT EXISTS idx_master_korlap ON subsls_master(korlap);
    CREATE INDEX IF NOT EXISTS idx_master_pml ON subsls_master(pml);
    CREATE INDEX IF NOT EXISTS idx_master_pcl ON subsls_master(pcl);

    -- Tabel summary_cache untuk optimasi chatbot & fetchPageData
    CREATE TABLE IF NOT EXISTS summary_cache (
      upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      kecamatan TEXT,
      desa TEXT,
      korlap TEXT,
      pml TEXT,
      pcl TEXT,
      total_sls INTEGER,
      selesai INTEGER,
      total_muatan INTEGER,
      muatan_selesai INTEGER,
      usaha_total INTEGER,
      keluarga_total INTEGER,
      draft_total INTEGER,
      submitted_total INTEGER,
      approved_total INTEGER,
      rejected_total INTEGER,
      target_fasih_total INTEGER,
      usaha_ditemukan INTEGER DEFAULT 0,
      usaha_baru INTEGER DEFAULT 0,
      ditemukan INTEGER DEFAULT 0,
      keluarga_baru INTEGER DEFAULT 0,
      usaha_tidak_ditemukan INTEGER DEFAULT 0,
      tidak_ditemukan INTEGER DEFAULT 0,
      usaha_tutup INTEGER DEFAULT 0,
      meninggal INTEGER DEFAULT 0,
      usaha_ganda INTEGER DEFAULT 0,
      rumah_tunggal INTEGER DEFAULT 0,
      rumah_deret INTEGER DEFAULT 0,
      rumah_susun INTEGER DEFAULT 0,
      apartemen INTEGER DEFAULT 0,
      lainnya INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (upload_id, pcl, desa)
    );

    CREATE INDEX IF NOT EXISTS idx_summary_upload ON summary_cache(upload_id);
    CREATE INDEX IF NOT EXISTS idx_summary_pcl ON summary_cache(pcl);

    -- Tabel pengaturan tampilan halaman/fitur
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function migrateSchema() {
  // Alter subsls_master to add target_fasih
  try {
    db.prepare('ALTER TABLE subsls_master ADD COLUMN target_fasih INTEGER DEFAULT 0').run();
  } catch (err) {}

  // Alter progres to add draft, submitted_by_pcl, approved, rejected
  const progresCols = ['draft', 'submitted_by_pcl', 'approved', 'rejected'];
  progresCols.forEach(col => {
    try {
      db.prepare(`ALTER TABLE progres ADD COLUMN ${col} INTEGER DEFAULT 0`).run();
    } catch (err) {}
  });

  // Alter uploads to add status_filename, stored_status_filename, and stored_filename
  try {
    db.prepare('ALTER TABLE uploads ADD COLUMN stored_filename TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE uploads ADD COLUMN status_filename TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE uploads ADD COLUMN stored_status_filename TEXT').run();
  } catch (e) {}

  // Rebuild summary cache for all uploads if empty or missing 'desa' or 'usaha_baru' columns
  try {
    try {
      const tableInfo = db.prepare("PRAGMA table_info(summary_cache)").all();
      const hasDesa = tableInfo.some(col => col.name === 'desa');
      const hasUsahaBaru = tableInfo.some(col => col.name === 'usaha_baru');
      if (tableInfo.length > 0 && (!hasDesa || !hasUsahaBaru)) {
        console.log('summary_cache is missing required columns. Recreating summary_cache table...');
        db.exec(`
          DROP TABLE IF EXISTS summary_cache;
          CREATE TABLE summary_cache (
            upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
            kecamatan TEXT,
            desa TEXT,
            korlap TEXT,
            pml TEXT,
            pcl TEXT,
            total_sls INTEGER,
            selesai INTEGER,
            total_muatan INTEGER,
            muatan_selesai INTEGER,
            usaha_total INTEGER,
            keluarga_total INTEGER,
            draft_total INTEGER,
            submitted_total INTEGER,
            approved_total INTEGER,
            rejected_total INTEGER,
            target_fasih_total INTEGER,
            usaha_ditemukan INTEGER DEFAULT 0,
            usaha_baru INTEGER DEFAULT 0,
            ditemukan INTEGER DEFAULT 0,
            keluarga_baru INTEGER DEFAULT 0,
            usaha_tidak_ditemukan INTEGER DEFAULT 0,
            tidak_ditemukan INTEGER DEFAULT 0,
            usaha_tutup INTEGER DEFAULT 0,
            meninggal INTEGER DEFAULT 0,
            usaha_ganda INTEGER DEFAULT 0,
            rumah_tunggal INTEGER DEFAULT 0,
            rumah_deret INTEGER DEFAULT 0,
            rumah_susun INTEGER DEFAULT 0,
            apartemen INTEGER DEFAULT 0,
            lainnya INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (upload_id, pcl, desa)
          );
          CREATE INDEX IF NOT EXISTS idx_summary_upload ON summary_cache(upload_id);
          CREATE INDEX IF NOT EXISTS idx_summary_pcl ON summary_cache(pcl);
        `);
      }
    } catch (tblErr) {
      console.error('Error checking summary_cache structure:', tblErr);
    }

    const uploadCount = db.prepare('SELECT COUNT(*) as n FROM uploads').get().n;
    const cacheCount = db.prepare('SELECT COUNT(*) as n FROM summary_cache').get().n;
    if (uploadCount > 0 && cacheCount === 0) {
      console.log('Populating summary_cache for existing uploads...');
      const uploadsList = db.prepare('SELECT id FROM uploads').all();
      for (const u of uploadsList) {
        rebuildSummaryCache(u.id);
      }
    }
  } catch (err) {
    console.error('Error migrating/populating summary_cache:', err);
  }
}

// Ambil upload terakhir
function getLatestUpload() {
  return getDb().prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 1').get();
}

// Ambil semua upload (untuk tren)
function getAllUploads() {
  return getDb().prepare('SELECT * FROM uploads ORDER BY tanggal ASC').all();
}

// Ambil data progres gabungan dengan master untuk upload tertentu
function getProgresWithMaster(uploadId) {
  const settings = getSettings();
  const isStatic = settings.target_fasih_mode === 'static';

  const singleTargetFormula = isStatic 
    ? 'COALESCE(m.target_fasih, 0)'
    : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  return getDb().prepare(`
    SELECT 
      m.kode, m.kode_kec, m.kecamatan, m.desa, m.nama_sls,
      m.korlap, m.pml, m.pcl, m.muatan, m.target_fasih AS target_fasih_awal,
      p.usaha_tidak_ditemukan, p.usaha_ditemukan, p.usaha_baru,
      p.usaha_tutup, p.usaha_ganda,
      p.tidak_ditemukan, p.ditemukan, p.keluarga_baru,
      p.meninggal, p.tidak_eligible, p.tidak_dapat_ditemui,
      p.rumah_tunggal, p.rumah_deret, p.rumah_susun, p.apartemen, p.lainnya,
      COALESCE(p.draft, 0) AS draft,
      COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
      COALESCE(p.approved, 0) AS approved,
      COALESCE(p.rejected, 0) AS rejected,
      (${singleTargetFormula}) AS target_fasih,
      (${singleSelesaiFormula}) AS sudah_diisi
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(uploadId);
}

// Agregate per kecamatan
function getKecamatanStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      kecamatan,
      SUM(total_sls) AS total_subsls,
      SUM(selesai) AS selesai,
      SUM(total_muatan) AS total_muatan,
      SUM(muatan_selesai) AS muatan_selesai,
      SUM(usaha_total) AS usaha_total,
      SUM(keluarga_total) AS keluarga_total,
      SUM(usaha_tidak_ditemukan) AS usaha_tidak_ditemukan,
      SUM(tidak_ditemukan) AS tidak_ditemukan,
      SUM(draft_total) AS draft_total,
      SUM(submitted_total) AS submitted_total,
      SUM(approved_total) AS approved_total,
      SUM(rejected_total) AS rejected_total,
      SUM(target_fasih_total) AS target_fasih_total
    FROM summary_cache
    WHERE upload_id = ?
    GROUP BY kecamatan
    ORDER BY kecamatan
  `).all(uploadId);
}

// Agregate per korlap
function getKorlapStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      korlap,
      COUNT(DISTINCT pcl) AS jumlah_pcl,
      COUNT(DISTINCT pml) AS jumlah_pml,
      SUM(total_sls) AS total_subsls,
      SUM(selesai) AS selesai,
      SUM(total_muatan) AS total_muatan,
      SUM(muatan_selesai) AS muatan_selesai,
      SUM(usaha_total) AS usaha_total,
      SUM(keluarga_total) AS keluarga_total,
      SUM(draft_total) AS draft_total,
      SUM(submitted_total) AS submitted_total,
      SUM(approved_total) AS approved_total,
      SUM(rejected_total) AS rejected_total,
      SUM(target_fasih_total) AS target_fasih_total
    FROM summary_cache
    WHERE upload_id = ?
    GROUP BY korlap
    ORDER BY selesai ASC
  `).all(uploadId);
}

// Agregate per PML
function getPmlStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      pml,
      korlap,
      COUNT(DISTINCT pcl) AS jumlah_pcl,
      SUM(total_sls) AS total_subsls,
      SUM(selesai) AS selesai,
      SUM(total_muatan) AS total_muatan,
      SUM(muatan_selesai) AS muatan_selesai,
      SUM(usaha_total) AS usaha_total,
      SUM(keluarga_total) AS keluarga_total,
      SUM(draft_total) AS draft_total,
      SUM(submitted_total) AS submitted_total,
      SUM(approved_total) AS approved_total,
      SUM(rejected_total) AS rejected_total,
      SUM(target_fasih_total) AS target_fasih_total
    FROM summary_cache
    WHERE upload_id = ?
    GROUP BY pml, korlap
    ORDER BY selesai ASC
  `).all(uploadId);
}

// Agregate per PCL
function getPclStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      pcl,
      pml,
      korlap,
      kecamatan,
      SUM(total_sls) AS total_subsls,
      SUM(selesai) AS selesai,
      SUM(total_muatan) AS total_muatan,
      SUM(muatan_selesai) AS muatan_selesai,
      SUM(usaha_total) AS usaha_total,
      SUM(keluarga_total) AS keluarga_total,
      SUM(draft_total) AS draft_total,
      SUM(submitted_total) AS submitted_total,
      SUM(approved_total) AS approved_total,
      SUM(rejected_total) AS rejected_total,
      SUM(target_fasih_total) AS target_fasih_total
    FROM summary_cache
    WHERE upload_id = ?
    GROUP BY pcl, pml, korlap, kecamatan
    ORDER BY selesai ASC
  `).all(uploadId);
}

// Tren harian
function getTrenHarian() {
  return getDb().prepare(`
    SELECT 
      u.tanggal,
      u.filename,
      SUM(COALESCE(s.selesai, 0)) AS subsls_selesai,
      SUM(COALESCE(s.usaha_total, 0)) AS usaha_total,
      SUM(COALESCE(s.keluarga_total, 0)) AS keluarga_total,
      SUM(COALESCE(s.draft_total, 0)) AS draft_total,
      SUM(COALESCE(s.submitted_total, 0)) AS submitted_total,
      SUM(COALESCE(s.approved_total, 0)) AS approved_total,
      SUM(COALESCE(s.rejected_total, 0)) AS rejected_total
    FROM uploads u
    LEFT JOIN summary_cache s ON s.upload_id = u.id
    GROUP BY u.id
    ORDER BY u.tanggal ASC
  `).all();
}

// Overview summary
function getOverviewSummary(uploadId) {
  if (!uploadId) return null;
  const total = getDb().prepare('SELECT COUNT(*) as n FROM subsls_master').get().n;
  const target_awal_total = getDb().prepare('SELECT SUM(target_fasih) AS n FROM subsls_master').get().n || 0;
  const muatan_total = getDb().prepare('SELECT SUM(muatan) as n FROM subsls_master').get().n || 0;

  const stats = getDb().prepare(`
    SELECT 
      SUM(selesai) AS selesai,
      SUM(muatan_selesai) AS muatan_selesai,
      SUM(target_fasih_total) AS target_fasih_total,
      SUM(usaha_total) AS usaha_total,
      SUM(keluarga_total) AS keluarga_total,
      SUM(usaha_tidak_ditemukan) AS usaha_tidak_ditemukan,
      SUM(tidak_ditemukan) AS keluarga_tidak_ditemukan,
      SUM(usaha_baru) AS usaha_baru,
      SUM(keluarga_baru) AS keluarga_baru,
      SUM(usaha_ditemukan) AS usaha_ditemukan,
      SUM(ditemukan) AS keluarga_ditemukan,
      SUM(usaha_tutup) AS usaha_tutup,
      SUM(meninggal) AS meninggal,
      SUM(usaha_ganda) AS usaha_ganda,
      SUM(rumah_tunggal) AS rumah_tunggal,
      SUM(rumah_deret) AS rumah_deret,
      SUM(rumah_susun) AS rumah_susun,
      SUM(apartemen) AS apartemen,
      SUM(lainnya) AS lainnya,
      SUM(draft_total) AS draft_total,
      SUM(submitted_total) AS submitted_total,
      SUM(approved_total) AS approved_total,
      SUM(rejected_total) AS rejected_total
    FROM summary_cache WHERE upload_id = ?
  `).get(uploadId);

  const selesai = stats.selesai || 0;
  const muatan_selesai = stats.muatan_selesai || 0;
  const target_fasih_total = stats.target_fasih_total || 0;

  return { 
    total, 
    selesai, 
    belum: total - selesai, 
    muatan_total, 
    muatan_selesai, 
    target_awal_total, 
    target_fasih_total, 
    ...stats 
  };
}

// Early warning: PCL dengan 0 progres
function getEarlyWarning(uploadId, filters = {}) {
  // Hitung jumlah hari sensus berjalan (dari tanggal upload pertama ke upload saat ini)
  const currentUpload = getDb().prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
  const firstUpload = getDb().prepare('SELECT MIN(tanggal) as min_tanggal FROM uploads').get();
  
  let diffDays = 1;
  if (currentUpload && firstUpload && firstUpload.min_tanggal) {
    const d1 = new Date(firstUpload.min_tanggal);
    const d2 = new Date(currentUpload.tanggal);
    const diffTime = d2 - d1;
    diffDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);
  }

  const settings = getSettings();
  const isStatic = settings.target_fasih_mode === 'static';

  const singleTargetFormula = isStatic 
    ? 'COALESCE(m.target_fasih, 0)'
    : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  let where = '';
  const paramsZeroPcl = [uploadId];
  const paramsSlowPcl = [diffDays, uploadId];
  const paramsZeroPml = [uploadId];

  if (filters.kec) {
    where += ' AND m.kecamatan = ?';
    paramsZeroPcl.push(filters.kec);
    paramsSlowPcl.push(filters.kec);
    paramsZeroPml.push(filters.kec);
  }
  if (filters.korlap) {
    where += ' AND m.korlap = ?';
    paramsZeroPcl.push(filters.korlap);
    paramsSlowPcl.push(filters.korlap);
    paramsZeroPml.push(filters.korlap);
  }
  if (filters.pml) {
    where += ' AND m.pml = ?';
    paramsZeroPcl.push(filters.pml);
    paramsSlowPcl.push(filters.pml);
    paramsZeroPml.push(filters.pml);
  }

  const zeroPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS muatan_selesai,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl COLLATE NOCASE
    HAVING SUM(${singleTargetFormula}) > 0 AND SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) = 0
    ORDER BY total_subsls DESC
  `).all(...paramsZeroPcl);

  const slowPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS muatan_selesai,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 100.0 END AS pct,
      SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS muatan_realisasi,
      ROUND(SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) * 1.0 / ?, 2) AS rata_rata,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl COLLATE NOCASE
    HAVING SUM(${singleTargetFormula}) > 0 AND SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0 AND rata_rata < 5.0
    ORDER BY rata_rata ASC
  `).all(...paramsSlowPcl);

  const zeroPml = getDb().prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS muatan_selesai,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pml COLLATE NOCASE
    HAVING SUM(${singleTargetFormula}) > 0 AND SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) = 0
    ORDER BY total_subsls DESC
  `).all(...paramsZeroPml);

  return { zeroPcl, slowPcl, zeroPml, diffDays };
}

// Top performers
function getTopPerformers(uploadId, filters = {}) {
  let where = '';
  const params = [uploadId];

  if (filters.kec) {
    where += ' AND m.kecamatan = ?';
    params.push(filters.kec);
  }
  if (filters.korlap) {
    where += ' AND m.korlap = ?';
    params.push(filters.korlap);
  }
  if (filters.pml) {
    where += ' AND m.pml = ?';
    params.push(filters.pml);
  }

  const settings = getSettings();
  const isStatic = settings.target_fasih_mode === 'static';

  const singleTargetFormula = isStatic 
    ? 'COALESCE(m.target_fasih, 0)'
    : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const topPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 0.0 END AS pct,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl COLLATE NOCASE
    ORDER BY pct DESC, (submitted_total + approved_total + rejected_total) DESC, target_fasih_total DESC
    LIMIT 5
  `).all(...params);

  const topPml = getDb().prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 0.0 END AS pct,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pml COLLATE NOCASE
    ORDER BY pct DESC, (submitted_total + approved_total + rejected_total) DESC, target_fasih_total DESC
    LIMIT 5
  `).all(...params);

  return { topPcl, topPml };
}

// Bottom performers
function getBottomPerformers(uploadId, filters = {}) {
  let where = '';
  const params = [uploadId];

  if (filters.kec) {
    where += ' AND LOWER(m.kecamatan) LIKE ?';
    params.push(`%${filters.kec.toLowerCase()}%`);
  }
  if (filters.korlap) {
    where += ' AND LOWER(m.korlap) LIKE ?';
    params.push(`%${filters.korlap.toLowerCase()}%`);
  }
  if (filters.pml) {
    where += ' AND LOWER(m.pml) LIKE ?';
    params.push(`%${filters.pml.toLowerCase()}%`);
  }

  const settings = getSettings();
  const isStatic = settings.target_fasih_mode === 'static';

  const singleTargetFormula = isStatic 
    ? 'COALESCE(m.target_fasih, 0)'
    : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const bottomPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 100.0 END AS pct,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl COLLATE NOCASE
    ORDER BY pct ASC, (submitted_total + approved_total + rejected_total) ASC, target_fasih_total DESC
    LIMIT 5
  `).all(...params);

  const bottomPml = getDb().prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 100.0 END AS pct,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pml COLLATE NOCASE
    ORDER BY pct ASC, (submitted_total + approved_total + rejected_total) ASC, target_fasih_total DESC
    LIMIT 5
  `).all(...params);

  return { bottomPcl, bottomPml };
}

function getAnomalyStats(uploadId, filters = {}) {
  let where = '';
  const params = [uploadId];

  if (filters.kec) {
    where += ' AND m.kecamatan = ?';
    params.push(filters.kec);
  }
  if (filters.korlap) {
    where += ' AND m.korlap = ?';
    params.push(filters.korlap);
  }
  if (filters.pml) {
    where += ' AND m.pml = ?';
    params.push(filters.pml);
  }

  // Query aggregates of anomaly indicators per PCL
  const sql = `
    SELECT 
      m.pcl,
      m.pml,
      m.korlap,
      m.kecamatan,
      SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda,
      SUM(COALESCE(p.tidak_dapat_ditemui, 0)) AS tidak_dapat_ditemui,
      SUM(COALESCE(p.rejected, 0)) AS rejected,
      (SUM(COALESCE(p.usaha_ganda, 0)) + SUM(COALESCE(p.tidak_dapat_ditemui, 0)) + SUM(COALESCE(p.rejected, 0))) AS total_anomali
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl
    HAVING total_anomali > 0
    ORDER BY total_anomali DESC
  `;

  return getDb().prepare(sql).all(params);
}

function initSettings() {
  const defaults = {
    'page_map': '1',
    'page_earlywarning': '1',
    'page_deteksianomali': '1',
    'page_leaderboard': '1',
    'page_performatrendah': '1',
    'page_performa': '1',
    'page_kecamatan': '1',
    'page_subsls': '1',
    'page_korlap': '1',
    'page_pml': '1',
    'page_pcl': '1',
    'page_export': '1',
    'page_aiagent': '0',
    'agent_provider': 'gemini',
    'gemini_api_key': '',
    'gemini_model': 'gemini-2.5-flash',
    'gemini_models_list': 'gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3.5-flash',
    'openai_api_key': '',
    'openai_model': 'gpt-5.5',
    'openai_models_list': 'gpt-5.5, gpt-4o',
    'openrouter_api_key': '',
    'openrouter_model': 'openrouter/free',
    'openrouter_models_list': 'openrouter/free, openrouter/owl-alpha, meta-llama/llama-3.3-70b-instruct:free, nvidia/nemotron-3-ultra-550b-a55b:free',
    'chatbot_smart_switch': '1',
    'overview_fasih': '1',
    'overview_muatan': '1',
    'overview_tren_muatan': '1',
    'overview_tren_fasih': '1',
    'overview_kecamatan': '1',
    'overview_bangunan': '1',
    'show_progres_muatan': '1',
    'target_fasih_mode': 'dynamic'
  };

  const insert = getDb().prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v);
  }

  // Force update openrouter_models_list to new set of models
  const openrouterModelsStr = 'openrouter/free, openrouter/owl-alpha, meta-llama/llama-3.3-70b-instruct:free, nvidia/nemotron-3-ultra-550b-a55b:free';
  getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run(openrouterModelsStr, 'openrouter_models_list');

  // If the current active model is not in the new list, reset it to openrouter/free
  const currentModelRow = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_model');
  if (!currentModelRow || !openrouterModelsStr.includes(currentModelRow.value) || currentModelRow.value.includes('owl-alpha:free')) {
    getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run('openrouter/free', 'openrouter_model');
  }

  const geminiModel = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('gemini_model');
  if (geminiModel && geminiModel.value === 'gemini-1.5-flash') {
    getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run('gemini-2.5-flash', 'gemini_model');
  }
}

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => {
    settings[r.key] = r.value;
  });
  return settings;
}

function rebuildAllSummaryCaches() {
  const uploads = getDb().prepare('SELECT id FROM uploads').all();
  uploads.forEach(u => rebuildSummaryCache(u.id));
}

function updateSettings(settingsObj) {
  const currentSettings = getSettings();
  const update = getDb().prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [k, v] of Object.entries(settingsObj)) {
    update.run(v, k);
  }
  // Rebuild cache if target_fasih_mode changed
  if (currentSettings.target_fasih_mode !== settingsObj.target_fasih_mode) {
    rebuildAllSummaryCaches();
  }
}

function rebuildSummaryCache(uploadId) {
  const db = getDb();
  db.prepare('DELETE FROM summary_cache WHERE upload_id = ?').run(uploadId);
  
  const settings = getSettings();
  const isStatic = settings.target_fasih_mode === 'static';

  const singleTargetFormula = isStatic 
    ? 'COALESCE(m.target_fasih, 0)'
    : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  db.prepare(`
    INSERT INTO summary_cache (
      upload_id, kecamatan, desa, korlap, pml, pcl,
      total_sls, selesai, total_muatan, muatan_selesai,
      usaha_total, keluarga_total, draft_total, submitted_total, approved_total, rejected_total, target_fasih_total,
      usaha_ditemukan, usaha_baru, ditemukan, keluarga_baru,
      usaha_tidak_ditemukan, tidak_ditemukan, usaha_tutup, meninggal, usaha_ganda,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya
    )
    SELECT 
      ? as upload_id,
      m.kecamatan,
      m.desa,
      m.korlap,
      m.pml,
      m.pcl,
      COUNT(m.kode) AS total_sls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS muatan_selesai,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(p.usaha_ditemukan, 0)) AS usaha_ditemukan,
      SUM(COALESCE(p.usaha_baru, 0)) AS usaha_baru,
      SUM(COALESCE(p.ditemukan, 0)) AS ditemukan,
      SUM(COALESCE(p.keluarga_baru, 0)) AS keluarga_baru,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan,
      SUM(COALESCE(p.tidak_ditemukan, 0)) AS tidak_ditemukan,
      SUM(COALESCE(p.usaha_tutup, 0)) AS usaha_tutup,
      SUM(COALESCE(p.meninggal, 0)) AS meninggal,
      SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda,
      SUM(COALESCE(p.rumah_tunggal, 0)) AS rumah_tunggal,
      SUM(COALESCE(p.rumah_deret, 0)) AS rumah_deret,
      SUM(COALESCE(p.rumah_susun, 0)) AS rumah_susun,
      SUM(COALESCE(p.apartemen, 0)) AS apartemen,
      SUM(COALESCE(p.lainnya, 0)) AS lainnya
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan, m.desa
  `).run(uploadId, uploadId);
}

module.exports = {
  getDb, getLatestUpload, getAllUploads,
  getProgresWithMaster, getKecamatanStats, getKorlapStats,
  getPmlStats, getPclStats, getTrenHarian, getOverviewSummary, getEarlyWarning, getTopPerformers,
  getBottomPerformers, getAnomalyStats,
  getSettings, updateSettings, getUserByUsername, hashPassword, rebuildSummaryCache, rebuildAllSummaryCaches
};
