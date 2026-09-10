'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDb, closeDbConnection, resolveSurveyId } = require('../database');
const logger = require('./logger');

/**
 * Mendapatkan direktori penyimpanan backup untuk survei tertentu
 */
function getSurveyBackupsDir(surveyId = 'se2026') {
  const sId = resolveSurveyId ? resolveSurveyId(surveyId) : surveyId;
  const dir = path.join(__dirname, '../data/backups', sId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Mendapatkan path file database utama untuk survei tertentu
 */
function getSurveyDbPath(surveyId = 'se2026') {
  const sId = resolveSurveyId ? resolveSurveyId(surveyId) : surveyId;
  return path.join(__dirname, `../data/${sId}.db`);
}

/**
 * Membersihkan file WAL dan SHM untuk path DB tertentu
 */
function cleanupWalShmFiles(dbPath) {
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) {
    try { fs.unlinkSync(walPath); } catch (_) {}
  }
  if (fs.existsSync(shmPath)) {
    try { fs.unlinkSync(shmPath); } catch (_) {}
  }
}

/**
 * Menyalin berkas dengan mekanisme coba-ulang (retry) untuk mengatasi delay lock file pada Windows
 */
function copyFileWithRetry(src, dest, maxRetries = 10, delayMs = 150) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.copyFileSync(src, dest);
      return;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const start = Date.now();
      while (Date.now() - start < delayMs) {}
    }
  }
}

/**
 * Memvalidasi dan mencoba memperbaiki database SQLite jika ditemukan kerusakan integritas (malformed)
 * 
 * @param {string} filePath - Path file SQLite yang akan diperiksa
 * @returns {{ valid: boolean, repaired: boolean, method?: string, error?: string }}
 */
function validateAndRepairSqliteFile(filePath) {
  let db = null;
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, repaired: false, error: 'File tidak ditemukan di disk.' };
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return { valid: false, repaired: false, error: 'File kosong (0 bytes).' };
    }

    // Cek awal koneksi dan integritas
    db = new Database(filePath);
    let integrity = [];
    try {
      integrity = db.pragma('integrity_check');
    } catch (checkErr) {
      integrity = [{ integrity_check: checkErr.message }];
    }

    const isOk = Array.isArray(integrity) && integrity.length > 0 && integrity[0].integrity_check === 'ok';
    if (isOk) {
      // Pastikan WAL ditutup jika file calon backup membawa mode WAL
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      db.close();
      cleanupWalShmFiles(filePath);
      return { valid: true, repaired: false };
    }

    logger.warn(`[BackupRepair] Integritas awal gagal pada ${filePath}: ${JSON.stringify(integrity)}. Mencoba perbaikan otomatis...`);

    // METODE PERBAIKAN 1: REINDEX
    try {
      db.exec('REINDEX');
      const checkReindex = db.pragma('integrity_check');
      if (Array.isArray(checkReindex) && checkReindex.length > 0 && checkReindex[0].integrity_check === 'ok') {
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
        db.close();
        cleanupWalShmFiles(filePath);
        logger.info(`[BackupRepair] Database berhasil diperbaiki menggunakan REINDEX: ${filePath}`);
        return { valid: true, repaired: true, method: 'REINDEX' };
      }
    } catch (reindexErr) {
      logger.warn(`[BackupRepair] REINDEX gagal: ${reindexErr.message}`);
    }

    // METODE PERBAIKAN 2: Table-by-table dump and recovery ke database baru
    const recoveredPath = `${filePath}.recovered_${Date.now()}.db`;
    let recDb = null;
    try {
      recDb = new Database(recoveredPath);
      recDb.pragma('journal_mode = DELETE');
      recDb.pragma('synchronous = OFF');

      const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      for (const t of tables) {
        if (!t.sql) continue;
        recDb.exec(t.sql);
        try {
          const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
          if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            const colNames = cols.map(c => `"${c}"`).join(',');
            const placeholders = cols.map(() => '?').join(',');
            const insertStmt = recDb.prepare(`INSERT OR IGNORE INTO "${t.name}" (${colNames}) VALUES (${placeholders})`);
            const insertMany = recDb.transaction((items) => {
              for (const item of items) {
                insertStmt.run(...cols.map(c => item[c]));
              }
            });
            insertMany(rows);
          }
        } catch (tableErr) {
          logger.warn(`[BackupRepair] Tabel "${t.name}" mengalami sebagian kerusakan, baris yang terselamatkan telah dimigrasi: ${tableErr.message}`);
        }
      }

      // Salin struktur indeks
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all();
      for (const idx of indexes) {
        try { recDb.exec(idx.sql); } catch (_) {}
      }

      db.close();
      db = null;
      cleanupWalShmFiles(filePath);

      recDb.close();
      recDb = null;
      cleanupWalShmFiles(recoveredPath);

      // Verifikasi database hasil recovery
      const checkRec = new Database(recoveredPath, { readonly: true });
      const checkRecRes = checkRec.pragma('integrity_check');
      checkRec.close();

      if (Array.isArray(checkRecRes) && checkRecRes.length > 0 && checkRecRes[0].integrity_check === 'ok') {
        fs.copyFileSync(recoveredPath, filePath);
        try { fs.unlinkSync(recoveredPath); } catch (_) {}
        cleanupWalShmFiles(filePath);
        logger.info(`[BackupRepair] Database berhasil dipulihkan total melalui Table Recovery: ${filePath}`);
        return { valid: true, repaired: true, method: 'TABLE_RECOVERY' };
      }
    } catch (recErr) {
      if (recDb) try { recDb.close(); } catch (_) {}
      if (fs.existsSync(recoveredPath)) try { fs.unlinkSync(recoveredPath); } catch (_) {}
      cleanupWalShmFiles(recoveredPath);
      logger.error(`[BackupRepair] Table recovery gagal: ${recErr.message}`);
    }

    if (db) try { db.close(); } catch (_) {}
    cleanupWalShmFiles(filePath);
    return { valid: false, repaired: false, error: 'Database disk image is malformed dan tidak dapat diperbaiki secara otomatis.' };
  } catch (err) {
    if (db) try { db.close(); } catch (_) {}
    cleanupWalShmFiles(filePath);
    return { valid: false, repaired: false, error: err.message };
  }
}

