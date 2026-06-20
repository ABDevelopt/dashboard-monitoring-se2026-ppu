const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('map', {
    title: 'Peta Progres',
    activePage: 'map'
  });
});

module.exports = router;
