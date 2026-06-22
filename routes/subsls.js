const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  const filterKec = req.query.kec || '';
  const filterDesa = req.query.desa || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';
  const filterPcl = req.query.pcl || '';
  const filterStatus = req.query.status || ''; // 'selesai' | 'belum'

  let data = [];
  let total = 0;

  if (uploadId) {
    let cond = [];
    let params = [uploadId];

    if (filterKec) { cond.push('m.kecamatan = ?'); params.push(filterKec); }
    if (filterDesa) { cond.push('m.desa = ?'); params.push(filterDesa); }
    if (filterKorlap) { cond.push('m.korlap = ?'); params.push(filterKorlap); }
    if (filterPml) { cond.push('m.pml = ?'); params.push(filterPml); }
    if (filterPcl) { cond.push('m.pcl = ?'); params.push(filterPcl); }
    if (filterStatus === 'selesai') cond.push('p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan');
    if (filterStatus === 'belum') cond.push('(p.kode IS NULL OR m.muatan = 0 OR (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) < m.muatan)');

    const where = cond.length ? 'AND ' + cond.join(' AND ') : '';

    total = getDb().prepare(`
      SELECT COUNT(*) as n
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE 1=1 ${where}
    `).get(...params).n;

    data = getDb().prepare(`
      SELECT 
        m.kode, m.kecamatan, m.desa, m.nama_sls,
        m.korlap, m.pml, m.pcl, m.muatan,
        CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END AS sudah_diisi,
        COALESCE(p.usaha_tidak_ditemukan, 0) AS usaha_tidak_ditemukan,
        COALESCE(p.usaha_ditemukan, 0) AS usaha_ditemukan,
        COALESCE(p.usaha_baru, 0) AS usaha_baru,
        COALESCE(p.usaha_tutup, 0) AS usaha_tutup,
        COALESCE(p.usaha_ganda, 0) AS usaha_ganda,
        COALESCE(p.tidak_ditemukan, 0) AS tidak_ditemukan,
        COALESCE(p.ditemukan, 0) AS ditemukan,
        COALESCE(p.keluarga_baru, 0) AS keluarga_baru,
        COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
        COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total,
        COALESCE(p.rumah_tunggal, 0) AS rumah_tunggal,
        COALESCE(p.rumah_deret, 0) AS rumah_deret,
        COALESCE(p.rumah_susun, 0) AS rumah_susun,
        COALESCE(p.apartemen, 0) AS apartemen,
        COALESCE(p.lainnya, 0) AS lainnya
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE 1=1 ${where}
      ORDER BY m.kecamatan, m.desa, m.kode
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
  }

  // Filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const desaList = filterKec
    ? getDb().prepare('SELECT DISTINCT desa FROM subsls_master WHERE kecamatan = ? ORDER BY desa').all(filterKec)
    : [];
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();
  const pclList = getDb().prepare('SELECT DISTINCT pcl FROM subsls_master ORDER BY pcl').all();

  const totalPages = Math.ceil(total / limit);

  res.render('subsls', {
    title: 'Per SubSLS',
    activePage: 'subsls',
    data,
    total,
    page,
    totalPages,
    limit,
    filterKec, filterDesa, filterKorlap, filterPml, filterPcl, filterStatus,
    kecList, desaList, korlapList, pmlList, pclList,
  });
});

// Export CSV
router.get('/export', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.status(400).send('Belum ada data yang diupload.');

  const data = getDb().prepare(`
    SELECT 
      m.kode, m.kecamatan, m.desa, m.nama_sls,
      m.korlap, m.pml, m.pcl, m.muatan,
      CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 'Selesai' ELSE 'Belum' END AS status,
      COALESCE(p.usaha_tidak_ditemukan, 0) AS usaha_tidak_ditemukan,
      COALESCE(p.usaha_ditemukan, 0) AS usaha_ditemukan,
      COALESCE(p.usaha_baru, 0) AS usaha_baru,
      COALESCE(p.usaha_tutup, 0) AS usaha_tutup,
      COALESCE(p.usaha_ganda, 0) AS usaha_ganda,
      COALESCE(p.tidak_ditemukan, 0) AS keluarga_tidak_ditemukan,
      COALESCE(p.ditemukan, 0) AS keluarga_ditemukan,
      COALESCE(p.keluarga_baru, 0) AS keluarga_baru,
      COALESCE(p.meninggal, 0) AS meninggal,
      COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS total_usaha,
      COALESCE(p.ditemukan + p.keluarga_baru, 0) AS total_keluarga,
      COALESCE(p.rumah_tunggal, 0) AS rumah_tunggal,
      COALESCE(p.rumah_deret, 0) AS rumah_deret,
      COALESCE(p.rumah_susun, 0) AS rumah_susun,
      COALESCE(p.apartemen, 0) AS apartemen,
      COALESCE(p.lainnya, 0) AS lainnya
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(uploadId);

  const headers = Object.keys(data[0] || {});
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="subsls_se2026_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel
});

module.exports = router;