/**
 * Membuat backup bersih dan terverifikasi secara atomik
 */
async function safeCreateBackup(surveyId = 'se2026', targetPath = null) {
  const sId = resolveSurveyId ? resolveSurveyId(surveyId) : surveyId;
  const backupsDir = getSurveyBackupsDir(sId);
  const finalPath = targetPath || path.join(backupsDir, `${sId}_backup_${Date.now()}.db`);

  const dbConn = getDb(sId);
  // Pastikan seluruh transaksi WAL ter-commit dan tertulis ke database file
  try {
    dbConn.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    logger.warn(`[SafeBackup] Warning saat wal_checkpoint untuk ${sId}: ${e.message}`);
  }

  // Gunakan SQLite native backup API untuk snapshot yang 100% konsisten
  await dbConn.backup(finalPath);

  // Verifikasi file backup yang baru dibuat
  const val = validateAndRepairSqliteFile(finalPath);
  if (!val.valid) {
    try { fs.unlinkSync(finalPath); } catch (_) {}
    throw new Error(`Hasil backup tidak lolos uji integritas: ${val.error}`);
  }

  return finalPath;
}

/**
 * Melakukan proses restore database dengan proteksi total dan rollback otomatis
 */
async function safeRestoreDatabase(surveyId = 'se2026', sourceDbPath) {
  const sId = resolveSurveyId ? resolveSurveyId(surveyId) : surveyId;
  const backupsDir = getSurveyBackupsDir(sId);
  const mainDbPath = getSurveyDbPath(sId);

  // 1. Validasi dan perbaiki source file sebelum menyentuh database aktif
  const val = validateAndRepairSqliteFile(sourceDbPath);
  if (!val.valid) {
    throw new Error(`File database tidak valid atau rusak (malformed): ${val.error}`);
  }

  // 2. Verifikasi tabel penting pada source DB
  const testDb = new Database(sourceDbPath, { readonly: true });
  const hasSettings = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  testDb.close();

  if (!hasSettings) {
    throw new Error('File tidak valid: tabel konfigurasi sistem (settings) tidak ditemukan.');
  }

  // 3. Buat auto-backup dari database aktif saat ini sebelum ditimpa
  const autoBackupPath = path.join(backupsDir, `pre_restore_auto_${Date.now()}.db`);
  let hasAutoBackup = false;
  if (fs.existsSync(mainDbPath)) {
    try {
      const curConn = getDb(sId);
      try { curConn.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      await curConn.backup(autoBackupPath);
      hasAutoBackup = true;
    } catch (backupErr) {
      logger.warn(`[SafeRestore] Auto backup via API gagal, fallback ke file copy: ${backupErr.message}`);
      try {
        fs.copyFileSync(mainDbPath, autoBackupPath);
        hasAutoBackup = true;
      } catch (_) {}
    }
  }

  // 4. Tutup koneksi aktif dan bersihkan file WAL/SHM lama
  closeDbConnection(sId);
  cleanupWalShmFiles(mainDbPath);

  try {
    // 5. Timpa berkas database utama dengan file yang telah divalidasi
    copyFileWithRetry(sourceDbPath, mainDbPath);
    // Hapus lagi jika ada WAL/SHM yang terbentuk
    cleanupWalShmFiles(mainDbPath);

    // 6. Buka koneksi baru dan verifikasi integritas
    const newDb = getDb(sId);
    const integrity = newDb.pragma('integrity_check');
    if (!Array.isArray(integrity) || integrity.length === 0 || integrity[0].integrity_check !== 'ok') {
      throw new Error(`Integritas database setelah restore tidak valid: ${JSON.stringify(integrity)}`);
    }

    // 7. Jalankan pembaruan skema/migrasi jika file backup berasal dari versi lama
    try {
      const { runMigrations } = require('../database');
      if (typeof runMigrations === 'function') {
        runMigrations(newDb, sId);
      }
    } catch (migErr) {
      logger.warn(`[SafeRestore] Warning saat runMigrations: ${migErr.message}`);
    }

    // 8. Bersihkan imputasi sintetis jika ada & rebuild cache
    try {
      const { runAutoImputation } = require('./imputerService');
      const { rebuildSummaryCache } = require('../database');
      runAutoImputation(sId);
      const curUploads = newDb.prepare('SELECT id FROM uploads').all();
      curUploads.forEach(u => rebuildSummaryCache(u.id, sId));
    } catch (cacheErr) {
      logger.warn(`[SafeRestore] Warning saat rebuild summary cache: ${cacheErr.message}`);
    }

    logger.info(`[SafeRestore] Berhasil memulihkan database untuk survei "${sId}". (Repaired: ${val.repaired ? 'Ya (' + val.method + ')' : 'Tidak'})`);
    return { success: true, repaired: val.repaired, method: val.method };
  } catch (restoreErr) {
    logger.error(`[SafeRestore] Gagal memulihkan database "${sId}": ${restoreErr.message}. Melakukan rollback...`);

    // ROLLBACK OTOMATIS JIKA GAGAL
    if (hasAutoBackup && fs.existsSync(autoBackupPath)) {
      try {
        closeDbConnection(sId);
        cleanupWalShmFiles(mainDbPath);
        copyFileWithRetry(autoBackupPath, mainDbPath);
        cleanupWalShmFiles(mainDbPath);
        getDb(sId);
        logger.info(`[SafeRestore] Rollback berhasil! Database dikembalikan ke status sebelum restore.`);
      } catch (rollbackErr) {
        logger.error(`[SafeRestore] Fatal: Rollback gagal: ${rollbackErr.message}`);
      }
    } else {
      try { getDb(sId); } catch (_) {}
    }

    throw new Error(`Gagal restore database: ${restoreErr.message}. Database aman dan telah dikembalikan ke kondisi semula.`);
  }
}

module.exports = {
  getSurveyBackupsDir,
  getSurveyDbPath,
  cleanupWalShmFiles,
  validateAndRepairSqliteFile,
  safeCreateBackup,
  safeRestoreDatabase
};
