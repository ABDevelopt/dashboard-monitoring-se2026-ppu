const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('map_ujipetik', {
    title: 'Titik Uji Petik',
    activePage: 'map-ujipetik'
  });
});

module.exports = router;
