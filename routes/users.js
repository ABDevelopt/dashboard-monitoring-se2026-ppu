const express = require('express');
const router = express.Router();
const { getAllUsers, createUser, updateUser, deleteUser, getUserByUsername } = require('../database');

// GET / - Halaman kelola pengguna
router.get('/', (req, res) => {
  res.render('admin_users', {
    title: 'Manajemen Pengguna',
    activePage: 'users',
    users: getAllUsers()
  });
});

// POST /create - Tambah pengguna baru
router.post('/create', (req, res) => {
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password : '';
  const role = req.body.role ? req.body.role : 'user';

  if (!username || !password) {
    req.flash('error', 'Username dan password harus diisi.');
    return res.redirect('/admin/users');
  }

  // Cek username unik
  const existing = getUserByUsername(username);
  if (existing) {
    req.flash('error', `Gagal: Username "${username}" sudah terdaftar. Gunakan username lain.`);
    return res.redirect('/admin/users');
  }

  try {
    createUser(username, password, role);
    req.flash('success', `Pengguna "${username}" berhasil ditambahkan.`);
  } catch (err) {
    req.flash('error', `Gagal menambahkan pengguna: ${err.message}`);
  }

  res.redirect('/admin/users');
});

// POST /edit/:id - Edit pengguna
router.post('/edit/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password : '';
  const role = req.body.role ? req.body.role : 'user';

  if (!username) {
    req.flash('error', 'Username tidak boleh kosong.');
    return res.redirect('/admin/users');
  }

  const allUsers = getAllUsers();
  const userToEdit = allUsers.find(u => u.id === id);

  if (!userToEdit) {
    req.flash('error', 'Pengguna tidak ditemukan.');
    return res.redirect('/admin/users');
  }

  // Cek duplikasi username
  if (username.toLowerCase() !== userToEdit.username.toLowerCase()) {
    const existing = getUserByUsername(username);
    if (existing) {
      req.flash('error', `Gagal: Username "${username}" sudah terdaftar.`);
      return res.redirect('/admin/users');
    }
  }

  // Validasi admin terakhir
  const admins = allUsers.filter(u => u.role === 'admin');
  if (userToEdit.role === 'admin' && role !== 'admin' && admins.length <= 1) {
    req.flash('error', 'Gagal: Tidak dapat mengubah peran admin terakhir menjadi user biasa.');
    return res.redirect('/admin/users');
  }

  try {
    updateUser(id, username, password, role);
    req.flash('success', `Informasi pengguna "${username}" berhasil diperbarui.`);
  } catch (err) {
    req.flash('error', `Gagal memperbarui pengguna: ${err.message}`);
  }

  res.redirect('/admin/users');
});

// POST /delete/:id - Hapus pengguna
router.post('/delete/:id', (req, res) => {
  const id = parseInt(req.params.id);

  // Proteksi hapus diri sendiri (Saran 3)
  if (req.session.user && id === req.session.user.id) {
    req.flash('error', 'Gagal: Anda tidak dapat menghapus akun Anda sendiri yang sedang digunakan.');
    return res.redirect('/admin/users');
  }

  const allUsers = getAllUsers();
  const userToDelete = allUsers.find(u => u.id === id);

  if (!userToDelete) {
    req.flash('error', 'Pengguna tidak ditemukan.');
    return res.redirect('/admin/users');
  }

  // Proteksi admin terakhir (Saran 1)
  const admins = allUsers.filter(u => u.role === 'admin');
  if (userToDelete.role === 'admin' && admins.length <= 1) {
    req.flash('error', 'Gagal: Tidak dapat menghapus admin terakhir pada sistem.');
    return res.redirect('/admin/users');
  }

  try {
    deleteUser(id);
    req.flash('success', `Pengguna "${userToDelete.username}" berhasil dihapus.`);
  } catch (err) {
    req.flash('error', `Gagal menghapus pengguna: ${err.message}`);
  }

  res.redirect('/admin/users');
});

module.exports = router;
