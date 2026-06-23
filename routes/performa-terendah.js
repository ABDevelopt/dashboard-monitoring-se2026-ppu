const express = require('express');
const router = express.Router();
const { getBottomPerformers, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';

  let performers = { bottomPcl: [], bottomPml: [] };

  if (uploadId) {
    performers = getBottomPerformers(uploadId, { kec: filterKec, korlap: filterKorlap, pml: filterPml });
  }

  // Get filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

  res.render('performa_terendah', {
    title: 'Performa Terendah',
    activePage: 'performa-terendah',
    performers,
    filterKec,
    filterKorlap,
    filterPml,
    kecList,
    korlapList,
    pmlList
  });
});

module.exports = router;
