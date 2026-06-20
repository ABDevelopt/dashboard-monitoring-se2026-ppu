const express = require('express');
const router = express.Router();
const { getEarlyWarning } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let warning = { zeroPcl: [], slowPcl: [], zeroPml: [] };

  if (uploadId) {
    warning = getEarlyWarning(uploadId);
  }

  res.render('earlywarning', {
    title: 'Early Warning',
    activePage: 'earlywarning',
    warning,
  });
});

module.exports = router;
