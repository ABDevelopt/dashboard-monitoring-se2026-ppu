const express = require('express');
const router = express.Router();
const { getLatestUpload, getOverviewSummary, getSettings } = require('../database');
const { getSurveysConfig } = require('../services/surveyRegistry');

// GET /surveys - Portal Induk Menu Utama Pananyo Taka & Katalog Dasbor Survei/Sensus
router.get('/', (req, res) => {
  const surveysConfig = getSurveysConfig();
  const surveysList = [];
  let totalRealisasiAll = 0;
  let totalTargetAll = 0;
  let totalActiveSurveys = 0;

  for (const [key, cfg] of Object.entries(surveysConfig)) {
    let summary = null;
    let latestUpload = null;
    try {
      latestUpload = getLatestUpload(key);
      if (latestUpload) {
        const settings = getSettings(key);
        summary = getOverviewSummary(latestUpload.id, settings, key);
      }
    } catch (err) {
      console.error(`Error calculating summary for ${key}:`, err.message);
    }

    // Hitung realisasi & target dari data upload nyata.
    // Jika belum ada data upload, tampilkan 0 (bukan angka palsu/demo).
    const realisasi = summary
      ? ((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0))
      : 0;
    const target = summary ? (summary.target_fasih_total || 0) : 0;
    const persen = target > 0 ? parseFloat(((realisasi / target) * 100).toFixed(1)) : 0;

    if (latestUpload || realisasi > 0) {
      totalActiveSurveys++;
      totalRealisasiAll += realisasi;
      totalTargetAll += target;
    }

    surveysList.push({
      id: key,
      name: cfg.name,
      shortName: cfg.shortName,
      tagline: cfg.tagline,
      themePack: cfg.themePack,
      theme: cfg.theme || 'orange',
      themeColor: cfg.themeColor || '#f97316',
      themeSecondary: cfg.themeSecondary || '#facc15',
      themeRgb: cfg.themeRgb || '249, 115, 22',
      themeIcon: cfg.themeIcon || 'bi-bar-chart-fill',
      themeGradient: cfg.themeGradient,
      unitName: cfg.unitName || 'dokumen',
      route: key === 'se2026' ? '/' : `/${key}/`,
      hasData: !!latestUpload || realisasi > 0,
      latestUploadDate: latestUpload ? latestUpload.tanggal : null,
      realisasi,
      target,
      persen,
      status: (persen >= 100) ? 'Selesai 100%' : (latestUpload || realisasi > 0 ? 'Aktif Berjalan' : 'Siap Mulai'),
      category: cfg.category || (key.startsWith('se') ? 'sensus' : 'survei'),
      categoryLabel: cfg.categoryLabel || (key.startsWith('se') ? 'Sensus Lengkap' : 'Survei Sampel'),
      categoryBadge: cfg.categoryBadge || (key.startsWith('se') ? 'Sensus Lengkap' : 'Survei Sampel'),
      categoryIcon: cfg.categoryIcon || (key.startsWith('se') ? 'bi-globe2' : 'bi-pie-chart-fill'),
      coverageDesc: cfg.coverageDesc || '',
      showUsahaColumns: cfg.showUsahaColumns,
      enabledPages: cfg.enabledPages || []
    });
  }

  const aggregatePct = totalTargetAll > 0 ? parseFloat(((totalRealisasiAll / totalTargetAll) * 100).toFixed(1)) : 0;

  res.render('surveys', {
    title: 'Portal Induk Sensus & Survei — Pananyo Taka BPS PPU',
    layout: 'layout-portal',
    activePage: 'surveys',
    surveysList,
    statsAggregate: {
      totalModules: Object.keys(surveysConfig).length,
      totalActive: totalActiveSurveys,
      totalRealisasi: totalRealisasiAll,
      totalTarget: totalTargetAll,
      aggregatePct
    },
    appVersion: req.app.locals.appVersion || '1.0.0'
  });
});

module.exports = router;
