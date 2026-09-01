const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./services/logger');

const DB_PATH = path.join(__dirname, 'data', 'se2026.db');

let db;
const dbs = {};
const { surveyContext } = require('./services/contextService');

const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Mengembalikan nama tabel master SubSLS.
 *
 * CATATAN DESAIN: Parameter `surveyId` secara sengaja TIDAK digunakan untuk
 * menentukan nama tabel. Semua survei menggunakan tabel bernama 'subsls_master'
 * yang SAMA — isolasi data dilakukan di level FILE DATABASE (per-survei.db),
 * bukan di level nama tabel. Ini adalah desain "one schema, isolated DB files".
 *
 * Parameter dipertahankan untuk backward compatibility dengan call sites yang
 * sudah ada, namun tidak mengubah perilaku fungsi.
 *
 * @param {string} [surveyId] — Tidak dipakai (backward compat only)
 * @returns {string} Nama tabel master: selalu 'subsls_master'
 */
function getMasterTableSql(surveyId) { // eslint-disable-line no-unused-vars
  return 'subsls_master';
}

function initUsers(dbConn) {
  dbConn.exec(`
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
    dbConn.prepare('DELETE FROM users WHERE username = ?').run('petugas');
  } catch (_) {}

  const stmt = dbConn.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');
  stmt.run('admin', hashPassword('adminse2026'), 'admin');
  stmt.run('korlap', hashPassword('korlapse2026'), 'korlap');
}

function resolveSurveyId(surveyId) {
  if (surveyId && typeof surveyId === 'string' && surveyId !== 'se2026') return surveyId;
  const store = surveyContext.getStore();
  if (store && store.activeSurvey) return store.activeSurvey;
  return surveyId || 'se2026';
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getDb(surveyId) {
  const sId = resolveSurveyId(surveyId);
  if (!dbs[sId]) {
    const dbName = `${sId}.db`;
    const dbPath = path.join(__dirname, 'data', dbName);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const dbConn = new Database(dbPath, { timeout: 15000 });
    dbConn.pragma('journal_mode = WAL');
    dbConn.pragma('synchronous = NORMAL');
    dbConn.pragma('cache_size = -32000');
    dbConn.pragma('temp_store = MEMORY');
    dbConn.pragma('mmap_size = 134217728');
    dbConn.pragma('foreign_keys = ON');
    
    runMigrations(dbConn, sId);
    initSettings(dbConn, sId);
    initUsers(dbConn);
    
    dbs[sId] = dbConn;
    if (sId === 'se2026') {
      db = dbConn;
    }
  }
  return dbs[sId];
}

function reloadDbConnection(surveyId) {
  const sId = resolveSurveyId(surveyId);
  if (dbs[sId]) {
    try {
      dbs[sId].close();
    } catch (_) {}
    delete dbs[sId];
  }
  return getDb(sId);
}

function closeDbConnection(surveyId) {
  const sId = resolveSurveyId(surveyId);
  if (dbs[sId]) {
    try {
      dbs[sId].close();
    } catch (_) {}
    delete dbs[sId];
  }
}

// ─── SHARED MASTER DATABASE (data/shared.db) ──────────────────────────────────
let _sharedDb = null;
const SHARED_DB_PATH = path.join(__dirname, 'data', 'shared.db');

function initSharedDb(dbConn) {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS ref_kecamatan (
      kode_kec TEXT PRIMARY KEY,
      nama_kecamatan TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ref_desa (
      kode_desa TEXT PRIMARY KEY,
      kode_kec TEXT NOT NULL REFERENCES ref_kecamatan(kode_kec),
      nama_desa TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ref_petugas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sobat_id TEXT UNIQUE,
      nama_lengkap TEXT NOT NULL,
      email TEXT UNIQUE,
      jenis_kelamin TEXT,
      kode_prov INTEGER DEFAULT 64,
      kode_kab INTEGER DEFAULT 9,
      nama_kab TEXT DEFAULT 'PENAJAM PASER UTARA',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_shared_ref_desa_kec ON ref_desa(kode_kec);
    CREATE INDEX IF NOT EXISTS idx_shared_ref_petugas_email ON ref_petugas(email);
    CREATE INDEX IF NOT EXISTS idx_shared_ref_petugas_nama ON ref_petugas(nama_lengkap);
  `);

  // Migrasikan petugas_email jika sebelumnya masih berupa tabel fisik menjadi SQL VIEW
  try {
    const isTable = dbConn.prepare("SELECT type FROM sqlite_master WHERE name='petugas_email'").get();
    if (isTable && isTable.type === 'table') {
      // Salin data unik ke ref_petugas terlebih dahulu jika ada
      dbConn.exec(`
        INSERT OR IGNORE INTO ref_petugas (sobat_id, nama_lengkap, email, jenis_kelamin)
        SELECT sobat_id, nama_lengkap, email, jenis_kelamin FROM petugas_email;
        DROP TABLE petugas_email;
      `);
    }
    // Buat View petugas_email untuk 100% backward compatibility
    dbConn.exec(`
      DROP VIEW IF EXISTS petugas_email;
      CREATE VIEW petugas_email AS
      SELECT id, sobat_id, nama_lengkap, email, jenis_kelamin, created_at
      FROM ref_petugas;
    `);
  } catch (_) {}

  // Seed data awal ke shared.db dari se2026.db jika shared.db baru pertama kali dibuat
  try {
    const kecCount = dbConn.prepare('SELECT COUNT(*) as count FROM ref_kecamatan').get().count;
    if (kecCount === 0) {
      const seDbPath = path.join(__dirname, 'data', 'se2026.db');
      if (fs.existsSync(seDbPath)) {
        const seDb = new Database(seDbPath, { readonly: true });
        const kecs = seDb.prepare('SELECT * FROM ref_kecamatan').all();
        const desas = seDb.prepare('SELECT * FROM ref_desa').all();
        const petugas = seDb.prepare('SELECT * FROM ref_petugas').all();
        seDb.close();

        const insKec = dbConn.prepare('INSERT OR IGNORE INTO ref_kecamatan (kode_kec, nama_kecamatan) VALUES (?, ?)');
        kecs.forEach(k => insKec.run(k.kode_kec, k.nama_kecamatan));

        const insDesa = dbConn.prepare('INSERT OR IGNORE INTO ref_desa (kode_desa, kode_kec, nama_desa) VALUES (?, ?, ?)');
        desas.forEach(d => insDesa.run(d.kode_desa, d.kode_kec, d.nama_desa));

        const insPetugas = dbConn.prepare('INSERT OR IGNORE INTO ref_petugas (id, sobat_id, nama_lengkap, email, jenis_kelamin, kode_prov, kode_kab, nama_kab) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        petugas.forEach(p => insPetugas.run(p.id, p.sobat_id, p.nama_lengkap, p.email, p.jenis_kelamin, p.kode_prov, p.kode_kab, p.nama_kab));
      }
    }
  } catch (err) {
    logger.error('Error seeding shared.db from existing databases:', err.message);
  }
}



/**
 * Mendapatkan koneksi ke Shared Master Database (data/shared.db).
 * Digunakan untuk tabel referensi terpusat: ref_petugas, ref_kecamatan, ref_desa, petugas_email.
 */
function getSharedDb() {
  if (!_sharedDb) {
    fs.mkdirSync(path.dirname(SHARED_DB_PATH), { recursive: true });
    _sharedDb = new Database(SHARED_DB_PATH, { timeout: 15000 });
    _sharedDb.pragma('journal_mode = WAL');
    _sharedDb.pragma('synchronous = NORMAL');
    _sharedDb.pragma('foreign_keys = ON');
    initSharedDb(_sharedDb);
  }
  return _sharedDb;
}

function runMigrations(dbConn, surveyId = 'se2026') {

  // Ensure migrations log table exists
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedMigrations = dbConn.prepare('SELECT version FROM schema_migrations').all().map(m => m.version);

  // Clean up any legacy "null" string values in the uploads table to prevent false matching
  const uploadsTableExists = dbConn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='uploads'").get();
  if (uploadsTableExists) {
    try {
      dbConn.prepare("UPDATE uploads SET status_filename = NULL WHERE status_filename = 'null'").run();
      dbConn.prepare("UPDATE uploads SET filename = '' WHERE filename = 'null'").run();
      dbConn.prepare("UPDATE uploads SET stored_status_filename = NULL WHERE stored_status_filename = 'null'").run();
      dbConn.prepare("UPDATE uploads SET stored_filename = NULL WHERE stored_filename = 'null'").run();
    } catch (err) {
      logger.error('Error cleaning up legacy "null" string values in database:', err);
    }
  }


  const migrations = [
    {
      version: '20260710000000_init',
      up: (db) => {
        dbConn.exec(`
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
            sls_selesai INTEGER DEFAULT 0,
            keluarga_khusus INTEGER DEFAULT 0,
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
            keluarga_khusus_total INTEGER DEFAULT 0,
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
          dbConn.prepare('ALTER TABLE subsls_master ADD COLUMN target_fasih INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260710000002_add_progres_columns',
      up: (db) => {
        const progresCols = ['draft', 'submitted_by_pcl', 'approved', 'rejected'];
        progresCols.forEach(col => {
          try {
            dbConn.prepare(`ALTER TABLE progres ADD COLUMN ${col} INTEGER DEFAULT 0`).run();
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
            dbConn.prepare(`ALTER TABLE uploads ADD COLUMN ${col} TEXT`).run();
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

        const rows = dbConn.prepare('SELECT rowid, korlap, pml, pcl FROM subsls_master').all();
        const updateStmt = dbConn.prepare('UPDATE subsls_master SET korlap = ?, pml = ?, pcl = ? WHERE rowid = ?');

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
          dbConn.prepare('DELETE FROM summary_cache').run();
        } catch (_) {}
      }
    },
    {
      version: '20260713000000_add_target_upload_to_progres',
      up: (db) => {
        try {
          dbConn.prepare('ALTER TABLE progres ADD COLUMN target_upload INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260713000001_add_dual_targets_to_summary_cache',
      up: (db) => {
        try {
          dbConn.prepare('ALTER TABLE summary_cache ADD COLUMN target_static_total INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          dbConn.prepare('ALTER TABLE summary_cache ADD COLUMN target_upload_total INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260714000000_add_target_honor_to_master',
      up: (db) => {
        try {
          dbConn.prepare('ALTER TABLE subsls_master ADD COLUMN target_honor INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          dbConn.prepare('ALTER TABLE summary_cache ADD COLUMN target_honor_total INTEGER DEFAULT 0').run();
        } catch (_) {}

        try {
          if (surveyId !== 'se2026') return;
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
                const updateStmt = dbConn.prepare('UPDATE subsls_master SET target_honor = ? WHERE kode = ?');
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
          dbConn.prepare('ALTER TABLE subsls_master ADD COLUMN muatan_original INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          dbConn.prepare('UPDATE subsls_master SET muatan_original = muatan').run();
        } catch (_) {}
        try {
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('target_muatan_mode', 'prelist')").run();
        } catch (_) {}
      }
    },
    {
      version: '20260718000000_add_remember_tokens',
      up: (db) => {
        dbConn.exec(`
          CREATE TABLE IF NOT EXISTS remember_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );
        `);
        try {
          dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_remember_tokens_token ON remember_tokens(token);`);
        } catch (_) {}
      }
    },
    {
      version: '20260719000000_add_whatsapp_settings',
      up: (db) => {
        try {
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_enabled', '0')").run();
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_group_id', '')").run();
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_group_name', '')").run();
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_message_template', '')").run();
        } catch (_) {}
      }
    },
    {
      version: '20260725000000_add_visitor_logs',
      up: (db) => {
        dbConn.exec(`
          CREATE TABLE IF NOT EXISTS visitor_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            role TEXT,
            ip TEXT,
            user_agent TEXT,
            path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        try {
          dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_visitor_logs_created_at ON visitor_logs(created_at);`);
          dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_visitor_logs_path ON visitor_logs(path);`);
        } catch (_) {}
      }
    },
    {
      version: '20260725000001_add_petugas_email',
      up: (db) => {
        dbConn.exec(`
          CREATE TABLE IF NOT EXISTS petugas_email (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sobat_id TEXT,
            nama_lengkap TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            jenis_kelamin TEXT,
            kode_prov INTEGER DEFAULT 64,
            kode_kab INTEGER DEFAULT 9,
            nama_kab TEXT DEFAULT 'PENAJAM PASER UTARA',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        try {
          dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_petugas_email_nama ON petugas_email(nama_lengkap);`);
          dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_petugas_email_email ON petugas_email(email);`);
          dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_petugas_email_sobat ON petugas_email(sobat_id);`);
        } catch (_) {}
      }
    },
    {
      version: '20260725000002_integrate_petugas_email',
      up: (db) => {
        const cols = ['pcl_email', 'pcl_sobat_id', 'pml_email', 'pml_sobat_id', 'korlap_email', 'korlap_sobat_id'];
        cols.forEach(col => {
          try {
            dbConn.prepare(`ALTER TABLE subsls_master ADD COLUMN ${col} TEXT`).run();
          } catch (_) {}
        });

        const emails = dbConn.prepare('SELECT nama_lengkap, email, sobat_id FROM petugas_email').all();
        const cleanStr = (s) => (s ? s.toString().toLowerCase().replace(/[^a-z0-9]/g, '') : '');
        const emailMapExact = {};
        const emailMapClean = {};

        emails.forEach(r => {
          if (r.nama_lengkap) {
            const ex = r.nama_lengkap.trim().toLowerCase();
            const cl = cleanStr(r.nama_lengkap);
            emailMapExact[ex] = r;
            emailMapClean[cl] = r;
          }
        });

        const roles = [
          { roleCol: 'pcl', emailCol: 'pcl_email', sobatCol: 'pcl_sobat_id' },
          { roleCol: 'pml', emailCol: 'pml_email', sobatCol: 'pml_sobat_id' },
          { roleCol: 'korlap', emailCol: 'korlap_email', sobatCol: 'korlap_sobat_id' }
        ];

        roles.forEach(({ roleCol, emailCol, sobatCol }) => {
          const uniqueOfficers = dbConn.prepare(`SELECT DISTINCT ${roleCol} FROM subsls_master WHERE ${roleCol} IS NOT NULL AND ${roleCol} != ''`).all();
          uniqueOfficers.forEach(o => {
            const name = o[roleCol] ? o[roleCol].trim() : '';
            if (!name) return;
            const ex = name.toLowerCase();
            const cl = cleanStr(name);

            const target = emailMapExact[ex] || emailMapClean[cl];
            if (target) {
              dbConn.prepare(`UPDATE subsls_master SET ${emailCol} = ?, ${sobatCol} = ? WHERE LOWER(TRIM(${roleCol})) = LOWER(TRIM(?))`)
                .run(target.email, target.sobat_id, name);
            }
          });
        });
      }
    },
    {
      version: '20260726000001_support_officer_level_progres',
      up: (db) => {
        ['pcl_email', 'pcl_name', 'pcl_sobat_id'].forEach(col => {
          try { dbConn.prepare(`ALTER TABLE progres ADD COLUMN ${col} TEXT`).run(); } catch (_) {}
        });
        try { dbConn.exec('CREATE INDEX IF NOT EXISTS idx_progres_pcl_email ON progres(pcl_email)'); } catch (_) {}
        try { dbConn.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_progres_upload_kode_email ON progres(upload_id, kode, COALESCE(pcl_email, ''))"); } catch (_) {}
      }
    },
    {
      version: '20260726000003_add_open_to_progres',
      up: (db) => {
        try { dbConn.prepare('ALTER TABLE progres ADD COLUMN open INTEGER DEFAULT 0').run(); } catch (_) {}
        try { dbConn.prepare('ALTER TABLE summary_cache ADD COLUMN open_total INTEGER DEFAULT 0').run(); } catch (_) {}
      }
    },
    {
      version: '20260804000000_add_intraday_wa_settings',
      up: (db) => {
        try {
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_intraday_enabled', '0')").run();
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_session_cutoff_hour', '12')").run();
          dbConn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_intraday_message_template', '')").run();
        } catch (_) {}
      }
    },
    {
      version: '20260809000000_add_survey_id_to_uploads',
      up: (db) => {
        try {
          dbConn.prepare("ALTER TABLE uploads ADD COLUMN survey_id TEXT NOT NULL DEFAULT 'se2026'").run();
        } catch (_) {}
        try {
          dbConn.exec("CREATE INDEX IF NOT EXISTS idx_uploads_survey ON uploads(survey_id)");
        } catch (_) {}

        dbConn.exec(`
          CREATE TABLE IF NOT EXISTS survey_subsls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survey_id TEXT NOT NULL,
            kode TEXT NOT NULL,
            kecamatan TEXT,
            desa TEXT,
            korlap TEXT,
            pml TEXT,
            pcl TEXT,
            target_fasih INTEGER DEFAULT 0,
            UNIQUE(survey_id, kode)
          );
          CREATE INDEX IF NOT EXISTS idx_survey_subsls_survey ON survey_subsls(survey_id);
          CREATE INDEX IF NOT EXISTS idx_survey_subsls_kec ON survey_subsls(survey_id, kecamatan);
          CREATE INDEX IF NOT EXISTS idx_survey_subsls_pcl ON survey_subsls(survey_id, pcl);
        `);
      }
    },
    {
      version: '20260812000000_normalized_ref_schema',
      up: (db) => {
        dbConn.exec(`
          -- 1. Master Wilayah Kecamatan
          CREATE TABLE IF NOT EXISTS ref_kecamatan (
            kode_kec TEXT PRIMARY KEY,
            nama_kecamatan TEXT NOT NULL
          );

          -- 2. Master Wilayah Desa/Kelurahan
          CREATE TABLE IF NOT EXISTS ref_desa (
            kode_desa TEXT PRIMARY KEY,
            kode_kec TEXT NOT NULL REFERENCES ref_kecamatan(kode_kec),
            nama_desa TEXT NOT NULL
          );

          -- 3. Master Petugas Terpadu
          CREATE TABLE IF NOT EXISTS ref_petugas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sobat_id TEXT UNIQUE,
            nama_lengkap TEXT NOT NULL,
            email TEXT UNIQUE,
            jenis_kelamin TEXT,
            kode_prov INTEGER DEFAULT 64,
            kode_kab INTEGER DEFAULT 9,
            nama_kab TEXT DEFAULT 'PENAJAM PASER UTARA',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_ref_desa_kec ON ref_desa(kode_kec);
          CREATE INDEX IF NOT EXISTS idx_ref_petugas_email ON ref_petugas(email);
          CREATE INDEX IF NOT EXISTS idx_ref_petugas_nama ON ref_petugas(nama_lengkap);
        `);

        // Populate ref_kecamatan from subsls_master
        try {
          dbConn.exec(`
            INSERT OR IGNORE INTO ref_kecamatan (kode_kec, nama_kecamatan)
            SELECT DISTINCT kode_kec, UPPER(TRIM(kecamatan))
            FROM subsls_master
            WHERE kode_kec IS NOT NULL AND TRIM(kode_kec) != '' AND kecamatan IS NOT NULL;
          `);
        } catch (_) {}

        // Populate ref_desa from subsls_master
        try {
          dbConn.exec(`
            INSERT OR IGNORE INTO ref_desa (kode_desa, kode_kec, nama_desa)
            SELECT DISTINCT SUBSTR(kode, 1, 10) AS kode_desa, kode_kec, UPPER(TRIM(desa))
            FROM subsls_master
            WHERE kode IS NOT NULL AND LENGTH(kode) >= 10 AND kode_kec IS NOT NULL AND desa IS NOT NULL;
          `);
        } catch (_) {}

        // Populate ref_petugas from petugas_email & distinct names in subsls_master
        try {
          dbConn.exec(`
            INSERT OR IGNORE INTO ref_petugas (sobat_id, nama_lengkap, email, jenis_kelamin, kode_prov, kode_kab, nama_kab)
            SELECT sobat_id, TRIM(nama_lengkap), TRIM(email), jenis_kelamin, kode_prov, kode_kab, nama_kab
            FROM petugas_email
            WHERE nama_lengkap IS NOT NULL AND TRIM(nama_lengkap) != '';
          `);
        } catch (_) {}

        // Add foreign key columns in subsls_master
        ['korlap_id', 'pml_id', 'pcl_id'].forEach(col => {
          try {
            dbConn.prepare(`ALTER TABLE subsls_master ADD COLUMN ${col} INTEGER REFERENCES ref_petugas(id)`).run();
          } catch (_) {}
        });

        // Link existing officer text names to ref_petugas ID
        try {
          dbConn.exec(`
            UPDATE subsls_master
            SET korlap_id = (SELECT id FROM ref_petugas WHERE LOWER(TRIM(nama_lengkap)) = LOWER(TRIM(subsls_master.korlap)) LIMIT 1)
            WHERE korlap IS NOT NULL AND TRIM(korlap) != '';

            UPDATE subsls_master
            SET pml_id = (SELECT id FROM ref_petugas WHERE LOWER(TRIM(nama_lengkap)) = LOWER(TRIM(subsls_master.pml)) LIMIT 1)
            WHERE pml IS NOT NULL AND TRIM(pml) != '';

            UPDATE subsls_master
            SET pcl_id = (SELECT id FROM ref_petugas WHERE LOWER(TRIM(nama_lengkap)) = LOWER(TRIM(subsls_master.pcl)) LIMIT 1)
            WHERE pcl IS NOT NULL AND TRIM(pcl) != '';
          `);
        } catch (_) {}

        // Create Database View for 100% Backward Compatibility
        try {
          dbConn.exec(`
            CREATE VIEW IF NOT EXISTS v_subsls_detail AS
            SELECT 
              s.kode,
              d.kode_kec,
              COALESCE(k.nama_kecamatan, s.kecamatan) AS kecamatan,
              COALESCE(d.nama_desa, s.desa) AS desa,
              s.nama_sls,
              COALESCE(p_korlap.nama_lengkap, s.korlap) AS korlap,
              COALESCE(p_pml.nama_lengkap, s.pml) AS pml,
              COALESCE(p_pcl.nama_lengkap, s.pcl) AS pcl,
              s.muatan,
              s.target_fasih_sm,
              s.target_honor,
              s.target_fasih,
              s.kode_2025,
              s.korlap_id,
              s.pml_id,
              s.pcl_id
            FROM subsls_master s
            LEFT JOIN ref_desa d ON SUBSTR(s.kode, 1, 10) = d.kode_desa
            LEFT JOIN ref_kecamatan k ON d.kode_kec = k.kode_kec
            LEFT JOIN ref_petugas p_korlap ON s.korlap_id = p_korlap.id
            LEFT JOIN ref_petugas p_pml ON s.pml_id = p_pml.id
            LEFT JOIN ref_petugas p_pcl ON s.pcl_id = p_pcl.id;
          `);
        } catch (_) {}
      }
    },
    {
      version: '20260812010000_surveys_registry',
      up: (db) => {
        // ── 1. Tabel registri survei/sensus ─────────────────────────────────
        dbConn.exec(`
          CREATE TABLE IF NOT EXISTS surveys_registry (
            id            TEXT PRIMARY KEY,
            slug          TEXT UNIQUE NOT NULL,
            name          TEXT NOT NULL,
            short_name    TEXT,
            tagline       TEXT,
            category      TEXT NOT NULL CHECK(category IN ('sensus','survei')),
            category_label TEXT,
            coverage_desc TEXT,
            is_active     INTEGER DEFAULT 1,
            sort_order    INTEGER DEFAULT 0,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          -- ── 2. Tema visual per survei ─────────────────────────────────────
          CREATE TABLE IF NOT EXISTS survey_themes (
            survey_id       TEXT PRIMARY KEY REFERENCES surveys_registry(id) ON DELETE CASCADE,
            theme_name      TEXT,
            theme_color     TEXT,
            theme_secondary TEXT,
            theme_rgb       TEXT,
            theme_gradient  TEXT,
            theme_glow      TEXT,
            theme_icon      TEXT,
            category_icon   TEXT,
            category_badge  TEXT
          );

          -- ── 3. Konfigurasi pengumpulan data per survei ────────────────────
          CREATE TABLE IF NOT EXISTS survey_collection_config (
            survey_id          TEXT PRIMARY KEY REFERENCES surveys_registry(id) ON DELETE CASCADE,
            unit_name          TEXT DEFAULT 'dokumen',
            route_prefix       TEXT,
            show_usaha_columns INTEGER DEFAULT 0,
            show_muatan_usaha  INTEGER DEFAULT 0,
            enabled_pages      TEXT DEFAULT '[]'
          );

          CREATE INDEX IF NOT EXISTS idx_surveys_registry_active ON surveys_registry(is_active, sort_order);
        `);

        // ── 4. Seed data dari surveys.json ───────────────────────────────────
        const surveysJson = require('./config/surveys.json');

        const insRegistry = dbConn.prepare(`
          INSERT OR IGNORE INTO surveys_registry
            (id, slug, name, short_name, tagline, category, category_label, coverage_desc, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insTheme = dbConn.prepare(`
          INSERT OR IGNORE INTO survey_themes
            (survey_id, theme_name, theme_color, theme_secondary, theme_rgb, theme_gradient, theme_glow, theme_icon, category_icon, category_badge)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insConfig = dbConn.prepare(`
          INSERT OR IGNORE INTO survey_collection_config
            (survey_id, unit_name, route_prefix, show_usaha_columns, show_muatan_usaha, enabled_pages)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const seedAll = dbConn.transaction((entries) => {
          entries.forEach(([key, cfg], idx) => {
            insRegistry.run(
              key,
              key.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              cfg.name || key,
              cfg.shortName || null,
              cfg.tagline || null,
              cfg.category || (key.startsWith('se') ? 'sensus' : 'survei'),
              cfg.categoryLabel || null,
              cfg.coverageDesc || null,
              idx
            );

            insTheme.run(
              key,
              cfg.themePack || cfg.theme || null,
              cfg.themeColor || null,
              cfg.themeSecondary || null,
              cfg.themeRgb || null,
              cfg.themeGradient || null,
              cfg.themeGlow || null,
              cfg.themeIcon || null,
              cfg.categoryIcon || null,
              cfg.categoryBadge || null
            );

            insConfig.run(
              key,
              cfg.unitName || 'dokumen',
              key === 'se2026' ? '/' : `/${key}/`,
              cfg.showUsahaColumns ? 1 : 0,
              cfg.showMuatanUsaha ? 1 : 0,
              JSON.stringify(cfg.enabledPages || [])
            );
          });
        });

        try {
          seedAll(Object.entries(surveysJson));
        } catch (seedErr) {
          logger.error('surveys_registry seed error (non-fatal):', seedErr.message);
        }
      }
    },
    {
      version: '20260817000000_add_sls_selesai',
      up: (dbConn) => {
        try {
          dbConn.prepare('ALTER TABLE progres ADD COLUMN sls_selesai INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260817010000_add_agent_sessions',
      up: (dbConn) => {
        try {
          dbConn.exec(`
            CREATE TABLE IF NOT EXISTS agent_sessions (
              user_id INTEGER PRIMARY KEY,
              history TEXT,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
          `);
        } catch (_) {}
      }
    },
    {
      version: '20260817020000_add_keluarga_khusus',
      up: (dbConn) => {
        try {
          dbConn.prepare('ALTER TABLE progres ADD COLUMN keluarga_khusus INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          dbConn.prepare('ALTER TABLE summary_cache ADD COLUMN keluarga_khusus_total INTEGER DEFAULT 0').run();
        } catch (_) {}
      }
    },
    {
      version: '20260823010000_add_agent_queries',
      up: (dbConn) => {
        try {
          dbConn.exec(`
            CREATE TABLE IF NOT EXISTS agent_queries (
              id TEXT PRIMARY KEY,
              user_id INTEGER,
              prompt TEXT,
              tool_name TEXT,
              query_sql TEXT,
              query_params TEXT,
              columns_json TEXT,
              row_count INTEGER,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
          `);
        } catch (_) {}
      }
    },
    {
      // ── MIGRASI 20260820 ────────────────────────────────────────────────────
      // Tujuan: Memastikan setiap DB survei memiliki data surveys_registry
      // hanya untuk survei ITU SENDIRI — tidak bergantung pada DB lain.
      // Prinsip: setiap survei/sensus berdiri sendiri sebagai peers.
      version: '20260820000000_self_contained_surveys_registry',
      up: (dbConn) => {
        // Pastikan tabel surveys_registry + relasi-nya ada di DB ini
        try {
          dbConn.exec(`
            CREATE TABLE IF NOT EXISTS surveys_registry (
              id            TEXT PRIMARY KEY,
              slug          TEXT UNIQUE NOT NULL,
              name          TEXT NOT NULL,
              short_name    TEXT,
              tagline       TEXT,
              category      TEXT NOT NULL CHECK(category IN ('sensus','survei')),
              category_label TEXT,
              coverage_desc TEXT,
              is_active     INTEGER DEFAULT 1,
              sort_order    INTEGER DEFAULT 0,
              created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS survey_themes (
              survey_id       TEXT PRIMARY KEY REFERENCES surveys_registry(id) ON DELETE CASCADE,
              theme_name      TEXT,
              theme_color     TEXT,
              theme_secondary TEXT,
              theme_rgb       TEXT,
              theme_gradient  TEXT,
              theme_glow      TEXT,
              theme_icon      TEXT,
              category_icon   TEXT,
              category_badge  TEXT
            );
            CREATE TABLE IF NOT EXISTS survey_collection_config (
              survey_id          TEXT PRIMARY KEY REFERENCES surveys_registry(id) ON DELETE CASCADE,
              unit_name          TEXT DEFAULT 'dokumen',
              route_prefix       TEXT,
              show_usaha_columns INTEGER DEFAULT 0,
              show_muatan_usaha  INTEGER DEFAULT 0,
              enabled_pages      TEXT DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_surveys_registry_active ON surveys_registry(is_active, sort_order);
          `);
        } catch (_) {}

        // Seed hanya data untuk survei ini sendiri dari surveys.json
        try {
          const surveysJson = require('./config/surveys.json');
          const cfg = surveysJson[surveyId];
          if (!cfg) return; // Survei ini tidak ada di JSON, skip

          const insRegistry = dbConn.prepare(`
            INSERT OR IGNORE INTO surveys_registry
              (id, slug, name, short_name, tagline, category, category_label, coverage_desc, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insTheme = dbConn.prepare(`
            INSERT OR IGNORE INTO survey_themes
              (survey_id, theme_name, theme_color, theme_secondary, theme_rgb, theme_gradient, theme_glow, theme_icon, category_icon, category_badge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insConfig = dbConn.prepare(`
            INSERT OR IGNORE INTO survey_collection_config
              (survey_id, unit_name, route_prefix, show_usaha_columns, show_muatan_usaha, enabled_pages)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          dbConn.transaction(() => {
            // Tentukan sort_order berdasarkan posisi di JSON
            const sortOrder = Object.keys(surveysJson).indexOf(surveyId);
            insRegistry.run(
              surveyId,
              surveyId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              cfg.name || surveyId,
              cfg.shortName || null,
              cfg.tagline || null,
              cfg.category || (surveyId.startsWith('se') ? 'sensus' : 'survei'),
              cfg.categoryLabel || null,
              cfg.coverageDesc || null,
              sortOrder
            );
            insTheme.run(
              surveyId,
              cfg.themePack || cfg.theme || null,
              cfg.themeColor || null,
              cfg.themeSecondary || null,
              cfg.themeRgb || null,
              cfg.themeGradient || null,
              cfg.themeGlow || null,
              cfg.themeIcon || null,
              cfg.categoryIcon || null,
              cfg.categoryBadge || null
            );
            insConfig.run(
              surveyId,
              cfg.unitName || 'dokumen',
              surveyId === 'se2026' ? '/' : `/${surveyId}/`,
              cfg.showUsahaColumns ? 1 : 0,
              cfg.showMuatanUsaha ? 1 : 0,
              JSON.stringify(cfg.enabledPages || [])
            );
          })();
        } catch (seedErr) {
          logger.error(`surveys_registry self-seed error for ${surveyId} (non-fatal):`, seedErr.message);
        }
      }
    },
    {
      // ── MIGRASI 20260820010000: SKEMA IDEAL RELASIONAL ──────────────────────
      // Tujuan: Menerapkan skema relasional terpadu (Master Reference + Assignment)
      // sesuai ERD ideal:
      // 1. REF_PETUGAS ──(1:N)──> SURVEY_PETUGAS_ASSIGNMENT <──(1:N)── SURVEYS_REGISTRY
      // 2. SUBSLS_MASTER ──(N:1)──> SURVEY_PETUGAS_ASSIGNMENT (pcl/pml/korlap)
      // 3. SUBSLS_MASTER ──(N:1)──> REF_DESA ──(N:1)──> REF_KECAMATAN
      version: '20260820010000_ideal_assignment_schema',
      up: (dbConn) => {
        // 1. Tabel Penugasan Petugas per Survei
        dbConn.exec(`
          CREATE TABLE IF NOT EXISTS survey_petugas_assignment (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survey_id TEXT NOT NULL,
            petugas_id INTEGER NOT NULL REFERENCES ref_petugas(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('pcl', 'pml', 'korlap', 'ppl')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(survey_id, petugas_id, role)
          );
          CREATE INDEX IF NOT EXISTS idx_spa_survey ON survey_petugas_assignment(survey_id);
          CREATE INDEX IF NOT EXISTS idx_spa_petugas ON survey_petugas_assignment(petugas_id);
          CREATE INDEX IF NOT EXISTS idx_spa_role ON survey_petugas_assignment(survey_id, role);
        `);

        // 2. Tambah kolom relasional di subsls_master (jika belum ada)
        ['kode_desa', 'pcl_assignment_id', 'pml_assignment_id', 'korlap_assignment_id'].forEach(col => {
          try {
            const colType = col === 'kode_desa' ? 'TEXT' : 'INTEGER';
            dbConn.prepare(`ALTER TABLE subsls_master ADD COLUMN ${col} ${colType}`).run();
          } catch (_) {}
        });

        // 3. Link kode_desa ke ref_desa
        try {
          dbConn.exec(`
            UPDATE subsls_master
            SET kode_desa = SUBSTR(kode, 1, 10)
            WHERE (kode_desa IS NULL OR kode_desa = '') AND kode IS NOT NULL AND LENGTH(kode) >= 10;
          `);
        } catch (_) {}

        // 4. Pastikan ref_petugas terisi dari data subsls_master jika ada nama baru
        try {
          const roles = [
            { col: 'pcl', emailCol: 'pcl_email', sobatCol: 'pcl_sobat_id' },
            { col: 'pml', emailCol: 'pml_email', sobatCol: 'pml_sobat_id' },
            { col: 'korlap', emailCol: 'korlap_email', sobatCol: 'korlap_sobat_id' }
          ];

          roles.forEach(({ col, emailCol, sobatCol }) => {
            dbConn.exec(`
              INSERT OR IGNORE INTO ref_petugas (sobat_id, nama_lengkap, email, kode_prov, kode_kab, nama_kab)
              SELECT DISTINCT 
                NULLIF(TRIM(${sobatCol}), ''), 
                TRIM(${col}), 
                NULLIF(TRIM(${emailCol}), ''), 
                64, 9, 'PENAJAM PASER UTARA'
              FROM subsls_master
              WHERE ${col} IS NOT NULL AND TRIM(${col}) != '';
            `);
          });
        } catch (_) {}

        // 5. Backfill survey_petugas_assignment dari data subsls_master di DB ini
        try {
          const roles = ['pcl', 'pml', 'korlap'];
          roles.forEach(r => {
            dbConn.exec(`
              INSERT OR IGNORE INTO survey_petugas_assignment (survey_id, petugas_id, role)
              SELECT DISTINCT 
                '${surveyId}' AS survey_id, 
                p.id AS petugas_id, 
                '${r}' AS role
              FROM subsls_master s
              JOIN ref_petugas p ON LOWER(TRIM(p.nama_lengkap)) = LOWER(TRIM(s.${r}))
              WHERE s.${r} IS NOT NULL AND TRIM(s.${r}) != '';
            `);
          });
        } catch (_) {}

        // 6. Hubungkan assignment_id ke subsls_master
        try {
          dbConn.exec(`
            UPDATE subsls_master
            SET pcl_assignment_id = (
              SELECT a.id FROM survey_petugas_assignment a
              JOIN ref_petugas p ON a.petugas_id = p.id
              WHERE a.survey_id = '${surveyId}' AND a.role = 'pcl' AND LOWER(TRIM(p.nama_lengkap)) = LOWER(TRIM(subsls_master.pcl))
              LIMIT 1
            )
            WHERE pcl IS NOT NULL AND TRIM(pcl) != '';

            UPDATE subsls_master
            SET pml_assignment_id = (
              SELECT a.id FROM survey_petugas_assignment a
              JOIN ref_petugas p ON a.petugas_id = p.id
              WHERE a.survey_id = '${surveyId}' AND a.role = 'pml' AND LOWER(TRIM(p.nama_lengkap)) = LOWER(TRIM(subsls_master.pml))
              LIMIT 1
            )
            WHERE pml IS NOT NULL AND TRIM(pml) != '';

            UPDATE subsls_master
            SET korlap_assignment_id = (
              SELECT a.id FROM survey_petugas_assignment a
              JOIN ref_petugas p ON a.petugas_id = p.id
              WHERE a.survey_id = '${surveyId}' AND a.role = 'korlap' AND LOWER(TRIM(p.nama_lengkap)) = LOWER(TRIM(subsls_master.korlap))
              LIMIT 1
            )
            WHERE korlap IS NOT NULL AND TRIM(korlap) != '';
          `);
        } catch (_) {}

        // 7. Update View v_subsls_detail untuk menggabungkan relasi ideal
        try {
          dbConn.exec(`
            DROP VIEW IF EXISTS v_subsls_detail;
            CREATE VIEW v_subsls_detail AS
            SELECT 
              s.kode,
              COALESCE(s.kode_desa, d.kode_desa, SUBSTR(s.kode, 1, 10)) AS kode_desa,
              COALESCE(d.kode_kec, s.kode_kec) AS kode_kec,
              COALESCE(k.nama_kecamatan, s.kecamatan) AS kecamatan,
              COALESCE(d.nama_desa, s.desa) AS desa,
              s.nama_sls,
              COALESCE(p_korlap.nama_lengkap, s.korlap) AS korlap,
              COALESCE(p_pml.nama_lengkap, s.pml) AS pml,
              COALESCE(p_pcl.nama_lengkap, s.pcl) AS pcl,
              COALESCE(p_korlap.email, s.korlap_email) AS korlap_email,
              COALESCE(p_pml.email, s.pml_email) AS pml_email,
              COALESCE(p_pcl.email, s.pcl_email) AS pcl_email,
              COALESCE(p_korlap.sobat_id, s.korlap_sobat_id) AS korlap_sobat_id,
              COALESCE(p_pml.sobat_id, s.pml_sobat_id) AS pml_sobat_id,
              COALESCE(p_pcl.sobat_id, s.pcl_sobat_id) AS pcl_sobat_id,
              s.muatan,
              s.target_fasih,
              s.target_honor,
              s.kode_2025,
              s.pcl_assignment_id,
              s.pml_assignment_id,
              s.korlap_assignment_id,
              a_pcl.petugas_id AS pcl_id,
              a_pml.petugas_id AS pml_id,
              a_korlap.petugas_id AS korlap_id
            FROM subsls_master s
            LEFT JOIN ref_desa d ON COALESCE(s.kode_desa, SUBSTR(s.kode, 1, 10)) = d.kode_desa
            LEFT JOIN ref_kecamatan k ON d.kode_kec = k.kode_kec
            LEFT JOIN survey_petugas_assignment a_korlap ON s.korlap_assignment_id = a_korlap.id
            LEFT JOIN ref_petugas p_korlap ON a_korlap.petugas_id = p_korlap.id
            LEFT JOIN survey_petugas_assignment a_pml ON s.pml_assignment_id = a_pml.id
            LEFT JOIN ref_petugas p_pml ON a_pml.petugas_id = p_pml.id
            LEFT JOIN survey_petugas_assignment a_pcl ON s.pcl_assignment_id = a_pcl.id
            LEFT JOIN ref_petugas p_pcl ON a_pcl.petugas_id = p_pcl.id;
          `);
        } catch (_) {}
      }
    },
    {
      // ── MIGRASI 20260826010000: AGENT SESSIONS & QUERIES TEXT ID ───────────────
      // Tujuan: Mengubah kolom user_id pada tabel agent_sessions menjadi TEXT PRIMARY KEY
      // dan agent_queries menjadi TEXT agar mendukung sesi tamu (guest_<sessionID>).
      version: '20260826010000_agent_sessions_text_pk',
      up: (dbConn) => {
        try {
          dbConn.exec(`
            CREATE TABLE IF NOT EXISTS agent_sessions_new (
              user_id TEXT PRIMARY KEY,
              history TEXT,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT OR IGNORE INTO agent_sessions_new (user_id, history, updated_at)
            SELECT CAST(user_id AS TEXT), history, updated_at FROM agent_sessions;
            DROP TABLE agent_sessions;
            ALTER TABLE agent_sessions_new RENAME TO agent_sessions;
          `);
        } catch (_) {}
        try {
          dbConn.exec(`
            CREATE TABLE IF NOT EXISTS agent_queries_new (
              id TEXT PRIMARY KEY,
              user_id TEXT,
              prompt TEXT,
              tool_name TEXT,
              query_sql TEXT,
              query_params TEXT,
              columns_json TEXT,
              row_count INTEGER,
              analysis_text TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT OR IGNORE INTO agent_queries_new (id, user_id, prompt, tool_name, query_sql, query_params, columns_json, row_count, analysis_text, created_at)
            SELECT id, CAST(user_id AS TEXT), prompt, tool_name, query_sql, query_params, columns_json, row_count, analysis_text, created_at FROM agent_queries;
            DROP TABLE agent_queries;
            ALTER TABLE agent_queries_new RENAME TO agent_queries;
          `);
        } catch (_) {}
      }
    },
    {
      version: '20260901000000_add_titik_uji_petik',
      up: (dbConn) => {
        try {
          dbConn.exec(`
            CREATE TABLE IF NOT EXISTS titik_uji_petik (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              level_6_full_code TEXT NOT NULL,
              label TEXT,
              no_bang TEXT,
              kode_bang_label TEXT,
              latitude REAL NOT NULL,
              longitude REAL NOT NULL,
              is_kosong INTEGER DEFAULT 0,
              pcl TEXT,
              pml TEXT,
              korlap TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_titik_ujipetik_code ON titik_uji_petik(level_6_full_code);
            CREATE INDEX IF NOT EXISTS idx_titik_ujipetik_kode_bang ON titik_uji_petik(kode_bang_label);
            CREATE INDEX IF NOT EXISTS idx_titik_ujipetik_kosong ON titik_uji_petik(is_kosong);
            CREATE INDEX IF NOT EXISTS idx_titik_ujipetik_pcl ON titik_uji_petik(pcl);
            CREATE INDEX IF NOT EXISTS idx_titik_ujipetik_pml ON titik_uji_petik(pml);
            CREATE INDEX IF NOT EXISTS idx_titik_ujipetik_korlap ON titik_uji_petik(korlap);
          `);
        } catch (_) {}
      }
    }
  ];

  let appliedCount = 0;
  migrations.forEach(m => {
    if (!appliedMigrations.includes(m.version)) {
      logger.info(`Applying database migration: ${m.version}`);
      try {
        m.up(dbConn);
        dbConn.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
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
      const tableInfo = dbConn.prepare("PRAGMA table_info(summary_cache)").all();
      const hasDesa = tableInfo.some(col => col.name === 'desa');
      const hasUsahaBaru = tableInfo.some(col => col.name === 'usaha_baru');
      if (tableInfo.length > 0 && (!hasDesa || !hasUsahaBaru)) {
        logger.info('summary_cache is missing required columns. Recreating summary_cache table...');
        dbConn.exec(`
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

    const uploadCount = dbConn.prepare('SELECT COUNT(*) as n FROM uploads').get().n;
    const cacheCount = dbConn.prepare('SELECT COUNT(*) as n FROM summary_cache').get().n;
    if (uploadCount > 0 && cacheCount === 0) {
      logger.info('Populating summary_cache for existing uploads...');
      const uploadsList = dbConn.prepare('SELECT id FROM uploads').all();
      for (const u of uploadsList) {
        rebuildSummaryCache(u.id);
      }
    }
  } catch (err) {
    logger.error('Error migrating/populating summary_cache:', err);
  }
}

// Ambil upload terakhir berdasarkan tanggal (bukan ID), agar upload imputasi tidak mengacaukan urutan
function getLatestUpload(surveyId) {
  const db = getDb(surveyId);
  return db.prepare('SELECT * FROM uploads ORDER BY tanggal DESC, id DESC LIMIT 1').get();
}

// Ambil upload terakhir yang memiliki data FASIH dan data Muatan secara terpisah
function getLatestUploadsDetailed(surveyId) {
  try {
    const db = getDb(surveyId);
    const latestFasih = db.prepare("SELECT * FROM uploads WHERE status_filename IS NOT NULL AND status_filename != '' AND status_filename != 'null' ORDER BY tanggal DESC, id DESC LIMIT 1").get();
    const latestMuatan = db.prepare("SELECT * FROM uploads WHERE filename IS NOT NULL AND filename != '' AND filename != 'null' AND filename != 'Imputasi Otomatis (Hari Kosong)' ORDER BY tanggal DESC, id DESC LIMIT 1").get();
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
function getAllUploads(surveyId) {
  const db = getDb(surveyId);
  return db.prepare('SELECT * FROM uploads ORDER BY tanggal ASC').all();
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
    return `(COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0) + COALESCE(${progresAlias}.tidak_ditemukan, 0) + COALESCE(${progresAlias}.meninggal, 0) + COALESCE(${progresAlias}.tidak_eligible, 0) + COALESCE(${progresAlias}.tidak_dapat_ditemui, 0) + COALESCE(${progresAlias}.keluarga_khusus, 0) + COALESCE(${progresAlias}.usaha_ditemukan, 0) + COALESCE(${progresAlias}.usaha_baru, 0) + COALESCE(${progresAlias}.usaha_tidak_ditemukan, 0) + COALESCE(${progresAlias}.usaha_tutup, 0) + COALESCE(${progresAlias}.usaha_ganda, 0))`;
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
    return `(COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0) + COALESCE(${progresAlias}.tidak_ditemukan, 0) + COALESCE(${progresAlias}.meninggal, 0) + COALESCE(${progresAlias}.tidak_eligible, 0) + COALESCE(${progresAlias}.tidak_dapat_ditemui, 0) + COALESCE(${progresAlias}.keluarga_khusus, 0))`;
  }
  return `(COALESCE(${progresAlias}.ditemukan, 0) + COALESCE(${progresAlias}.keluarga_baru, 0))`;
}

function getAdaptiveMuatanFormula(mode, progresAlias = 'p', masterAlias = 'm') {
  return `COALESCE(${masterAlias}.muatan, 0)`;
}

function getSingleSelesaiFormula(targetFormula, progresAlias = 'p') {
  return `(CASE WHEN (
    COALESCE(${progresAlias}.sls_selesai, 0) = 1 OR (
      COALESCE(${progresAlias}.open, 0) = 0 AND 
      COALESCE(${progresAlias}.draft, 0) = 0 AND 
      COALESCE(${progresAlias}.submitted_by_pcl, 0) = 0 AND 
      COALESCE(${progresAlias}.rejected, 0) = 0 AND 
      COALESCE(${progresAlias}.approved, 0) > 0 AND 
      COALESCE(${progresAlias}.approved, 0) >= (${targetFormula})
    )
  ) THEN 1 ELSE 0 END)`;
}

function getSubslsStatusFormula(targetFormula, progresAlias = 'p') {
  const isSelesaiSql = `(COALESCE(${progresAlias}.sls_selesai, 0) = 1 OR (
    COALESCE(${progresAlias}.open, 0) = 0 AND 
    COALESCE(${progresAlias}.draft, 0) = 0 AND 
    COALESCE(${progresAlias}.submitted_by_pcl, 0) = 0 AND 
    COALESCE(${progresAlias}.rejected, 0) = 0 AND 
    COALESCE(${progresAlias}.approved, 0) > 0 AND 
    COALESCE(${progresAlias}.approved, 0) >= (${targetFormula})
  ))`;

  return `CASE 
    WHEN ${isSelesaiSql} THEN 'selesai'
    WHEN ${progresAlias}.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(${progresAlias}.submitted_by_pcl, 0) + COALESCE(${progresAlias}.approved, 0) + COALESCE(${progresAlias}.rejected, 0)) >= (${targetFormula}) THEN 'memenuhi_target'
    WHEN ${progresAlias}.kode IS NOT NULL AND (
      COALESCE(${progresAlias}.draft, 0) > 0 OR 
      COALESCE(${progresAlias}.submitted_by_pcl, 0) > 0 OR 
      COALESCE(${progresAlias}.approved, 0) > 0 OR 
      COALESCE(${progresAlias}.rejected, 0) > 0
    ) THEN 'sedang_didata'
    ELSE 'belum_mulai'
  END`;
}


// Ambil data progres gabungan dengan master untuk upload tertentu
function getProgresWithMaster(uploadId, surveyId) {
  const sId = resolveSurveyId(surveyId);
  const masterTable = getMasterTableSql(sId);
  const settings = getSettings(sId);
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');

  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb(sId).prepare(`
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
      CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, (${singleTargetFormula}) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END AS open,
      (${singleTargetFormula}) AS target_fasih,
      ${getSubslsStatusFormula(singleTargetFormula, 'p')} AS sudah_diisi,
      (${singleSelesaiFormula}) AS selesai,
      (${targetMuatanFormula}) AS muatan,
      (${realFormula}) AS muatan_selesai,
      (${usahaTotalFormula}) AS usaha_total,
      (${keluargaTotalFormula}) AS keluarga_total
    FROM ${masterTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(uploadId), settings);
}

// Agregate per kecamatan
function getKecamatanStats(uploadId, settings, surveyId) {
  const sId = resolveSurveyId(surveyId);
  const masterTable = getMasterTableSql(sId);
  const effSettings = settings || getSettings(sId);
  const singleTargetFormula = getTargetFormula(effSettings.target_fasih_mode);
  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');
  const realFormula = getRealizationFormula(effSettings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(effSettings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(effSettings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(effSettings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb(sId).prepare(`
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
    FROM ${masterTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.kecamatan
    ORDER BY m.kecamatan
  `).all(uploadId), effSettings);
}

// Agregate per korlap
function getKorlapStats(uploadId, settings, surveyId) {
  const sId = resolveSurveyId(surveyId);
  const masterTable = getMasterTableSql(sId);
  const effSettings = settings || getSettings(sId);
  const singleTargetFormula = getTargetFormula(effSettings.target_fasih_mode);
  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');
  const realFormula = getRealizationFormula(effSettings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(effSettings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(effSettings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(effSettings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb(sId).prepare(`
    SELECT 
      m.korlap,
      MAX(m.korlap_email) AS email,
      MAX(m.korlap_sobat_id) AS sobat_id,
      COUNT(DISTINCT COALESCE(p.pcl_email, m.pcl_email, m.pcl)) AS jumlah_pcl,
      COUNT(DISTINCT m.pml) AS jumlah_pml,
      COUNT(DISTINCT p.kode) AS total_subsls,
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
    FROM progres p
    LEFT JOIN ${masterTable} m ON p.kode = m.kode
    WHERE p.upload_id = ? AND m.korlap IS NOT NULL
    GROUP BY m.korlap
    ORDER BY selesai ASC
  `).all(uploadId), effSettings);
}

// Agregate per PML
function getPmlStats(uploadId, settings, surveyId) {
  const sId = resolveSurveyId(surveyId);
  const masterTable = getMasterTableSql(sId);
  const effSettings = settings || getSettings(sId);
  const singleTargetFormula = getTargetFormula(effSettings.target_fasih_mode);
  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');
  const realFormula = getRealizationFormula(effSettings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(effSettings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(effSettings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(effSettings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb(sId).prepare(`
    SELECT 
      m.pml,
      m.korlap,
      MAX(m.pml_email) AS email,
      MAX(m.pml_sobat_id) AS sobat_id,
      COUNT(DISTINCT COALESCE(p.pcl_email, m.pcl_email, m.pcl)) AS jumlah_pcl,
      COUNT(DISTINCT p.kode) AS total_subsls,
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
    FROM progres p
    LEFT JOIN ${masterTable} m ON p.kode = m.kode
    WHERE p.upload_id = ? AND m.pml IS NOT NULL
    GROUP BY m.pml, m.korlap
    ORDER BY selesai ASC
  `).all(uploadId), effSettings);
}

// Agregate per PCL
function getPclStats(uploadId, settings, surveyId) {
  const sId = resolveSurveyId(surveyId);
  const masterTable = getMasterTableSql(sId);
  const effSettings = settings || getSettings(sId);
  const singleTargetFormula = getTargetFormula(effSettings.target_fasih_mode);
  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');
  const realFormula = getRealizationFormula(effSettings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(effSettings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(effSettings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(effSettings.target_muatan_mode, 'p');

  return attachProgressPercentages(getDb(sId).prepare(`
    SELECT 
      COALESCE(p.pcl_name, m.pcl) AS pcl,
      COALESCE(p.pcl_email, m.pcl_email) AS email,
      COALESCE(p.pcl_sobat_id, m.pcl_sobat_id) AS sobat_id,
      MAX(m.pml) AS pml,
      MAX(m.korlap) AS korlap,
      MAX(m.kecamatan) AS kecamatan,
      COUNT(DISTINCT p.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.open, 0)) AS open_total,
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
    FROM progres p
    LEFT JOIN ${masterTable} m ON p.kode = m.kode
    WHERE p.upload_id = ?
    GROUP BY COALESCE(p.pcl_email, m.pcl_email, m.pcl), COALESCE(p.pcl_name, m.pcl)
    ORDER BY approved_total DESC
  `).all(uploadId), effSettings);
}

// Tren harian
function getTrenHarian(surveyId) {
  const sId = resolveSurveyId(surveyId);
  return getDb(sId).prepare(`
    SELECT 
      u.id,
      u.tanggal,
      u.filename,
      SUM(COALESCE(s.selesai, 0)) AS subsls_selesai,
      SUM(COALESCE(s.usaha_total, 0)) AS usaha_total,
      SUM(COALESCE(s.keluarga_total, 0)) AS keluarga_total,
      SUM(COALESCE(s.draft_total, 0)) AS draft_total,
      SUM(COALESCE(s.submitted_total, 0)) AS submitted_total,
      SUM(COALESCE(s.approved_total, 0)) AS approved_total,
      SUM(COALESCE(s.rejected_total, 0)) AS rejected_total,
      SUM(COALESCE(s.target_fasih_total, 0)) AS target_fasih_total,
      SUM(MAX(0, COALESCE(s.target_fasih_total, 0) - (COALESCE(s.draft_total, 0) + COALESCE(s.submitted_total, 0) + COALESCE(s.approved_total, 0) + COALESCE(s.rejected_total, 0)))) AS open_total,
      COUNT(DISTINCT CASE WHEN s.pcl IS NOT NULL AND s.pcl != '' THEN s.pcl END) AS total_pcl,
      w.temp AS weather_temp,
      w.code AS weather_code,
      w.humidity AS weather_humidity
    FROM (
      SELECT MAX(id) AS id, tanggal, MAX(filename) AS filename
      FROM uploads
      WHERE total_subsls_terisi > 0
        AND (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%')
      GROUP BY tanggal
    ) u
    LEFT JOIN summary_cache s ON s.upload_id = u.id
    LEFT JOIN weather_history w ON w.tanggal = u.tanggal
    GROUP BY u.tanggal
    ORDER BY u.tanggal ASC
  `).all();
}


// Overview summary
function getOverviewSummary(uploadId, settings = getSettings(), surveyId = 'se2026') {
  const db = getDb(surveyId);
  const masterTable = getMasterTableSql(surveyId);
  if (!uploadId) return null;
  const total = db.prepare(`SELECT COUNT(*) as n FROM ${masterTable}`).get().n;
  const target_awal_total = db.prepare(`SELECT SUM(target_fasih) AS n FROM ${masterTable}`).get().n || 0;

  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const stats = db.prepare(`
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
      SUM(COALESCE(p.tidak_eligible, 0)) AS tidak_eligible,
      SUM(COALESCE(p.tidak_dapat_ditemui, 0)) AS tidak_dapat_ditemui,
      SUM(COALESCE(p.keluarga_khusus, 0)) AS keluarga_khusus,
      SUM(COALESCE(p.rumah_tunggal, 0)) AS rumah_tunggal,
      SUM(COALESCE(p.rumah_deret, 0)) AS rumah_deret,
      SUM(COALESCE(p.rumah_susun, 0)) AS rumah_susun,
      SUM(COALESCE(p.apartemen, 0)) AS apartemen,
      SUM(COALESCE(p.lainnya, 0)) AS lainnya,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, (${singleTargetFormula}) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END) AS open_total
    FROM ${masterTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `).get(uploadId);

  const selesai = stats.selesai || 0;
  const total_muatan = stats.total_muatan || 0;
  const muatan_selesai = stats.muatan_selesai || 0;
  const target_fasih_total = stats.target_fasih_total || 0;
  const target_static_total = stats.target_static_total || 0;
  const target_upload_total = stats.target_upload_total || 0;

  const total_pcl = db.prepare(`SELECT COUNT(DISTINCT pcl) AS n FROM ${masterTable} WHERE pcl IS NOT NULL AND pcl != ''`).get().n || 0;
  const total_pml = db.prepare(`SELECT COUNT(DISTINCT pml) AS n FROM ${masterTable} WHERE pml IS NOT NULL AND pml != ''`).get().n || 0;

  const active_pcl = db.prepare(`
    SELECT COUNT(DISTINCT m.pcl) AS n 
    FROM ${masterTable} m 
    JOIN progres p ON m.kode = p.kode AND p.upload_id = ? 
    WHERE m.pcl IS NOT NULL AND m.pcl != '' 
      AND (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0
  `).get(uploadId).n || 0;

  const total_pengerjaan = (stats.submitted_total || 0) + (stats.approved_total || 0) + (stats.rejected_total || 0);

  const avg_subsls_per_pcl = total_pcl > 0 ? parseFloat((total / total_pcl).toFixed(2)) : 0;
  const avg_target_fasih_per_pcl = total_pcl > 0 ? parseFloat((target_fasih_total / total_pcl).toFixed(1)) : 0;
  const avg_didata_per_pcl = total_pcl > 0 ? parseFloat((total_pengerjaan / total_pcl).toFixed(1)) : 0;
  const avg_didata_per_active_pcl = active_pcl > 0 ? parseFloat((total_pengerjaan / active_pcl).toFixed(1)) : 0;
  const avg_selesai_subsls_per_pcl = total_pcl > 0 ? parseFloat((selesai / total_pcl).toFixed(2)) : 0;
  const avg_muatan_per_pcl = total_pcl > 0 ? parseFloat((muatan_selesai / total_pcl).toFixed(1)) : 0;

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
    total_pcl,
    total_pml,
    active_pcl,
    avg_subsls_per_pcl,
    avg_target_fasih_per_pcl,
    avg_didata_per_pcl,
    avg_didata_per_active_pcl,
    avg_selesai_subsls_per_pcl,
    avg_muatan_per_pcl,
    ...stats 
  }, settings);
}

// Early warning: PCL dengan 0 progres
function getEarlyWarning(uploadId, filters = {}, settings = null, surveyId = 'se2026') {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  const currentSettings = settings || getSettings(sId);
  // Hitung jumlah hari sensus berjalan (dari tanggal upload pertama ke upload saat ini)
  const currentUpload = db.prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
  
  let diffDays = 1;
  const startSensusDateStr = currentSettings.speedometer_start_date || (sId === 'se2026' ? '2026-06-15' : '2026-08-01');
  if (currentUpload && startSensusDateStr) {
    const d1 = new Date(startSensusDateStr);
    const d2 = new Date(currentUpload.tanggal);
    const diffTime = d2 - d1;
    diffDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);
  }

  const singleTargetFormula = getTargetFormula(currentSettings.target_fasih_mode);

  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');

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

  const realFormula = getRealizationFormula(currentSettings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(currentSettings.target_muatan_mode, 'p', 'm');

  const zeroPcl = [];

  const slowPcl = db.prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * CAST(SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS REAL) / CAST(SUM(${singleTargetFormula}) AS REAL), 2) ELSE 100.0 END AS pct,
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

  const zeroPml = db.prepare(`
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

  // Stagnan 1 hari: PCL yang tidak ada penambahan selesai (submit+approve+reject) antara upload 1 hari lalu dan upload sekarang
  // Cari upload yang tanggalnya >= 1 hari sebelum upload saat ini
  let stagnanPcl = [];
  if (currentUpload) {
    const currentDate = new Date(currentUpload.tanggal);
    const oneDayAgo = new Date(currentDate);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const oneDayAgoStr = oneDayAgo.toISOString().slice(0, 10);

    // Cari upload terbaru yang tanggalnya <= 1 hari sebelum upload saat ini
    const prevUpload = db.prepare(
      `SELECT id, tanggal FROM uploads WHERE tanggal <= ? AND id != ? ORDER BY tanggal DESC LIMIT 1`
    ).get(oneDayAgoStr, uploadId);

    if (prevUpload) {
      // Bandingkan summary_cache antara upload sekarang dan upload lama
      // PCL stagnan = selesai_sekarang - selesai_lama <= 0, dan target > 0, dan belum selesai
      let stagnanWhere = '';
      const stagnanParams = [uploadId, prevUpload.id];
      const stagnanParamsFilters = [];

      if (filters.kec) { stagnanWhere += ' AND m.kecamatan = ?'; stagnanParamsFilters.push(filters.kec); }
      if (filters.korlap) { stagnanWhere += ' AND m.korlap = ?'; stagnanParamsFilters.push(filters.korlap); }
      if (filters.pml) { stagnanWhere += ' AND m.pml = ?'; stagnanParamsFilters.push(filters.pml); }

      stagnanPcl = db.prepare(`
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
    const deadlineAug31 = new Date(currentSettings.speedometer_target_date || (sId === 'se2026' ? '2026-08-31' : '2026-08-31'));

    const daysToJuly15 = Math.max(0, Math.ceil((deadlineJuly15 - currentDate) / (1000 * 60 * 60 * 24)));
    const daysToAug31 = Math.max(0, Math.ceil((deadlineAug31 - currentDate) / (1000 * 60 * 60 * 24)));

    // Query stats for all PCLs
    const allPcls = db.prepare(`
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
function getTopPerformers(uploadId, filters = {}, settings = null, surveyId = 'se2026') {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  const currentSettings = settings || getSettings(sId);
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

  const singleTargetFormula = getTargetFormula(currentSettings.target_fasih_mode);

  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');

  const targetMuatanFormula = getAdaptiveMuatanFormula(currentSettings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(currentSettings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(currentSettings.target_muatan_mode, 'p');

  const topPcl = db.prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * CAST(SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS REAL) / CAST(SUM(${singleTargetFormula}) AS REAL), 2) ELSE 0.0 END AS pct,
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
    WHERE m.pcl IS NOT NULL AND TRIM(m.pcl) != '' ${where}
    GROUP BY m.pcl COLLATE NOCASE
    ORDER BY pct DESC, (submitted_total + approved_total + rejected_total) DESC, target_fasih_total DESC
    LIMIT ?
  `).all(...params, limit);

  const topPml = db.prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap, 
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * CAST(SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS REAL) / CAST(SUM(${singleTargetFormula}) AS REAL), 2) ELSE 0.0 END AS pct,
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
    WHERE m.pml IS NOT NULL AND TRIM(m.pml) != '' ${where}
    GROUP BY m.pml COLLATE NOCASE
    ORDER BY pct DESC, (submitted_total + approved_total + rejected_total) DESC, target_fasih_total DESC
    LIMIT ?
  `).all(...params, limit);

  return { 
    topPcl: attachProgressPercentages(topPcl, currentSettings), 
    topPml: attachProgressPercentages(topPml, currentSettings) 
  };
}

// Bottom performers
function getBottomPerformers(uploadId, filters = {}, settings = null, surveyId = 'se2026') {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  const currentSettings = settings || getSettings(sId);
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

  const singleTargetFormula = getTargetFormula(currentSettings.target_fasih_mode);

  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');

  const targetMuatanFormula = getAdaptiveMuatanFormula(currentSettings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(currentSettings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(currentSettings.target_muatan_mode, 'p');

  const bottomPcl = db.prepare(`
    SELECT 
      m.pcl, 
      MAX(m.pml) AS pml, 
      MAX(m.korlap) AS korlap, 
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * CAST(SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS REAL) / CAST(SUM(${singleTargetFormula}) AS REAL), 2) ELSE 100.0 END AS pct,
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

  const bottomPml = db.prepare(`
    SELECT 
      m.pml, 
      MAX(m.korlap) AS korlap,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      CASE WHEN SUM(${singleTargetFormula}) > 0 THEN ROUND(100.0 * CAST(SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS REAL) / CAST(SUM(${singleTargetFormula}) AS REAL), 2) ELSE 100.0 END AS pct,
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
    bottomPcl: attachProgressPercentages(bottomPcl, currentSettings), 
    bottomPml: attachProgressPercentages(bottomPml, currentSettings) 
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

function initSettings(dbConn, surveyId = 'se2026') {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const isSe2026 = surveyId === 'se2026';
  const waTemplate = isSe2026 ? `*UPDATE HARIAN SE2026 PPU*
🗓️ {tanggal_sekarang} | ⏰ {jam_sekarang}

*AKUMULASI PROGRES PENDATAAN*
✅ Selesai (Subm/Appr/Rej): *{realisasi_fasih}* dokumen (*{persen_fasih}%*)
   ├ 🟢 Approved: *{approved_total}* dokumen
   ├ 📨 Submitted PCL: *{submitted_total}* dokumen
   └ 🔴 Rejected: *{rejected_total}* dokumen
🟠 Open (Belum Diisi): *{open_total}* dokumen
🟡 Draft (Sedang Diisi): *{draft_total}* dokumen
📋 Total Assignment FASIH: *{target_fasih}* dokumen

*KINERJA REALISASI SEJAK UPLOAD SEBELUMNYA ({waktu_upload_sebelumnya})*
📨 Realisasi Masuk: *{diff_total}* dokumen
👤 Produktifitas petugas keseluruhan: *{avg_diff_all}* dokumen/petugas/hari
📈 Deviasi vs Target Normal (Update): *{deviasi_update}* dokumen
📉 Defisit Laju Kumulatif: *{deviasi_kumulatif}* dokumen/hari

*SEBARAN PRODUKTIVITAS PETUGAS (SEJAK UPLOAD SEBELUMNYA)*
🔴 0 dokumen: *{dist_0}* orang
🟠 1–4 dokumen: *{dist_1_4}* orang
🟡 5–7 dokumen: *{dist_5_7}* orang
🔵 8–12 dokumen: *{dist_8_12}* orang
🟢 ≥13 dokumen: *{dist_13_plus}* orang

_Notifikasi otomatis [monitoring.bpsppu.com]_` : `*UPDATE HARIAN SAKERNAS PPU*
🗓️ {tanggal_sekarang} | ⏰ {jam_sekarang}

*AKUMULASI PROGRES PENDATAAN*
✅ Selesai: *{realisasi_fasih}* dokumen (*{persen_fasih}%*)
   ├ 🟢 Approved: *{approved_total}* dokumen
   ├ 📨 Submitted: *{submitted_total}* dokumen
   └ 🔴 Rejected: *{rejected_total}* dokumen
🟠 Open: *{open_total}* dokumen
🟡 Draft: *{draft_total}* dokumen
📋 Target: *{target_fasih}* dokumen

*KINERJA REALISASI SEJAK UPLOAD SEBELUMNYA ({waktu_upload_sebelumnya})*
📨 Realisasi Masuk: *{diff_total}* dokumen
👤 Produktifitas petugas: *{avg_diff_all}* dokumen/petugas/hari

_Notifikasi otomatis [monitoring.bpsppu.com]_`;

  const defaults = {
    'survey_title': isSe2026 ? 'Sensus Ekonomi 2026 PPU' : 'Sakernas Agustus 2026 PPU',
    'page_map': '1',
    'page_map_ujipetik': '1',
    'page_earlywarning': '1',
    'page_deteksianomali': isSe2026 ? '1' : '0',
    'page_leaderboard': '1',
    'page_performatrendah': '1',
    'page_performa': '1',
    'page_kecamatan': '1',
    'page_subsls': '1',
    'page_korlap': isSe2026 ? '1' : '0',
    'page_pml': '1',
    'page_pcl': '1',
    'page_export': '1',
    'page_aiagent': '1',
    'auth_req_overview': '0',
    'auth_req_agent': '0',
    'auth_req_map': '0',
    'auth_req_map_ujipetik': '0',
    'auth_req_earlywarning': '0',
    'auth_req_deteksianomali': '0',
    'auth_req_leaderboard': '0',
    'auth_req_performatrendah': '0',
    'auth_req_performa': '0',
    'auth_req_kecamatan': '0',
    'auth_req_subsls': '0',
    'auth_req_korlap': '0',
    'auth_req_pml': '0',
    'auth_req_pcl': '0',
    'auth_req_export': '0',
    'auth_req_harian': '0',
    'auth_req_help': '0',
    'agent_provider': 'gemini',
    'gemini_api_key': '',
    'gemini_backup_api_keys': '[]',
    'gemini_model': 'gemini-3.5-flash',
    'gemini_models_list': 'gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-3.7-flash, gemini-3.1-flash-lite, gemini-2.5-flash',
    'openai_api_key': '',
    'openai_model': 'gpt-5.5',
    'openai_models_list': 'gpt-5.5, gpt-4o',
    'openrouter_api_key': '',
    'openrouter_model': 'openrouter/free',
    'openrouter_models_list': 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free',
    'chatbot_smart_switch': '1',

    'overview_fasih': '1',
    'overview_muatan': isSe2026 ? '1' : '0',
    'overview_tren_muatan': isSe2026 ? '1' : '0',
    'overview_tren_fasih': '1',
    'overview_heatmap': '1',
    'overview_kecamatan': '1',
    'overview_bangunan': isSe2026 ? '1' : '0',
    'show_progres_muatan': isSe2026 ? '1' : '0',
    'target_fasih_mode': 'static',
    'target_muatan_mode': 'prelist',
    'google_sheets_anomaly_url': isSe2026 ? 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2cciIGMfpN1IJpezUhI8d1m6XX7MAX7lE1G9XsSIFgeOMxLVOEuKJWvDtjiLdkdButQU95_7WoP9S/pubhtml' : '',
    'google_sheets_apps_script_url': isSe2026 ? 'https://script.google.com/macros/s/AKfycby3zpFtIN58xOf6GxnDqkl7gjwKX-oeUZwuAp93wL0OrejumH91ykBGa9XbsoMdhZQetA/exec' : '',
    'whatsapp_message_template': waTemplate,
    'speedometer_start_date': isSe2026 ? '2026-06-15' : '2026-08-01',
    'speedometer_target_date': isSe2026 ? '2026-08-31' : '2026-08-31',
    'speedometer_target_speed_per_pcl': isSe2026 ? '13' : '10',
    'speedometer_calc_mode': 'total_target',
    'whatsapp_enabled': '0',
    'whatsapp_group_id': '',
    'whatsapp_group_name': '',
    'show_status_open': '1',
    'show_status_draft': '1',
    'show_status_submitted': '1',
    'show_status_approved': '1',
    'show_status_rejected': '1',
    'whatsapp_intraday_enabled': '0',
    'whatsapp_session_cutoff_hour': '12',
    'whatsapp_intraday_message_template': ''
  };

  const insert = dbConn.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v);
  }

  // Force update openrouter_models_list to new set of models
  const openrouterModelsStr = 'openrouter/free, openrouter/owl-alpha, meta-llama/llama-3.3-70b-instruct:free, nvidia/nemotron-3-ultra-550b-a55b:free';
  dbConn.prepare('UPDATE settings SET value = ? WHERE key = ?').run(openrouterModelsStr, 'openrouter_models_list');

  // Force update empty or old whatsapp_message_template to new layout
  const currentTemplate = dbConn.prepare("SELECT value FROM settings WHERE key = 'whatsapp_message_template'").get();
  if (currentTemplate && (currentTemplate.value === '' || currentTemplate.value.includes('Produktivitas Petugas Aktif') || currentTemplate.value.includes('24 JAM') || currentTemplate.value.includes('avg_diff_24h_all'))) {
    dbConn.prepare("UPDATE settings SET value = ? WHERE key = 'whatsapp_message_template'").run(defaults['whatsapp_message_template']);
  }

  // If the current active model is not in the new list, reset it to openrouter/free
  const currentModelRow = dbConn.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_model');
  if (!currentModelRow || !openrouterModelsStr.includes(currentModelRow.value) || currentModelRow.value.includes('owl-alpha:free')) {
    dbConn.prepare('UPDATE settings SET value = ? WHERE key = ?').run('openrouter/free', 'openrouter_model');
  }

  const geminiModel = dbConn.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_model');
  if (geminiModel && (geminiModel.value === 'gemini-1.5-flash' || geminiModel.value === 'gemini-2.5-flash')) {
    dbConn.prepare('UPDATE settings SET value = ? WHERE key = ?').run('gemini-3.5-flash', 'gemini_model');
  }
}

function getSettings(surveyId) {
  const rows = getDb(surveyId).prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => {
    settings[r.key] = r.value;
  });
  if (settings.target_fasih_mode === 'dynamic') {
    settings.target_fasih_mode = 'static';
  }
  if (!settings.gemini_model) {
    settings.gemini_model = 'gemini-3.5-flash';
  }
  return settings;
}

function rebuildAllSummaryCaches() {
  const surveysConfig = require('./config/surveys.json');
  const { ensureAllSubslsInUpload } = require('./services/excelParser');
  for (const surveyId of Object.keys(surveysConfig)) {
    try {
      const db = getDb(surveyId);
      const uploads = db.prepare('SELECT id FROM uploads').all();
      uploads.forEach(u => {
        if (typeof ensureAllSubslsInUpload === 'function') {
          try { ensureAllSubslsInUpload(u.id, surveyId); } catch (_) {}
        }
        rebuildSummaryCache(u.id, surveyId);
      });
    } catch (e) {
      logger.error(`Failed to rebuild summary cache for ${surveyId}:`, e.message);
    }
  }
  try {
    const { triggerAsyncSync } = require('./services/firebaseSyncService');
    triggerAsyncSync();
  } catch (e) {
    logger.error('Failed to trigger Firebase sync:', e.message);
  }
}

function updateSettings(settingsObj, surveyId) {
  const activeSurveyId = resolveSurveyId(surveyId);
  const db = getDb(activeSurveyId);
  const currentSettings = getSettings(activeSurveyId);
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
    const masterTable = getMasterTableSql(activeSurveyId);
    db.transaction(() => {
      if (settingsObj.target_muatan_mode === 'honor') {
        db.prepare(`UPDATE ${masterTable} SET muatan = COALESCE(target_honor, 0)`).run();
      } else {
        db.prepare(`UPDATE ${masterTable} SET muatan = COALESCE(muatan_original, 0)`).run();
      }
    })();
  }
  
  if (needsRebuild) {
    rebuildAllSummaryCaches();
  }
}

function rebuildSummaryCache(uploadId, surveyId) {
  const db = getDb(surveyId);
  db.prepare('DELETE FROM summary_cache WHERE upload_id = ?').run(uploadId);
  const masterTable = getMasterTableSql(surveyId);

  const settings = getSettings(surveyId);
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');

  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  db.prepare(`
    INSERT OR REPLACE INTO summary_cache (
      upload_id, kecamatan, desa, korlap, pml, pcl,
      total_sls, selesai, total_muatan, muatan_selesai,
      usaha_total, keluarga_total, draft_total, open_total, submitted_total, approved_total, rejected_total, target_fasih_total,
      target_static_total, target_upload_total, target_honor_total,
      usaha_ditemukan, usaha_baru, ditemukan, keluarga_baru,
      usaha_tidak_ditemukan, tidak_ditemukan, usaha_tutup, meninggal, usaha_ganda,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya, keluarga_khusus_total
    )
    SELECT 
      ? as upload_id,
      MAX(m.kecamatan) AS kecamatan,
      MAX(m.desa) AS desa,
      MAX(m.korlap) AS korlap,
      MAX(m.pml) AS pml,
      COALESCE(p.pcl_name, m.pcl) AS pcl,
      COUNT(DISTINCT p.kode) AS total_sls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, (${singleTargetFormula}) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END) AS open_total,
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
      SUM(COALESCE(p.lainnya, 0)) AS lainnya,
      SUM(COALESCE(p.keluarga_khusus, 0)) AS keluarga_khusus_total
    FROM progres p
    LEFT JOIN ${masterTable} m ON p.kode = m.kode
    WHERE p.upload_id = ?
    GROUP BY COALESCE(p.pcl_email, m.pcl_email, m.pcl), m.kecamatan, m.desa
  `).run(uploadId, uploadId);
}

function getKippOfficers() {
  try {
    const db = getDb();
    const pcls = db.prepare("SELECT DISTINCT pcl_name FROM progres WHERE kode IN (SELECT kode FROM subsls_master WHERE nama_sls = 'KIPP IKN') AND pcl_name IS NOT NULL AND pcl_name != ''").all().map(r => r.pcl_name.toUpperCase());
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

function attachProgressPercentages(data, settings) {
  if (!data) return data;
  if (!settings) {
    settings = getSettings();
  }
  if (Array.isArray(data)) {
    return data.map(item => attachProgressPercentages(item, settings));
  }

  // Single object
  const draft = data.draft_total !== undefined ? data.draft_total : (data.draft || 0);
  const submitted = data.submitted_total !== undefined ? data.submitted_total : (data.submitted_by_pcl !== undefined ? data.submitted_by_pcl : (data.submitted || 0));
  const approved = data.approved_total !== undefined ? data.approved_total : (data.approved || 0);
  const rejected = data.rejected_total !== undefined ? data.rejected_total : (data.rejected || 0);
  const targetFasih = data.target_fasih_total !== undefined ? data.target_fasih_total : (data.target_fasih || 0);
  const targetUpload = data.target_upload_total !== undefined ? data.target_upload_total : (data.target_upload || 0);
  const targetStatic = data.target_static_total !== undefined ? data.target_static_total : (data.target_static || 0);

  // Exact Formula: Progres Fasih = (submitted + approved + rejected) / total assignment
  const completedFasih = submitted + approved + rejected;
  data.fasih_real_total = completedFasih;

  let activeTarget = targetFasih;
  if (settings && settings.target_fasih_mode === 'fasih-sm') {
    activeTarget = targetUpload > 0 ? targetUpload : targetFasih;
  } else if (settings && settings.target_fasih_mode === 'static') {
    activeTarget = targetStatic > 0 ? targetStatic : targetFasih;
  } else {
    activeTarget = targetUpload > 0 ? targetUpload : (targetFasih > 0 ? targetFasih : targetStatic);
  }

  data.fasih_pct = activeTarget > 0 ? parseFloat(((completedFasih / activeTarget) * 100).toFixed(2)) : 0.0;
  data.fasih_pct_str = activeTarget > 0 ? ((completedFasih / activeTarget) * 100).toFixed(2) : '0.00';

  const verifiedFasih = approved + rejected;
  data.fasih_verified_pct = activeTarget > 0 ? parseFloat(((verifiedFasih / activeTarget) * 100).toFixed(2)) : 0.0;
  data.fasih_verified_pct_str = activeTarget > 0 ? ((verifiedFasih / activeTarget) * 100).toFixed(2) : '0.00';

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

function getAllUsers() {
  return getDb().prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all();
}

function createUser(username, password, role) {
  const stmt = getDb().prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  const info = stmt.run(username, hashPassword(password), role);
  return info.lastInsertRowid;
}

function updateUser(id, username, password, role) {
  if (password && password.trim() !== '') {
    const stmt = getDb().prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?');
    return stmt.run(username, hashPassword(password), role, id).changes;
  } else {
    const stmt = getDb().prepare('UPDATE users SET username = ?, role = ? WHERE id = ?');
    return stmt.run(username, role, id).changes;
  }
}

function deleteUser(id) {
  const stmt = getDb().prepare('DELETE FROM users WHERE id = ?');
  return stmt.run(id).changes;
}

function saveRememberToken(userId, token) {
  const stmt = getDb().prepare("INSERT INTO remember_tokens (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+30 days'))");
  return stmt.run(userId, token).lastInsertRowid;
}

function getUserByRememberToken(token) {
  const stmt = getDb().prepare(`
    SELECT u.*, rt.token 
    FROM users u 
    JOIN remember_tokens rt ON u.id = rt.user_id 
    WHERE rt.token = ? AND rt.expires_at > datetime('now')
  `);
  return stmt.get(token);
}

function deleteRememberToken(token) {
  const stmt = getDb().prepare("DELETE FROM remember_tokens WHERE token = ?");
  return stmt.run(token).changes;
}

function getIntradayUploadsByDate(tanggal) {
  if (!tanggal) return null;

  const uploadSessions = getDb().prepare(`
    SELECT id, filename, tanggal, created_at
    FROM uploads
    WHERE tanggal = ?
    ORDER BY created_at ASC, id ASC
  `).all(tanggal);

  if (!uploadSessions || uploadSessions.length === 0) return null;

  const sessionDetails = uploadSessions.map((u, idx) => {
    const stats = getDb().prepare(`
      SELECT 
        SUM(COALESCE(draft, 0)) AS draft_total,
        SUM(COALESCE(submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(approved, 0)) AS approved_total,
        SUM(COALESCE(rejected, 0)) AS rejected_total,
        SUM(COALESCE(submitted_by_pcl, 0) + COALESCE(approved, 0) + COALESCE(rejected, 0)) AS selesai_total,
        SUM(COALESCE(usaha_tidak_ditemukan, 0) + COALESCE(usaha_ditemukan, 0) + COALESCE(usaha_baru, 0) + COALESCE(usaha_tutup, 0) + COALESCE(usaha_ganda, 0)) AS usaha_total,
        SUM(COALESCE(tidak_ditemukan, 0) + COALESCE(ditemukan, 0) + COALESCE(keluarga_baru, 0) + COALESCE(meninggal, 0) + COALESCE(tidak_eligible, 0) + COALESCE(tidak_dapat_ditemui, 0)) AS keluarga_total
      FROM progres
      WHERE upload_id = ?
    `).get(u.id);

    let timeStr = `Sesi ${idx + 1}`;
    if (u.created_at) {
      try {
        timeStr = new Date(u.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        timeStr = `Sesi ${idx + 1}`;
      }
    }

    return {
      upload_id: u.id,
      filename: u.filename,
      created_at: u.created_at,
      time: timeStr,
      draft_total: stats ? stats.draft_total || 0 : 0,
      submitted_total: stats ? stats.submitted_total || 0 : 0,
      approved_total: stats ? stats.approved_total || 0 : 0,
      rejected_total: stats ? stats.rejected_total || 0 : 0,
      selesai_total: stats ? stats.selesai_total || 0 : 0,
      usaha_total: stats ? stats.usaha_total || 0 : 0,
      keluarga_total: stats ? stats.keluarga_total || 0 : 0
    };
  });

  // Get closing total from previous upload date if available
  const prevUpload = getDb().prepare(`
    SELECT id FROM uploads WHERE tanggal < ? ORDER BY tanggal DESC, created_at DESC LIMIT 1
  `).get(tanggal);

  let baseline = 0;
  if (prevUpload) {
    const prevStats = getDb().prepare(`
      SELECT SUM(COALESCE(submitted_by_pcl, 0) + COALESCE(approved, 0) + COALESCE(rejected, 0)) AS total
      FROM progres WHERE upload_id = ?
    `).get(prevUpload.id);
    baseline = prevStats ? prevStats.total || 0 : 0;
  }

  let lastClose = baseline;
  sessionDetails.forEach((s) => {
    s.open = lastClose;
    s.close = s.selesai_total;
    s.high = Math.max(s.open, s.close);
    s.low = Math.min(s.open, s.close);
    s.is_bullish = s.close >= s.open;
    s.delta = s.close - s.open;
    lastClose = s.close;
  });

  const open = sessionDetails[0].open;
  const close = sessionDetails[sessionDetails.length - 1].close;
  const high = Math.max(...sessionDetails.map(s => s.high));
  const low = Math.min(...sessionDetails.map(s => s.low));

  return {
    tanggal,
    session_count: sessionDetails.length,
    ohlc: { open, high, low, close },
    sessions: sessionDetails
  };
}

function logVisit({ username, role, ip, userAgent, path }) {
  try {
    const db = getDb();
    db.prepare('INSERT INTO visitor_logs (username, role, ip, user_agent, path) VALUES (?, ?, ?, ?, ?)')
      .run(username || null, role || null, ip || null, userAgent || null, path);
  } catch (err) {
    logger.error('Failed to log visit:', err);
  }
}

function getVisitorStats() {
  try {
    const db = getDb();
    
    // Total page views
    const totalViews = db.prepare('SELECT COUNT(*) as count FROM visitor_logs').get().count;
    
    // Unique visitors (based on IP)
    const uniqueVisitors = db.prepare('SELECT COUNT(DISTINCT ip) as count FROM visitor_logs').get().count;
    
    // Unique logged in users count
    const uniqueUsers = db.prepare('SELECT COUNT(DISTINCT username) as count FROM visitor_logs WHERE username IS NOT NULL').get().count;

    // Page views per path (top paths)
    const topPaths = db.prepare(`
      SELECT path, COUNT(*) as count 
      FROM visitor_logs 
      GROUP BY path 
      ORDER BY count DESC 
      LIMIT 10
    `).all();

    // Page views per user role
    const viewsByRole = db.prepare(`
      SELECT COALESCE(role, 'guest') as role, COUNT(*) as count 
      FROM visitor_logs 
      GROUP BY role 
      ORDER BY count DESC
    `).all();

    // Top active users (logged in)
    const topUsers = db.prepare(`
      SELECT username, role, COUNT(*) as count, MAX(created_at) as last_active
      FROM visitor_logs 
      WHERE username IS NOT NULL
      GROUP BY username, role 
      ORDER BY count DESC 
      LIMIT 10
    `).all();

    // Daily visits for the last 14 days
    const dailyVisits = db.prepare(`
      SELECT DATE(created_at, '+8 hours') as date, COUNT(*) as views, COUNT(DISTINCT ip) as unique_ips
      FROM visitor_logs 
      WHERE created_at >= DATETIME('now', '-14 days')
      GROUP BY DATE(created_at, '+8 hours')
      ORDER BY date ASC
    `).all();

    // Latest visits (last 20)
    const latestVisits = db.prepare(`
      SELECT username, role, ip, user_agent, path, created_at
      FROM visitor_logs
      ORDER BY id DESC
      LIMIT 20
    `).all();

    return {
      totalViews,
      uniqueVisitors,
      uniqueUsers,
      topPaths,
      viewsByRole,
      topUsers,
      dailyVisits,
      latestVisits
    };
  } catch (err) {
    logger.error('Failed to get visitor stats:', err);
    return {
      totalViews: 0,
      uniqueVisitors: 0,
      uniqueUsers: 0,
      topPaths: [],
      viewsByRole: [],
      topUsers: [],
      dailyVisits: [],
      latestVisits: []
    };
  }
}

// ===== PETUGAS MASTER & EMAIL DATABASE HELPERS (Menggunakan ref_petugas di data/shared.db) =====
function getPetugasEmails() {
  return getSharedDb().prepare('SELECT * FROM ref_petugas ORDER BY nama_lengkap ASC').all();
}

function searchPetugasEmails(query) {
  if (!query) return getPetugasEmails();
  const q = `%${query.trim()}%`;
  return getSharedDb().prepare(`
    SELECT * FROM ref_petugas 
    WHERE nama_lengkap LIKE ? OR email LIKE ? OR sobat_id LIKE ?
    ORDER BY nama_lengkap ASC
  `).all(q, q, q);
}

function getPetugasEmailByNama(nama) {
  if (!nama) return null;
  return getSharedDb().prepare('SELECT * FROM ref_petugas WHERE LOWER(nama_lengkap) = LOWER(?)').get(nama.trim());
}

function getPetugasEmailBySobatId(sobatId) {
  if (!sobatId) return null;
  return getSharedDb().prepare('SELECT * FROM ref_petugas WHERE sobat_id = ?').get(String(sobatId).trim());
}

function getPetugasEmailById(id) {
  return getSharedDb().prepare('SELECT * FROM ref_petugas WHERE id = ?').get(id);
}

function insertPetugasEmail({ sobat_id, nama_lengkap, email, jenis_kelamin }) {
  const dbShared = getSharedDb();
  const stmt = dbShared.prepare(`
    INSERT INTO ref_petugas (sobat_id, nama_lengkap, email, jenis_kelamin)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      sobat_id = COALESCE(excluded.sobat_id, ref_petugas.sobat_id),
      nama_lengkap = excluded.nama_lengkap,
      jenis_kelamin = COALESCE(excluded.jenis_kelamin, ref_petugas.jenis_kelamin)
  `);
  const res = stmt.run(sobat_id || null, nama_lengkap.trim(), email.trim().toLowerCase(), jenis_kelamin || null);
  try { resyncPetugasEmailsToMaster(); } catch (_) {}
  return res.lastInsertRowid;
}

function updatePetugasEmail(id, { sobat_id, nama_lengkap, email, jenis_kelamin }) {
  const dbShared = getSharedDb();
  const stmt = dbShared.prepare(`
    UPDATE ref_petugas 
    SET sobat_id = ?, nama_lengkap = ?, email = ?, jenis_kelamin = ?
    WHERE id = ?
  `);
  const res = stmt.run(sobat_id || null, nama_lengkap.trim(), email.trim().toLowerCase(), jenis_kelamin || null, id);
  try { resyncPetugasEmailsToMaster(); } catch (_) {}
  return res.changes;
}

function deletePetugasEmail(id) {
  const dbShared = getSharedDb();
  const stmt = dbShared.prepare('DELETE FROM ref_petugas WHERE id = ?');
  const res = stmt.run(id);
  try { resyncPetugasEmailsToMaster(); } catch (_) {}
  return res.changes;
}

function resyncPetugasEmailsToMaster() {
  const dbShared = getSharedDb();
  const emails = dbShared.prepare('SELECT id, nama_lengkap, email, sobat_id FROM ref_petugas').all();
  const cleanStr = (s) => (s ? s.toString().toLowerCase().replace(/[^a-z0-9]/g, '') : '');
  const emailMapExact = {};
  const emailMapClean = {};

  emails.forEach(r => {
    if (r.nama_lengkap) {
      const ex = r.nama_lengkap.trim().toLowerCase();
      const cl = cleanStr(r.nama_lengkap);
      emailMapExact[ex] = r;
      emailMapClean[cl] = r;
    }
  });

  const roles = [
    { roleCol: 'pcl', emailCol: 'pcl_email', sobatCol: 'pcl_sobat_id' },
    { roleCol: 'pml', emailCol: 'pml_email', sobatCol: 'pml_sobat_id' },
    { roleCol: 'korlap', emailCol: 'korlap_email', sobatCol: 'korlap_sobat_id' }
  ];

  // Sinkronkan ke SEMUA survei yang terdaftar di surveys.json
  try {
    const surveysJson = require('./config/surveys.json');
    for (const sId of Object.keys(surveysJson)) {
      try {
        const dbSurvey = getDb(sId);
        roles.forEach(({ roleCol, emailCol, sobatCol }) => {
          const uniqueOfficers = dbSurvey.prepare(`SELECT DISTINCT ${roleCol} FROM subsls_master WHERE ${roleCol} IS NOT NULL AND ${roleCol} != ''`).all();
          uniqueOfficers.forEach(o => {
            const name = o[roleCol] ? o[roleCol].trim() : '';
            if (!name) return;
            const ex = name.toLowerCase();
            const cl = cleanStr(name);

            const target = emailMapExact[ex] || emailMapClean[cl];
            if (target) {
              dbSurvey.prepare(`UPDATE subsls_master SET ${emailCol} = ?, ${sobatCol} = ? WHERE LOWER(TRIM(${roleCol})) = LOWER(TRIM(?))`)
                .run(target.email, target.sobat_id, name);
            }
          });
        });
      } catch (errSurvey) {
        logger.error(`Error resyncing to survey DB ${sId}:`, errSurvey.message);
      }
    }
  } catch (err) {
    logger.error('Error in resyncPetugasEmailsToMaster:', err.message);
  }
}



/**
 * Atomic Inter-Process Lock menggunakan SQLite (ACID compliant across multiple Passenger/Node processes)
 */
function initProcessLockTable(dbConn) {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS process_locks (
      lock_name TEXT PRIMARY KEY,
      owner_pid INTEGER NOT NULL,
      heartbeat INTEGER NOT NULL,
      hostname TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

function acquireProcessLock(lockName, ownerPid, ttlMs = 12000, force = false) {
  try {
    const dbConn = getDb('se2026');
    initProcessLockTable(dbConn);
    const now = Date.now();

    const tx = dbConn.transaction(() => {
      const row = dbConn.prepare('SELECT owner_pid, heartbeat FROM process_locks WHERE lock_name = ?').get(lockName);
      if (row && !force) {
        const processActuallyRunning = isProcessAlive(row.owner_pid);
        const heartbeatFresh = (now - row.heartbeat) < ttlMs;
        if (processActuallyRunning && heartbeatFresh && row.owner_pid !== ownerPid) {
          return { acquired: false, masterPid: row.owner_pid };
        }
      }
      dbConn.prepare(`
        INSERT INTO process_locks (lock_name, owner_pid, heartbeat, hostname)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(lock_name) DO UPDATE SET
          owner_pid = excluded.owner_pid,
          heartbeat = excluded.heartbeat,
          hostname = excluded.hostname
      `).run(lockName, ownerPid, now, require('os').hostname());
      return { acquired: true, masterPid: ownerPid };
    });

    return tx();
  } catch (e) {
    logger.error('acquireProcessLock error:', e.message);
    return { acquired: true, masterPid: ownerPid };
  }
}

function renewProcessLock(lockName, ownerPid) {
  try {
    const dbConn = getDb('se2026');
    dbConn.prepare('UPDATE process_locks SET heartbeat = ? WHERE lock_name = ? AND owner_pid = ?')
      .run(Date.now(), lockName, ownerPid);
  } catch (_) {}
}

function releaseProcessLock(lockName, ownerPid) {
  try {
    const dbConn = getDb('se2026');
    dbConn.prepare('DELETE FROM process_locks WHERE lock_name = ? AND owner_pid = ?')
      .run(lockName, ownerPid);
  } catch (_) {}
}

function getProcessLock(lockName) {
  try {
    const dbConn = getDb('se2026');
    initProcessLockTable(dbConn);
    return dbConn.prepare('SELECT * FROM process_locks WHERE lock_name = ?').get(lockName);
  } catch (_) {
    return null;
  }
}

function getRefKecamatan() {
  try {
    return getSharedDb().prepare('SELECT * FROM ref_kecamatan ORDER BY kode_kec ASC').all();
  } catch (_) {
    return [];
  }
}

function getRefDesa(kodeKec) {
  try {
    if (kodeKec) {
      return getSharedDb().prepare('SELECT * FROM ref_desa WHERE kode_kec = ? ORDER BY kode_desa ASC').all(kodeKec);
    }
    return getSharedDb().prepare('SELECT * FROM ref_desa ORDER BY kode_desa ASC').all();
  } catch (_) {
    return [];
  }
}

function getRefPetugas() {
  try {
    return getSharedDb().prepare('SELECT * FROM ref_petugas ORDER BY nama_lengkap ASC').all();
  } catch (_) {
    return [];
  }
}


/**
 * Mengambil daftar petugas yang ditugaskan pada survei tertentu
 * secara relasional via tabel survey_petugas_assignment ⟷ ref_petugas.
 * @param {string} surveyId
 * @param {string} [role] - 'pcl', 'pml', 'korlap', 'ppl'
 */
function getSurveyPetugasAssignments(surveyId, role = null) {
  try {
    const sId = resolveSurveyId(surveyId);
    const dbConn = getDb(sId);
    let query = `
      SELECT 
        a.id AS assignment_id,
        a.survey_id,
        a.role,
        a.created_at AS assigned_at,
        p.id AS petugas_id,
        p.sobat_id,
        p.nama_lengkap,
        p.email,
        p.jenis_kelamin,
        COUNT(s.kode) AS total_subsls_assigned
      FROM survey_petugas_assignment a
      JOIN ref_petugas p ON a.petugas_id = p.id
      LEFT JOIN subsls_master s ON (
        (a.role = 'pcl' AND s.pcl_assignment_id = a.id) OR
        (a.role = 'pml' AND s.pml_assignment_id = a.id) OR
        (a.role = 'korlap' AND s.korlap_assignment_id = a.id)
      )
      WHERE a.survey_id = ?
    `;
    const params = [sId];
    if (role) {
      query += ` AND a.role = ?`;
      params.push(role);
    }
    query += ` GROUP BY a.id, a.survey_id, a.role, p.id ORDER BY p.nama_lengkap ASC`;
    return dbConn.prepare(query).all(...params);
  } catch (err) {
    logger.error('Error fetching survey petugas assignments:', err);
    return [];
  }
}

/**
 * Menugaskan petugas (dari master ref_petugas) ke suatu survei tertentu.
 * @param {string} surveyId
 * @param {number} petugasId
 * @param {string} role
 */
function assignPetugasToSurvey(surveyId, petugasId, role) {
  try {
    const sId = resolveSurveyId(surveyId);
    const dbConn = getDb(sId);
    const stmt = dbConn.prepare(`
      INSERT INTO survey_petugas_assignment (survey_id, petugas_id, role)
      VALUES (?, ?, ?)
      ON CONFLICT(survey_id, petugas_id, role) DO NOTHING
    `);
    const info = stmt.run(sId, petugasId, role);
    if (info.changes > 0) return info.lastInsertRowid;
    const existing = dbConn.prepare('SELECT id FROM survey_petugas_assignment WHERE survey_id = ? AND petugas_id = ? AND role = ?').get(sId, petugasId, role);
    return existing ? existing.id : null;
  } catch (err) {
    logger.error('Error assigning petugas to survey:', err);
    return null;
  }
}

/**
 * Mendapatkan ringkasan penugasan seorang petugas di seluruh survei yang aktif.
 * Memungkinkan analisis lintas survei (e.g. beban kerja di SE2026 vs Sakernas).
 * @param {number} petugasId
 */
function getPetugasCrossSurveyStats(petugasId) {
  try {
    const surveysJson = require('./config/surveys.json');
    const results = [];
    for (const sId of Object.keys(surveysJson)) {
      const dbConn = getDb(sId);
      const row = dbConn.prepare(`
        SELECT 
          a.survey_id,
          a.role,
          a.created_at AS assigned_at,
          p.nama_lengkap,
          p.email,
          p.sobat_id,
          COUNT(s.kode) AS total_subsls
        FROM survey_petugas_assignment a
        JOIN ref_petugas p ON a.petugas_id = p.id
        LEFT JOIN subsls_master s ON (
          (a.role = 'pcl' AND s.pcl_assignment_id = a.id) OR
          (a.role = 'pml' AND s.pml_assignment_id = a.id) OR
          (a.role = 'korlap' AND s.korlap_assignment_id = a.id)
        )
        WHERE a.petugas_id = ? AND a.survey_id = ?
        GROUP BY a.id, a.survey_id, a.role
      `).get(petugasId, sId);
      if (row) results.push(row);
    }
    return results;
  } catch (err) {
    logger.error('Error getting cross survey stats for petugas:', err);
    return [];
  }
}


/**
 * Shared WhatsApp State, Logs, Commands, & Outbox Tables across Passenger Workers
 */
function initWhatsappSharedTables(dbConn) {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS whatsapp_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
      type TEXT,
      message TEXT,
      created_at INTEGER
    );
    DROP TABLE IF EXISTS whatsapp_commands;
    CREATE TABLE IF NOT EXISTS whatsapp_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      error TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
}

function setWhatsappState(key, value) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    const valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value || '');
    dbConn.prepare(`
      INSERT INTO whatsapp_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, valStr, Date.now());
  } catch (_) {}
}

function getWhatsappState(key) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    const row = dbConn.prepare('SELECT value, updated_at FROM whatsapp_state WHERE key = ?').get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch (_) {
      return row.value;
    }
  } catch (_) {
    return null;
  }
}

function getAllWhatsappState() {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    const rows = dbConn.prepare('SELECT key, value, updated_at FROM whatsapp_state').all();
    const state = {};
    rows.forEach(r => {
      try {
        state[r.key] = JSON.parse(r.value);
      } catch (_) {
        state[r.key] = r.value;
      }
    });
    return state;
  } catch (_) {
    return {};
  }
}

function saveWhatsappLogDb(logEntry) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    dbConn.prepare(`
      INSERT OR REPLACE INTO whatsapp_logs (id, timestamp, type, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(logEntry.id, logEntry.timestamp, logEntry.type, logEntry.message, Date.now());

    // Prune logs keeping only latest 100
    dbConn.prepare(`
      DELETE FROM whatsapp_logs WHERE id NOT IN (
        SELECT id FROM whatsapp_logs ORDER BY created_at DESC LIMIT 100
      )
    `).run();
  } catch (_) {}
}

function getWhatsappLogsDb(limit = 40) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    const rows = dbConn.prepare(`
      SELECT id, timestamp, type, message FROM whatsapp_logs ORDER BY created_at ASC LIMIT ?
    `).all(limit);
    return rows;
  } catch (_) {
    return [];
  }
}

function pushWhatsappCommand(command, payload = null) {
  // No-op: Commands are handled directly in-process
}

function popPendingWhatsappCommands() {
  return [];
}

function queueWhatsappMessage(chatId, message) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    const info = dbConn.prepare(`
      INSERT INTO whatsapp_outbox (chat_id, message, status, created_at, updated_at)
      VALUES (?, ?, 'PENDING', ?, ?)
    `).run(chatId, message, Date.now(), Date.now());
    return info.lastInsertRowid;
  } catch (_) {
    return null;
  }
}

function getPendingWhatsappMessages() {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    return dbConn.prepare(`
      SELECT id, chat_id, message FROM whatsapp_outbox WHERE status = 'PENDING' ORDER BY id ASC LIMIT 10
    `).all();
  } catch (_) {
    return [];
  }
}

function updateWhatsappMessageStatus(id, status, error = null) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    dbConn.prepare(`
      UPDATE whatsapp_outbox SET status = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(status, error, Date.now(), id);
  } catch (_) {}
}

function checkQueuedMessageStatus(id) {
  try {
    const dbConn = getDb('se2026');
    initWhatsappSharedTables(dbConn);
    return dbConn.prepare(`SELECT status, error FROM whatsapp_outbox WHERE id = ?`).get(id);
  } catch (_) {
    return null;
  }
}

/**
 * Jalankan WAL checkpoint pada satu DB survei.
 * Checkpoint PASSIVE: tidak memblokir reader/writer, checkpoint sebanyak
 * yang bisa dilakukan tanpa konflik.
 * @param {string} surveyId
 */
function runWalCheckpoint(surveyId) {
  try {
    const dbConn = getDb(surveyId);
    const result = dbConn.pragma('wal_checkpoint(PASSIVE)');
    logger.info(`[WAL Checkpoint] ${surveyId}: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    logger.error(`[WAL Checkpoint] Gagal checkpoint ${surveyId}:`, err.message);
    return null;
  }
}

/**
 * Jalankan WAL checkpoint pada SEMUA DB survei yang aktif (sudah diinisialisasi).
 * Dipanggil secara terjadwal dari server.js setiap 6 jam.
 * Setiap survei diperiksa secara independen — kegagalan satu tidak mempengaruhi lain.
 */
function runWalCheckpointAll() {
  try {
    // Checkpoint shared.db jika aktif
    if (_sharedDb) {
      try {
        const res = _sharedDb.pragma('wal_checkpoint(PASSIVE)');
        logger.info(`[WAL Checkpoint] shared.db: ${JSON.stringify(res)}`);
      } catch (err) {
        logger.error('[WAL Checkpoint] Gagal checkpoint shared.db:', err.message);
      }
    }

    const surveysJson = require('./config/surveys.json');
    const surveyIds = Object.keys(surveysJson);
    logger.info(`[WAL Checkpoint] Memulai checkpoint untuk ${surveyIds.length} survei...`);

    let checkpointCount = 0;
    for (const sId of surveyIds) {
      // Hanya checkpoint DB yang sudah diinisialisasi (ada di cache dbs)
      if (dbs[sId]) {
        runWalCheckpoint(sId);
        checkpointCount++;
      }
    }

    logger.info(`[WAL Checkpoint] Selesai. ${checkpointCount} DB diperiksa.`);
  } catch (err) {
    logger.error('[WAL Checkpoint] runWalCheckpointAll error:', err.message);
  }
}

function saveAgentQuery(queryData, surveyId) {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  const id = queryData.id;
  try {
    try {
      db.exec(`ALTER TABLE agent_queries ADD COLUMN analysis_text TEXT;`);
    } catch (_) {}

    db.prepare(`
      INSERT OR REPLACE INTO agent_queries (id, user_id, prompt, tool_name, query_sql, query_params, columns_json, row_count, analysis_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      queryData.userId || null,
      queryData.prompt || '',
      queryData.toolName || '',
      queryData.querySql || '',
      typeof queryData.queryParams === 'string' ? queryData.queryParams : JSON.stringify(queryData.queryParams || {}),
      typeof queryData.columnsJson === 'string' ? queryData.columnsJson : JSON.stringify(queryData.columnsJson || []),
      queryData.rowCount || 0,
      queryData.analysisText || null
    );
    return id;
  } catch (err) {
    logger.error(`[DB] saveAgentQuery error: ${err.message}`);
    return null;
  }
}

function updateAgentQueryAnalysis(id, analysisText, surveyId) {
  if (!id || !analysisText) return false;
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  try {
    try {
      db.exec(`ALTER TABLE agent_queries ADD COLUMN analysis_text TEXT;`);
    } catch (_) {}
    db.prepare(`UPDATE agent_queries SET analysis_text = ? WHERE id = ?`).run(analysisText, id);
    return true;
  } catch (err) {
    logger.error(`[DB] updateAgentQueryAnalysis error: ${err.message}`);
    return false;
  }
}

function getAgentQueryById(id, surveyId) {
  if (!id) return null;
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  try {
    try {
      db.exec(`ALTER TABLE agent_queries ADD COLUMN analysis_text TEXT;`);
    } catch (_) {}
    return db.prepare(`SELECT * FROM agent_queries WHERE id = ?`).get(id);
  } catch (err) {
    logger.error(`[DB] getAgentQueryById error: ${err.message}`);
    return null;
  }
}

function executeAgentQueryById(id, surveyId) {
  const record = getAgentQueryById(id, surveyId);
  if (!record || !record.query_sql) return { error: 'Kueri tidak ditemukan atau sudah kadaluarsa.' };
  
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  
  try {
    let params = {};
    if (record.query_params) {
      try { params = JSON.parse(record.query_params); } catch (_) {}
    }
    let cleanSql = record.query_sql.trim().replace(/;+$/, '');
    if (!/^(select|with)\s/i.test(cleanSql)) {
      return { error: 'Hanya kueri SELECT yang diizinkan.' };
    }

    // Hapus LIMIT kecil (misal LIMIT 5 atau LIMIT 10) agar halaman tabel mengeksekusi seluruh dataset lengkap
    if (/\bLIMIT\s+\d+\s*$/i.test(cleanSql)) {
      const match = cleanSql.match(/\bLIMIT\s+(\d+)\s*$/i);
      if (match && parseInt(match[1], 10) <= 50) {
        cleanSql = cleanSql.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();
      }
    }

    const stmt = db.prepare(cleanSql);
    const rows = Object.keys(params).length > 0 ? stmt.all(params) : stmt.all();
    return {
      query: record,
      rows: rows
    };
  } catch (err) {
    return { error: `Gagal mengeksekusi kueri: ${err.message}` };
  }
}

function parseCSVLineInternal(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function clearTitikUjiPetik(surveyId = 'se2026') {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='titik_uji_petik'").get();
  if (tableCheck) {
    db.exec('DELETE FROM titik_uji_petik;');
  }
  _titikUjiPetikCompactCache = null;
  logger.info(`[Titik Uji Petik] Seluruh data titik uji petik berhasil dikosongkan (${sId}).`);
  return true;
}

function importTitikUjiPetikFromCsv(filePath, surveyId = 'se2026', replaceExisting = true) {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);

  // Auto-create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS titik_uji_petik (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_6_full_code TEXT NOT NULL,
      label TEXT,
      no_bang TEXT,
      kode_bang_label TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      is_kosong INTEGER DEFAULT 0,
      pcl TEXT,
      pml TEXT,
      korlap TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_titik_uji_petik_sls ON titik_uji_petik (level_6_full_code);
    CREATE INDEX IF NOT EXISTS idx_titik_uji_petik_coords ON titik_uji_petik (latitude, longitude);
  `);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File CSV tidak ditemukan pada path: ${filePath}`);
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const lines = rawData.split(/\r?\n/);
  if (lines.length <= 1) return 0;

  const insertStmt = db.prepare(`
    INSERT INTO titik_uji_petik (
      level_6_full_code, label, no_bang, kode_bang_label,
      latitude, longitude, is_kosong, pcl, pml, korlap
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    if (replaceExisting) {
      db.exec('DELETE FROM titik_uji_petik;');
    }
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCSVLineInternal(line);
      if (cols.length < 6) continue;

      const code = (cols[0] || '').trim();
      const label = (cols[1] || '').trim();
      const noBang = (cols[2] || '').trim();
      const kodeBangLabel = (cols[3] || '').trim();
      const lat = parseFloat(cols[4]);
      const lng = parseFloat(cols[5]);
      const kosong = (cols[6] || '').trim() === '1' ? 1 : 0;
      const pcl = (cols[7] || '').trim();
      const pml = (cols[8] || '').trim();
      const korlap = (cols[9] || '').trim();

      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        insertStmt.run(code, label, noBang, kodeBangLabel, lat, lng, kosong, pcl, pml, korlap);
        count++;
      }
    }
    return count;
  });

  const total = tx();
  _titikUjiPetikCompactCache = null;
  logger.info(`[Titik Uji Petik] Berhasil mengimpor ${total} titik ke database (${sId}).`);
  return total;
}

function getTitikUjiPetikStats(surveyId = 'se2026') {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);

  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='titik_uji_petik'").get();
  if (!tableCheck) {
    return {
      total: 0,
      kosong: 0,
      isi: 0,
      kategoriStats: [],
      kecStats: [],
      desaStats: [],
      pcls: [],
      pmls: [],
      korlaps: []
    };
  }

  const overall = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN is_kosong = 1 THEN 1 ELSE 0 END) AS kosong,
      SUM(CASE WHEN is_kosong = 0 THEN 1 ELSE 0 END) AS isi
    FROM titik_uji_petik
  `).get() || { total: 0, kosong: 0, isi: 0 };

  const kategoriStats = db.prepare(`
    SELECT 
      COALESCE(NULLIF(kode_bang_label, ''), 'Lainnya / Tidak Tercatat') AS kategori,
      COUNT(*) AS count
    FROM titik_uji_petik
    GROUP BY kode_bang_label
    ORDER BY count DESC
  `).all();

  const kecStats = db.prepare(`
    SELECT 
      m.kecamatan,
      COUNT(t.id) AS total_titik,
      SUM(CASE WHEN t.kode_bang_label LIKE '%Usaha%' OR t.kode_bang_label LIKE '%Campuran%' THEN 1 ELSE 0 END) AS usaha_titik,
      SUM(CASE WHEN t.is_kosong = 1 THEN 1 ELSE 0 END) AS kosong_titik
    FROM titik_uji_petik t
    LEFT JOIN subsls_master m ON t.level_6_full_code = m.kode
    WHERE m.kecamatan IS NOT NULL
    GROUP BY m.kecamatan
    ORDER BY m.kecamatan ASC
  `).all();

  const desaStats = db.prepare(`
    SELECT 
      SUBSTR(t.level_6_full_code, 1, 10) AS iddesa,
      m.kecamatan,
      m.desa,
      COUNT(t.id) AS total_titik,
      SUM(CASE WHEN t.kode_bang_label LIKE '%Usaha%' OR t.kode_bang_label LIKE '%Campuran%' THEN 1 ELSE 0 END) AS usaha_titik,
      SUM(CASE WHEN t.is_kosong = 1 THEN 1 ELSE 0 END) AS kosong_titik
    FROM titik_uji_petik t
    LEFT JOIN subsls_master m ON t.level_6_full_code = m.kode
    WHERE m.desa IS NOT NULL
    GROUP BY SUBSTR(t.level_6_full_code, 1, 10), m.kecamatan, m.desa
    ORDER BY m.kecamatan ASC, m.desa ASC
  `).all();

  const pcls = db.prepare(`SELECT DISTINCT pcl FROM titik_uji_petik WHERE pcl IS NOT NULL AND pcl != '' ORDER BY pcl ASC`).all().map(r => r.pcl);
  const pmls = db.prepare(`SELECT DISTINCT pml FROM titik_uji_petik WHERE pml IS NOT NULL AND pml != '' ORDER BY pml ASC`).all().map(r => r.pml);
  const korlaps = db.prepare(`SELECT DISTINCT korlap FROM titik_uji_petik WHERE korlap IS NOT NULL AND korlap != '' ORDER BY korlap ASC`).all().map(r => r.korlap);

  return {
    total: overall.total || 0,
    kosong: overall.kosong || 0,
    isi: overall.isi || 0,
    kategoriStats,
    kecStats,
    desaStats,
    pcls,
    pmls,
    korlaps
  };
}

function getTitikUjiPetikPoints(filters = {}, surveyId = 'se2026') {
  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);

  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='titik_uji_petik'").get();
  if (!tableCheck) return [];

  let sql = `
    SELECT 
      t.id,
      t.level_6_full_code AS kode_sls,
      t.label,
      t.no_bang,
      t.kode_bang_label,
      t.latitude,
      t.longitude,
      t.is_kosong,
      COALESCE(t.pcl, m.pcl) AS pcl,
      COALESCE(t.pml, m.pml) AS pml,
      COALESCE(t.korlap, m.korlap) AS korlap,
      m.nama_sls,
      m.desa,
      m.kecamatan
    FROM titik_uji_petik t
    LEFT JOIN subsls_master m ON t.level_6_full_code = m.kode
    WHERE 1=1
  `;

  const params = [];

  if (filters.kec) {
    sql += ` AND UPPER(TRIM(m.kecamatan)) = UPPER(TRIM(?))`;
    params.push(filters.kec);
  }

  if (filters.desa) {
    sql += ` AND (UPPER(TRIM(m.desa)) = UPPER(TRIM(?)) OR SUBSTR(t.level_6_full_code, 1, 10) = ?)`;
    params.push(filters.desa, filters.desa);
  }

  if (filters.sls || filters.kode_sls) {
    const slsVal = filters.sls || filters.kode_sls;
    sql += ` AND t.level_6_full_code = ?`;
    params.push(slsVal);
  }

  if (filters.kategori) {
    sql += ` AND t.kode_bang_label = ?`;
    params.push(filters.kategori);
  }

  if (filters.kosong !== undefined && filters.kosong !== '' && filters.kosong !== null) {
    sql += ` AND t.is_kosong = ?`;
    params.push(parseInt(filters.kosong, 10));
  }

  if (filters.pcl) {
    sql += ` AND (LOWER(TRIM(t.pcl)) = LOWER(TRIM(?)) OR LOWER(TRIM(m.pcl)) = LOWER(TRIM(?)))`;
    params.push(filters.pcl, filters.pcl);
  }

  if (filters.pml) {
    sql += ` AND (LOWER(TRIM(t.pml)) = LOWER(TRIM(?)) OR LOWER(TRIM(m.pml)) = LOWER(TRIM(?)))`;
    params.push(filters.pml, filters.pml);
  }

  if (filters.korlap) {
    sql += ` AND (LOWER(TRIM(t.korlap)) = LOWER(TRIM(?)) OR LOWER(TRIM(m.korlap)) = LOWER(TRIM(?)))`;
    params.push(filters.korlap, filters.korlap);
  }

  if (filters.search) {
    const q = `%${filters.search.toLowerCase().trim()}%`;
    sql += ` AND (
      LOWER(t.label) LIKE ? OR
      LOWER(t.no_bang) LIKE ? OR
      LOWER(t.level_6_full_code) LIKE ? OR
      LOWER(t.pcl) LIKE ? OR
      LOWER(m.nama_sls) LIKE ? OR
      LOWER(m.desa) LIKE ?
    )`;
    params.push(q, q, q, q, q, q);
  }

  if (filters.limit) {
    sql += ` LIMIT ?`;
    params.push(parseInt(filters.limit, 10));
  }

  return db.prepare(sql).all(...params);
}

let _titikUjiPetikCompactCache = null;

function getTitikUjiPetikCompact(surveyId = 'se2026') {
  if (_titikUjiPetikCompactCache) return _titikUjiPetikCompactCache;

  const sId = resolveSurveyId(surveyId);
  const db = getDb(sId);

  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='titik_uji_petik'").get();
  if (!tableCheck) return [];

  const rows = db.prepare(`
    SELECT 
      t.id,
      t.latitude,
      t.longitude,
      t.kode_bang_label,
      t.is_kosong,
      t.label,
      t.no_bang,
      COALESCE(t.pcl, m.pcl, '') AS pcl,
      COALESCE(t.pml, m.pml, '') AS pml,
      COALESCE(t.korlap, m.korlap, '') AS korlap,
      COALESCE(m.nama_sls, '') AS nama_sls,
      COALESCE(m.desa, '') AS desa,
      COALESCE(m.kecamatan, '') AS kecamatan,
      t.level_6_full_code AS kode_sls
    FROM titik_uji_petik t
    LEFT JOIN subsls_master m ON t.level_6_full_code = m.kode
  `).all();

  function getCatCode(str, isKosong) {
    if (isKosong === 1) return 6;
    if (!str) return 0;
    if (str.startsWith('1')) return 1;
    if (str.startsWith('2')) return 2;
    if (str.startsWith('3')) return 3;
    if (str.startsWith('4')) return 4;
    if (str.startsWith('5')) return 5;
    if (str.startsWith('6')) return 6;
    if (str.startsWith('8')) return 8;
    if (str.startsWith('9')) return 9;
    return 0;
  }

  // Schema: [id, lat, lng, catCode, isKosong, label, noBang, pcl, pml, korlap, namaSls, desa, kec, kodeSls]
  const compact = rows.map(r => [
    r.id,
    r.latitude,
    r.longitude,
    getCatCode(r.kode_bang_label, r.is_kosong),
    r.is_kosong,
    r.label || '',
    r.no_bang || '',
    r.pcl || '',
    r.pml || '',
    r.korlap || '',
    r.nama_sls || '',
    r.desa || '',
    r.kecamatan || '',
    r.kode_sls || ''
  ]);

  _titikUjiPetikCompactCache = compact;
  return compact;
}

module.exports = {
  getDb, getSharedDb, resolveSurveyId, getLatestUpload, getLatestUploadsDetailed, getAllUploads,
  getProgresWithMaster, getKecamatanStats, getKorlapStats,
  getPmlStats, getPclStats, getTrenHarian, getOverviewSummary, getEarlyWarning, getTopPerformers,
  getBottomPerformers, getAnomalyStats,
  getSettings, updateSettings, getUserByUsername, hashPassword, rebuildSummaryCache, rebuildAllSummaryCaches,
  getKippOfficers, saveDailyWeather, getWeatherHistory, attachProgressPercentages, getTargetFormula,
  getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula, getSingleSelesaiFormula, getSubslsStatusFormula,
  getAllUsers, createUser, updateUser, deleteUser,
  saveRememberToken, getUserByRememberToken, deleteRememberToken, getIntradayUploadsByDate,
  logVisit, getVisitorStats,
  getPetugasEmails, searchPetugasEmails, getPetugasEmailByNama, getPetugasEmailBySobatId,
  getPetugasEmailById, insertPetugasEmail, updatePetugasEmail, deletePetugasEmail, resyncPetugasEmailsToMaster,
  getRefKecamatan, getRefDesa, getRefPetugas,
  getSurveyPetugasAssignments, assignPetugasToSurvey, getPetugasCrossSurveyStats,
  reloadDbConnection, closeDbConnection, getMasterTableSql,
  acquireProcessLock, renewProcessLock, releaseProcessLock, getProcessLock,
  setWhatsappState, getWhatsappState, getAllWhatsappState,
  saveWhatsappLogDb, getWhatsappLogsDb,
  pushWhatsappCommand, popPendingWhatsappCommands,
  queueWhatsappMessage, getPendingWhatsappMessages, updateWhatsappMessageStatus, checkQueuedMessageStatus,
  runWalCheckpoint, runWalCheckpointAll,
  saveAgentQuery, getAgentQueryById, executeAgentQueryById, updateAgentQueryAnalysis,
  importTitikUjiPetikFromCsv, clearTitikUjiPetik, getTitikUjiPetikStats, getTitikUjiPetikPoints, getTitikUjiPetikCompact
};




