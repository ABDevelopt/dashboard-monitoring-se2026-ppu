const express = require('express');
const router = express.Router();
const { getPclStats, getDb, getSettings, attachProgressPercentages, getTargetFormula } = require('../database');

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

    const settings = getSettings();
    const targetFormula = getTargetFormula(settings.target_fasih_mode);

    pclStats = attachProgressPercentages(getDb().prepare(`
      SELECT 
        m.pcl, m.pml, m.korlap, m.kecamatan,
        COUNT(m.kode) AS total_subsls,
        SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
        SUM(m.muatan) AS total_muatan,
        SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
        SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
        SUM(COALESCE(p.ditemukan, 0)) AS keluarga_ditemukan_total,
        SUM(COALESCE(p.keluarga_baru, 0)) AS keluarga_baru_total,
        SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
        SUM(COALESCE(p.draft, 0)) AS draft_total,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(p.approved, 0)) AS approved_total,
        SUM(COALESCE(p.rejected, 0)) AS rejected_total,
        SUM(${targetFormula}) AS target_fasih_total,
        CASE WHEN SUM(${targetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${targetFormula}), 2) ELSE 0.0 END AS pct
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      ${where}
      GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
      ORDER BY selesai ASC
    `).all(...params));

    if (filterPcl) {
      const settings = getSettings();
      const targetFormula = getTargetFormula(settings.target_fasih_mode);

      detailSubsls = attachProgressPercentages(getDb().prepare(`
        SELECT 
          m.kode, m.kecamatan, m.desa, m.nama_sls,
          m.korlap, m.pml, m.pcl, m.muatan,
          m.target_fasih AS target_fasih_awal,
          COALESCE(p.draft, 0) AS draft,
          COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
          COALESCE(p.approved, 0) AS approved,
          COALESCE(p.rejected, 0) AS rejected,
          ${targetFormula} AS target_fasih,
          CASE 
            WHEN p.kode IS NULL OR (
              COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) = 0 AND 
              COALESCE(p.draft, 0) = 0 AND 
              COALESCE(p.submitted_by_pcl, 0) = 0 AND 
              COALESCE(p.approved, 0) = 0 AND 
              COALESCE(p.rejected, 0) = 0
            ) THEN 'belum_mulai'
            WHEN m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) < m.muatan THEN 'sedang_didata'
            WHEN (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) = m.muatan THEN 'memenuhi_target'
            ELSE 'melebihi_target'
          END AS sudah_diisi,
          COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
          COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.pcl = ?
        ORDER BY m.kecamatan, m.desa, m.kode
      `).all(uploadId, filterPcl));
    }
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

  // Get filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

  // Get historical progress of selected PCL
  let pclHistory = [];
  if (uploadId && filterPcl) {
    pclHistory = getDb().prepare(`
      SELECT 
        u.tanggal,
        SUM(c.draft_total) AS draft_total,
        SUM(c.submitted_total) AS submitted_total,
        SUM(c.approved_total) AS approved_total,
        SUM(c.rejected_total) AS rejected_total,
        SUM(c.submitted_total + c.approved_total + c.rejected_total) AS selesai_total,
        SUM(c.target_fasih_total) AS target_fasih_total
      FROM summary_cache c
      JOIN uploads u ON c.upload_id = u.id
      WHERE c.pcl = ?
      GROUP BY u.tanggal, u.id
      ORDER BY u.tanggal ASC
    `).all(filterPcl);
  }

  const selectedPclStats = filterPcl ? pclStats.find(p => p.pcl.toUpperCase() === filterPcl.toUpperCase()) : null;

  res.render('pcl', {
    title: 'Per PCL',
    activePage: 'pcl',
    pclStats,
    detailSubsls,
    selectedPclStats,
    filterPcl,
    filterKec,
    filterKorlap,
    filterPml,
    kecList,
    korlapList,
    pmlList,
    diffDays,
    daysRemaining,
    pclHistory,
  });
});

module.exports = router;
