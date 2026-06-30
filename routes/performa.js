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
    const top = getTopPerformers(uploadId, { kec: filterKec, korlap: filterKorlap, pml: filterPml, limit: null });
    const bottom = getBottomPerformers(uploadId, { kec: filterKec, korlap: filterKorlap, pml: filterPml, limit: null });
    performers = {
      topPcl: top.topPcl || [],
      topPml: top.topPml || [],
      bottomPcl: bottom.bottomPcl || [],
      bottomPml: bottom.bottomPml || []
    };
  }

  // Calculate elapsed days of census and remaining days until August 31, 2026
  let diffDays = 1;
  let daysRemaining = 0;
  if (uploadId) {
    const currentUpload = getDb().prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
    const firstUpload = getDb().prepare('SELECT MIN(tanggal) as min_tanggal FROM uploads').get();
    
    if (currentUpload && firstUpload && firstUpload.min_tanggal) {
      const d1 = new Date(firstUpload.min_tanggal);
      const d2 = new Date(currentUpload.tanggal);
      const diffTime = d2 - d1;
      diffDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);
    }
    
    if (currentUpload) {
      const d2 = new Date(currentUpload.tanggal);
      const deadline = new Date('2026-08-31');
      const diffTime = deadline - d2;
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }
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
    pmlList,
    diffDays,
    daysRemaining
  });
});

module.exports = router;
