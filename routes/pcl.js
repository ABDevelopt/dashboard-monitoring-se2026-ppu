const express = require('express');
const router = express.Router();
const { getPclStats, getDb, getSettings, attachProgressPercentages, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula } = require('../database');

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

    const settings = res.locals.settings;
    const targetFormula = getTargetFormula(settings.target_fasih_mode);
    const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
    const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
    const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
    const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

    pclStats = attachProgressPercentages(getDb().prepare(`
      SELECT 
        m.pcl, m.pml, m.korlap, m.kecamatan,
        COUNT(m.kode) AS total_subsls,
        SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
        SUM(${targetMuatanFormula}) AS total_muatan,
        SUM(${realFormula}) AS muatan_selesai,
        SUM(${usahaTotalFormula}) AS usaha_total,
        SUM(COALESCE(p.usaha_ditemukan, 0)) AS usaha_ditemukan_total,
        SUM(COALESCE(p.usaha_baru, 0)) AS usaha_baru_total,
        SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan_total,
        SUM(COALESCE(p.usaha_tutup, 0)) AS usaha_tutup_total,
        SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda_total,
        SUM(COALESCE(p.ditemukan, 0)) AS keluarga_ditemukan_total,
        SUM(COALESCE(p.keluarga_baru, 0)) AS keluarga_baru_total,
        SUM(COALESCE(p.tidak_ditemukan, 0)) AS keluarga_tidak_ditemukan_total,
        SUM(COALESCE(p.meninggal, 0)) AS keluarga_meninggal_total,
        SUM(COALESCE(p.tidak_eligible, 0)) AS keluarga_tidak_eligible_total,
        SUM(COALESCE(p.tidak_dapat_ditemui, 0)) AS keluarga_tidak_dapat_ditemui_total,
        SUM(${keluargaTotalFormula}) AS keluarga_total,
        SUM(COALESCE(p.draft, 0)) AS draft_total,
        SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
        SUM(COALESCE(p.approved, 0)) AS approved_total,
        SUM(COALESCE(p.rejected, 0)) AS rejected_total,
        SUM(${targetFormula}) AS target_fasih_total,
        SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
        SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
        CASE WHEN SUM(${targetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${targetFormula}), 2) ELSE 0.0 END AS pct
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
      ${where}
      GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
      ORDER BY selesai ASC
    `).all(...params));

    if (filterPcl) {
      const settings = res.locals.settings;
      const targetFormula = getTargetFormula(settings.target_fasih_mode);
      const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
      const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
      const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
      const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

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
          COALESCE(m.target_fasih, 0) AS target_static,
          COALESCE(p.target_upload, 0) AS target_upload,
          CASE 
            WHEN p.kode IS NULL OR (
              (${realFormula}) = 0 AND 
              COALESCE(p.draft, 0) = 0 AND 
              COALESCE(p.submitted_by_pcl, 0) = 0 AND 
              COALESCE(p.approved, 0) = 0 AND 
              COALESCE(p.rejected, 0) = 0
            ) THEN 'belum_mulai'
            WHEN (${targetMuatanFormula}) > 0 AND (${realFormula}) < (${targetMuatanFormula}) THEN 'sedang_didata'
            WHEN (${realFormula}) = (${targetMuatanFormula}) THEN 'memenuhi_target'
            ELSE 'melebihi_target'
          END AS sudah_diisi,
          ${usahaTotalFormula} AS usaha_total,
          ${keluargaTotalFormula} AS keluarga_total
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

router.get('/export-excel', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.status(400).send('Belum ada data yang diupload.');

  const settings = res.locals.settings;
  const targetFormula = getTargetFormula(settings.target_fasih_mode);
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  // 1. Fetch PCL stats
  const pcls = getDb().prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(COALESCE(p.usaha_ditemukan, 0)) AS usaha_ditemukan_total,
      SUM(COALESCE(p.usaha_baru, 0)) AS usaha_baru_total,
      SUM(COALESCE(p.usaha_tidak_ditemukan, 0)) AS usaha_tidak_ditemukan_total,
      SUM(COALESCE(p.usaha_tutup, 0)) AS usaha_tutup_total,
      SUM(COALESCE(p.usaha_ganda, 0)) AS usaha_ganda_total,
      SUM(COALESCE(p.ditemukan, 0)) AS keluarga_ditemukan_total,
      SUM(COALESCE(p.keluarga_baru, 0)) AS keluarga_baru_total,
      SUM(COALESCE(p.tidak_ditemukan, 0)) AS keluarga_tidak_ditemukan_total,
      SUM(COALESCE(p.meninggal, 0)) AS keluarga_meninggal_total,
      SUM(COALESCE(p.tidak_eligible, 0)) AS keluarga_tidak_eligible_total,
      SUM(COALESCE(p.tidak_dapat_ditemui, 0)) AS keluarga_tidak_dapat_ditemui_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${targetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
    ORDER BY m.kecamatan, m.korlap, m.pml, m.pcl
  `).all(uploadId);

  // 2. Fetch PML stats
  const pmls = getDb().prepare(`
    SELECT 
      m.pml, m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${targetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pml, m.korlap
    ORDER BY m.korlap, m.pml
  `).all(uploadId);

  // 3. Fetch Korlap stats
  const korlaps = getDb().prepare(`
    SELECT 
      m.korlap,
      COUNT(DISTINCT m.pml) AS jumlah_pml,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${targetFormula}) AS target_fasih_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.korlap
    ORDER BY m.korlap
  `).all(uploadId);

  // Format PCL data
  const pclSheetData = pcls.map((r, idx) => {
    const completedMuatan = r.muatan_selesai || 0;
    const targetMuatan = r.total_muatan || 0;
    const muatanPct = targetMuatan > 0 ? parseFloat(((completedMuatan / targetMuatan) * 100).toFixed(2)) : 0.0;
    
    const completedFasih = (r.submitted_total || 0) + (r.approved_total || 0) + (r.rejected_total || 0);
    const targetFasih = r.target_fasih_total || 0;
    const fasihPct = targetFasih > 0 ? parseFloat(((completedFasih / targetFasih) * 100).toFixed(2)) : 0.0;

    return {
      'No': idx + 1,
      'Nama PCL': r.pcl || '-',
      'PML (Pengawas)': r.pml || '-',
      'Korlap (Koordinator)': r.korlap || '-',
      'Kecamatan': r.kecamatan || '-',
      'Jumlah Sub-SLS': r.total_subsls || 0,
      'Sub-SLS Selesai FASIH': r.selesai || 0,
      'Target Muatan': targetMuatan,
      'Realisasi Muatan': completedMuatan,
      'Capaian Muatan (%)': muatanPct,
      'Total Usaha': r.usaha_total || 0,
      'Usaha Ditemukan': r.usaha_ditemukan_total || 0,
      'Usaha Baru': r.usaha_baru_total || 0,
      'Usaha Tidak Ditemukan': r.usaha_tidak_ditemukan_total || 0,
      'Usaha Tutup': r.usaha_tutup_total || 0,
      'Usaha Ganda': r.usaha_ganda_total || 0,
      'Total Keluarga': r.keluarga_total || 0,
      'Keluarga Ditemukan': r.keluarga_ditemukan_total || 0,
      'Keluarga Baru': r.keluarga_baru_total || 0,
      'Keluarga Tidak Ditemukan': r.keluarga_tidak_ditemukan_total || 0,
      'Keluarga Meninggal': r.keluarga_meninggal_total || 0,
      'Keluarga Tidak Eligible': r.keluarga_tidak_eligible_total || 0,
      'Keluarga Tidak Dapat Ditemui': r.keluarga_tidak_dapat_ditemui_total || 0,
      'FASIH Draft': r.draft_total || 0,
      'FASIH Submitted': r.submitted_total || 0,
      'FASIH Approved': r.approved_total || 0,
      'FASIH Rejected': r.rejected_total || 0,
      'Target FASIH': targetFasih,
      'Capaian FASIH (%)': fasihPct
    };
  });

  // Format PML data
  const pmlSheetData = pmls.map((r, idx) => {
    const completedMuatan = r.muatan_selesai || 0;
    const targetMuatan = r.total_muatan || 0;
    const muatanPct = targetMuatan > 0 ? parseFloat(((completedMuatan / targetMuatan) * 100).toFixed(2)) : 0.0;
    
    const completedFasih = (r.submitted_total || 0) + (r.approved_total || 0) + (r.rejected_total || 0);
    const targetFasih = r.target_fasih_total || 0;
    const fasihPct = targetFasih > 0 ? parseFloat(((completedFasih / targetFasih) * 100).toFixed(2)) : 0.0;

    return {
      'No': idx + 1,
      'Nama PML': r.pml || '-',
      'Korlap (Koordinator)': r.korlap || '-',
      'Jumlah PCL Bawahan': r.jumlah_pcl || 0,
      'Jumlah Sub-SLS': r.total_subsls || 0,
      'Sub-SLS Selesai FASIH': r.selesai || 0,
      'Target Muatan': targetMuatan,
      'Realisasi Muatan': completedMuatan,
      'Capaian Muatan (%)': muatanPct,
      'Total Usaha': r.usaha_total || 0,
      'Total Keluarga': r.keluarga_total || 0,
      'FASIH Draft': r.draft_total || 0,
      'FASIH Submitted': r.submitted_total || 0,
      'FASIH Approved': r.approved_total || 0,
      'FASIH Rejected': r.rejected_total || 0,
      'Target FASIH': targetFasih,
      'Capaian FASIH (%)': fasihPct
    };
  });

  // Format Korlap data
  const korlapSheetData = korlaps.map((r, idx) => {
    const completedMuatan = r.muatan_selesai || 0;
    const targetMuatan = r.total_muatan || 0;
    const muatanPct = targetMuatan > 0 ? parseFloat(((completedMuatan / targetMuatan) * 100).toFixed(2)) : 0.0;
    
    const completedFasih = (r.submitted_total || 0) + (r.approved_total || 0) + (r.rejected_total || 0);
    const targetFasih = r.target_fasih_total || 0;
    const fasihPct = targetFasih > 0 ? parseFloat(((completedFasih / targetFasih) * 100).toFixed(2)) : 0.0;

    return {
      'No': idx + 1,
      'Nama Korlap': r.korlap || '-',
      'Jumlah PML Bawahan': r.jumlah_pml || 0,
      'Jumlah PCL Bawahan': r.jumlah_pcl || 0,
      'Jumlah Sub-SLS': r.total_subsls || 0,
      'Sub-SLS Selesai FASIH': r.selesai || 0,
      'Target Muatan': targetMuatan,
      'Realisasi Muatan': completedMuatan,
      'Capaian Muatan (%)': muatanPct,
      'Total Usaha': r.usaha_total || 0,
      'Total Keluarga': r.keluarga_total || 0,
      'FASIH Draft': r.draft_total || 0,
      'FASIH Submitted': r.submitted_total || 0,
      'FASIH Approved': r.approved_total || 0,
      'FASIH Rejected': r.rejected_total || 0,
      'Target FASIH': targetFasih,
      'Capaian FASIH (%)': fasihPct
    };
  });

  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  
  const wsPcl = XLSX.utils.json_to_sheet(pclSheetData);
  const wsPml = XLSX.utils.json_to_sheet(pmlSheetData);
  const wsKorlap = XLSX.utils.json_to_sheet(korlapSheetData);

  XLSX.utils.book_append_sheet(wb, wsPcl, "Progres PCL");
  XLSX.utils.book_append_sheet(wb, wsPml, "Progres PML");
  XLSX.utils.book_append_sheet(wb, wsKorlap, "Progres Korlap");

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="progres_muatan_petugas_${new Date().toISOString().slice(0,10)}.xlsx"`);
  res.send(buf);
});

