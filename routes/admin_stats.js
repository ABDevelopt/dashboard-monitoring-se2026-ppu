const express = require('express');
const router = express.Router();
const { getVisitorStats } = require('../database');

// GET / - Halaman statistik pengunjung
router.get('/', (req, res) => {
  try {
    const stats = getVisitorStats();
    res.render('admin_stats', {
      title: 'Statistik Pengunjung',
      activePage: 'admin-menu',
      stats
    });
  } catch (err) {
    req.flash('error', `Gagal memuat statistik pengunjung: ${err.message}`);
    res.redirect('/admin');
  }
});

module.exports = router;
