const express = require('express');
const router = express.Router();
const { getKorlapStats, getDb, getSettings, attachProgressPercentages, compareFasihProgress, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula, getSingleSelesaiFormula } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const surveyId = res.locals.activeSurvey || 'se2026';
  const db = getDb(surveyId);
  let korlapStats = [];
  let detailData = [];
  const filterKorlap = req.query.korlap || '';

  const isPartial = req.query.partial === '1' || req.headers['x-partial-drilldown'] === '1';

  // Optimized Fast Path for AJAX Partial Drilldown
  if (isPartial) {
    if (!filterKorlap || !uploadId) {
      return res.render('partials/korlap_detail', {
        layout: false,
        filterKorlap: '',
        selectedKorlapStats: null,
        detailData: [],
      });
    }

    const settings = res.locals.settings;
    const targetFormula = getTargetFormula(settings.target_fasih_mode);
    const singleTargetFormula = targetFormula;
    const singleSelesaiFormula = getSingleSelesaiFormula(singleTargetFormula, 'p');
    const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
    const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
    const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
    const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

    // Query stats only for selected Korlap
    const selectedKorlapStatsRows = attachProgressPercentages(db.prepare(`
      SELECT 
        m.korlap,
        MAX(m.korlap_email) AS email,
        MAX(m.korlap_sobat_id) AS sobat_id,
        COUNT(DISTINCT COALESCE(p.pcl_email, m.pcl_email, m.pcl)) AS jumlah_pcl,
        COUNT(DISTINCT m.pml) AS jumlah_pml,
        COUNT(DISTINCT p.kode) AS total_subsls,
        SUM(${singleSelesaiFormula}) AS selesai,
        SUM(${targetMuatanFormula}) AS total_muatan,
        SUM(${realFormula}) AS muatan_selesai,
        SUM(${usahaTotalFormula}) AS usaha_total,
        SUM(${keluargaTotalFormula}) AS keluarga_total,
        SUM(COALESCE(p.draft, 0)) AS draft_total,
        SUM(CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, (${singleTargetFormula}) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END) AS open_total,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(p.approved, 0)) AS approved_total,
        SUM(COALESCE(p.rejected, 0)) AS rejected_total,
        SUM(${singleTargetFormula}) AS target_fasih_total,
        SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
        SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
        SUM(COALESCE(m.target_honor, 0)) AS target_honor_total
      FROM progres p
      LEFT JOIN subsls_master m ON p.kode = m.kode
      WHERE p.upload_id = ? AND UPPER(TRIM(m.korlap)) = UPPER(TRIM(?))
      GROUP BY m.korlap
    `).all(uploadId, filterKorlap), settings);
    const selectedKorlapStats = selectedKorlapStatsRows[0] || null;

    detailData = attachProgressPercentages(db.prepare(`
      SELECT 
        m.pml, m.korlap,
        COUNT(DISTINCT COALESCE(p.pcl_email, m.pcl_email, m.pcl)) AS jumlah_pcl,
        COUNT(DISTINCT p.kode) AS total_subsls,
        SUM(${getSingleSelesaiFormula(targetFormula, 'p')}) AS selesai,
        SUM(${targetMuatanFormula}) AS total_muatan,
        SUM(${realFormula}) AS muatan_selesai,
        SUM(${usahaTotalFormula}) AS usaha_total,
        SUM(${keluargaTotalFormula}) AS keluarga_total,
        SUM(COALESCE(p.draft, 0)) AS draft_total,
        SUM(CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, (${targetFormula}) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END) AS open_total,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(p.approved, 0)) AS approved_total,
        SUM(COALESCE(p.rejected, 0)) AS rejected_total,
        SUM(${targetFormula}) AS target_fasih_total,
        SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
        SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
      FROM progres p
      LEFT JOIN subsls_master m ON p.kode = m.kode
      WHERE p.upload_id = ? AND UPPER(TRIM(m.korlap)) = UPPER(TRIM(?))
      GROUP BY m.pml
      ORDER BY selesai ASC
    `).all(uploadId, filterKorlap), settings);
    detailData.sort((a, b) => compareFasihProgress(a, b, 'pml'));

    return res.render('partials/korlap_detail', {
      layout: false,
      filterKorlap,
      selectedKorlapStats,
      detailData,
    });
  }

  if (uploadId) {
    korlapStats = getKorlapStats(uploadId, res.locals.settings, surveyId);
    korlapStats.sort((a, b) => compareFasihProgress(a, b, 'korlap'));

    if (filterKorlap) {
      const settings = res.locals.settings;
      const targetFormula = getTargetFormula(settings.target_fasih_mode);
      const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
      const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
      const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
      const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

      detailData = attachProgressPercentages(db.prepare(`
        SELECT 
          m.pml, m.korlap,
          COUNT(DISTINCT COALESCE(p.pcl_email, m.pcl_email, m.pcl)) AS jumlah_pcl,
          COUNT(DISTINCT p.kode) AS total_subsls,
          SUM(${getSingleSelesaiFormula(targetFormula, 'p')}) AS selesai,
          SUM(${targetMuatanFormula}) AS total_muatan,
          SUM(${realFormula}) AS muatan_selesai,
          SUM(${usahaTotalFormula}) AS usaha_total,
          SUM(${keluargaTotalFormula}) AS keluarga_total,
          SUM(COALESCE(p.draft, 0)) AS draft_total,
          SUM(CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, (${targetFormula}) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END) AS open_total,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
          SUM(COALESCE(p.approved, 0)) AS approved_total,
          SUM(COALESCE(p.rejected, 0)) AS rejected_total,
          SUM(${targetFormula}) AS target_fasih_total,
          SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
          SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
        FROM progres p
        LEFT JOIN subsls_master m ON p.kode = m.kode
        WHERE p.upload_id = ? AND UPPER(TRIM(m.korlap)) = UPPER(TRIM(?))
        GROUP BY m.pml
        ORDER BY selesai ASC
      `).all(uploadId, filterKorlap), settings);
      detailData.sort((a, b) => compareFasihProgress(a, b, 'pml'));
    }
  }

  const selectedKorlapStats = filterKorlap ? korlapStats.find(k => k.korlap && k.korlap.toUpperCase().trim() === filterKorlap.toUpperCase().trim()) : null;

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
