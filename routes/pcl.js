const express = require('express');
const router = express.Router();
const { getPclStats, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let pclStats = [];
  let detailSubsls = [];
  const filterPcl = req.query.pcl || '';
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';

  if (uploadId) {
    // Build dynamic filter
    let where = 'WHERE 1=1';
    const params = [uploadId];
    if (filterKec) { where += ' AND m.kecamatan = ?'; params.push(filterKec); }
    if (filterKorlap) { where += ' AND m.korlap = ?'; params.push(filterKorlap); }
    if (filterPml) { where += ' AND m.pml = ?'; params.push(filterPml); }

    pclStats = getDb().prepare(`
      SELECT 
        m.pcl, m.pml, m.korlap, m.kecamatan,
        COUNT(m.kode) AS total_subsls,
        SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) AS selesai,
        SUM(m.muatan) AS total_muatan,
        SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
        SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
        ROUND(100.0 * SUM(CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END) / COUNT(m.kode), 1) AS pct
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      ${where}
      GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
      ORDER BY selesai ASC
    `).all(...params);

    if (filterPcl) {
      detailSubsls = getDb().prepare(`
        SELECT 
          m.kode, m.kecamatan, m.desa, m.nama_sls,
          m.korlap, m.pml, m.pcl, m.muatan,
          CASE WHEN p.kode IS NOT NULL THEN 1 ELSE 0 END AS sudah_diisi,
          COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
          COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.pcl = ?
        ORDER BY m.kecamatan, m.desa, m.kode
      `).all(uploadId, filterPcl);
    }
  }

  // Get filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

  res.render('pcl', {
    title: 'Per PCL',
    activePage: 'pcl',
    pclStats,
    detailSubsls,
    filterPcl,
    filterKec,
    filterKorlap,
    filterPml,
    kecList,
    korlapList,
    pmlList,
  });
});

module.exports = router;