// Export rekap count assignment harian seluruh petugas
router.get('/export-daily-assignments', (req, res) => {
  const history = getDb().prepare(`
    SELECT 
      u.tanggal,
      c.pcl,
      c.pml,
      c.korlap,
      c.kecamatan,
      c.draft_total,
      c.submitted_total,
      c.approved_total,
      c.rejected_total,
      (c.submitted_total + c.approved_total + c.rejected_total) AS selesai_total,
      c.target_fasih_total
    FROM summary_cache c
    JOIN uploads u ON c.upload_id = u.id
    ORDER BY u.tanggal DESC, c.kecamatan, c.pml, c.pcl
  `).all();

  const dailySheetData = history.map((r, idx) => ({
    'No': idx + 1,
    'Tanggal': r.tanggal,
    'Nama PCL': r.pcl || '-',
    'PML': r.pml || '-',
    'Korlap': r.korlap || '-',
    'Kecamatan': r.kecamatan || '-',
    'Draft': r.draft_total || 0,
    'Submitted (PCL)': r.submitted_total || 0,
    'Approved (PML)': r.approved_total || 0,
    'Rejected (PML)': r.rejected_total || 0,
    'Total Pengerjaan FASIH': r.selesai_total || 0,
    'Target FASIH': r.target_fasih_total || 0,
    'Capaian (%)': r.target_fasih_total ? ((r.selesai_total / r.target_fasih_total) * 100).toFixed(2) + '%' : '0%'
  }));

  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(dailySheetData);
  XLSX.utils.book_append_sheet(wb, ws, "Count Assignment Harian");

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="count_assignment_harian_petugas_${new Date().toISOString().slice(0,10)}.xlsx"`);
  res.send(buf);
});

module.exports = router;
