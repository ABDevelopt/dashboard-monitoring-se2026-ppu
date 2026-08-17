const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseAndSaveExcel, parseAndSaveSeparateExports, parseAndSaveStatusExcelOnly, parseAndSaveJsonStatusOnly } = require('../services/excelParser');
const { getAllUploads, getDb, getSettings, rebuildAllSummaryCaches } = require('../database');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const ts = Date.now();
    cb(null, `${ts}_${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || ext === '.json') cb(null, true);
    else cb(new Error('Hanya file Excel (.xlsx/.xls), CSV (.csv), atau JSON (.json) yang diperbolehkan.'));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// GET: Upload page redirect
router.get('/', (req, res) => {
  res.redirect(`${req.baseUrl || '/admin/upload'}/muatan`);
});

// Helper to scan files in workspace
function scanWorkspace(activeSurvey) {
  let workspaceFiles = [];
  try {
    const scanDir = (dir, prefix = '') => {
      if (!fs.existsSync(dir)) return [];
      const items = fs.readdirSync(dir);
      return items
        .filter(item => {
          const ext = path.extname(item).toLowerCase();
          return (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || ext === '.json') && !item.startsWith('~');
        })
        .map(item => {
          const fullPath = path.join(dir, item);
          const stats = fs.statSync(fullPath);
          return {
            filename: prefix ? `${prefix}/${item}` : item,
            size: stats.size,
            mtime: stats.mtime
          };
        });
    };

    if (activeSurvey === 'se2026') {
      const wsDir = path.join(__dirname, '../');
      const muatanDir = path.join(__dirname, '../file_upload_muatan');
      const rootFiles = scanDir(wsDir);
      const folderFiles = scanDir(muatanDir, 'file_upload_muatan');
      workspaceFiles = [...folderFiles, ...rootFiles].sort((a, b) => b.mtime - a.mtime);
    } else {
      const surveyDir = path.join(__dirname, '../file_upload_workspace', activeSurvey);
      if (!fs.existsSync(surveyDir)) {
        fs.mkdirSync(surveyDir, { recursive: true });
      }
      workspaceFiles = scanDir(surveyDir).sort((a, b) => b.mtime - a.mtime);
    }
  } catch (err) {
    console.error('Error scanning workspace files:', err);
  }
  return workspaceFiles;
}

// GET: Upload Progres Muatan
router.get('/muatan', (req, res) => {
  const allUploads = getAllUploads().sort((a, b) => (b.id - a.id) || b.tanggal.localeCompare(a.tanggal));
  const uploads = allUploads.filter(u => u.filename && u.filename.length > 0);
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const workspaceFiles = scanWorkspace(activeSurvey);

  res.render('upload', {
    title: 'Upload Progres Muatan',
    activePage: 'upload-muatan',
    uploadType: 'muatan',
    uploads,
    workspaceFiles
  });
});

// GET: Upload Status FASIH
router.get('/fasih', (req, res) => {
  const allUploads = getAllUploads().sort((a, b) => (b.id - a.id) || b.tanggal.localeCompare(a.tanggal));
  const uploads = allUploads.filter(u => u.status_filename && !u.status_filename.toLowerCase().includes('monitoring_sls'));
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const workspaceFiles = scanWorkspace(activeSurvey);

  res.render('upload', {
    title: 'Upload Status FASIH',
    activePage: 'upload-fasih',
    uploadType: 'fasih',
    uploads,
    workspaceFiles
  });
});

// GET: Upload Status SLS Selesai
router.get('/sls', (req, res) => {
  const allUploads = getAllUploads().sort((a, b) => (b.id - a.id) || b.tanggal.localeCompare(a.tanggal));
  const uploads = allUploads.filter(u => u.status_filename && u.status_filename.toLowerCase().includes('monitoring_sls'));
  const activeSurvey = res.locals.activeSurvey || 'se2026';
  const workspaceFiles = scanWorkspace(activeSurvey);

  res.render('upload', {
    title: 'Upload Status SLS Selesai',
    activePage: 'upload-sls',
    uploadType: 'sls',
    uploads,
    workspaceFiles
  });
});

function extractDateFromFilename(filename) {
  if (!filename) return null;
  const name = filename.toLowerCase();

  // Pattern 1: YYYY-MM-DD
  const ymd = name.match(/(?<!\d)(20\d{2})[-/._](0[1-9]|1[0-2])[-/._](0[1-9]|[12]\d|3[01])(?!\d)/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }

  // Pattern 2: DD-MM-YYYY
  const dmy = name.match(/(?<!\d)(0[1-9]|[12]\d|3[01])[-/._](0[1-9]|1[0-2])[-/._](20\d{2})(?!\d)/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }

  // Pattern 3: Textual Month (e.g. "19 juni" or "19 juni 2026")
  const months = {
    jan: '01', januari: '01', january: '01',
    feb: '02', februari: '02', february: '02',
    mar: '03', maret: '03', march: '03',
    apr: '04', april: '04',
    mei: '05', may: '05',
    jun: '06', juni: '06', june: '06',
    jul: '07', juli: '07', july: '07',
    agu: '08', agustus: '08', august: '08',
    sep: '09', september: '09',
    okt: '10', oktober: '10', october: '10',
    nov: '11', november: '11',
    des: '12', desember: '12', december: '12'
  };

  const monthKeys = Object.keys(months).sort((a,b) => b.length - a.length);
  const monthRegex = monthKeys.join('|');
  const txtDatePattern = new RegExp(`(?<!\\d)(0?[1-9]|[12]\\d|3[01])[-_\\s]+(${monthRegex})([-_\\s]+(20\\d{2}))?(?!\\d)`, 'i');
  const txtMatch = name.match(txtDatePattern);
  if (txtMatch) {
    const day = txtMatch[1].padStart(2, '0');
    const month = months[txtMatch[2].toLowerCase()];
    const year = txtMatch[4] || new Date().getFullYear().toString();
    return `${year}-${month}-${day}`;
  }

  return null;
}

// Shared helper for processing uploads
async function handleUploadPost(req, res) {
  const excelFiles = req.files && req.files['excelFile'] ? req.files['excelFile'] : [];
  const keluargaFiles = req.files && req.files['keluargaFile'] ? req.files['keluargaFile'] : [];
  const usahaFiles = req.files && req.files['usahaFile'] ? req.files['usahaFile'] : [];
  const statusFiles = req.files && req.files['statusFile'] ? req.files['statusFile'] : [];
  const slsFiles = req.files && req.files['slsFile'] ? req.files['slsFile'] : [];

  if (excelFiles.length === 0 && keluargaFiles.length === 0 && usahaFiles.length === 0 && statusFiles.length === 0 && slsFiles.length === 0) {
    req.flash('error', 'Silakan pilih setidaknya satu file untuk diupload.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  // Prepend monitoring_sls_ prefix to SLS status filename to keep database records properly grouped/identified
  for (const f of slsFiles) {
    if (!f.originalname.toLowerCase().includes('monitoring_sls')) {
      f.originalname = 'monitoring_sls_' + f.originalname;
    }
  }

  const defaultTanggal = req.body.tanggal || new Date().toISOString().slice(0, 10);

  // Group files by date
  const groups = {};

  function addToGroup(date, type, file) {
    if (!groups[date]) {
      groups[date] = { excelFile: null, keluargaFile: null, usahaFile: null, statusFile: null, slsFile: null };
    }
    groups[date][type] = file;
  }

  // Process excel files (Utama)
  for (const f of excelFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'excelFile', f);
  }

  // Process keluarga files
  for (const f of keluargaFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'keluargaFile', f);
  }

  // Process usaha files
  for (const f of usahaFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'usahaFile', f);
  }

  // Process status files (FASIH)
  for (const f of statusFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'statusFile', f);
  }

  // Process SLS files
  for (const f of slsFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'slsFile', f);
  }

  // Sort dates chronologically ascending
  const sortedDates = Object.keys(groups).sort();
  const successMessages = [];
  const errors = [];

  for (const date of sortedDates) {
    const g = groups[date];
    const excelFile = g.excelFile;
    const keluargaFile = g.keluargaFile;
    const usahaFile = g.usahaFile;
    const statusFile = g.statusFile;
    const slsFile = g.slsFile;

    try {
      let result;
      let msg = `Tanggal ${date}: `;

      if (keluargaFile || usahaFile) {
        result = parseAndSaveSeparateExports(
          keluargaFile ? keluargaFile.path : null,
          usahaFile ? usahaFile.path : null,
          keluargaFile ? keluargaFile.originalname : null,
          usahaFile ? usahaFile.originalname : null,
          date,
          statusFile ? statusFile.path : (slsFile ? slsFile.path : null),
          statusFile ? statusFile.originalname : (slsFile ? slsFile.originalname : null),
          statusFile ? statusFile.filename : (slsFile ? slsFile.filename : null)
        );
        if (keluargaFile) msg += `Keluarga (${keluargaFile.originalname}) `;
        if (usahaFile) msg += `Usaha (${usahaFile.originalname}) `;
        if (slsFile && !statusFile) msg += `Status SLS (${slsFile.originalname}) `;
      } else if (excelFile) {
        if (excelFile.originalname.toLowerCase().endsWith('.json')) {
          result = parseAndSaveJsonStatusOnly(
            excelFile.path, 
            excelFile.originalname, 
            excelFile.filename, 
            date,
            res.locals.activeSurvey || 'se2026'
          );
          msg += `Rekap Status JSON (${excelFile.originalname}) `;
        } else {
          result = parseAndSaveExcel(
            excelFile.path, 
            excelFile.originalname, 
            excelFile.filename, 
            date,
            statusFile ? statusFile.path : (slsFile ? slsFile.path : null),
            statusFile ? statusFile.originalname : (slsFile ? slsFile.originalname : null),
            statusFile ? statusFile.filename : (slsFile ? slsFile.filename : null)
          );
          msg += `Progres (${excelFile.originalname}) `;
          if (slsFile && !statusFile) msg += `Status SLS (${slsFile.originalname}) `;
        }
      } else if (statusFile) {
        if (statusFile.originalname.toLowerCase().endsWith('.json')) {
          result = parseAndSaveJsonStatusOnly(
            statusFile.path,
            statusFile.originalname,
            statusFile.filename,
            date,
            res.locals.activeSurvey || 'se2026'
          );
          msg += `Rekap Status JSON (${statusFile.originalname}) `;
        } else {
          result = parseAndSaveStatusExcelOnly(
            statusFile.path,
            statusFile.originalname,
            statusFile.filename,
            date,
            res.locals.activeSurvey
          );
          msg += `Status FASIH (${statusFile.originalname}) `;
        }
      } else if (slsFile) {
        result = parseAndSaveStatusExcelOnly(
          slsFile.path,
          slsFile.originalname,
          slsFile.filename,
          date,
          res.locals.activeSurvey
        );
        msg += `Status SLS Selesai (${slsFile.originalname}) `;
      }
      msg += `berhasil diproses (SubSLS: ${result ? result.uniqueSubsls : 0})`;
      successMessages.push(msg);

      // Kirim Notifikasi WhatsApp jika diaktifkan
      if (result && result.uploadId) {
        try {
          const whatsappService = require('../services/whatsappService');
          const waRes = await whatsappService.sendUpdateNotification(result.uploadId);
          if (waRes && waRes.success) {
            successMessages.push(`📱 <strong>Notifikasi WhatsApp:</strong> Berhasil dikirim ke grup <em>${waRes.groupName || 'WhatsApp'}</em>.`);
          } else if (waRes && waRes.error) {
            errors.push(`⚠️ <strong>Notifikasi WhatsApp Gagal:</strong> ${waRes.error}`);
          }
        } catch (waErr) {
          console.error('Gagal mengirim notifikasi WhatsApp:', waErr);
          errors.push(`⚠️ <strong>Notifikasi WhatsApp Gagal:</strong> ${waErr.message}`);
        }
      }
    } catch (err) {
      console.error(`Error processing date ${date}:`, err);
      // Clean up uploaded files for this date
      if (excelFile && fs.existsSync(excelFile.path)) {
        try { fs.unlinkSync(excelFile.path); } catch (e) {}
      }
      if (keluargaFile && fs.existsSync(keluargaFile.path)) {
        try { fs.unlinkSync(keluargaFile.path); } catch (e) {}
      }
      if (usahaFile && fs.existsSync(usahaFile.path)) {
        try { fs.unlinkSync(usahaFile.path); } catch (e) {}
      }
      if (statusFile && fs.existsSync(statusFile.path)) {
        try { fs.unlinkSync(statusFile.path); } catch (e) {}
      }
      if (slsFile && fs.existsSync(slsFile.path)) {
        try { fs.unlinkSync(slsFile.path); } catch (e) {}
      }
      errors.push(`Tanggal ${date} gagal: ${err.message}`);
    }
  }

  if (successMessages.length > 0) {
    req.flash('success', `Berhasil memproses ${successMessages.length} item:<br>- ${successMessages.join('<br>- ')}`);
  }
  if (errors.length > 0) {
    req.flash('error', `Pemberitahuan:<br>- ${errors.join('<br>- ')}`);
  }

  res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
}

// POST Redirects and Specific Fields uploads
router.post('/', (req, res) => res.redirect(`${req.baseUrl || '/admin/upload'}/muatan`));

router.post('/muatan', upload.fields([
  { name: 'keluargaFile', maxCount: 100 },
  { name: 'usahaFile', maxCount: 100 }
]), async (req, res) => handleUploadPost(req, res));

router.post('/fasih', upload.fields([
  { name: 'statusFile', maxCount: 100 }
]), async (req, res) => handleUploadPost(req, res));

router.post('/sls', upload.fields([
  { name: 'slsFile', maxCount: 100 }
]), async (req, res) => handleUploadPost(req, res));

// DELETE: hapus upload
router.post('/delete/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const db = getDb();
  const uploadRec = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
  if (uploadRec) {
    const excelPath = path.join(__dirname, '../uploads', uploadRec.stored_filename || '');
    const statusPath = path.join(__dirname, '../uploads', uploadRec.stored_status_filename || '');
    if (uploadRec.stored_filename && fs.existsSync(excelPath)) {
      try { fs.unlinkSync(excelPath); } catch (e) {}
    }
    if (uploadRec.stored_status_filename && fs.existsSync(statusPath)) {
      try { fs.unlinkSync(statusPath); } catch (e) {}
    }

    // 1. Transaksi pembersihan total seluruh data terkait upload & imputasi otomatis sintetis
    db.transaction(() => {
      db.prepare('DELETE FROM progres WHERE upload_id = ?').run(id);
      db.prepare('DELETE FROM summary_cache WHERE upload_id = ?').run(id);
      db.prepare('DELETE FROM uploads WHERE id = ?').run(id);

      // Bersihkan SEMUA record 'Imputasi Otomatis' sintetis lama agar statistik rebuild secara segar
      const autoImputedRows = db.prepare("SELECT id FROM uploads WHERE filename LIKE '%Imputasi Otomatis%' OR filename LIKE '%Imputasi%'").all();
      if (autoImputedRows.length > 0) {
        const autoIds = autoImputedRows.map(r => r.id);
        const placeholders = autoIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM progres WHERE upload_id IN (${placeholders})`).run(...autoIds);
        db.prepare(`DELETE FROM summary_cache WHERE upload_id IN (${placeholders})`).run(...autoIds);
        db.prepare(`DELETE FROM uploads WHERE id IN (${placeholders})`).run(...autoIds);
      }
    })();

    // 2. Jalankan ulang auto-imputation dan rebuild summary cache untuk mengembalikan data ke file terakhir yang tersisa
    try {
      const { runAutoImputation } = require('../services/imputerService');
      const surveysConfig = require('../config/surveys.json');
      for (const sKey of Object.keys(surveysConfig)) {
        runAutoImputation(sKey);
      }
      rebuildAllSummaryCaches();
    } catch (err) {
      console.error("Error rebuilding summary caches after delete:", err);
    }
  }

  req.flash('success', 'Upload berhasil dihapus. Semua data dan statistik telah otomatis dikembalikan ke file terakhir yang tersisa.');
  res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
});

