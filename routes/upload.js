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
router.post('/', upload.single('excelFile'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'File tidak ditemukan. Pastikan memilih file Excel.');
    return res.redirect('/upload');
  }

  const tanggal = req.body.tanggal || new Date().toISOString().slice(0, 10);

  try {
    const result = parseAndSaveExcel(req.file.path, req.file.originalname, tanggal);
    req.flash('success', 
      `Upload berhasil! File: ${req.file.originalname} | Tanggal: ${tanggal} | SubSLS terproses: ${result.uniqueSubsls}`
    );
    res.redirect('/');
  } catch (err) {
    console.error('Upload error:', err);
    req.flash('error', `Gagal memproses file: ${err.message}`);
    res.redirect('/upload');
  }
});

// DELETE: hapus upload
router.post('/delete/:id', (req, res) => {
  const id = parseInt(req.params.id);
  getDb().prepare('DELETE FROM uploads WHERE id = ?').run(id);
  req.flash('success', 'Upload berhasil dihapus.');
  res.redirect('/upload');
});

module.exports = router;
