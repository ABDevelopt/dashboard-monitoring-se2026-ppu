const express = require('express');
const router = express.Router();
const { getBottomPerformers } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let performers = { bottomPcl: [], bottomPml: [] };

  if (uploadId) {
    performers = getBottomPerformers(uploadId);
  }

  res.render('performa_terendah', {
    title: 'Performa Terendah',
    activePage: 'performa-terendah',
    performers,
  });
});

module.exports = router;
