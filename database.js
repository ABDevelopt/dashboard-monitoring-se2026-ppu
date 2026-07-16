const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./services/logger');

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
    runMigrations();
    initSettings();
    initUsers();
  }
  return db;
}

function runMigrations() {
  // Ensure migrations log table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedMigrations = db.prepare('SELECT version FROM schema_migrations').all().map(m => m.version);

  const migrations = [
    {
      version: '20260710000000_init',
      up: (db) => {
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
            target_fasih INTEGER DEFAULT 0,
            target_honor INTEGER DEFAULT 0
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
            target_static_total INTEGER DEFAULT 0,
            target_upload_total INTEGER DEFAULT 0,
            target_honor_total INTEGER DEFAULT 0,
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

          -- Tabel riwayat cuaca harian
          CREATE TABLE IF NOT EXISTS weather_history (
            tanggal TEXT PRIMARY KEY,
            temp REAL,
            code INTEGER,
            humidity INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    },
    {
      version: '20260710000001_add_target_fasih',
      up: (db) => {
        try {
          db.prepare('ALTER TABLE subsls_master ADD COLUMN target_fasih INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260710000002_add_progres_columns',
      up: (db) => {
        const progresCols = ['draft', 'submitted_by_pcl', 'approved', 'rejected'];
        progresCols.forEach(col => {
          try {
            db.prepare(`ALTER TABLE progres ADD COLUMN ${col} INTEGER DEFAULT 0`).run();
          } catch (_) {}
        });
      }
    },
    {
      version: '20260710000003_add_uploads_filenames',
      up: (db) => {
        const uploadsCols = ['stored_filename', 'status_filename', 'stored_status_filename'];
        uploadsCols.forEach(col => {
          try {
            db.prepare(`ALTER TABLE uploads ADD COLUMN ${col} TEXT`).run();
          } catch (_) {}
        });
      }
    },
    {
      version: '20260710000004_normalize_officer_names',
      up: (db) => {
        const toTitleCase = (str) => {
          if (!str) return '';
          return str.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };

        const rows = db.prepare('SELECT rowid, korlap, pml, pcl FROM subsls_master').all();
        const updateStmt = db.prepare('UPDATE subsls_master SET korlap = ?, pml = ?, pcl = ? WHERE rowid = ?');

        db.transaction(() => {
          for (const row of rows) {
            updateStmt.run(
              toTitleCase(row.korlap),
              toTitleCase(row.pml),
              toTitleCase(row.pcl),
              row.rowid
            );
          }
        })();

        try {
          db.prepare('DELETE FROM summary_cache').run();
        } catch (_) {}
      }
    },
    {
      version: '20260713000000_add_target_upload_to_progres',
      up: (db) => {
        try {
          db.prepare('ALTER TABLE progres ADD COLUMN target_upload INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260713000001_add_dual_targets_to_summary_cache',
      up: (db) => {
        try {
          db.prepare('ALTER TABLE summary_cache ADD COLUMN target_static_total INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          db.prepare('ALTER TABLE summary_cache ADD COLUMN target_upload_total INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260714000000_add_target_honor_to_master',
      up: (db) => {
        try {
          db.prepare('ALTER TABLE subsls_master ADD COLUMN target_honor INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          db.prepare('ALTER TABLE summary_cache ADD COLUMN target_honor_total INTEGER DEFAULT 0').run();
        } catch (_) {}

        try {
          const XLSX = require('xlsx');
          const path = require('path');
          const fs = require('fs');
          const honorPath = path.join(__dirname, 'muatan_sls_pembayaran_honor.xlsx');
          if (fs.existsSync(honorPath)) {
            logger.info('Importing target_honor from muatan_sls_pembayaran_honor.xlsx in migration...');
            const wb = XLSX.readFile(honorPath);
            const ws = wb.Sheets[wb.SheetNames[0]];
            const excelRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (excelRows.length > 0) {
              const headers = excelRows[0];
              const codeIdx = headers.indexOf('idsubsls_25_2');
              const keluargaIdx = headers.indexOf('keluarga');
              const utpIdx = headers.indexOf('jml_utp_subsektor');
              const sbrIdx = headers.indexOf('Total_usaha_SBR');

              if (codeIdx !== -1 && keluargaIdx !== -1 && utpIdx !== -1 && sbrIdx !== -1) {
                const updateStmt = db.prepare('UPDATE subsls_master SET target_honor = ? WHERE kode = ?');
                let updatedCount = 0;
                db.transaction(() => {
                  for (let i = 1; i < excelRows.length; i++) {
                    const row = excelRows[i];
                    if (!row || row.length === 0) continue;
                    const code = String(row[codeIdx] || '').trim();
                    if (!code) continue;
                    const valY = parseInt(row[keluargaIdx] || 0, 10);
                    const valZ = parseInt(row[utpIdx] || 0, 10);
                    const valAA = parseInt(row[sbrIdx] || 0, 10);
                    const targetHonor = valY + valZ + valAA;
                    updateStmt.run(targetHonor, code);
                    updatedCount++;
                  }
                })();
                logger.info(`✅ Migration: Applied target_honor for ${updatedCount} records from Excel.`);
              }
            }
          }
        } catch (err) {
          logger.error('⚠️ Migration: Failed to apply target_honor from Excel:', err.message);
        }
      }
    },
    {
      version: '20260714010000_add_muatan_original_and_setting',
      up: (db) => {
        try {
          db.prepare('ALTER TABLE subsls_master ADD COLUMN muatan_original INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          db.prepare('UPDATE subsls_master SET muatan_original = muatan').run();
        } catch (_) {}
        try {
          db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('target_muatan_mode', 'prelist')").run();
        } catch (_) {}
      }
    }
  ];

  let appliedCount = 0;
  migrations.forEach(m => {
    if (!appliedMigrations.includes(m.version)) {
      logger.info(`Applying database migration: ${m.version}`);
      try {
        m.up(db);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
        appliedCount++;
      } catch (err) {
        logger.error(`Failed to apply migration ${m.version}:`, err);
        throw err;
      }
    }
  });

  if (appliedCount > 0) {
    logger.info(`Database schema migrations complete. Applied ${appliedCount} migrations.`);
  }

  // Verify and potentially populate summary_cache
  try {
    try {
      const tableInfo = db.prepare("PRAGMA table_info(summary_cache)").all();
      const hasDesa = tableInfo.some(col => col.name === 'desa');
      const hasUsahaBaru = tableInfo.some(col => col.name === 'usaha_baru');
      if (tableInfo.length > 0 && (!hasDesa || !hasUsahaBaru)) {
        logger.info('summary_cache is missing required columns. Recreating summary_cache table...');
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
            target_static_total INTEGER DEFAULT 0,
            target_upload_total INTEGER DEFAULT 0,
            target_honor_total INTEGER DEFAULT 0,
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
      logger.error('Error checking summary_cache structure:', tblErr);
    }

    const uploadCount = db.prepare('SELECT COUNT(*) as n FROM uploads').get().n;
    const cacheCount = db.prepare('SELECT COUNT(*) as n FROM summary_cache').get().n;
    if (uploadCount > 0 && cacheCount === 0) {
      logger.info('Populating summary_cache for existing uploads...');
      const uploadsList = db.prepare('SELECT id FROM uploads').all();
      for (const u of uploadsList) {
        rebuildSummaryCache(u.id);
      }
    }
  } catch (err) {
    logger.error('Error migrating/populating summary_cache:', err);
  }
}

// Ambil upload terakhir
function getLatestUpload() {
  return getDb().prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 1').get();
}

// Ambil upload terakhir yang memiliki data FASIH dan data Muatan secara terpisah
function getLatestUploadsDetailed() {
  try {
    const db = getDb();
    const latestFasih = db.prepare("SELECT * FROM uploads WHERE status_filename IS NOT NULL AND status_filename != '' ORDER BY id DESC LIMIT 1").get();
    const latestMuatan = db.prepare("SELECT * FROM uploads WHERE filename IS NOT NULL AND filename != '' ORDER BY id DESC LIMIT 1").get();
    return {
      fasih: latestFasih || null,
      muatan: latestMuatan || null
    };
  } catch (err) {
    logger.error('Error fetching getLatestUploadsDetailed:', err);
    return { fasih: null, muatan: null };
  }
}

// Ambil semua upload (untuk tren)
function getAllUploads() {
  return getDb().prepare('SELECT * FROM uploads ORDER BY tanggal ASC').all();
}

function getTargetFormula(mode, progresAlias = 'p', masterAlias = 'm') {
  if (mode === 'fasih-sm') {
    return `COALESCE(${progresAlias}.target_upload, 0)`;
  } else if (mode === 'dynamic') {
    return `CASE WHEN (COALESCE(${masterAlias}.target_fasih, 0) + COALESCE(${progresAlias}.usaha_baru, 0) + COALESCE(${progresAlias}.keluarga_baru, 0) - COALESCE(${progresAlias}.usaha_tutup, 0) - COALESCE(${progresAlias}.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(${masterAlias}.target_fasih, 0) + COALESCE(${progresAlias}.usaha_baru, 0) + COALESCE(${progresAlias}.keluarga_baru, 0) - COALESCE(${progresAlias}.usaha_tutup, 0) - COALESCE(${progresAlias}.tidak_ditemukan, 0)) END`;
  } else {
    // Default to static
    return `COALESCE(${masterAlias}.target_fasih, 0)`;
  }
}

function getRealizationFormula(mode, progresAlias = 'p') {
  if (mode === 'honor' || mode === 'prelist') {
    return `(COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0) + COALESCE(${progresAlias}.tidak_ditemukan, 0) + COALESCE(${progresAlias}.meninggal, 0) + COALESCE(${progresAlias}.tidak_eligible, 0) + COALESCE(${progresAlias}.tidak_dapat_ditemui, 0) + COALESCE(${progresAlias}.usaha_ditemukan, 0) + COALESCE(${progresAlias}.usaha_baru, 0) + COALESCE(${progresAlias}.usaha_tidak_ditemukan, 0) + COALESCE(${progresAlias}.usaha_tutup, 0) + COALESCE(${progresAlias}.usaha_ganda, 0))`;
  }
  return `(COALESCE(${progresAlias}.usaha_ditemukan, 0) + COALESCE(${progresAlias}.usaha_baru, 0) + COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0))`;
}

function getUsahaTotalFormula(mode, progresAlias = 'p') {
  if (mode === 'honor' || mode === 'prelist') {
    return `(COALESCE(${progresAlias}.usaha_ditemukan, 0) + COALESCE(${progresAlias}.usaha_baru, 0) + COALESCE(${progresAlias}.usaha_tidak_ditemukan, 0) + COALESCE(${progresAlias}.usaha_tutup, 0) + COALESCE(${progresAlias}.usaha_ganda, 0))`;
  }
  return `(COALESCE(${progresAlias}.usaha_ditemukan, 0) + COALESCE(${progresAlias}.usaha_baru, 0))`;
}

function getKeluargaTotalFormula(mode, progresAlias = 'p') {
  if (mode === 'honor' || mode === 'prelist') {
    return `(COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0) + COALESCE(${progresAlias}.tidak_ditemukan, 0) + COALESCE(${progresAlias}.meninggal, 0) + COALESCE(${progresAlias}.tidak_eligible, 0) + COALESCE(${progresAlias}.tidak_dapat_ditemui, 0))`;
  }
  return `(COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0))`;
}

function getAdaptiveMuatanFormula(mode, progresAlias = 'p', masterAlias = 'm') {
  return `COALESCE(${masterAlias}.muatan, 0)`;
}


// Ambil data progres gabungan dengan master untuk upload tertentu
function getProgresWithMaster(uploadId) {
  const settings = getSettings();
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb().prepare(`
    SELECT 
      m.kode, m.kode_kec, m.kecamatan, m.desa, m.nama_sls,
      m.korlap, m.pml, m.pcl, m.target_fasih AS target_fasih_awal,
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
      (${singleSelesaiFormula}) AS sudah_diisi,
      (${targetMuatanFormula}) AS muatan,
      (${realFormula}) AS muatan_selesai,
      (${usahaTotalFormula}) AS usaha_total,
      (${keluargaTotalFormula}) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(uploadId));
}

// Agregate per kecamatan
function getKecamatanStats(uploadId, settings = getSettings()) {
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb().prepare(`
    SELECT 
      m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan,
      SUM(COALESCE(p.tidak_ditemukan, 0)) AS tidak_ditemukan,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      SUM(COALESCE(m.target_honor, 0)) AS target_honor_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.kecamatan
    ORDER BY m.kecamatan
  `).all(uploadId));
}

// Agregate per korlap
function getKorlapStats(uploadId, settings = getSettings()) {
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb().prepare(`
    SELECT 
      m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(DISTINCT m.pml) AS jumlah_pml,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      SUM(COALESCE(m.target_honor, 0)) AS target_honor_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.korlap
    ORDER BY selesai ASC
  `).all(uploadId));
}

// Agregate per PML
function getPmlStats(uploadId, settings = getSettings()) {
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb().prepare(`
    SELECT 
      m.pml,
      m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      SUM(COALESCE(m.target_honor, 0)) AS target_honor_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pml, m.korlap
    ORDER BY selesai ASC
  `).all(uploadId));
}

// Agregate per PCL
function getPclStats(uploadId, settings = getSettings()) {
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb().prepare(`
    SELECT 
      m.pcl,
      m.pml,
      m.korlap,
      m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      SUM(COALESCE(m.target_honor, 0)) AS target_honor_total,
      SUM(COALESCE(p.usaha_ditemukan, 0)) AS usaha_ditemukan_total,
      SUM(COALESCE(p.usaha_baru, 0)) AS usaha_baru_total,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan_total,
      SUM(COALESCE(p.usaha_tutup, 0)) AS usaha_tutup_total,
      SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
    ORDER BY selesai ASC
  `).all(uploadId));
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
      SUM(COALESCE(s.rejected_total, 0)) AS rejected_total,
      w.temp AS weather_temp,
      w.code AS weather_code,
      w.humidity AS weather_humidity
    FROM uploads u
    LEFT JOIN summary_cache s ON s.upload_id = u.id
    LEFT JOIN weather_history w ON w.tanggal = u.tanggal
    GROUP BY u.id
    ORDER BY u.tanggal ASC
  `).all();
}


// Overview summary
function getOverviewSummary(uploadId, settings = getSettings()) {
  if (!uploadId) return null;
  const total = getDb().prepare('SELECT COUNT(*) as n FROM subsls_master').get().n;
  const target_awal_total = getDb().prepare('SELECT SUM(target_fasih) AS n FROM subsls_master').get().n || 0;

  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const stats = getDb().prepare(`
    SELECT 
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan,
      SUM(COALESCE(p.tidak_ditemukan, 0)) AS keluarga_tidak_ditemukan,
      SUM(COALESCE(p.usaha_baru, 0)) AS usaha_baru,
      SUM(COALESCE(p.keluarga_baru, 0)) AS keluarga_baru,
      SUM(COALESCE(p.usaha_ditemukan, 0)) AS usaha_ditemukan,
      SUM(COALESCE(p.ditemukan, 0)) AS keluarga_ditemukan,
      SUM(COALESCE(p.usaha_tutup, 0)) AS usaha_tutup,
      SUM(COALESCE(p.meninggal, 0)) AS meninggal,
      SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda,
      SUM(COALESCE(p.rumah_tunggal, 0)) AS rumah_tunggal,
      SUM(COALESCE(p.rumah_deret, 0)) AS rumah_deret,
      SUM(COALESCE(p.rumah_susun, 0)) AS rumah_susun,
      SUM(COALESCE(p.apartemen, 0)) AS apartemen,
      SUM(COALESCE(p.lainnya, 0)) AS lainnya,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `).get(uploadId);

  const selesai = stats.selesai || 0;
  const total_muatan = stats.total_muatan || 0;
  const muatan_selesai = stats.muatan_selesai || 0;
  const target_fasih_total = stats.target_fasih_total || 0;
  const target_static_total = stats.target_static_total || 0;
  const target_upload_total = stats.target_upload_total || 0;

  return attachProgressPercentages({ 
    total, 
    selesai, 
    belum: total - selesai, 
    total_muatan, 
    muatan_total: total_muatan, 
    muatan_selesai, 
    target_awal_total, 
    target_fasih_total, 
    target_static_total,
    target_upload_total,
    ...stats 
  });
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
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

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

  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');

  const zeroPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
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
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 100.0 END AS pct,
      SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS muatan_realisasi,
      ROUND(SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) * 1.0 / ?, 2) AS rata_rata,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
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
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pml COLLATE NOCASE
    HAVING SUM(${singleTargetFormula}) > 0 AND SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) = 0
    ORDER BY total_subsls DESC
  `).all(...paramsZeroPml);

  // Stagnan 2 hari: PCL yang tidak ada penambahan selesai (submit+approve+reject) antara upload 2 hari lalu dan upload sekarang
  // Cari upload yang tanggalnya >= 2 hari sebelum upload saat ini
  let stagnanPcl = [];
  if (currentUpload) {
    const currentDate = new Date(currentUpload.tanggal);
    const twoDaysAgo = new Date(currentDate);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString().slice(0, 10);

    // Cari upload terbaru yang tanggalnya <= 2 hari sebelum upload saat ini
    const prevUpload = getDb().prepare(
      `SELECT id, tanggal FROM uploads WHERE tanggal <= ? AND id != ? ORDER BY tanggal DESC LIMIT 1`
    ).get(twoDaysAgoStr, uploadId);

    if (prevUpload) {
      // Bandingkan summary_cache antara upload sekarang dan upload lama
      // PCL stagnan = selesai_sekarang - selesai_lama <= 0, dan target > 0, dan belum selesai
      let stagnanWhere = '';
      const stagnanParams = [uploadId, prevUpload.id];
      const stagnanParamsFilters = [];

      if (filters.kec) { stagnanWhere += ' AND m.kecamatan = ?'; stagnanParamsFilters.push(filters.kec); }
      if (filters.korlap) { stagnanWhere += ' AND m.korlap = ?'; stagnanParamsFilters.push(filters.korlap); }
      if (filters.pml) { stagnanWhere += ' AND m.pml = ?'; stagnanParamsFilters.push(filters.pml); }

      stagnanPcl = getDb().prepare(`
        WITH cur_stats AS (
          SELECT 
            m.pcl,
            MAX(m.pml) AS pml,
            MAX(m.korlap) AS korlap,
            MAX(m.kecamatan) AS kecamatan,
            SUM(${singleTargetFormula}) AS target_fasih_total,
            SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS selesai_sekarang,
            SUM(COALESCE(p.draft, 0)) AS draft_total,
            SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
            SUM(COALESCE(p.approved, 0)) AS approved_total,
            SUM(COALESCE(p.rejected, 0)) AS rejected_total
          FROM subsls_master m
          LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
          WHERE 1=1 ${stagnanWhere}
          GROUP BY m.pcl COLLATE NOCASE
        ),
        prev_stats AS (
          SELECT 
            m.pcl,
            SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS selesai_lama
          FROM subsls_master m
          LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
          GROUP BY m.pcl COLLATE NOCASE
        )
        SELECT 
          c.pcl,
          c.pml,
          c.korlap,
          c.kecamatan,
          c.target_fasih_total,
          c.selesai_sekarang,
          COALESCE(pr.selesai_lama, 0) AS selesai_lama,
          c.selesai_sekarang - COALESCE(pr.selesai_lama, 0) AS delta_selesai,
          ? AS tanggal_ref,
          ? AS tanggal_prev,
          c.draft_total,
          c.submitted_total,
          c.approved_total,
          c.rejected_total
        FROM cur_stats c
        LEFT JOIN prev_stats pr ON pr.pcl = c.pcl COLLATE NOCASE
        WHERE c.target_fasih_total > 0
          AND c.selesai_sekarang < c.target_fasih_total
          AND (c.selesai_sekarang - COALESCE(pr.selesai_lama, 0)) <= 0
        ORDER BY c.selesai_sekarang DESC
      `).all(uploadId, ...stagnanParamsFilters, prevUpload.id, currentUpload.tanggal, prevUpload.tanggal);
    }
  }

  // 5. Prediksi Capaian Akhir Berisiko Tinggi: < 40% pada 15 Juli 2026 ATAU < 100% pada 31 Agustus 2026
  let lowProjectedPcl = [];
  if (currentUpload) {
    const currentDate = new Date(currentUpload.tanggal);
    const deadlineJuly15 = new Date('2026-07-15');
    const deadlineAug31 = new Date('2026-08-31');

    const daysToJuly15 = Math.max(0, Math.ceil((deadlineJuly15 - currentDate) / (1000 * 60 * 60 * 24)));
    const daysToAug31 = Math.max(0, Math.ceil((deadlineAug31 - currentDate) / (1000 * 60 * 60 * 24)));

    // Query stats for all PCLs
    const allPcls = getDb().prepare(`
      SELECT 
        m.pcl, 
        MAX(m.pml) AS pml, 
        MAX(m.korlap) AS korlap, 
        MAX(m.kecamatan) AS kecamatan,
        SUM(${singleSelesaiFormula}) AS selesai,
        SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS selesai_sekarang,
        SUM(COALESCE(p.draft, 0)) AS draft_total,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(p.approved, 0)) AS approved_total,
        SUM(COALESCE(p.rejected, 0)) AS rejected_total,
        SUM(${singleTargetFormula}) AS target_fasih_total
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE 1=1 ${where}
      GROUP BY m.pcl COLLATE NOCASE
    `).all(...paramsZeroPcl);

    allPcls.forEach(item => {
      const selesaiFasih = item.selesai_sekarang || 0;
      const targetFasih = item.target_fasih_total || 0;
      if (targetFasih > 0) {
        const runrate = diffDays > 0 ? (selesaiFasih / diffDays) : 0;
        
        // Proyeksi 15 Juli (target: < 40%)
        const projectedJuly15 = selesaiFasih + (runrate * daysToJuly15);
        const projectedPctJuly15 = (projectedJuly15 / targetFasih) * 100;

        // Proyeksi 31 Agustus (target: < 100%)
        const projectedAug31 = selesaiFasih + (runrate * daysToAug31);
        const projectedPctAug31 = (projectedAug31 / targetFasih) * 100;
        
        if (projectedPctJuly15 < 40.0 || projectedPctAug31 < 100.0) {
          lowProjectedPcl.push({
            pcl: item.pcl,
            pml: item.pml,
            korlap: item.korlap,
            kecamatan: item.kecamatan,
            target_fasih_total: targetFasih,
            selesai_sekarang: selesaiFasih,
            runrate: parseFloat(runrate.toFixed(2)),
            projected_final: Math.round(projectedAug31),
            projected_pct: parseFloat(projectedPctAug31.toFixed(2)),
            projected_final_july15: Math.round(projectedJuly15),
            projected_pct_july15: parseFloat(projectedPctJuly15.toFixed(2)),
            draft_total: item.draft_total || 0,
            submitted_total: item.submitted_total || 0,
            approved_total: item.approved_total || 0,
            rejected_total: item.rejected_total || 0
          });
        }
      }
    });
    
    // Sort lowProjectedPcl by projected_pct ascending
    lowProjectedPcl.sort((a, b) => a.projected_pct - b.projected_pct);
  }

  return { zeroPcl, slowPcl, zeroPml, stagnanPcl, lowProjectedPcl, diffDays };
}

// Top performers
function getTopPerformers(uploadId, filters = {}, settings = getSettings()) {
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

  let limit = typeof filters.limit !== 'undefined' ? filters.limit : 5;
  if (limit === null || limit === false) {
    limit = -1; // SQLite uses -1 for no limit
  }

  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const topPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 0.0 END AS pct,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl COLLATE NOCASE
    ORDER BY pct DESC, (submitted_total + approved_total + rejected_total) DESC, target_fasih_total DESC
    LIMIT ?
  `).all(...params, limit);

  const topPml = getDb().prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 0.0 END AS pct,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pml COLLATE NOCASE
    ORDER BY pct DESC, (submitted_total + approved_total + rejected_total) DESC, target_fasih_total DESC
    LIMIT ?
  `).all(...params, limit);

  return { 
    topPcl: attachProgressPercentages(topPcl), 
    topPml: attachProgressPercentages(topPml) 
  };
}

// Bottom performers
function getBottomPerformers(uploadId, filters = {}, settings = getSettings()) {
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

  let limit = typeof filters.limit !== 'undefined' ? filters.limit : 5;
  if (limit === null || limit === false) {
    limit = -1; // SQLite uses -1 for no limit
  }

  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const bottomPcl = getDb().prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 100.0 END AS pct,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pcl COLLATE NOCASE
    ORDER BY pct ASC, (submitted_total + approved_total + rejected_total) ASC, target_fasih_total DESC
    LIMIT ?
  `).all(...params, limit);

  const bottomPml = getDb().prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${singleTargetFormula}), 2) ELSE 100.0 END AS pct,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    GROUP BY m.pml COLLATE NOCASE
    ORDER BY pct ASC, (submitted_total + approved_total + rejected_total) ASC, target_fasih_total DESC
    LIMIT ?
  `).all(...params, limit);

  return { 
    bottomPcl: attachProgressPercentages(bottomPcl), 
    bottomPml: attachProgressPercentages(bottomPml) 
  };
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
      SUM(COALESCE(p.usaha_ditemukan, 0)) AS usaha_ditemukan,
      SUM(COALESCE(p.usaha_baru, 0)) AS usaha_baru,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan,
      SUM(COALESCE(p.usaha_tutup, 0)) AS usaha_tutup,
      SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda,
      (SUM(COALESCE(p.usaha_ditemukan, 0)) + SUM(COALESCE(p.usaha_baru, 0)) + SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) + SUM(COALESCE(p.usaha_tutup, 0)) + SUM(COALESCE(p.usaha_ganda, 0))) AS usaha_total,
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

  return getDb().prepare(sql).all(...params);
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
    'target_fasih_mode': 'static',
    'target_muatan_mode': 'prelist'
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
  const db = getDb();
  const currentSettings = getSettings();
  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [k, v] of Object.entries(settingsObj)) {
    update.run(v, k);
  }
  
  let needsRebuild = false;
  
  if (settingsObj.target_fasih_mode !== undefined && currentSettings.target_fasih_mode !== settingsObj.target_fasih_mode) {
    needsRebuild = true;
  }
  
  if (settingsObj.target_muatan_mode !== undefined && currentSettings.target_muatan_mode !== settingsObj.target_muatan_mode) {
    needsRebuild = true;
    db.transaction(() => {
      if (settingsObj.target_muatan_mode === 'honor') {
        db.prepare('UPDATE subsls_master SET muatan = COALESCE(target_honor, 0)').run();
      } else {
        db.prepare('UPDATE subsls_master SET muatan = COALESCE(muatan_original, 0)').run();
      }
    })();
  }
  
  if (needsRebuild) {
    rebuildAllSummaryCaches();
  }
}

function rebuildSummaryCache(uploadId) {
  const db = getDb();
  db.prepare('DELETE FROM summary_cache WHERE upload_id = ?').run(uploadId);
  
  const settings = getSettings();
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  db.prepare(`
    INSERT INTO summary_cache (
      upload_id, kecamatan, desa, korlap, pml, pcl,
      total_sls, selesai, total_muatan, muatan_selesai,
      usaha_total, keluarga_total, draft_total, submitted_total, approved_total, rejected_total, target_fasih_total,
      target_static_total, target_upload_total, target_honor_total,
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
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      SUM(COALESCE(m.target_honor, 0)) AS target_honor_total,
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

function getKippOfficers() {
  try {
    const db = getDb();
    const pcls = db.prepare("SELECT DISTINCT pcl FROM subsls_master WHERE nama_sls = 'KIPP IKN' AND pcl IS NOT NULL").all().map(r => r.pcl.toUpperCase());
    const pmls = db.prepare("SELECT DISTINCT pml FROM subsls_master WHERE nama_sls = 'KIPP IKN' AND pml IS NOT NULL").all().map(r => r.pml.toUpperCase());
    const korlaps = db.prepare("SELECT DISTINCT korlap FROM subsls_master WHERE nama_sls = 'KIPP IKN' AND korlap IS NOT NULL").all().map(r => r.korlap.toUpperCase());
    return { pcls, pmls, korlaps };
  } catch (err) {
    logger.error("Error fetching KIPP officers:", err);
    return { pcls: [], pmls: [], korlaps: [] };
  }
}

function saveDailyWeather(tanggal, temp, code, humidity) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO weather_history (tanggal, temp, code, humidity, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(tanggal) DO UPDATE SET
        temp = excluded.temp,
        code = excluded.code,
        humidity = excluded.humidity,
        updated_at = CURRENT_TIMESTAMP
    `).run(tanggal, temp, code, humidity);
    return true;
  } catch (err) {
    logger.error("Error saving daily weather:", err);
    return false;
  }
}

function getWeatherHistory(limit = 7) {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT tanggal, temp, code, humidity
      FROM weather_history
      ORDER BY tanggal DESC
      LIMIT ?
    `).all(limit);
  } catch (err) {
    logger.error("Error getting weather history:", err);
    return [];
  }
}

function attachProgressPercentages(data) {
  if (!data) return data;
  if (Array.isArray(data)) {
    return data.map(attachProgressPercentages);
  }

  // Single object
  const submitted = data.submitted_total !== undefined ? data.submitted_total : (data.submitted_by_pcl !== undefined ? data.submitted_by_pcl : (data.submitted || 0));
  const approved = data.approved_total !== undefined ? data.approved_total : (data.approved || 0);
  const rejected = data.rejected_total !== undefined ? data.rejected_total : (data.rejected || 0);
  const targetFasih = data.target_fasih_total !== undefined ? data.target_fasih_total : (data.target_fasih || 0);

  const completedFasih = submitted + approved + rejected;
  data.fasih_pct = targetFasih > 0 ? parseFloat(((completedFasih / targetFasih) * 100).toFixed(2)) : 0.0;
  data.fasih_pct_str = targetFasih > 0 ? ((completedFasih / targetFasih) * 100).toFixed(2) : '0.00';

  // Compute dual targets
  const targetStatic = data.target_static_total !== undefined ? data.target_static_total : (data.target_static || 0);
  const targetUpload = data.target_upload_total !== undefined ? data.target_upload_total : (data.target_upload || 0);

  data.fasih_static_pct = targetStatic > 0 ? parseFloat(((completedFasih / targetStatic) * 100).toFixed(2)) : 0.0;
  data.fasih_static_pct_str = targetStatic > 0 ? ((completedFasih / targetStatic) * 100).toFixed(2) : '0.00';

  data.fasih_upload_pct = targetUpload > 0 ? parseFloat(((completedFasih / targetUpload) * 100).toFixed(2)) : 0.0;
  data.fasih_upload_pct_str = targetUpload > 0 ? ((completedFasih / targetUpload) * 100).toFixed(2) : '0.00';

  let targetMuatan = data.total_muatan !== undefined ? data.total_muatan : (data.muatan_total !== undefined ? data.muatan_total : (data.muatan || 0));
  let completedMuatan = 0;
  if (data.muatan_selesai !== undefined) {
    completedMuatan = data.muatan_selesai;
  } else {
    const usaha = data.usaha_total !== undefined ? data.usaha_total : (data.total_usaha || 0);
    const keluarga = data.keluarga_total !== undefined ? data.keluarga_total : (data.total_keluarga || 0);
    completedMuatan = usaha + keluarga;
    data.muatan_selesai = completedMuatan;
  }



  data.muatan_pct = targetMuatan > 0 ? parseFloat(((completedMuatan / targetMuatan) * 100).toFixed(2)) : 0.0;
  data.muatan_pct_str = targetMuatan > 0 ? ((completedMuatan / targetMuatan) * 100).toFixed(2) : '0.00';

  return data;
}

module.exports = {
  getDb, getLatestUpload, getLatestUploadsDetailed, getAllUploads,
  getProgresWithMaster, getKecamatanStats, getKorlapStats,
  getPmlStats, getPclStats, getTrenHarian, getOverviewSummary, getEarlyWarning, getTopPerformers,
  getBottomPerformers, getAnomalyStats,
  getSettings, updateSettings, getUserByUsername, hashPassword, rebuildSummaryCache, rebuildAllSummaryCaches,
  getKippOfficers, saveDailyWeather, getWeatherHistory, attachProgressPercentages, getTargetFormula,
  getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula
};
