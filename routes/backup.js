const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { closeDbConnection, getDb, getSettings } = require('../database');

// Helper to get survey-specific backups folder
function getSurveyBackupsDir(surveyId = 'se2026') {
  const dir = path.join(__dirname, '../data/backups', surveyId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Helper to get main DB path for a survey
function getSurveyDbPath(surveyId = 'se2026') {
  return path.join(__dirname, `../data/${surveyId}.db`);
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const ts = Date.now();
    cb(null, `import_${ts}_${file.originalname}`);
  }
});

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
router.get('/download', (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const dbPath = getSurveyDbPath(activeSurvey);
  if (fs.existsSync(dbPath)) {
    const ts = new Date().toISOString().slice(0, 10);
    res.download(dbPath, `${activeSurvey}_backup_${ts}.db`);
  } else {
    req.flash('error', 'File database tidak ditemukan.');
    res.redirect('/admin/settings/backup');
  }
});

// POST: Trigger Manual Backup
router.post('/create', (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const dbPath = getSurveyDbPath(activeSurvey);
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  
  if (!fs.existsSync(dbPath)) {
    req.flash('error', 'File database tidak ditemukan.');
    return res.redirect('/admin/settings/backup');
  }

  try {
    const ts = Date.now();
    const backupPath = path.join(backupsDir, `${activeSurvey}_backup_${ts}.db`);
    fs.copyFileSync(dbPath, backupPath);
    req.flash('success', 'Backup database berhasil dibuat.');
  } catch (err) {
    req.flash('error', `Gagal membuat backup: ${err.message}`);
  }
  res.redirect('/admin/settings/backup');
});

// POST: Restore from list
router.post('/restore-local', (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  const { filename } = req.body;
  
  if (!filename) {
    req.flash('error', 'Nama file backup tidak valid.');
    return res.redirect('/admin/settings/backup');
  }

  const backupPath = path.join(backupsDir, filename);
  if (!fs.existsSync(backupPath)) {
    req.flash('error', 'File backup tidak ditemukan.');
    return res.redirect('/admin/settings/backup');
  }

  try {
    // 1. Verify file is a valid SQLite DB
    const testDb = new Database(backupPath, { readonly: true });
    testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    testDb.close();

    // 2. Perform safe replacement
    const mainDbPath = getSurveyDbPath(activeSurvey);
    
    // Auto-backup before overwrite
    const autoBackupPath = path.join(backupsDir, `pre_restore_auto_${Date.now()}.db`);
    if (fs.existsSync(mainDbPath)) {
      fs.copyFileSync(mainDbPath, autoBackupPath);
    }

    // Close connection cleanly before copying
    closeDbConnection(activeSurvey);
    fs.copyFileSync(backupPath, mainDbPath);
    
    // Reopen connection and initialize
    getDb(activeSurvey);
    
    // Auto run imputation and rebuild caches
    try {
      const { runAutoImputation } = require('../services/imputerService');
      const { rebuildSummaryCache } = require('../database');
      runAutoImputation(activeSurvey);
      const curDb = getDb(activeSurvey);
      const curUploads = curDb.prepare('SELECT id FROM uploads').all();
      curUploads.forEach(u => rebuildSummaryCache(u.id, activeSurvey));
    } catch (imputeErr) {
      console.error('[Restore-Impute] Failed to auto impute database after restore:', imputeErr);
    }

    req.flash('success', 'Database berhasil di-restore dari file lokal.');
  } catch (err) {
    try { getDb(activeSurvey); } catch (_) {}
    req.flash('error', `Gagal restore database: ${err.message}`);
  }
  res.redirect('/admin/settings/backup');
});

// POST: Delete local backup
router.post('/delete-local', (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  const { filename } = req.body;
  
  if (!filename) {
    req.flash('error', 'Nama file backup tidak valid.');
    return res.redirect('/admin/settings/backup');
  }

  const backupPath = path.join(backupsDir, filename);
  if (fs.existsSync(backupPath)) {
    try {
      fs.unlinkSync(backupPath);
      req.flash('success', 'File backup lokal berhasil dihapus.');
    } catch (err) {
      req.flash('error', `Gagal menghapus file: ${err.message}`);
    }
  } else {
    req.flash('error', 'File backup tidak ditemukan.');
  }
  res.redirect('/admin/settings/backup');
});

// POST: Import DB file (Upload and Restore)
router.post('/restore', upload.single('db_file'), (req, res) => {
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const backupsDir = getSurveyBackupsDir(activeSurvey);
  
  if (!req.file) {
    req.flash('error', 'Silakan pilih file database untuk diunggah.');
    return res.redirect('/admin/settings/backup');
  }

  const tempPath = req.file.path;
  
  try {
    // 1. Verify file is a valid SQLite DB
    const testDb = new Database(tempPath, { readonly: true });
    const settingsTable = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
    testDb.close();

    if (!settingsTable) {
      throw new Error('File tidak valid (tabel settings tidak ditemukan).');
    }

    // 2. Perform safe replacement
    const mainDbPath = getSurveyDbPath(activeSurvey);
    
    // Auto-backup current DB before overwrite
    const autoBackupPath = path.join(backupsDir, `pre_restore_auto_${Date.now()}.db`);
    if (fs.existsSync(mainDbPath)) {
      fs.copyFileSync(mainDbPath, autoBackupPath);
    }

    // Close connection cleanly before copying
    closeDbConnection(activeSurvey);
    
    // Overwrite database file
    fs.copyFileSync(tempPath, mainDbPath);
    
    // Reopen connection and initialize
    getDb(activeSurvey);

    // Auto run imputation and rebuild caches
    try {
      const { runAutoImputation } = require('../services/imputerService');
      const { rebuildSummaryCache } = require('../database');
      runAutoImputation(activeSurvey);
      const curDb = getDb(activeSurvey);
      const curUploads = curDb.prepare('SELECT id FROM uploads').all();
      curUploads.forEach(u => rebuildSummaryCache(u.id, activeSurvey));
    } catch (imputeErr) {
      console.error('[Restore-Upload-Impute] Failed to auto impute database after restore:', imputeErr);
    }

    try { fs.unlinkSync(tempPath); } catch (_) {}
    req.flash('success', 'Database berhasil di-import dan diperbarui secara instan.');
  } catch (err) {
    try { getDb(activeSurvey); } catch (_) {}
    try { fs.unlinkSync(tempPath); } catch (_) {}
    req.flash('error', `Gagal import database: ${err.message}`);
  }

  res.redirect('/admin/settings/backup');
});

module.exports = router;
