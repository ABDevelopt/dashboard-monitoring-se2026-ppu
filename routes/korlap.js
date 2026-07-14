const express = require('express');
const router = express.Router();
const { getKorlapStats, getDb, getSettings, attachProgressPercentages, getTargetFormula } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let korlapStats = [];
  let detailData = [];
  const filterKorlap = req.query.korlap || '';

  if (uploadId) {
    korlapStats = getKorlapStats(uploadId);

    if (filterKorlap) {
      const settings = getSettings();
      const targetFormula = getTargetFormula(settings.target_fasih_mode);

      detailData = attachProgressPercentages(getDb().prepare(`
        SELECT 
          m.pml, m.korlap,
          COUNT(DISTINCT m.pcl) AS jumlah_pcl,
          COUNT(m.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
          SUM(m.muatan) AS total_muatan,
          SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
          SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
          SUM(COALESCE(p.draft, 0)) AS draft_total,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
          SUM(COALESCE(p.approved, 0)) AS approved_total,
          SUM(COALESCE(p.rejected, 0)) AS rejected_total,
          SUM(${targetFormula}) AS target_fasih_total,
          SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
          SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.korlap = ?
        GROUP BY m.pml
        ORDER BY selesai ASC
      `).all(uploadId, filterKorlap));
    }
  }

  const selectedKorlapStats = filterKorlap ? korlapStats.find(k => k.korlap.toUpperCase() === filterKorlap.toUpperCase()) : null;

  res.render('korlap', {
    title: 'Per Korlap',
    activePage: 'korlap',
    korlapStats,
    detailData,
    selectedKorlapStats,
    filterKorlap,
  });
});

module.exports = router;
