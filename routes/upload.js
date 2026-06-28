const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseAndSaveExcel } = require('../services/excelParser');
const { getAllUploads, getDb } = require('../database');

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
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new Error('Hanya file Excel (.xlsx/.xls) yang diperbolehkan.'));
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// GET: Upload page
router.get('/', (req, res) => {
  const uploads = getAllUploads();
  
  // Scan workspace for Excel files
  let workspaceFiles = [];
  const wsDir = path.join(__dirname, '../');
  try {
    const items = fs.readdirSync(wsDir);
    workspaceFiles = items
      .filter(item => {
        const ext = path.extname(item).toLowerCase();
        return (ext === '.xlsx' || ext === '.xls') && !item.startsWith('~');
      })
      .map(item => {
        const stats = fs.statSync(path.join(wsDir, item));
        return {
          filename: item,
          size: stats.size,
          mtime: stats.mtime
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    console.error('Error scanning workspace files:', err);
  }

  res.render('upload', {
    title: 'Upload Data',
    activePage: 'upload',
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

// POST: Process upload
router.post('/', upload.fields([
  { name: 'excelFile', maxCount: 100 },
  { name: 'statusFile', maxCount: 100 }
]), (req, res) => {
  const excelFiles = req.files && req.files['excelFile'] ? req.files['excelFile'] : [];
  const statusFiles = req.files && req.files['statusFile'] ? req.files['statusFile'] : [];

  if (excelFiles.length === 0 && statusFiles.length === 0) {
    req.flash('error', 'Silakan pilih setidaknya satu file Excel untuk diupload.');
    return res.redirect('/admin/upload');
  }

  const defaultTanggal = req.body.tanggal || new Date().toISOString().slice(0, 10);

  // Group files by date
  const groups = {};

  function addToGroup(date, type, file) {
    if (!groups[date]) {
      groups[date] = { excelFile: null, statusFile: null };
    }
    groups[date][type] = file;
  }

  // Process excel files (Utama)
  for (const f of excelFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'excelFile', f);
  }

  // Process status files (FASIH)
  for (const f of statusFiles) {
    const d = extractDateFromFilename(f.originalname) || defaultTanggal;
    addToGroup(d, 'statusFile', f);
  }

  // Sort dates chronologically ascending
  const sortedDates = Object.keys(groups).sort();

  const successMessages = [];
  const errors = [];

  for (const date of sortedDates) {
    const g = groups[date];
    const excelFile = g.excelFile;
    const statusFile = g.statusFile;

    try {
      const result = parseAndSaveExcel(
        excelFile ? excelFile.path : null, 
        excelFile ? excelFile.originalname : (statusFile ? statusFile.originalname : null), 
        excelFile ? excelFile.filename : null, 
        date,
        statusFile ? statusFile.path : null,
        statusFile ? statusFile.originalname : null,
        statusFile ? statusFile.filename : null
      );

      let msg = `Tanggal ${date}: `;
      if (excelFile) msg += `Progres (${excelFile.originalname}) `;
      if (statusFile) msg += `Status FASIH (${statusFile.originalname}) `;
      msg += `berhasil diproses (SubSLS: ${result.uniqueSubsls})`;
      successMessages.push(msg);
    } catch (err) {
      console.error(`Error processing date ${date}:`, err);
      // Clean up uploaded files for this date
      if (excelFile && fs.existsSync(excelFile.path)) {
        try { fs.unlinkSync(excelFile.path); } catch (e) {}
      }
      if (statusFile && fs.existsSync(statusFile.path)) {
        try { fs.unlinkSync(statusFile.path); } catch (e) {}
      }
      errors.push(`Tanggal ${date} gagal: ${err.message}`);
    }
  }

  if (successMessages.length > 0) {
    req.flash('success', `Berhasil memproses ${successMessages.length} upload data:<br>- ${successMessages.join('<br>- ')}`);
  }
  if (errors.length > 0) {
    req.flash('error', `Gagal memproses beberapa file:<br>- ${errors.join('<br>- ')}`);
  }

  res.redirect('/admin/upload');
});

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
  }
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
  req.flash('success', 'Upload berhasil dihapus.');
  res.redirect('/admin/upload');
});

// GET: Download file
router.get('/download/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const uploadRec = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id);
  if (!uploadRec || !uploadRec.stored_filename) {
    req.flash('error', 'File fisik tidak ditemukan.');
    return res.redirect('/admin/upload');
  }

  const filePath = path.join(__dirname, '../uploads', uploadRec.stored_filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, uploadRec.filename);
  } else {
    req.flash('error', 'File fisik tidak ditemukan di server.');
    res.redirect('/admin/upload');
  }
});

// GET: Download status file
router.get('/download-status/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const uploadRec = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id);
  if (!uploadRec || !uploadRec.stored_status_filename) {
    req.flash('error', 'File status tidak ditemukan untuk upload ini.');
    return res.redirect('/admin/upload');
  }

  const filePath = path.join(__dirname, '../uploads', uploadRec.stored_status_filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, uploadRec.status_filename);
  } else {
    req.flash('error', 'File status fisik tidak ditemukan di server.');
    res.redirect('/admin/upload');
  }
});

// POST: Import local workspace file
router.post('/import-local', (req, res) => {
  const { filename, tanggal, type } = req.body;
  if (!filename) {
    req.flash('error', 'Nama file tidak boleh kosong.');
    return res.redirect('/admin/upload');
  }

  const sourcePath = path.join(__dirname, '../', filename);
  if (!fs.existsSync(sourcePath)) {
    req.flash('error', 'File tidak ditemukan di folder workspace.');
    return res.redirect('/admin/upload');
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
      result = parseAndSaveExcel(destPath, filename, storedFilename, tanggal, null, null, null);
    } else {
      result = parseAndSaveExcel(null, null, null, tanggal, destPath, filename, storedFilename);
    }

    req.flash('success', `File local "${filename}" berhasil diimport sebagai ${type === 'excel' ? 'File Progres Utama' : 'File Status FASIH'} untuk tanggal ${tanggal} (SubSLS: ${result.uniqueSubsls})`);
  } catch (err) {
    console.error('Error importing local file:', err);
    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch (e) {}
    }
    req.flash('error', `Gagal memproses file local: ${err.message}`);
  }

  res.redirect('/admin/upload');
});

module.exports = router;
