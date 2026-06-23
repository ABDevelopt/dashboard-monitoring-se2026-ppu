const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { loadMasterFromJson, loadMasterFromExcel } = require('../services/excelParser');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    cb(null, `master_${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.json') cb(null, true);
    else cb(new Error('Hanya file Excel (.xlsx/.xls) atau JSON (.json) yang diperbolehkan.'));
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// GET: Master management dashboard
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const q = req.query.q || '';

  // Calculate master statistics
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_subsls,
      SUM(muatan) as total_muatan,
      COUNT(DISTINCT kecamatan) as total_kec,
      COUNT(DISTINCT kecamatan || '-' || desa) as total_desa,
      COUNT(DISTINCT korlap) as total_korlap,
      COUNT(DISTINCT pml) as total_pml,
      COUNT(DISTINCT pcl) as total_pcl
    FROM subsls_master
  `).get() || { total_subsls: 0, total_muatan: 0, total_kec: 0, total_desa: 0, total_korlap: 0, total_pml: 0, total_pcl: 0 };

  // Query table with search
  let where = 'WHERE 1=1';
  const params = [];
  if (q) {
    where += ' AND (m.kode LIKE ? OR m.nama_sls LIKE ? OR m.kecamatan LIKE ? OR m.desa LIKE ? OR m.pml LIKE ? OR m.pcl LIKE ? OR m.korlap LIKE ?)';
    const searchParam = `%${q}%`;
    params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
  }

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM subsls_master m ${where}
  `).get(...params).n;

  const data = db.prepare(`
    SELECT m.*, 
           (SELECT COUNT(*) FROM progres p WHERE p.kode = m.kode) as has_progress
    FROM subsls_master m
    ${where}
    ORDER BY m.kecamatan, m.desa, m.kode
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const totalPages = Math.ceil(total / limit);

  res.render('master', {
    title: 'Kelola Master Data',
    activePage: 'master',
    stats,
    data,
    total,
    page,
    totalPages,
    limit,
    q
  });
});

// POST: Upload master data file (Excel/JSON)
router.post('/upload', upload.single('masterFile'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'File tidak ditemukan. Silakan pilih file Excel (.xlsx/.xls) or JSON.');
    return res.redirect('/admin/master');
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let count = 0;
    if (ext === '.json') {
      count = loadMasterFromJson(filePath);
    } else {
      count = loadMasterFromExcel(filePath);
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    req.flash('success', `Master data berhasil diupload! File: ${req.file.originalname} | Total record terproses: ${count}`);
    res.redirect('/admin/master');
  } catch (err) {
    console.error('Master upload error:', err);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    req.flash('error', `Gagal mengimpor master data: ${err.message}`);
    res.redirect('/admin/master');
  }
});

// POST: Reset master data to default JSON
router.post('/reset', (req, res) => {
  try {
    const masterPath = path.join(__dirname, '../kelompok_populasi_pml_pcl_korlap_muatan.json');
    if (!fs.existsSync(masterPath)) {
      throw new Error('File master default kelompok_populasi_pml_pcl_korlap_muatan.json tidak ditemukan.');
    }

    const db = getDb();
    db.prepare('DELETE FROM subsls_master').run();
    const count = loadMasterFromJson(masterPath);

    req.flash('success', `Berhasil merestore master data bawaan! Total record terproses: ${count}`);
    res.redirect('/admin/master');
  } catch (err) {
    console.error('Master reset error:', err);
    req.flash('error', `Gagal merestore master data bawaan: ${err.message}`);
    res.redirect('/admin/master');
  }
});

