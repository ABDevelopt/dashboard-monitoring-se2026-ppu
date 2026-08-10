const express = require('express');
const router = express.Router();
const { getKorlapStats, getDb, getSettings, attachProgressPercentages, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula } = require('../database');

router.get('/', (req, res) => {
const uploadId = res.locals.uploadId;
  let korlapStats = [];
  let detailData = [];
  const filterKorlap = req.query.korlap || '';

  if (uploadId) {
    korlapStats = getKorlapStats(uploadId, res.locals.settings);

    if (filterKorlap) {
      const settings = res.locals.settings;
      const targetFormula = getTargetFormula(settings.target_fasih_mode);
      const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
      const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
      const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
      const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

      detailData = attachProgressPercentages(getDb().prepare(`
        SELECT 
          m.pml, m.korlap,
          COUNT(DISTINCT COALESCE(p.pcl_email, m.pcl_email, m.pcl)) AS jumlah_pcl,
          COUNT(DISTINCT p.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
          SUM(${targetMuatanFormula}) AS total_muatan,
          SUM(${realFormula}) AS muatan_selesai,
          SUM(${usahaTotalFormula}) AS usaha_total,
          SUM(${keluargaTotalFormula}) AS keluarga_total,
          SUM(COALESCE(p.draft, 0)) AS draft_total,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
          SUM(COALESCE(p.approved, 0)) AS approved_total,
          SUM(COALESCE(p.rejected, 0)) AS rejected_total,
          SUM(${targetFormula}) AS target_fasih_total,
          SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
          SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
        FROM progres p
        LEFT JOIN subsls_master m ON p.kode = m.kode
        WHERE p.upload_id = ? AND m.korlap = ?
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
