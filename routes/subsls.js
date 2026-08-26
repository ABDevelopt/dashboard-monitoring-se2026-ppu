const express = require('express');
const router = express.Router();
const { getDb, getSettings, attachProgressPercentages, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula, getSubslsStatusFormula } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const surveyId = res.locals.activeSurvey || 'se2026';
  const db = getDb(surveyId);

  const filterKec = req.query.kec || '';
  const filterDesa = req.query.desa || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';
  const filterPcl = req.query.pcl || '';
  const filterStatus = req.query.status || ''; // 'belum_mulai' | 'sedang_didata' | 'memenuhi_target' | 'melebihi_target'
  const filterKode = req.query.kode || '';
  const filterQ = req.query.q || '';

  let data = [];
  let total = 0;

  const settings = res.locals.settings;
  const targetFormula = getTargetFormula(settings.target_fasih_mode);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitQuery = req.query.limit || '';
  const isAll = limitQuery === 'all';

  if (uploadId) {
    let cond = [];
    let params = [uploadId];

    if (filterKec) { cond.push('UPPER(TRIM(m.kecamatan)) = UPPER(TRIM(?))'); params.push(filterKec); }
    if (filterDesa) { cond.push('UPPER(TRIM(m.desa)) = UPPER(TRIM(?))'); params.push(filterDesa); }
    if (filterKorlap) { cond.push('UPPER(TRIM(m.korlap)) = UPPER(TRIM(?))'); params.push(filterKorlap); }
    if (filterPml) { cond.push('UPPER(TRIM(m.pml)) = UPPER(TRIM(?))'); params.push(filterPml); }
    if (filterPcl) {
      cond.push('(UPPER(TRIM(m.pcl)) = UPPER(TRIM(?)) OR UPPER(TRIM(p.pcl_name)) = UPPER(TRIM(?)) OR UPPER(TRIM(p.pcl_email)) = UPPER(TRIM(?)))');
      params.push(filterPcl, filterPcl, filterPcl);
    }
    if (filterQ) {
      cond.push('(m.nama_sls LIKE ? OR m.kode LIKE ? OR m.kecamatan LIKE ? OR m.desa LIKE ? OR m.korlap LIKE ? OR m.pml LIKE ? OR m.pcl LIKE ?)');
      const qParam = `%${filterQ}%`;
      params.push(qParam, qParam, qParam, qParam, qParam, qParam, qParam);
    }
    
    if (filterStatus === 'belum_mulai') {
      cond.push('(p.kode IS NULL OR (COALESCE(p.sls_selesai, 0) = 0 AND COALESCE(p.draft, 0) = 0 AND COALESCE(p.submitted_by_pcl, 0) = 0 AND COALESCE(p.approved, 0) = 0 AND COALESCE(p.rejected, 0) = 0))');
    } else if (filterStatus === 'sedang_didata') {
      cond.push(`(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 0 AND (COALESCE(p.draft, 0) > 0 OR COALESCE(p.submitted_by_pcl, 0) > 0 OR COALESCE(p.approved, 0) > 0 OR COALESCE(p.rejected, 0) > 0) AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) < (${targetFormula}))`);
    } else if (filterStatus === 'memenuhi_target') {
      cond.push(`(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 0 AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}))`);
    } else if (filterStatus === 'selesai') {
      cond.push('(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 1)');
    }

    const where = cond.length ? 'AND ' + cond.join(' AND ') : '';

    total = db.prepare(`
      SELECT COUNT(*) as n
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE 1=1 ${where}
    `).get(...params).n;

    let limitClause = '';
    let queryParams = [...params];
    if (!isAll) {
      const offset = (page - 1) * 50;
      limitClause = 'LIMIT ? OFFSET ?';
      queryParams.push(50, offset);
    }

    const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
    const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
    const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
    const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

    data = attachProgressPercentages(db.prepare(`
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
        ${getSubslsStatusFormula(targetFormula, 'p')} AS sudah_diisi,
        COALESCE(p.usaha_tidak_ditemukan, 0) AS usaha_tidak_ditemukan,
        COALESCE(p.usaha_ditemukan, 0) AS usaha_ditemukan,
        COALESCE(p.usaha_baru, 0) AS usaha_baru,
        COALESCE(p.usaha_tutup, 0) AS usaha_tutup,
        COALESCE(p.usaha_ganda, 0) AS usaha_ganda,
        COALESCE(p.tidak_ditemukan, 0) AS tidak_ditemukan,
        COALESCE(p.ditemukan, 0) AS ditemukan,
        COALESCE(p.keluarga_baru, 0) AS keluarga_baru,
        (${usahaTotalFormula}) AS usaha_total,
        (${keluargaTotalFormula}) AS keluarga_total,
        (${realFormula}) AS muatan_selesai,
        COALESCE(p.rumah_tunggal, 0) AS rumah_tunggal,
        COALESCE(p.rumah_deret, 0) AS rumah_deret,
        COALESCE(p.rumah_susun, 0) AS rumah_susun,
        COALESCE(p.apartemen, 0) AS apartemen,
        COALESCE(p.lainnya, 0) AS lainnya
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      WHERE 1=1 ${where}
      ORDER BY m.kecamatan, m.desa, m.kode
      ${limitClause}
    `).all(...queryParams));
  }

  let selectedSubsls = null;
  if (uploadId && filterKode) {
    selectedSubsls = data.find(s => s.kode === filterKode);
    if (!selectedSubsls) {
      const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
      const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
      const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
      const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

      const directData = attachProgressPercentages(db.prepare(`
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
          ${getSubslsStatusFormula(targetFormula, 'p')} AS sudah_diisi,
          COALESCE(p.usaha_tidak_ditemukan, 0) AS usaha_tidak_ditemukan,
          COALESCE(p.usaha_ditemukan, 0) AS usaha_ditemukan,
          COALESCE(p.usaha_baru, 0) AS usaha_baru,
          COALESCE(p.usaha_tutup, 0) AS usaha_tutup,
          COALESCE(p.usaha_ganda, 0) AS usaha_ganda,
          COALESCE(p.tidak_ditemukan, 0) AS tidak_ditemukan,
          COALESCE(p.ditemukan, 0) AS ditemukan,
          COALESCE(p.keluarga_baru, 0) AS keluarga_baru,
          (${usahaTotalFormula}) AS usaha_total,
          (${keluargaTotalFormula}) AS keluarga_total,
          (${realFormula}) AS muatan_selesai,
          COALESCE(p.rumah_tunggal, 0) AS rumah_tunggal,
          COALESCE(p.rumah_deret, 0) AS rumah_deret,
          COALESCE(p.rumah_susun, 0) AS rumah_susun,
          COALESCE(p.apartemen, 0) AS apartemen,
          COALESCE(p.lainnya, 0) AS lainnya
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.kode = ?
      `).all(uploadId, filterKode));
      selectedSubsls = directData[0] || null;
    }
  }

  // Hitung hari berjalan dari tanggal mulai pendataan & sisa hari menuju deadline
  const START_DATE = new Date((settings && settings.speedometer_start_date) || (surveyId === 'se2026' ? '2026-06-15' : '2026-08-01'));
  let diffDays = 1;
  let daysRemaining = 0;
  if (uploadId) {
    const currentUpload = db.prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);

    if (currentUpload) {
      const d2 = new Date(currentUpload.tanggal);
      const diffTime = d2 - START_DATE;
      diffDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);

      const deadline = new Date((settings && settings.speedometer_target_date) || (surveyId === 'se2026' ? '2026-08-31' : '2026-08-31'));
      daysRemaining = Math.max(0, Math.ceil((deadline - d2) / (1000 * 60 * 60 * 24)));
    }
  }

  let subslsHistory = [];
  if (uploadId && filterKode) {
    subslsHistory = db.prepare(`
      SELECT 
        u.tanggal,
        COALESCE(p.draft, 0) AS draft_total,
        COALESCE(p.submitted_by_pcl, 0) AS submitted_total,
        COALESCE(p.approved, 0) AS approved_total,
        COALESCE(p.rejected, 0) AS rejected_total,
        (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS selesai_total,
        ${targetFormula} AS target_fasih_total
      FROM progres p
      JOIN uploads u ON p.upload_id = u.id
      JOIN subsls_master m ON m.kode = p.kode
      WHERE p.kode = ?
      ORDER BY u.tanggal ASC
    `).all(filterKode);
  }

  // Filter lists: Single pass metadata query for fast execution
  const filterLists = db.prepare('SELECT DISTINCT kecamatan, korlap, pml, pcl FROM subsls_master').all();
  const kecSet = new Set();
  const korlapSet = new Set();
  const pmlSet = new Set();
  const pclSet = new Set();

  filterLists.forEach(r => {
    if (r.kecamatan) kecSet.add(r.kecamatan);
    if (r.korlap) korlapSet.add(r.korlap);
    if (r.pml) pmlSet.add(r.pml);
    if (r.pcl) pclSet.add(r.pcl);
  });

  const kecList = Array.from(kecSet).sort().map(k => ({ kecamatan: k }));
  const korlapList = Array.from(korlapSet).sort().map(k => ({ korlap: k }));
  const pmlList = Array.from(pmlSet).sort().map(p => ({ pml: p }));
  const pclList = Array.from(pclSet).sort().map(p => ({ pcl: p }));

  const desaList = filterKec
    ? db.prepare('SELECT DISTINCT desa FROM subsls_master WHERE UPPER(TRIM(kecamatan)) = UPPER(TRIM(?)) ORDER BY desa').all(filterKec)
    : [];

  const defaultLimit = 100;
  const effectiveLimit = isAll ? total : (parseInt(limitQuery, 10) || defaultLimit);
  const totalPages = Math.max(1, Math.ceil(total / (effectiveLimit || 1)));

  const getPageUrl = (p, l) => {
    const pMap = new URLSearchParams();
    if (filterKec) pMap.set('kec', filterKec);
    if (filterDesa) pMap.set('desa', filterDesa);
    if (filterKorlap) pMap.set('korlap', filterKorlap);
    if (filterPml) pMap.set('pml', filterPml);
    if (filterPcl) pMap.set('pcl', filterPcl);
    if (filterStatus) pMap.set('status', filterStatus);
    if (filterKode) pMap.set('kode', filterKode);
    if (filterQ) pMap.set('q', filterQ);
    const targetLimit = l !== undefined ? l : (limitQuery || '100');
    if (targetLimit) pMap.set('limit', targetLimit);
    pMap.set('page', p);
    return `${res.locals.navPrefix || ''}/subsls?${pMap.toString()}`;
  };

  res.render('subsls', {
    title: 'Per SubSLS',
    activePage: 'subsls',
    data,
    total,
    page,
    totalPages,
    limit: isAll ? 'all' : effectiveLimit,
    filterKec, filterDesa, filterKorlap, filterPml, filterPcl, filterStatus, filterKode, filterQ,
    kecList, desaList, korlapList, pmlList, pclList,
    settings,
    selectedSubsls,
    diffDays,
    daysRemaining,
    subslsHistory,
    getPageUrl
  });
});

