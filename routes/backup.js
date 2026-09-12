const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, getSettings } = require('../database');
const {
  getSurveyBackupsDir,
  getSurveyDbPath,
  cleanupWalShmFiles,
  safeCreateBackup,
  safeRestoreDatabase
} = require('../services/backupService');

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const ts = Date.now();
    cb(null, `import_${ts}_${file.originalname}`);
  }
});

function getBackupRedirectUrl(res, activeSurvey) {
  const navPrefix = res.locals.navPrefix || (activeSurvey && activeSurvey !== 'se2026' ? '/' + activeSurvey : '');
  return `${navPrefix}/admin/settings/backup`;
}

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') cb(null, true);
    else cb(new Error('Hanya file database SQLite (.db, .sqlite, .sqlite3) yang diperbolehkan.'));
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// GET: Backup & Restore Page
router.get('/', (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  let files = [];
  try {
    files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.db') || f.endsWith('.bak'))
      .map(f => {
        const stats = fs.statSync(path.join(backupsDir, f));
        return {
          filename: f,
          sizeBytes: stats.size,
          createdAt: stats.birthtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.error(err);
  }

  res.render('settings_backup', {
    title: 'Backup & Restore Data',
    activePage: 'settings-backup',
    backups: files,
    settings: getSettings(activeSurvey)
  });
});

// GET: Download Current DB (Export)
router.get('/download', async (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const ts = new Date().toISOString().slice(0, 10);
  const tempDownloadDir = path.join(__dirname, '../uploads');
  const tempDownloadPath = path.join(tempDownloadDir, `export_${activeSurvey}_${Date.now()}.db`);
  
  try {
    const dbConn = getDb(activeSurvey);
    try { dbConn.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    await dbConn.backup(tempDownloadPath);
    cleanupWalShmFiles(tempDownloadPath);
    
    res.download(tempDownloadPath, `${activeSurvey}_backup_${ts}.db`, (err) => {
      try { if (fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath); } catch (_) {}
      cleanupWalShmFiles(tempDownloadPath);
    });
  } catch (err) {
    console.error('[Backup Download Error]', err);
    try { if (fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath); } catch (_) {}
    cleanupWalShmFiles(tempDownloadPath);
    req.flash('error', `Gagal mengunduh file database: ${err.message}`);
    res.redirect(getBackupRedirectUrl(res, activeSurvey));
  }
});

// POST: Trigger Manual Backup
router.post('/create', async (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  try {
    await safeCreateBackup(activeSurvey);
    req.flash('success', 'Backup database berhasil dibuat dan terverifikasi.');
  } catch (err) {
    req.flash('error', `Gagal membuat backup: ${err.message}`);
  }
  res.redirect(getBackupRedirectUrl(res, activeSurvey));
});

// POST: Restore from list
router.post('/restore-local', async (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  const { filename } = req.body;
  
  if (!filename) {
    req.flash('error', 'Nama file backup tidak valid.');
    return res.redirect(getBackupRedirectUrl(res, activeSurvey));
  }

  const backupPath = path.join(backupsDir, filename);
  if (!fs.existsSync(backupPath)) {
    req.flash('error', 'File backup tidak ditemukan.');
    return res.redirect(getBackupRedirectUrl(res, activeSurvey));
  }

  try {
    const result = await safeRestoreDatabase(activeSurvey, backupPath);
    let msg = 'Database berhasil di-restore dari file lokal.';
    if (result.repaired) {
      msg += ` (File backup otomatis diperbaiki dari kerusakan: ${result.method})`;
    }
    req.flash('success', msg);
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect(getBackupRedirectUrl(res, activeSurvey));
});

// POST: Delete local backup
router.post('/delete-local', (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  const { filename } = req.body;
  
  if (!filename) {
    req.flash('error', 'Nama file backup tidak valid.');
    return res.redirect(getBackupRedirectUrl(res, activeSurvey));
  }

  const backupPath = path.join(backupsDir, filename);
  if (fs.existsSync(backupPath)) {
    try {
      fs.unlinkSync(backupPath);
      cleanupWalShmFiles(backupPath);
      req.flash('success', 'File backup lokal berhasil dihapus.');
    } catch (err) {
      req.flash('error', `Gagal menghapus file: ${err.message}`);
    }
  } else {
    req.flash('error', 'File backup tidak ditemukan.');
  }
  res.redirect(getBackupRedirectUrl(res, activeSurvey));
});

// POST: Import DB file (Upload and Restore)
router.post('/restore', upload.single('db_file'), async (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  
  if (!req.file) {
    req.flash('error', 'Silakan pilih file database untuk diunggah.');
    return res.redirect(getBackupRedirectUrl(res, activeSurvey));
  }

  const tempPath = req.file.path;
  
  try {
    const result = await safeRestoreDatabase(activeSurvey, tempPath);
    try { fs.unlinkSync(tempPath); } catch (_) {}
    cleanupWalShmFiles(tempPath);
    let msg = 'Database berhasil di-import dan diperbarui secara instan.';
    if (result.repaired) {
      msg += ` (File yang diunggah otomatis diperbaiki dari kerusakan: ${result.method})`;
    }
    req.flash('success', msg);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    cleanupWalShmFiles(tempPath);
    req.flash('error', err.message);
  }

  res.redirect(getBackupRedirectUrl(res, activeSurvey));
});

// POST: Seed Sakernas Data from Workspace
router.post('/seed-sakernas', async (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  try {
    const { seedAll, seedSurvey, PMU_FILES, PDT_FILES } = require('../scripts/seed_sakernas_from_workspace');
    if (activeSurvey === 'sakernas-pemutakhiran') {
      seedSurvey('sakernas-pemutakhiran', 'alokasi_petugas_sakernas_pemutakhiran.json', PMU_FILES, true);
      req.flash('success', 'Data Sakernas Pemutakhiran berhasil disinkronkan dan di-seed dari workspace.');
    } else if (activeSurvey === 'sakernas-pendataan') {
      seedSurvey('sakernas-pendataan', 'alokasi_petugas_sakernas_pendataan.json', PDT_FILES, true);
      req.flash('success', 'Data Sakernas Pendataan berhasil disinkronkan dan di-seed dari workspace.');
    } else {
      seedAll(true);
      req.flash('success', 'Seluruh data Sakernas (Pemutakhiran & Pendataan) berhasil disinkronkan.');
    }
  } catch (err) {
    console.error('[Seed Sakernas Error]', err);
    req.flash('error', `Gagal sinkronisasi Sakernas: ${err.message}`);
  }

  res.redirect(getBackupRedirectUrl(res, activeSurvey));
});

module.exports = router;
