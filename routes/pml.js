const express = require('express');
const router = express.Router();
const { getPmlStats, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let pmlStats = [];
  let detailPcl = [];
  const filterPml = req.query.pml || '';

  if (uploadId) {
    pmlStats = getPmlStats(uploadId);

    if (filterPml) {
      detailPcl = getDb().prepare(`
        SELECT 
          m.pcl, m.pml, m.korlap, m.kecamatan,
          COUNT(m.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END) AS selesai,
          SUM(m.muatan) AS total_muatan,
          SUM(CASE WHEN p.kode IS NOT NULL AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
          SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
          CASE WHEN SUM(m.muatan) > 0 THEN ROUND(100.0 * SUM(CASE WHEN p.kode IS NOT NULL AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) / SUM(m.muatan), 1) ELSE 0.0 END AS pct
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.pml = ?
        GROUP BY m.pcl, m.kecamatan
        ORDER BY selesai ASC
      `).all(uploadId, filterPml);
    }
  }

  res.render('pml', {
    title: 'Per PML',
    activePage: 'pml',
    pmlStats,
    detailPcl,
    filterPml,
  });
});

module.exports = router;