// Export CSV
router.get('/export', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.status(400).send('Belum ada data yang diupload.');

  const filterKec = req.query.kec || '';
  const filterDesa = req.query.desa || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';
  const filterPcl = req.query.pcl || '';
  const filterStatus = req.query.status || '';
  const filterKode = req.query.kode || '';
  const filterQ = req.query.q || '';

  const settings = res.locals.settings;
  const targetFormula = getTargetFormula(settings.target_fasih_mode);
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  let cond = [];
  let params = [uploadId];

  if (filterKec) { cond.push('UPPER(TRIM(m.kecamatan)) = UPPER(TRIM(?))'); params.push(filterKec); }
  if (filterDesa) { cond.push('UPPER(TRIM(m.desa)) = UPPER(TRIM(?))'); params.push(filterDesa); }
  if (filterKorlap) { cond.push('UPPER(TRIM(m.korlap)) = UPPER(TRIM(?))'); params.push(filterKorlap); }
  if (filterPml) { cond.push('UPPER(TRIM(m.pml)) = UPPER(TRIM(?))'); params.push(filterPml); }
  if (filterPcl) {
    cond.push('(UPPER(TRIM(m.pcl)) = UPPER(TRIM(?)) OR UPPER(TRIM(p.pcl_name)) = UPPER(TRIM(?)) OR UPPER(TRIM(p.pcl_email)) = UPPER(TRIM(?)))');
    params.push(filterPcl, filterPcl, filterPcl);
  }
  if (filterKode) { cond.push('m.kode = ?'); params.push(filterKode); }
  if (filterQ) {
    cond.push('(m.nama_sls LIKE ? OR m.kode LIKE ? OR m.kecamatan LIKE ? OR m.desa LIKE ? OR m.korlap LIKE ? OR m.pml LIKE ? OR m.pcl LIKE ?)');
    const qParam = `%${filterQ}%`;
    params.push(qParam, qParam, qParam, qParam, qParam, qParam, qParam);
  }

  if (filterStatus === 'belum_mulai') {
    cond.push('(p.kode IS NULL OR (COALESCE(p.sls_selesai, 0) = 0 AND COALESCE(p.draft, 0) = 0 AND COALESCE(p.submitted_by_pcl, 0) = 0 AND COALESCE(p.approved, 0) = 0 AND COALESCE(p.rejected, 0) = 0))');
  } else if (filterStatus === 'sedang_didata') {
    cond.push(`(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 0 AND (COALESCE(p.draft, 0) > 0 OR COALESCE(p.submitted_by_pcl, 0) > 0 OR COALESCE(p.approved, 0) > 0 OR COALESCE(p.rejected, 0) > 0) AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) < (${targetFormula}))`);
  } else if (filterStatus === 'memenuhi_target') {
    cond.push(`(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 0 AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}))`);
  } else if (filterStatus === 'selesai') {
    cond.push('(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 1)');
  }

  const where = cond.length ? 'AND ' + cond.join(' AND ') : '';

  const data = attachProgressPercentages(db.prepare(`
    SELECT 
      m.kode, m.kecamatan, m.desa, m.nama_sls,
      m.korlap, m.pml, m.pcl, 
      m.target_fasih AS target_fasih_awal,
      COALESCE(p.draft, 0) AS draft,
      COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
      COALESCE(p.approved, 0) AS approved,
      COALESCE(p.rejected, 0) AS rejected,
      ${targetFormula} AS target_fasih_sekarang,
      COALESCE(m.target_fasih, 0) AS target_static,
      COALESCE(p.target_upload, 0) AS target_upload,

      (${targetMuatanFormula}) AS target_muatan,
      CASE 
        WHEN COALESCE(p.sls_selesai, 0) = 1 THEN 'Selesai'
        WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 'Memenuhi Target'
        WHEN p.kode IS NOT NULL AND (
          COALESCE(p.draft, 0) > 0 OR 
          COALESCE(p.submitted_by_pcl, 0) > 0 OR 
          COALESCE(p.approved, 0) > 0 OR 
          COALESCE(p.rejected, 0) > 0
        ) THEN 'Sedang Didata'
        ELSE 'Belum Mulai'
      END AS status,
      COALESCE(p.usaha_tidak_ditemukan, 0) AS usaha_tidak_ditemukan,
      COALESCE(p.usaha_ditemukan, 0) AS usaha_ditemukan,
      COALESCE(p.usaha_baru, 0) AS usaha_baru,
      COALESCE(p.usaha_tutup, 0) AS usaha_tutup,
      COALESCE(p.usaha_ganda, 0) AS usaha_ganda,
      COALESCE(p.tidak_ditemukan, 0) AS keluarga_tidak_ditemukan,
      COALESCE(p.ditemukan, 0) AS keluarga_ditemukan,
      COALESCE(p.keluarga_baru, 0) AS keluarga_baru,
      COALESCE(p.meninggal, 0) AS meninggal,
      (${usahaTotalFormula}) AS total_usaha,
      (${keluargaTotalFormula}) AS total_keluarga,
      COALESCE(p.rumah_tunggal, 0) AS rumah_tunggal,
      COALESCE(p.rumah_deret, 0) AS rumah_deret,
      COALESCE(p.rumah_susun, 0) AS rumah_susun,
      COALESCE(p.apartemen, 0) AS apartemen,
      COALESCE(p.lainnya, 0) AS lainnya
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE 1=1 ${where}
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(...params));

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
