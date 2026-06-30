const express = require('express');
const router = express.Router();
const { getTopPerformers, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';

  // Ambil semua PCL, diurutkan progres tertinggi ke terendah (default)
  let performers = { topPcl: [] };

  if (uploadId) {
    const top = getTopPerformers(uploadId, { kec: filterKec, korlap: filterKorlap, pml: filterPml, limit: null });
    performers = { topPcl: top.topPcl || [] };
  }

  // Hitung hari berjalan dari tanggal mulai pendataan (15 Juni 2026) & sisa hari menuju deadline
  const START_DATE = new Date('2026-06-15');
  let diffDays = 1;
  let daysRemaining = 0;
  if (uploadId) {
    const currentUpload = getDb().prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);

    if (currentUpload) {
      const d2 = new Date(currentUpload.tanggal);
      const diffTime = d2 - START_DATE;
      diffDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);

      const deadline = new Date('2026-08-31');
      daysRemaining = Math.max(0, Math.ceil((deadline - d2) / (1000 * 60 * 60 * 24)));
    }
  }

  // Dropdown filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

  res.render('performa', {
    title: 'Performa Petugas PCL',
    activePage: 'performa',
    performers,
    filterKec,
    filterKorlap,
    filterPml,
    kecList,
    korlapList,
    pmlList,
    diffDays,
    daysRemaining
  });
});

module.exports = router;
