const express = require('express');
const router = express.Router();
const { getOverviewSummary, getKecamatanStats, getTrenHarian } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let summary = null;
  let kecStats = [];
  let tren = [];

  if (uploadId) {
    summary = getOverviewSummary(uploadId);
    kecStats = getKecamatanStats(uploadId);
    tren = getTrenHarian();
  }

  res.render('overview', {
    title: 'Overview',
    activePage: 'overview',
    summary,
    kecStats,
    tren: JSON.stringify(tren),
  });
});

module.exports = router;
