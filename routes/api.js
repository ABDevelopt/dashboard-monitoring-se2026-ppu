const express = require('express');
const router = express.Router();
const { getTrenHarian, getKecamatanStats, getPclStats, getDb } = require('../database');

// Tren harian (untuk Chart.js)
router.get('/tren', (req, res) => {
  res.json(getTrenHarian());
});

// Stats per kecamatan
router.get('/kecamatan', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.json([]);
  res.json(getKecamatanStats(uploadId));
});

// Search SubSLS
router.get('/search', (req, res) => {
  const q = req.query.q || '';
  const uploadId = res.locals.uploadId;
  if (!q || !uploadId) return res.json([]);

  const results = getDb().prepare(`
    SELECT m.kode, m.kecamatan, m.desa, m.pcl, m.pml, m.korlap,
           CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END AS sudah_diisi
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.kode LIKE ? OR m.desa LIKE ? OR m.pcl LIKE ?
    LIMIT 20
  `).all(uploadId, `%${q}%`, `%${q}%`, `%${q}%`);

  res.json(results);
});

// Summary API
router.get('/summary', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.json(null);

  const { getOverviewSummary } = require('../database');
  res.json(getOverviewSummary(uploadId));
});

module.exports = router;
