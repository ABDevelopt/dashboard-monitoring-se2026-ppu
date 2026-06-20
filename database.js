const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'se2026.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Tabel upload history
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      tanggal DATE NOT NULL,
      total_subsls_terisi INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      kode_2025 TEXT
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
      UNIQUE(upload_id, kode)
    );

    CREATE INDEX IF NOT EXISTS idx_progres_upload ON progres(upload_id);
    CREATE INDEX IF NOT EXISTS idx_progres_kode ON progres(kode);
    CREATE INDEX IF NOT EXISTS idx_master_kecamatan ON subsls_master(kecamatan);
    CREATE INDEX IF NOT EXISTS idx_master_korlap ON subsls_master(korlap);
    CREATE INDEX IF NOT EXISTS idx_master_pml ON subsls_master(pml);
    CREATE INDEX IF NOT EXISTS idx_master_pcl ON subsls_master(pcl);
  `);
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
  return getDb().prepare(`
    SELECT 
      m.kode, m.kode_kec, m.kecamatan, m.desa, m.nama_sls,
      m.korlap, m.pml, m.pcl, m.muatan,
      p.usaha_tidak_ditemukan, p.usaha_ditemukan, p.usaha_baru,
      p.usaha_tutup, p.usaha_ganda,
      p.tidak_ditemukan, p.ditemukan, p.keluarga_baru,
      p.meninggal, p.tidak_eligible, p.tidak_dapat_ditemui,
      p.rumah_tunggal, p.rumah_deret, p.rumah_susun, p.apartemen, p.lainnya,
      (p.usaha_ditemukan + p.usaha_baru) AS usaha_total,
      (p.ditemukan + p.keluarga_baru) AS keluarga_total,
      CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END AS sudah_diisi
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(uploadId);
}

// Agregate per kecamatan
function getKecamatanStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan,
      SUM(COALESCE(p.tidak_ditemukan, 0)) AS tidak_ditemukan
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.kecamatan
    ORDER BY m.kecamatan
  `).all(uploadId);
}

// Agregate per korlap
function getKorlapStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(DISTINCT m.pml) AS jumlah_pml,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.korlap
    ORDER BY selesai ASC
  `).all(uploadId);
}

// Agregate per PML
function getPmlStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      m.pml,
      m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pml, m.korlap
    ORDER BY selesai ASC
  `).all(uploadId);
}

// Agregate per PCL
function getPclStats(uploadId) {
  return getDb().prepare(`
    SELECT 
      m.pcl,
      m.pml,
      m.korlap,
      m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
    ORDER BY selesai ASC
  `).all(uploadId);
}

// Tren harian
function getTrenHarian() {
  return getDb().prepare(`
    SELECT 
      u.tanggal,
      u.filename,
      COUNT(DISTINCT p.kode) AS subsls_selesai,
      SUM(p.usaha_ditemukan + p.usaha_baru) AS usaha_total,
      SUM(p.ditemukan + p.keluarga_baru) AS keluarga_total
    FROM uploads u
    LEFT JOIN progres p ON p.upload_id = u.id
    GROUP BY u.id
    ORDER BY u.tanggal ASC
  `).all();
}

// Overview summary
function getOverviewSummary(uploadId) {
  const total = getDb().prepare('SELECT COUNT(*) as n FROM subsls_master').get().n;
  const selesai = getDb().prepare(`
    SELECT COUNT(DISTINCT kode) as n FROM progres WHERE upload_id = ?
  `).get(uploadId).n;
  const stats = getDb().prepare(`
    SELECT 
      SUM(usaha_ditemukan + usaha_baru) AS usaha_total,
      SUM(ditemukan + keluarga_baru) AS keluarga_total,
      SUM(usaha_tidak_ditemukan) AS usaha_tidak_ditemukan,
      SUM(tidak_ditemukan) AS keluarga_tidak_ditemukan,
      SUM(usaha_baru) AS usaha_baru,
      SUM(keluarga_baru) AS keluarga_baru,
      SUM(usaha_ditemukan) AS usaha_ditemukan,
      SUM(ditemukan) AS keluarga_ditemukan,
      SUM(usaha_tutup) AS usaha_tutup,
      SUM(meninggal) AS meninggal,
      SUM(rumah_tunggal) AS rumah_tunggal,
      SUM(rumah_deret) AS rumah_deret,
      SUM(rumah_susun) AS rumah_susun,
      SUM(apartemen) AS apartemen,
      SUM(lainnya) AS lainnya
    FROM progres WHERE upload_id = ?
  `).get(uploadId);

  return { total, selesai, belum: total - selesai, ...stats };
}

// Early warning: PCL dengan 0 progres
function getEarlyWarning(uploadId) {
  const zeroPcl = getDb().prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
    HAVING selesai = 0
    ORDER BY total_subsls DESC
  `).all(uploadId);

  const slowPcl = getDb().prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      ROUND(100.0 * SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) / COUNT(m.kode), 1) AS pct
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
    HAVING selesai > 0 AND pct < 25
    ORDER BY pct ASC
  `).all(uploadId);

  const zeroPml = getDb().prepare(`
    SELECT 
      m.pml, m.korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pml, m.korlap
    HAVING selesai = 0
    ORDER BY total_subsls DESC
  `).all(uploadId);

  return { zeroPcl, slowPcl, zeroPml };
}

// Top performers
function getTopPerformers(uploadId) {
  const topPcl = getDb().prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      ROUND(100.0 * SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) / COUNT(m.kode), 1) AS pct,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
    ORDER BY pct DESC, selesai DESC, usaha_total DESC
    LIMIT 5
  `).all(uploadId);

  const topPml = getDb().prepare(`
    SELECT 
      m.pml, m.korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      ROUND(100.0 * SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) / COUNT(m.kode), 1) AS pct,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pml, m.korlap
    ORDER BY pct DESC, selesai DESC, usaha_total DESC
    LIMIT 5
  `).all(uploadId);

  return { topPcl, topPml };
}

module.exports = {
  getDb, getLatestUpload, getAllUploads,
  getProgresWithMaster, getKecamatanStats, getKorlapStats,
  getPmlStats, getPclStats, getTrenHarian, getOverviewSummary, getEarlyWarning, getTopPerformers
};
