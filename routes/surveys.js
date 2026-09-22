const express = require('express');
const router = express.Router();
const { getLatestUpload, getOverviewSummary, getSettings } = require('../database');
const { getSurveysConfig } = require('../services/surveyRegistry');

const fasihSyncService = require('../services/fasihSyncService');

// GET /surveys/catalog-status - Cek koneksi live ke API katalog FASIH-SM Cloud
router.get('/catalog-status', async (req, res) => {
  try {
    const conn = await fasihSyncService.checkSurveysCatalogConnection();
    const surveysConfig = getSurveysConfig();
    return res.json({
      ...conn,
      totalRegistered: Object.keys(surveysConfig).length
    });
  } catch (err) {
    return res.status(500).json({ ok: false, status: 'error', error: err.message });
  }
});

// POST /surveys/sync-catalog - Trigger penarikan katalog dan auto-generate dasbor kegiatan
router.post('/sync-catalog', async (req, res) => {
  try {
    const result = await fasihSyncService.autoGenerateSurveyDashboards({
      forceRefresh: true
    });
    return res.json({
      success: true,
      message: `Berhasil menyinkronkan ${result.totalInCloud} kegiatan resmi BPS dari Cloud. Total dasbor aktif: ${result.totalRegistered} (${result.added} baru ditambahkan).`,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /surveys/sync-progress/:surveyId - Trigger sinkronisasi data progres untuk satu kegiatan tertentu
router.post('/sync-progress/:surveyId', async (req, res) => {
  const surveyId = req.params.surveyId;
  try {
    const result = await fasihSyncService.syncSurveyProgress(surveyId, {
      forceRefresh: req.body && req.body.forceRefresh
    });
    return res.json({
      success: true,
      message: `Berhasil menyinkronkan data progres kegiatan [${surveyId}].`,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ success: false, surveyId, error: err.message });
  }
});

// POST /surveys/sync-progress-all - Trigger sinkronisasi massal seluruh data progres kegiatan
router.post('/sync-progress-all', async (req, res) => {
  try {
    const result = await fasihSyncService.syncAllSurveysProgress({
      forceRefresh: req.body && req.body.forceRefresh,
      skipIfUnchanged: req.body && req.body.skipIfUnchanged !== false
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /surveys/progress-status/:surveyId - Cek status progres lokal kegiatan
router.get('/progress-status/:surveyId', (req, res) => {
  const surveyId = req.params.surveyId;
  const status = fasihSyncService.getSurveyProgressStatus(surveyId);
  return res.json({
    success: true,
    surveyId,
    status
  });
});

// GET /surveys - Portal Induk Menu Utama Pananyo Taka & Katalog Dasbor Survei/Sensus
router.get('/', (req, res) => {
  const surveysConfig = getSurveysConfig();
  const surveysList = [];
  let totalRealisasiAll = 0;
  let totalTargetAll = 0;
  let totalActiveSurveys = 0;

  const categoryCounts = {
    all: Object.keys(surveysConfig).length,
    pencacahan: 0,
    pelatihan: 0,
    ujicoba: 0,
    sensus: 0
  };

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

    const cat = cfg.category || (key.startsWith('se') ? 'sensus' : 'survei');
    if (cat === 'pelatihan') categoryCounts.pelatihan++;
    else if (cat === 'ujicoba') categoryCounts.ujicoba++;
    else if (cat === 'sensus') {
      categoryCounts.sensus++;
      categoryCounts.pencacahan++;
    } else {
      categoryCounts.pencacahan++;
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
      category: cat,
      categoryLabel: cfg.categoryLabel || (cat === 'sensus' ? 'Sensus Lengkap' : (cat === 'pelatihan' ? 'Pelatihan' : (cat === 'ujicoba' ? 'Ujicoba' : 'Survei Sampel'))),
      categoryBadge: cfg.categoryBadge || (cat === 'sensus' ? 'Sensus Lengkap' : (cat === 'pelatihan' ? 'Pelatihan' : (cat === 'ujicoba' ? 'Ujicoba' : 'Survei Sampel'))),
      categoryIcon: cfg.categoryIcon || (cat === 'sensus' ? 'bi-globe2' : (cat === 'pelatihan' ? 'bi-mortarboard-fill' : (cat === 'ujicoba' ? 'bi-cpu-fill' : 'bi-pie-chart-fill'))),
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
    categoryCounts,
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
