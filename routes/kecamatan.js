const express = require('express');
const router = express.Router();
const { getKecamatanStats, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let kecStats = [];
  let desaStats = [];
  const filterKec = req.query.kec || '';

  if (uploadId) {
    kecStats = getKecamatanStats(uploadId);

    if (filterKec) {
      desaStats = getDb().prepare(`
        SELECT 
          m.kecamatan, m.desa,
          COUNT(m.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
          SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.kecamatan = ?
        GROUP BY m.desa
        ORDER BY selesai DESC
      `).all(uploadId, filterKec);
    }
  }

  res.render('kecamatan', {
    title: 'Per Kecamatan',
    activePage: 'kecamatan',
    kecStats,
    desaStats,
    filterKec,
  });
});

module.exports = router;
