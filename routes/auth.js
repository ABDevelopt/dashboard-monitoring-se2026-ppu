const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { 
  getUserByUsername, 
  hashPassword, 
  saveRememberToken, 
  getUserByRememberToken, 
  deleteRememberToken 
} = require('../database');

const cookie = require('cookie');

// Helper to parse cookies from request headers safely
function parseCookies(req) {
  return req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
}

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin');
    } else {
      return res.redirect('/agent');
    }
  }

  const cookies = parseCookies(req);
  let savedAccount = null;

  if (cookies.remember_token && cookies.saved_username) {
    try {
      const user = getUserByRememberToken(cookies.remember_token);
      if (user && user.username === cookies.saved_username) {
        savedAccount = {
          username: user.username,
          role: user.role
        };
      }
    } catch (err) {
      console.error("Error getting saved account for login page:", err);
    }
  }

  res.render('login', {
    title: 'Login Pengguna',
    activePage: 'login',
    savedAccount
  });
});

// POST /login
router.post('/login', (req, res) => {
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password : '';
  const remember = req.body.remember === 'on' || req.body.remember === 'true';

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

    // Remove loggedOut flag from session
    delete req.session.loggedOut;

    // Handle "Remember Me" / "Save Login Info"
    if (remember) {
      const token = crypto.randomBytes(32).toString('hex');
      saveRememberToken(user.id, token);
      
      // Set cookies for 30 days with SameSite Lax
      res.cookie('remember_token', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
      res.cookie('saved_username', user.username, { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    }

    // Keep backwards compatibility for isAdmin
    if (user.role === 'admin') {
      req.session.isAdmin = true;
      req.flash('success', 'Selamat datang, Administrator!');
      res.redirect('/admin');
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

// POST /login/token - One-click login from saved account
router.post('/login/token', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies.remember_token;

  if (!token) {
    req.flash('error', 'Sesi login tersimpan tidak ditemukan.');
    return res.redirect('/login');
  }

  try {
    const user = getUserByRememberToken(token);
    if (!user) {
      req.flash('error', 'Sesi login tersimpan telah kedaluwarsa atau tidak valid.');
      res.clearCookie('remember_token');
      return res.redirect('/login');
    }

    // Set user session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };
    
    // Remove loggedOut flag from session
    delete req.session.loggedOut;

    // Rotate the remember token for security
    const newToken = crypto.randomBytes(32).toString('hex');
    deleteRememberToken(token);
    saveRememberToken(user.id, newToken);
    
    // Update cookies with SameSite Lax
    res.cookie('remember_token', newToken, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
    res.cookie('saved_username', user.username, { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

    if (user.role === 'admin') {
      req.session.isAdmin = true;
      req.flash('success', 'Selamat datang kembali, Administrator!');
      res.redirect('/admin');
    } else {
      req.session.isAdmin = false;
      req.flash('success', `Selamat datang kembali, ${user.username}!`);
      res.redirect('/agent');
    }
  } catch (err) {
    console.error("Token login error:", err);
    req.flash('error', 'Terjadi kesalahan sistem saat memproses login otomatis.');
    res.redirect('/login');
  }
});

// GET /login/clear-saved - Delete saved info and show normal login form
router.get('/login/clear-saved', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.remember_token) {
    try {
      deleteRememberToken(cookies.remember_token);
    } catch (err) {
      console.error("Error clearing remember token:", err);
    }
  }
  res.clearCookie('remember_token');
  res.clearCookie('saved_username');
  req.flash('success', 'Informasi login tersimpan berhasil dihapus.');
  res.redirect('/login');
});

// GET /logout
router.get('/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.remember_token) {
    try {
      deleteRememberToken(cookies.remember_token);
    } catch (err) {
      console.error("Error deleting token on logout:", err);
    }
  }
  
  res.clearCookie('remember_token');
  
  // Set session flag so they don't get auto-logged in again immediately
  req.session.loggedOut = true;

  req.session.destroy((err) => {
    if (err) {
      console.error("Logout session destroy error:", err);
    }
    res.redirect('/login'); // Redirect to login page instead of root
  });
});

module.exports = router;
