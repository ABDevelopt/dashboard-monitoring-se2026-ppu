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
          SUM(CASE WHEN p.kode IS NOT NULL AND COALESCE(m.target_fasih, 0) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= m.target_fasih THEN 1 ELSE 0 END) AS selesai,
          SUM(m.muatan) AS total_muatan,
          SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
          SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
          SUM(COALESCE(p.draft, 0)) AS draft_total,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
          SUM(COALESCE(p.approved, 0)) AS approved_total,
          SUM(COALESCE(p.rejected, 0)) AS rejected_total,
          SUM(CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 
                   THEN 0 
                   ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) 
              END) AS target_fasih_total,
          CASE WHEN SUM(COALESCE(m.target_fasih, 0)) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(COALESCE(m.target_fasih, 0)), 2) ELSE 0.0 END AS pct
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
