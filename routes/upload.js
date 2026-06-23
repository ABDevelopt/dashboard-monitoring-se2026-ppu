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
  res.render('upload', {
    title: 'Upload Data',
    activePage: 'upload',
    uploads,
  });
});

// POST: Process upload
router.post('/', upload.fields([
  { name: 'excelFile', maxCount: 1 },
  { name: 'statusFile', maxCount: 1 }
]), (req, res) => {
  const excelFile = req.files && req.files['excelFile'] ? req.files['excelFile'][0] : null;
  const statusFile = req.files && req.files['statusFile'] ? req.files['statusFile'][0] : null;

  if (!excelFile) {
    req.flash('error', 'File progres tidak ditemukan. Pastikan memilih file Excel Utama.');
    return res.redirect('/admin/upload');
  }

  const tanggal = req.body.tanggal || new Date().toISOString().slice(0, 10);

  try {
    const result = parseAndSaveExcel(
      excelFile.path, 
      excelFile.originalname, 
      excelFile.filename, 
      tanggal,
      statusFile ? statusFile.path : null,
      statusFile ? statusFile.originalname : null,
      statusFile ? statusFile.filename : null
    );

    let msg = `Upload progres berhasil! File: ${excelFile.originalname} | Tanggal: ${tanggal} | SubSLS terproses: ${result.uniqueSubsls}`;
    if (statusFile) {
      msg += ` | File Status FASIH: ${statusFile.originalname} berhasil diproses.`;
    }
    req.flash('success', msg);
    res.redirect('/');
  } catch (err) {
    console.error('Upload error:', err);
    if (excelFile && fs.existsSync(excelFile.path)) {
      try { fs.unlinkSync(excelFile.path); } catch (e) {}
    }
    if (statusFile && fs.existsSync(statusFile.path)) {
      try { fs.unlinkSync(statusFile.path); } catch (e) {}
    }
    req.flash('error', `Gagal memproses file: ${err.message}`);
    res.redirect('/admin/upload');
  }
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

module.exports = router;