// POST: Add new master SLS
router.post('/add', (req, res) => {
  const { kode, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, target_fasih, kode_2025 } = req.body;

  if (!kode || !kecamatan || !desa) {
    req.flash('error', 'Kode SLS, Kecamatan, dan Desa wajib diisi.');
    return res.redirect('/admin/master');
  }

  const db = getDb();

  // Check if kode already exists
  const existing = db.prepare('SELECT kode FROM subsls_master WHERE kode = ?').get(kode);
  if (existing) {
    req.flash('error', `Gagal menambahkan: Kode SLS ${kode} sudah terdaftar di master data.`);
    return res.redirect('/admin/master');
  }

  const kode_kec = kode.substring(6, 8) || '00';
  const muatanNum = parseInt(muatan) || 0;
  const targetFasihNum = target_fasih !== undefined && target_fasih !== '' ? parseInt(target_fasih) : muatanNum;

  try {
    db.prepare(`
      INSERT INTO subsls_master (kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, target_fasih, kode_2025)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      kode.trim(),
      kode_kec,
      kecamatan.trim(),
      desa.trim(),
      (nama_sls || '').trim(),
      (korlap || '').trim(),
      (pml || '').trim().replace(/\s+/g, ' '),
      (pcl || '').trim().replace(/\s+/g, ' '),
      muatanNum,
      targetFasihNum,
      (kode_2025 || kode).trim()
    );

    req.flash('success', `Berhasil menambahkan SLS baru: ${nama_sls || kode}`);
    res.redirect('/admin/master');
  } catch (err) {
    console.error('Master add error:', err);
    req.flash('error', `Gagal menambahkan SLS baru: ${err.message}`);
    res.redirect('/admin/master');
  }
});

// POST: Edit master SLS
router.post('/edit', (req, res) => {
  const { kode, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, target_fasih, kode_2025 } = req.body;

  if (!kode) {
    req.flash('error', 'Kode SLS tidak valid.');
    return res.redirect('/admin/master');
  }

  const db = getDb();
  const muatanNum = parseInt(muatan) || 0;
  const targetFasihNum = target_fasih !== undefined && target_fasih !== '' ? parseInt(target_fasih) : muatanNum;
  const kode_kec = kode.substring(6, 8) || '00';

  try {
    db.prepare(`
      UPDATE subsls_master 
      SET kecamatan = ?, desa = ?, nama_sls = ?, korlap = ?, pml = ?, pcl = ?, muatan = ?, target_fasih = ?, kode_2025 = ?, kode_kec = ?
      WHERE kode = ?
    `).run(
      kecamatan.trim(),
      desa.trim(),
      (nama_sls || '').trim(),
      (korlap || '').trim(),
      (pml || '').trim().replace(/\s+/g, ' '),
      (pcl || '').trim().replace(/\s+/g, ' '),
      muatanNum,
      targetFasihNum,
      (kode_2025 || kode).trim(),
      kode_kec,
      kode
    );

    req.flash('success', `Berhasil mengupdate SLS master: ${nama_sls || kode}`);
    res.redirect('/admin/master');
  } catch (err) {
    console.error('Master edit error:', err);
    req.flash('error', `Gagal mengupdate SLS master: ${err.message}`);
    res.redirect('/admin/master');
  }
});

// POST: Delete master SLS
router.post('/delete/:kode', (req, res) => {
  const kode = req.params.kode;

  try {
    const db = getDb();
    
    // Check if progress data exists for this SLS
    const hasProgress = db.prepare('SELECT COUNT(*) as n FROM progres WHERE kode = ?').get(kode).n;
    if (hasProgress > 0) {
      req.flash('error', `Gagal menghapus: SLS ${kode} memiliki data progres pencacahan terikat.`);
      return res.redirect('/admin/master');
    }

    db.prepare('DELETE FROM subsls_master WHERE kode = ?').run(kode);
    req.flash('success', `Berhasil menghapus SLS master: ${kode}`);
    res.redirect('/admin/master');
  } catch (err) {
    console.error('Master delete error:', err);
    req.flash('error', `Gagal menghapus SLS: ${err.message}`);
    res.redirect('/admin/master');
  }
});

module.exports = router;