// GET: Download file
router.get('/download/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const uploadRec = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id);
  if (!uploadRec || !uploadRec.stored_filename) {
    req.flash('error', 'File fisik tidak ditemukan.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  const filePath = path.join(__dirname, '../uploads', uploadRec.stored_filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, uploadRec.filename);
  } else {
    req.flash('error', 'File fisik tidak ditemukan di server.');
    res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }
});

// GET: Download status file
router.get('/download-status/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const uploadRec = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id);
  if (!uploadRec || !uploadRec.stored_status_filename) {
    req.flash('error', 'File status tidak ditemukan untuk upload ini.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  const filePath = path.join(__dirname, '../uploads', uploadRec.stored_status_filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, uploadRec.status_filename);
  } else {
    req.flash('error', 'File status fisik tidak ditemukan di server.');
    res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }
});

// POST: Import local workspace file
router.post('/import-local', async (req, res) => {
  const { filename, tanggal, type } = req.body;
  if (!filename) {
    req.flash('error', 'Nama file tidak boleh kosong.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  const activeSurvey = res.locals.activeSurvey || 'se2026';
  let sourcePath = path.join(__dirname, '../', filename);
  if (activeSurvey !== 'se2026') {
    sourcePath = path.join(__dirname, '../file_upload_workspace', activeSurvey, filename);
  }
  if (!fs.existsSync(sourcePath)) {
    req.flash('error', 'File tidak ditemukan di folder workspace.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  // Generate stored filename to persist in uploads folder
  const ts = Date.now();
  const storedFilename = `${ts}_${filename}`;
  const destDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const destPath = path.join(destDir, storedFilename);

  try {
    // Copy the file to persist it
    fs.copyFileSync(sourcePath, destPath);

    // Process the copied file
    let result;
    if (type === 'excel') {
      const nameLower = filename.toLowerCase();
      if (nameLower.includes('keluarga')) {
        result = parseAndSaveSeparateExports(destPath, null, filename, null, tanggal, null, null, null);
      } else if (nameLower.includes('pendataan') || nameLower.includes('usaha') || nameLower.includes('bku')) {
        result = parseAndSaveSeparateExports(null, destPath, null, filename, tanggal, null, null, null);
      } else {
        result = parseAndSaveExcel(destPath, filename, storedFilename, tanggal, null, null, null);
      }
    } else {
      result = parseAndSaveExcel(null, null, null, tanggal, destPath, filename, storedFilename);
    }

    let waSuccessMsg = '';
    let waErrorMsg = '';

    // Kirim Notifikasi WhatsApp jika diaktifkan
    if (result && result.uploadId) {
      try {
        const whatsappService = require('../services/whatsappService');
        const waRes = await whatsappService.sendUpdateNotification(result.uploadId);
        if (waRes && waRes.success) {
          waSuccessMsg = `<br>📱 <strong>Notifikasi WhatsApp:</strong> Berhasil dikirim ke grup <em>${waRes.groupName || 'WhatsApp'}</em>.`;
        } else if (waRes && waRes.error) {
          waErrorMsg = `<br>⚠️ <strong>Notifikasi WhatsApp Gagal:</strong> ${waRes.error}`;
        }
      } catch (waErr) {
        console.error('Gagal mengirim notifikasi WhatsApp:', waErr);
        waErrorMsg = `<br>⚠️ <strong>Notifikasi WhatsApp Gagal:</strong> ${waErr.message}`;
      }
    }

    req.flash('success', `File local "${filename}" berhasil diimport sebagai ${type === 'excel' ? 'File Progres Utama' : 'File Status FASIH'} untuk tanggal ${tanggal} (SubSLS: ${result.uniqueSubsls}).${waSuccessMsg}`);
    if (waErrorMsg) {
      req.flash('error', `Pemberitahuan:${waErrorMsg}`);
    }
  } catch (err) {
    console.error('Error importing local file:', err);
    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch (e) {}
    }
    req.flash('error', `Gagal memproses file local: ${err.message}`);
  }

  res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
});

// POST: Process upload target honor
router.post('/honor', upload.single('honorFile'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'Silakan pilih file Excel target honor untuk diupload.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  const tempPath = req.file.path;
  const db = getDb();

  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(tempPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const excelRows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (excelRows.length === 0) {
      throw new Error('File Excel kosong atau tidak valid.');
    }

    const headers = excelRows[0];
    const codeIdx = headers.indexOf('idsubsls_25_2');
    const keluargaIdx = headers.indexOf('keluarga');
    const utpIdx = headers.indexOf('jml_utp_subsektor');
    const sbrIdx = headers.indexOf('Total_usaha_SBR');

    if (codeIdx === -1 || keluargaIdx === -1 || utpIdx === -1 || sbrIdx === -1) {
      throw new Error('Format kolom Excel tidak sesuai. Pastikan memiliki kolom idsubsls_25_2, keluarga, jml_utp_subsektor, dan Total_usaha_SBR.');
    }

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

    // Copy to the root folder so that it replaces the master copy
    const targetRootPath = path.join(__dirname, '../muatan_sls_pembayaran_honor.xlsx');
    fs.copyFileSync(tempPath, targetRootPath);

    // Sync settings & rebuild caches
    const settings = getSettings();
    if (settings.target_muatan_mode === 'honor') {
      db.transaction(() => {
        db.prepare('UPDATE subsls_master SET muatan = COALESCE(target_honor, 0)').run();
      })();
    }

    // Always rebuild cache to ensure consistency of percentages/numbers
    rebuildAllSummaryCaches();

    req.flash('success', `Berhasil memproses target honor untuk ${updatedCount} records dari Excel.`);
  } catch (err) {
    console.error('Error uploading honor file:', err);
    req.flash('error', `Gagal memproses file target honor: ${err.message}`);
  } finally {
    // Delete temp upload file to keep directory clean
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
  }

  res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
});

// POST: Process Google Spreadsheet URL sync
router.post('/google-sheets', async (req, res) => {
  const { sheetUrl, date, dataType } = req.body;
  if (!sheetUrl || !sheetUrl.trim()) {
    req.flash('error', 'URL Google Spreadsheet tidak boleh kosong.');
    return res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
  }

  const targetDate = date || new Date().toISOString().slice(0, 10);
  
  // Convert URL to CSV export link
  let downloadUrl = sheetUrl.trim();
  if (downloadUrl.includes('/pubhtml')) {
    downloadUrl = downloadUrl.replace(/\/pubhtml(\?.*)?$/, '/pub?output=csv');
  } else if (downloadUrl.includes('/pub') && !downloadUrl.includes('output=csv')) {
    const baseUrl = downloadUrl.split('?')[0];
    downloadUrl = `${baseUrl}?output=csv`;
  } else if (downloadUrl.includes('/edit')) {
    const dMatch = downloadUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (dMatch) {
      const docId = dMatch[1];
      const gidMatch = downloadUrl.match(/gid=([0-9]+)/);
      const gid = gidMatch ? `&gid=${gidMatch[1]}` : '';
      downloadUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv${gid}`;
    }
  }

  const ts = Date.now();
  const tempPath = path.join(__dirname, `../uploads/gsheet_${ts}.csv`);
  const filename = `GoogleSheet_${targetDate}.csv`;

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    const csvBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempPath, Buffer.from(csvBuffer));

    let result;
    if (dataType === 'status') {
      result = parseAndSaveStatusExcelOnly(tempPath, filename, null, targetDate, res.locals.activeSurvey);
    } else if (dataType === 'keluarga') {
      result = parseAndSaveSeparateExports(tempPath, null, filename, null, targetDate);
    } else if (dataType === 'usaha') {
      result = parseAndSaveSeparateExports(null, tempPath, null, filename, targetDate);
    } else {
      // Default: excel (rekap utama)
      result = parseAndSaveExcel(tempPath, filename, filename, targetDate);
    }

    rebuildAllSummaryCaches();
    req.flash('success', `Berhasil mengimpor & menyinkronkan data dari Google Spreadsheet untuk tanggal ${targetDate}!`);
  } catch (err) {
    console.error('Error syncing Google Spreadsheet:', err);
    req.flash('error', `Gagal mengimpor dari Google Spreadsheet: ${err.message}`);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
  }

  res.redirect(req.header('Referer') || `${req.baseUrl || '/admin/upload'}/muatan`);
});

module.exports = router;
