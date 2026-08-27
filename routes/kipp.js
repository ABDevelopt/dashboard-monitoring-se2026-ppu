const express = require('express');
const router = express.Router();
const { getDb, getSettings, attachProgressPercentages, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula } = require('../database');

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

  const settings = res.locals.settings;
  const targetFormula = getTargetFormula(settings.target_fasih_mode);

  if (uploadId) {
    let cond = ["m.nama_sls = 'KIPP IKN'"];
    let params = [uploadId];

    if (filterKec) { cond.push('m.kecamatan = ?'); params.push(filterKec); }
    if (filterDesa) { cond.push('m.desa = ?'); params.push(filterDesa); }
    if (filterKorlap) { cond.push('m.korlap = ?'); params.push(filterKorlap); }
    if (filterPml) { cond.push('m.pml = ?'); params.push(filterPml); }
    if (filterPcl) {
      cond.push('(m.pcl = ? OR p.pcl_name = ? OR p.pcl_email = ?)');
      params.push(filterPcl, filterPcl, filterPcl);
    }
    if (filterStatus === 'selesai') cond.push(`p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 1`);
    if (filterStatus === 'belum') cond.push(`(p.kode IS NULL OR COALESCE(p.sls_selesai, 0) = 0)`);

    const where = cond.length ? 'AND ' + cond.join(' AND ') : '';

    let hasProgresPetugas = false;
    try {
      const ppCount = getDb().prepare("SELECT count(*) as c FROM progres_petugas WHERE upload_id = ?").get(uploadId);
      hasProgresPetugas = ppCount && ppCount.c > 0;
    } catch (_) {}

    const ppJoin = hasProgresPetugas
      ? `LEFT JOIN (
           SELECT kode, COUNT(DISTINCT pcl_name) AS officer_count, GROUP_CONCAT(DISTINCT pcl_name) AS officer_names
           FROM progres_petugas
           WHERE upload_id = ${Number(uploadId)}
           GROUP BY kode
         ) pp_agg ON m.kode = pp_agg.kode`
      : '';
    const ppSelect = hasProgresPetugas
      ? `, COALESCE(pp_agg.officer_count, 1) AS officer_count, COALESCE(pp_agg.officer_names, m.pcl) AS officer_names`
      : `, 1 AS officer_count, m.pcl AS officer_names`;

    total = getDb().prepare(`
      SELECT COUNT(*) as n
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE 1=1 ${where}
    `).get(...params).n;

    data = attachProgressPercentages(getDb().prepare(`
      SELECT 
        m.kode, m.kecamatan, m.desa, m.nama_sls,
        m.korlap, m.pml, m.pcl, m.muatan,
        m.target_fasih AS target_fasih_awal,
        COALESCE(p.draft, 0) AS draft,
        COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
        COALESCE(p.approved, 0) AS approved,
        COALESCE(p.rejected, 0) AS rejected,
        ${targetFormula} AS target_fasih,
        COALESCE(m.target_fasih, 0) AS target_static,
        COALESCE(p.target_upload, 0) AS target_upload,
        COALESCE(p.sls_selesai, 0) AS sudah_diisi,
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
        ${ppSelect}
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      ${ppJoin}
      WHERE 1=1 ${where}
      ORDER BY m.kecamatan, m.desa, m.kode
    `).all(...params));
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
    const settings = res.locals.settings;
    const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
    const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
    const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

    overallStats = attachProgressPercentages(getDb().prepare(`
      SELECT 
        SUM(COALESCE(p.draft, 0)) AS draft,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted,
        SUM(COALESCE(p.approved, 0)) AS approved,
        SUM(COALESCE(p.rejected, 0)) AS rejected,
        SUM(m.target_fasih) AS target_fasih_awal,
        SUM(${targetMuatanFormula}) AS muatan,
        SUM(${usahaTotalFormula}) AS usaha_total,
        SUM(${keluargaTotalFormula}) AS keluarga_total,
        SUM(${targetFormula}) AS target_fasih,
        SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
        SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE m.nama_sls = 'KIPP IKN'
    `).get(uploadId));
  }


  let kippPclStats = [];
  let kippDaysRemaining = 0;
  const KIPP_DEADLINE = new Date('2026-07-06');

  if (uploadId) {
    let hasProgresPetugas = false;
    try {
      const ppCount = getDb().prepare("SELECT count(*) as c FROM progres_petugas WHERE upload_id = ?").get(uploadId);
      hasProgresPetugas = ppCount && ppCount.c > 0;
    } catch (_) {}

    if (hasProgresPetugas) {
      kippPclStats = getDb().prepare(`
        SELECT 
          pp.pcl_name AS nama_petugas,
          COUNT(DISTINCT pp.kode) AS total_subsls,
          SUM(COALESCE(pp.draft, 0)) AS draft,
          SUM(COALESCE(pp.submitted_by_pcl, 0)) AS submitted,
          SUM(COALESCE(pp.approved, 0)) AS approved,
          SUM(COALESCE(pp.rejected, 0)) AS rejected,
          SUM(COALESCE(pp.submitted_by_pcl, 0) + COALESCE(pp.approved, 0) + COALESCE(pp.rejected, 0)) AS realisasi
        FROM progres_petugas pp
        JOIN subsls_master m ON pp.kode = m.kode
        WHERE pp.upload_id = ? AND m.nama_sls = 'KIPP IKN' AND pp.pcl_name IS NOT NULL AND pp.pcl_name != ''
        GROUP BY pp.pcl_name
        ORDER BY realisasi DESC, approved DESC
      `).all(uploadId);
    } else {
      kippPclStats = getDb().prepare(`
        SELECT 
          m.pcl AS nama_petugas,
          COUNT(m.kode) AS total_subsls,
          SUM(COALESCE(p.draft, 0)) AS draft,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted,
          SUM(COALESCE(p.approved, 0)) AS approved,
          SUM(COALESCE(p.rejected, 0)) AS rejected,
          SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS realisasi
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.nama_sls = 'KIPP IKN' AND m.pcl IS NOT NULL AND m.pcl != ''
        GROUP BY m.pcl
        ORDER BY realisasi DESC
      `).all(uploadId);
    }

    const currentUpload = getDb().prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
    if (currentUpload) {
      const d2 = new Date(currentUpload.tanggal);
      kippDaysRemaining = Math.max(0, Math.ceil((KIPP_DEADLINE - d2) / (1000 * 60 * 60 * 24)));
    }
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
    kippPclStats,
    kippDaysRemaining,
  });
});

module.exports = router;
