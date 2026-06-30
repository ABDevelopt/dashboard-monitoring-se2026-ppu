const express = require('express');
const router = express.Router();
const { getTopPerformers, getBottomPerformers, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';
  const activeTab = req.query.tab || 'terbaik'; // 'terbaik' or 'terendah'

  let performers = { topPcl: [], topPml: [], bottomPcl: [], bottomPml: [] };

  if (uploadId) {
    const top = getTopPerformers(uploadId, { kec: filterKec, korlap: filterKorlap, pml: filterPml });
    const bottom = getBottomPerformers(uploadId, { kec: filterKec, korlap: filterKorlap, pml: filterPml });
    performers = {
      topPcl: top.topPcl || [],
      topPml: top.topPml || [],
      bottomPcl: bottom.bottomPcl || [],
      bottomPml: bottom.bottomPml || []
    };
  }

  // Get filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

  res.render('performa', {
    title: 'Analisis Performa Petugas',
    activePage: 'performa',
    performers,
    filterKec,
    filterKorlap,
    filterPml,
    activeTab,
    kecList,
    korlapList,
    pmlList
  });
});

module.exports = router;
