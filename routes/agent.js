const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('agent', {
    title: 'Asisten AI Chat',
    activePage: 'agent'
  });
});

module.exports = router;
