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

// Map Statistics API
router.get('/map-stats', (req, res) => {
  const uploadId = res.locals.uploadId || -1;

  const db = getDb();
  
  const desaStats = db.prepare(`
    SELECT 
      SUBSTR(m.kode, 1, 10) AS iddesa,
      m.kecamatan, m.desa,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(CASE WHEN p.kode IS NOT NULL THEN m.muatan ELSE 0 END) AS muatan_selesai,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.kecamatan, m.desa
  `).all(uploadId);

  const slsStats = db.prepare(`
    SELECT 
      m.kode,
      m.nama_sls,
      m.desa,
      m.kecamatan,
      m.korlap,
      m.pml,
      m.pcl,
      m.muatan,
      CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END AS selesai,
      COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
      COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `).all(uploadId);

  res.json({ desaStats, slsStats });
});

module.exports = router;
