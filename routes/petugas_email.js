const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const {
  getPetugasEmails,
  searchPetugasEmails,
  getPetugasEmailById,
  insertPetugasEmail,
  updatePetugasEmail,
  deletePetugasEmail,
  resyncPetugasEmailsToMaster
} = require('../database');

// GET /admin/petugas-email - Halaman utama kelola email petugas
router.get('/', (req, res) => {
  const query = req.query.q ? req.query.q.trim() : '';
  const petugasList = searchPetugasEmails(query);
  const totalCount = getPetugasEmails().length;

  res.render('admin_petugas_email', {
    title: 'Pengaturan & Data Email Petugas',
    activePage: 'petugas-email',
    petugasList,
    totalCount,
    query
  });
});

// POST /admin/petugas-email/create - Tambah data email petugas baru
router.post('/create', (req, res) => {
  const nama_lengkap = req.body.nama_lengkap ? req.body.nama_lengkap.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const sobat_id = req.body.sobat_id ? req.body.sobat_id.trim() : '';
  const jenis_kelamin = req.body.jenis_kelamin ? req.body.jenis_kelamin.trim() : 'Pr';

  if (!nama_lengkap || !email) {
    req.flash('error', 'Nama Lengkap dan Email wajib diisi.');
    return res.redirect('/admin/petugas-email');
  }

  // Cek duplikasi email
  const existingEmail = getPetugasEmails().find(p => p.email.toLowerCase() === email);
  if (existingEmail) {
    req.flash('error', `Gagal: Email "${email}" sudah terdaftar untuk petugas ${existingEmail.nama_lengkap}.`);
    return res.redirect('/admin/petugas-email');
  }

  try {
    insertPetugasEmail({ sobat_id, nama_lengkap, email, jenis_kelamin });
    req.flash('success', `Data petugas "${nama_lengkap}" (${email}) berhasil ditambahkan dan disinkronkan.`);
  } catch (err) {
    req.flash('error', `Gagal menambahkan petugas: ${err.message}`);
  }

  res.redirect('/admin/petugas-email');
});

// POST /admin/petugas-email/edit/:id - Edit data email petugas
router.post('/edit/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const nama_lengkap = req.body.nama_lengkap ? req.body.nama_lengkap.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const sobat_id = req.body.sobat_id ? req.body.sobat_id.trim() : '';
  const jenis_kelamin = req.body.jenis_kelamin ? req.body.jenis_kelamin.trim() : '';

  if (!nama_lengkap || !email) {
    req.flash('error', 'Nama Lengkap dan Email tidak boleh kosong.');
    return res.redirect('/admin/petugas-email');
  }

  const existing = getPetugasEmailById(id);
  if (!existing) {
    req.flash('error', 'Data petugas tidak ditemukan.');
    return res.redirect('/admin/petugas-email');
  }

  // Cek duplikasi email dengan ID berbeda
  const allEmails = getPetugasEmails();
  const duplicate = allEmails.find(p => p.email.toLowerCase() === email && p.id !== id);
  if (duplicate) {
    req.flash('error', `Gagal: Email "${email}" sudah digunakan oleh ${duplicate.nama_lengkap}.`);
    return res.redirect('/admin/petugas-email');
  }

  try {
    updatePetugasEmail(id, { sobat_id, nama_lengkap, email, jenis_kelamin });
    req.flash('success', `Data petugas "${nama_lengkap}" berhasil diperbarui.`);
  } catch (err) {
    req.flash('error', `Gagal memperbarui data petugas: ${err.message}`);
  }

  res.redirect('/admin/petugas-email');
});

// POST /admin/petugas-email/delete/:id - Hapus data email petugas
router.post('/delete/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = getPetugasEmailById(id);

  if (!existing) {
    req.flash('error', 'Data petugas tidak ditemukan.');
    return res.redirect('/admin/petugas-email');
  }

  try {
    deletePetugasEmail(id);
    req.flash('success', `Data email petugas "${existing.nama_lengkap}" berhasil dihapus.`);
  } catch (err) {
    req.flash('error', `Gagal menghapus data petugas: ${err.message}`);
  }

  res.redirect('/admin/petugas-email');
});

// POST /admin/petugas-email/resync - Sinkronkan ke Master SubSLS
router.post('/resync', (req, res) => {
  try {
    resyncPetugasEmailsToMaster();
    req.flash('success', 'Berhasil melakukan pengurutan dan pencocokan ulang email petugas ke master data SubSLS.');
  } catch (err) {
    req.flash('error', `Gagal melakukan sinkronisasi: ${err.message}`);
  }
  res.redirect('/admin/petugas-email');
});

// GET /admin/petugas-email/export - Unduh CSV
router.get('/export', (req, res) => {
  const csvPath = path.join(__dirname, '../data/petugas_email.csv');
  if (fs.existsSync(csvPath)) {
    return res.download(csvPath, 'petugas_email.csv');
  } else {
    req.flash('error', 'File CSV belum tersedia.');
    return res.redirect('/admin/petugas-email');
  }
});

module.exports = router;
