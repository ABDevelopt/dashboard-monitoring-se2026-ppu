const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;

  const filterKec = req.query.kec || '';
  const filterDesa = req.query.desa || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';
  const filterPcl = req.query.pcl || '';
  const filterStatus = req.query.status || '';

  let data = [];
  let total = 0;

  if (uploadId) {
    let cond = ["m.nama_sls = 'KIPP IKN'"];
    let params = [uploadId];

    if (filterKec) { cond.push('m.kecamatan = ?'); params.push(filterKec); }
    if (filterDesa) { cond.push('m.desa = ?'); params.push(filterDesa); }
    if (filterKorlap) { cond.push('m.korlap = ?'); params.push(filterKorlap); }
    if (filterPml) { cond.push('m.pml = ?'); params.push(filterPml); }
    if (filterPcl) { cond.push('m.pcl = ?'); params.push(filterPcl); }
    if (filterStatus === 'selesai') cond.push('p.kode IS NOT NULL AND m.target_fasih > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= m.target_fasih');
    if (filterStatus === 'belum') cond.push('(p.kode IS NULL OR m.target_fasih = 0 OR (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) < m.target_fasih)');

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
        m.target_fasih AS target_fasih_awal,
        COALESCE(p.draft, 0) AS draft,
        COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
        COALESCE(p.approved, 0) AS approved,
        COALESCE(p.rejected, 0) AS rejected,
        CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 
             THEN 0 
             ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) 
        END AS target_fasih,
        COALESCE(p.sudah_diisi, 0) AS sudah_diisi,
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
    `).all(...params);
  }

  // Filter lists restricted to KIPP codes only
  const kecList = getDb().prepare(`SELECT DISTINCT kecamatan FROM subsls_master WHERE nama_sls = 'KIPP IKN' ORDER BY kecamatan`).all();
  const desaList = filterKec
    ? getDb().prepare(`SELECT DISTINCT desa FROM subsls_master WHERE kecamatan = ? AND nama_sls = 'KIPP IKN' ORDER BY desa`).all(filterKec)
    : [];
  const korlapList = getDb().prepare(`SELECT DISTINCT korlap FROM subsls_master WHERE nama_sls = 'KIPP IKN' ORDER BY korlap`).all();
  const pmlList = getDb().prepare(`SELECT DISTINCT pml FROM subsls_master WHERE nama_sls = 'KIPP IKN' ORDER BY pml`).all();
  const pclList = getDb().prepare(`SELECT DISTINCT pcl FROM subsls_master WHERE nama_sls = 'KIPP IKN' ORDER BY pcl`).all();

  let overallStats = null;
  if (uploadId) {
    overallStats = getDb().prepare(`
      SELECT 
        SUM(COALESCE(p.draft, 0)) AS draft,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted,
        SUM(COALESCE(p.approved, 0)) AS approved,
        SUM(COALESCE(p.rejected, 0)) AS rejected,
        SUM(m.target_fasih) AS target_fasih_awal,
        SUM(m.muatan) AS muatan,
        SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) AS usaha_total,
        SUM(COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS keluarga_total,
        SUM(CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 
                 THEN 0 
                 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) 
            END) AS target_fasih
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE m.nama_sls = 'KIPP IKN'
    `).get(uploadId);
  }

  res.render('kipp', {
    title: 'Kawasan KIPP IKN',
    activePage: 'kipp',
    data,
    total,
    overallStats,
    page: 1,
    totalPages: 1,
    limit: total || 50,
    filterKec, filterDesa, filterKorlap, filterPml, filterPcl, filterStatus,
    kecList, desaList, korlapList, pmlList, pclList,
  });
});

module.exports = router;
