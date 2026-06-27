const express = require('express');
const router = express.Router();
const { getUserByUsername, hashPassword } = require('../database');

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/upload');
    } else {
      return res.redirect('/agent');
    }
  }
  res.render('login', {
    title: 'Login Pengguna',
    activePage: 'login'
  });
});

// POST /login
router.post('/login', (req, res) => {
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password : '';

  if (!username || !password) {
    req.flash('error', 'Username dan password harus diisi.');
    return res.redirect('/login');
  }

  try {
    const user = getUserByUsername(username);
    if (!user) {
      req.flash('error', 'Username atau password salah.');
      return res.redirect('/login');
    }

    const hashedPassword = hashPassword(password);
    if (user.password !== hashedPassword) {
      req.flash('error', 'Username atau password salah.');
      return res.redirect('/login');
    }

    // Set user session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    // Keep backwards compatibility for isAdmin
    if (user.role === 'admin') {
      req.session.isAdmin = true;
      req.flash('success', 'Selamat datang, Administrator!');
      res.redirect('/admin/upload');
    } else {
      req.session.isAdmin = false;
      req.flash('success', `Selamat datang, ${user.username}!`);
      res.redirect('/agent');
    }

  } catch (err) {
    console.error("Login process error:", err);
    req.flash('error', 'Terjadi kesalahan sistem saat proses login.');
    res.redirect('/login');
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout session destroy error:", err);
    }
    res.redirect('/');
  });
});

module.exports = router;
