const express = require('express');
const router = express.Router();
const { getTopPerformers } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let performers = { topPcl: [], topPml: [] };

  if (uploadId) {
    performers = getTopPerformers(uploadId);
  }

  res.render('leaderboard', {
    title: 'Performa Terbaik',
    activePage: 'leaderboard',
    performers,
  });
});

module.exports = router;
