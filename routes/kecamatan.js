const express = require('express');
const router = express.Router();
const { getKecamatanStats, getDb, getSettings, attachProgressPercentages, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const surveyId = res.locals.activeSurvey || 'se2026';
  const db = getDb(surveyId);
  let kecStats = [];
  let desaStats = [];
  const filterKec = req.query.kec || '';

  if (uploadId) {
    kecStats = getKecamatanStats(uploadId, res.locals.settings, surveyId);

    if (filterKec) {
      const settings = res.locals.settings;
      const targetFormula = getTargetFormula(settings.target_fasih_mode);
      const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
      const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
      const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
      const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');
      const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END`;

      desaStats = attachProgressPercentages(db.prepare(`
        SELECT 
          m.kecamatan, m.desa,
          COUNT(m.kode) AS total_subsls,
          SUM(${singleSelesaiFormula}) AS selesai,
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
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE UPPER(TRIM(m.kecamatan)) = UPPER(TRIM(?))
        GROUP BY m.desa
        ORDER BY selesai DESC
      `).all(uploadId, filterKec), settings);
    }
  }

  const selectedKecStats = filterKec ? kecStats.find(k => k.kecamatan && k.kecamatan.toUpperCase().trim() === filterKec.toUpperCase().trim()) : null;

  res.render('kecamatan', {
    title: 'Per Kecamatan',
    activePage: 'kecamatan',
    kecStats,
    desaStats,
    selectedKecStats,
    filterKec,
  });
});

module.exports = router;
