const { 
  getDb, 
  getLatestUpload, 
  getLatestUploadsDetailed, 
  getAllUploads, 
  getMasterTableSql,
  attachProgressPercentages,
  getSettings
} = require('../database');

// Helper: Get list of Kecamatans for a survey
function getSurveyKecList(surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return db.prepare(`SELECT DISTINCT kecamatan FROM ${mTable} WHERE kecamatan IS NOT NULL AND kecamatan != '' ORDER BY kecamatan ASC`).all().map(r => r.kecamatan);
}

// Helper: Get list of Desas for a survey
function getSurveyDesaList(surveyId, filterKec = '') {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  if (filterKec) {
    return db.prepare(`SELECT DISTINCT desa FROM ${mTable} WHERE desa IS NOT NULL AND desa != '' AND LOWER(kecamatan) = LOWER(?) ORDER BY desa ASC`).all(filterKec).map(r => r.desa);
  }
  return db.prepare(`SELECT DISTINCT desa FROM ${mTable} WHERE desa IS NOT NULL AND desa != '' ORDER BY desa ASC`).all().map(r => r.desa);
}

// Helper: Get list of Korlaps for a survey
function getSurveyKorlapList(surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return db.prepare(`SELECT DISTINCT korlap FROM ${mTable} WHERE korlap IS NOT NULL AND korlap != '' ORDER BY korlap ASC`).all().map(r => ({ korlap: r.korlap }));
}

// Helper: Get list of PMLs for a survey
function getSurveyPmlList(surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return db.prepare(`SELECT DISTINCT pml FROM ${mTable} WHERE pml IS NOT NULL AND pml != '' ORDER BY pml ASC`).all().map(r => ({ pml: r.pml }));
}

// Helper: Get list of PCLs for a survey
function getSurveyPclList(surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return db.prepare(`SELECT DISTINCT pcl FROM ${mTable} WHERE pcl IS NOT NULL AND pcl != '' ORDER BY pcl ASC`).all().map(r => r.pcl);
}

// Helper: Get overview summary for a survey
function getSurveyOverviewSummary(uploadId, settings, surveyId) {
  if (!uploadId) return null;
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);

  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END) AS selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS total_muatan,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0)) AS muatan_selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      0 AS usaha_total,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0) + COALESCE(p.draft, 0)) AS keluarga_total,
      0 AS usaha_tidak_ditemukan,
      0 AS keluarga_tidak_ditemukan,
      0 AS usaha_baru,
      0 AS keluarga_baru,
      0 AS usaha_ditemukan,
      0 AS keluarga_ditemukan,
      0 AS usaha_tutup,
      0 AS meninggal,
      0 AS usaha_ganda,
      0 AS rumah_tunggal,
      0 AS rumah_deret,
      0 AS rumah_susun,
      0 AS apartemen,
      0 AS lainnya,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(CASE WHEN COALESCE(p.open, 0) > 0 THEN COALESCE(p.open, 0) ELSE MAX(0, COALESCE(m.target_fasih, 0) - (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) END) AS open_total
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `).get(uploadId);

  const total = db.prepare(`SELECT COUNT(*) as n FROM ${mTable}`).get().n;
  const total_pcl = db.prepare(`SELECT COUNT(DISTINCT pcl) AS n FROM ${mTable} WHERE pcl IS NOT NULL AND pcl != ''`).get().n || 0;
  const total_pml = db.prepare(`SELECT COUNT(DISTINCT pml) AS n FROM ${mTable} WHERE pml IS NOT NULL AND pml != ''`).get().n || 0;

  const active_pcl = db.prepare(`
    SELECT COUNT(DISTINCT m.pcl) AS n 
    FROM ${mTable} m 
    JOIN progres p ON m.kode = p.kode AND p.upload_id = ? 
    WHERE m.pcl IS NOT NULL AND m.pcl != '' 
      AND (COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0
  `).get(uploadId).n || 0;

  const total_pengerjaan = (stats.submitted_total || 0) + (stats.approved_total || 0) + (stats.rejected_total || 0);

  const avg_subsls_per_pcl = total_pcl > 0 ? parseFloat((total / total_pcl).toFixed(2)) : 0;
  const avg_target_fasih_per_pcl = total_pcl > 0 ? parseFloat(((stats.target_fasih_total || 0) / total_pcl).toFixed(1)) : 0;
  const avg_didata_per_pcl = total_pcl > 0 ? parseFloat((total_pengerjaan / total_pcl).toFixed(1)) : 0;
  const avg_didata_per_active_pcl = active_pcl > 0 ? parseFloat((total_pengerjaan / active_pcl).toFixed(1)) : 0;
  const avg_selesai_subsls_per_pcl = total_pcl > 0 ? parseFloat(((stats.selesai || 0) / total_pcl).toFixed(2)) : 0;
  const avg_muatan_per_pcl = total_pcl > 0 ? parseFloat(((stats.muatan_selesai || 0) / total_pcl).toFixed(1)) : 0;

  const out = Object.assign({}, stats, {
    total,
    total_pcl,
    total_pml,
    active_pcl,
    total_pengerjaan,
    avg_subsls_per_pcl,
    avg_target_fasih_per_pcl,
    avg_didata_per_pcl,
    avg_didata_per_active_pcl,
    avg_selesai_subsls_per_pcl,
    avg_muatan_per_pcl,
    nama_survei: surveyId === 'sakernas-pemutakhiran' ? 'Sakernas — Pemutakhiran' : 'Sakernas — Pendataan',
    periode: 'Agustus 2026',
    status_tahap: 'Aktif Berjalan'
  });

  return attachProgressPercentages(out, settings);
}

// Helper: Get kecamatan stats for a survey
function getSurveyKecamatanStats(uploadId, settings, surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return attachProgressPercentages(db.prepare(`
    SELECT 
      m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END) AS selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS total_muatan,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0)) AS muatan_selesai,
      0 AS usaha_total,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0) + COALESCE(p.draft, 0)) AS keluarga_total,
      0 AS usaha_tidak_ditemukan,
      0 AS tidak_ditemukan,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      0 AS target_honor_total
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.kecamatan
    ORDER BY m.kecamatan ASC
  `).all(uploadId), settings);
}

// Helper: Get desa stats for a survey
function getSurveyDesaStats(uploadId, surveyId, filterKec = '') {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  const settings = getSettings();
  let query = `
    SELECT 
      m.kecamatan,
      m.desa,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END) AS selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS total_muatan,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0)) AS muatan_selesai,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_fasih_total
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `;
  const params = [uploadId];
  if (filterKec) {
    query += ` WHERE LOWER(m.kecamatan) = LOWER(?)`;
    params.push(filterKec);
  }
  query += ` GROUP BY m.kecamatan, m.desa ORDER BY m.kecamatan, m.desa ASC`;
  return attachProgressPercentages(db.prepare(query).all(...params), settings);
}

// Helper: Get korlap stats for a survey
function getSurveyKorlapStats(uploadId, settings, surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return attachProgressPercentages(db.prepare(`
    SELECT 
      m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(DISTINCT m.pml) AS jumlah_pml,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END) AS selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS total_muatan,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0)) AS muatan_selesai,
      0 AS usaha_total,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0) + COALESCE(p.draft, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      0 AS target_honor_total
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.korlap IS NOT NULL AND m.korlap != ''
    GROUP BY m.korlap
    ORDER BY selesai DESC
  `).all(uploadId), settings);
}

// Helper: Get PML stats for a survey
function getSurveyPmlStats(uploadId, settings, surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return attachProgressPercentages(db.prepare(`
    SELECT 
      m.pml,
      m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END) AS selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS total_muatan,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0)) AS muatan_selesai,
      0 AS usaha_total,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0) + COALESCE(p.draft, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      0 AS target_honor_total
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.pml IS NOT NULL AND m.pml != ''
    GROUP BY m.pml, m.korlap
    ORDER BY selesai DESC
  `).all(uploadId), settings);
}

// Helper: Get PCL stats for a survey
function getSurveyPclStats(uploadId, settings, surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return attachProgressPercentages(db.prepare(`
    SELECT 
      m.pcl,
      MAX(m.pml) AS pml,
      MAX(m.korlap) AS korlap,
      MAX(m.kecamatan) AS kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END) AS selesai,
      SUM(COALESCE(m.target_fasih, 0)) AS total_muatan,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0)) AS muatan_selesai,
      0 AS usaha_total,
      SUM(COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0) + COALESCE(p.draft, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.open, 0)) AS open_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
      0 AS target_honor_total
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.pcl IS NOT NULL AND m.pcl != ''
    GROUP BY m.pcl
    ORDER BY approved_total DESC
  `).all(uploadId), settings);
}

// Helper: Get daily trend for a survey
function getSurveyTrenHarian(surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  return db.prepare(`
    SELECT 
      u.tanggal,
      u.filename,
      SUM(COALESCE(s.selesai, 0)) AS subsls_selesai,
      0 AS usaha_total,
      SUM(COALESCE(s.keluarga_total, 0)) AS keluarga_total,
      SUM(COALESCE(s.draft_total, 0)) AS draft_total,
      SUM(COALESCE(s.submitted_total, 0)) AS submitted_total,
      SUM(COALESCE(s.approved_total, 0)) AS approved_total,
      SUM(COALESCE(s.rejected_total, 0)) AS rejected_total,
      SUM(COALESCE(s.target_fasih_total, 0)) AS target_fasih_total,
      COUNT(DISTINCT CASE WHEN s.pcl IS NOT NULL AND s.pcl != '' THEN s.pcl END) AS total_pcl
    FROM uploads u
    LEFT JOIN summary_cache s ON s.upload_id = u.id
    WHERE COALESCE(u.survey_id, 'se2026') = ?
    GROUP BY u.id
    ORDER BY u.tanggal ASC
  `).all(surveyId);
}

// Helper: Get dynamic list of SubSLS/BS for list page
function getSurveySubslsList(uploadId, queryParams, surveyId) {
  const db = getDb();
  const mTable = getMasterTableSql(surveyId);
  
  let sql = `
    SELECT 
      m.kode, m.kecamatan, m.desa, m.kode AS nama_sls,
      m.korlap, m.pml, m.pcl, m.target_fasih,
      COALESCE(p.draft, 0) AS draft,
      COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
      COALESCE(p.approved, 0) AS approved,
      COALESCE(p.rejected, 0) AS rejected,
      COALESCE(p.target_upload, 0) AS target_upload,
      CASE WHEN (COALESCE(p.approved, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.rejected, 0)) >= COALESCE(m.target_fasih, 0) AND COALESCE(m.target_fasih, 0) > 0 THEN 1 ELSE 0 END AS sudah_diisi
    FROM ${mTable} m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `;

  const params = [uploadId];
  const conditions = [];

  if (queryParams.kec) {
    conditions.push("LOWER(m.kecamatan) = LOWER(?)");
    params.push(queryParams.kec);
  }
  if (queryParams.desa) {
    conditions.push("LOWER(m.desa) = LOWER(?)");
    params.push(queryParams.desa);
  }
  if (queryParams.korlap) {
    conditions.push("LOWER(m.korlap) = LOWER(?)");
    params.push(queryParams.korlap);
  }
  if (queryParams.pml) {
    conditions.push("LOWER(m.pml) = LOWER(?)");
    params.push(queryParams.pml);
  }
  if (queryParams.pcl) {
    conditions.push("LOWER(m.pcl) = LOWER(?)");
    params.push(queryParams.pcl);
  }
  if (queryParams.status) {
    if (queryParams.status === 'selesai') {
      conditions.push("sudah_diisi = 1");
    } else if (queryParams.status === 'belum') {
      conditions.push("sudah_diisi = 0");
    }
  }
  if (queryParams.q) {
    conditions.push("(m.kode LIKE ? OR m.pcl LIKE ? OR m.pml LIKE ?)");
    params.push(`%${queryParams.q}%`, `%${queryParams.q}%`, `%${queryParams.q}%`);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY m.kecamatan, m.desa, m.kode ASC";
  
  return db.prepare(sql).all(...params);
}

// Master survey data router function
function getSurveyData(surveyId, page, query = {}, locals = {}) {
  if (surveyId === 'se2026') return null; // Fallback to original controllers

  const settings = getSettings();
  const latestUpload = getLatestUpload(surveyId);
  const uploadId = latestUpload ? latestUpload.id : null;

  if (!uploadId) {
    // Return empty state mock structures if no data uploaded yet for this survey
    switch (page) {
      case 'index':
        return {
          title: 'Overview',
          activePage: 'overview',
          summary: null,
          kecStats: [],
          tren: JSON.stringify([]),
          distLast: null,
          pclDeltas: JSON.stringify([]),
          latestUpdateSpeedPerPcl: 0,
          diffTotal: 0
        };
      case 'kecamatan':
        return { title: 'Capaian Per Kecamatan', activePage: 'kecamatan', kecStats: [], desaStats: [], selectedKecStats: null, filterKec: '' };
      case 'korlap':
        return { title: 'Drilldown Koordinator Lapangan', activePage: 'korlap', korlapStats: [], filterKorlap: '', selectedKorlapStats: null, pmlUnderKorlap: [] };
      case 'pml':
        return { title: 'Drilldown Pengawas PML', activePage: 'pml', pmlStats: [], filterKec: '', filterKorlap: '', filterPml: '', selectedPmlStats: null, pclUnderPml: [] };
      case 'pcl':
        return { title: 'Drilldown Petugas PCL', activePage: 'pcl', pclStats: [], allPclNames: [], filterKec: '', filterKorlap: '', filterPml: '', filterPcl: '', filterStatus: '', selectedPclStats: null };
      case 'subsls':
        return { title: 'Daftar Blok Sensus / Subsls', activePage: 'subsls', subslsList: [], kecList: [], desaList: [], korlapList: [], pmlList: [], filterKec: '', filterDesa: '', filterKorlap: '', filterPml: '', filterStatus: '', filterSearch: '', pagination: { page: 1, totalPages: 1, totalRecords: 0, limit: 50 } };
      case 'harian':
        return { title: 'Progres Harian', activePage: 'harian', tren: JSON.stringify([]), harianStats: [], kecList: [], filterKec: '' };
      case 'leaderboard':
        return { title: 'Leaderboard Petugas', activePage: 'leaderboard', topPcl: [], topPml: [], kecList: [], korlapList: [], filterKec: '', filterKorlap: '' };
      case 'performa-terendah':
        return { title: 'Evaluasi Performa Petugas', activePage: 'performa-terendah', bottomPcl: [], bottomPml: [], kecList: [], korlapList: [], filterKec: '', filterKorlap: '' };
      case 'performa':
        return { title: 'Evaluasi Kinerja', activePage: 'performa', pclStats: [], pmlStats: [], kecList: [], korlapList: [], filterKec: '', filterKorlap: '' };
      case 'deteksi-anomali':
        return { title: 'Audit & Deteksi Anomali', activePage: 'deteksi-anomali', activeTab: query.tab || 'keluarga', filterKec: '', filterKorlap: '', filterStatus: '', searchQuery: '', filteredUsaha: [], filteredKeluarga: [], filteredPcl: [], paginatedUsaha: [], paginatedKeluarga: [], paginatedPcl: [], currentPage: 1, pageSize: 50, totalPagesUsaha: 1, totalPagesKeluarga: 1, totalPagesPcl: 1, totalRecordsUsaha: 0, totalRecordsKeluarga: 0, totalRecordsPcl: 0, kecList: [], korlapList: [], sheetsData: { summary: { total_anomali: 0, total_usaha: 0, total_keluarga: 0, total_sudah: 0, total_belum: 0, pct_sudah: 0 }, lastUpdated: 'No Data', fromCache: false } };
      case 'early-warning':
        return { title: 'Early Warning System', activePage: 'earlywarning', warning: { zeroPcl: [], slowPcl: [], zeroPml: [], stagnanPcl: [] }, filterKec: '', filterKorlap: '', filterPml: '', filterStatus: '', kecList: [], korlapList: [], pmlList: [] };
      case 'export':
        return { title: 'Ekspor Data', activePage: 'export', kecList: [], desaList: [], korlapList: [], pmlList: [], pclList: [] };
      case 'pbi':
        return { title: 'Pendataan PBI', activePage: 'pbi', pbiStats: [], filterKec: '', kecList: [] };
      case 'agent':
        return { title: 'Pananyo Taka AI', activePage: 'agent', provider: 'gemini', activeModel: 'gemini-2.5-flash', activeProvider: 'gemini', activeCategory: 'Sakernas', geminiModels: ['gemini-2.5-flash'], openaiModels: [], openrouterModels: [], selectedGeminiModel: 'gemini-2.5-flash', selectedOpenAIModel: '', selectedOpenRouterModel: '', hasKey: true, hasGeminiKey: true, hasOpenAIKey: false, hasOpenRouterKey: false, agentName: 'Pananyo Taka AI', surveyContext: surveyId };
      case 'map':
        return { title: 'Peta Progres', activePage: 'map', kecStats: [], filterKec: '' };
      default:
        return null;
    }
  }

  // Handle active upload state and query DB
  const filterKec     = query.kec     || '';
  const filterDesa    = query.desa    || '';
  const filterKorlap  = query.korlap  || '';
  const filterPml     = query.pml     || '';
  const filterPcl     = query.pcl     || '';
  const filterStatus  = query.status  || '';
  const filterSearch  = query.q       || '';

  switch (page) {
    case 'index': {
      const summary = getSurveyOverviewSummary(uploadId, settings, surveyId);
      const kecStats = getSurveyKecamatanStats(uploadId, settings, surveyId);
      const tren = getSurveyTrenHarian(surveyId);
      return {
        title: 'Overview',
        activePage: 'overview',
        summary,
        kecStats,
        tren: JSON.stringify(tren),
        distLast: null,
        pclDeltas: JSON.stringify([]),
        latestUpdateSpeedPerPcl: 0,
        diffTotal: 0
      };
    }

    case 'kecamatan': {
      const kecStats = getSurveyKecamatanStats(uploadId, settings, surveyId);
      const desaStats = getSurveyDesaStats(uploadId, surveyId, filterKec);
      const selectedKecStats = filterKec ? (kecStats.find(k => k.kecamatan.toUpperCase() === filterKec.toUpperCase()) || null) : null;
      return {
        title: 'Capaian Per Kecamatan',
        activePage: 'kecamatan',
        kecStats,
        desaStats,
        selectedKecStats,
        filterKec
      };
    }

    case 'korlap': {
      const korlapStats = getSurveyKorlapStats(uploadId, settings, surveyId);
      const pmlUnderKorlap = filterKorlap 
        ? getSurveyPmlStats(uploadId, settings, surveyId).filter(p => p.korlap === filterKorlap) 
        : [];
      return {
        title: 'Drilldown Koordinator Lapangan',
        activePage: 'korlap',
        korlapStats,
        filterKorlap,
        selectedKorlapStats: filterKorlap ? (korlapStats.find(k => k.korlap === filterKorlap) || null) : null,
        pmlUnderKorlap
      };
    }

    case 'pml': {
      const pmlStats = getSurveyPmlStats(uploadId, settings, surveyId);
      const pclUnderPml = filterPml 
        ? getSurveyPclStats(uploadId, settings, surveyId).filter(p => p.pml === filterPml) 
        : [];
      return {
        title: 'Drilldown Pengawas PML',
        activePage: 'pml',
        pmlStats,
        filterKec,
        filterKorlap,
        filterPml,
        selectedPmlStats: filterPml ? (pmlStats.find(p => p.pml === filterPml) || null) : null,
        pclUnderPml
      };
    }

    case 'pcl': {
      const pclStats = getSurveyPclStats(uploadId, settings, surveyId);
      const allPclNames = pclStats.map(p => ({ pcl: p.pcl }));
      const filteredPcl = filterKec
        ? pclStats.filter(p => p.kecamatan.toUpperCase() === filterKec.toUpperCase())
        : filterPml
        ? pclStats.filter(p => p.pml === filterPml)
        : pclStats;
      const selectedPclStats = filterPcl ? (pclStats.find(p => p.pcl === filterPcl) || null) : null;
      return {
        title: 'Drilldown Petugas PCL',
        activePage: 'pcl',
        pclStats: filteredPcl,
        allPclNames,
        filterKec,
        filterKorlap,
        filterPml,
        filterPcl,
        filterStatus,
        selectedPclStats,
        subslsList: []
      };
    }

    case 'subsls': {
      const subslsList = getSurveySubslsList(uploadId, query, surveyId);
      const kecList = getSurveyKecList(surveyId);
      const desaList = getSurveyDesaList(surveyId, filterKec);
      const korlapList = getSurveyKorlapList(surveyId);
      const pmlList = getSurveyPmlList(surveyId);
      return {
        title: 'Daftar Blok Sensus / Subsls',
        activePage: 'subsls',
        subslsList,
        kecList,
        desaList,
        korlapList,
        pmlList,
        filterKec,
        filterDesa,
        filterKorlap,
        filterPml,
        filterStatus,
        filterSearch,
        pagination: { page: 1, totalPages: 1, totalRecords: subslsList.length, limit: 1000 }
      };
    }

    case 'harian': {
      const tren = getSurveyTrenHarian(surveyId);
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      return {
        title: 'Progres Harian',
        activePage: 'harian',
        tren: JSON.stringify(tren),
        harianStats: tren,
        kecList,
        filterKec
      };
    }

    case 'leaderboard': {
      const topPcl = getSurveyPclStats(uploadId, settings, surveyId);
      const topPml = getSurveyPmlStats(uploadId, settings, surveyId);
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      const korlapList = getSurveyKorlapList(surveyId);
      return {
        title: 'Leaderboard Petugas',
        activePage: 'leaderboard',
        topPcl,
        topPml,
        kecList,
        korlapList,
        filterKec,
        filterKorlap
      };
    }

    case 'performa-terendah': {
      const bottomPcl = [...getSurveyPclStats(uploadId, settings, surveyId)].reverse();
      const bottomPml = [...getSurveyPmlStats(uploadId, settings, surveyId)].reverse();
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      const korlapList = getSurveyKorlapList(surveyId);
      return {
        title: 'Evaluasi Performa Petugas',
        activePage: 'performa-terendah',
        bottomPcl,
        bottomPml,
        kecList,
        korlapList,
        filterKec,
        filterKorlap
      };
    }

    case 'performa': {
      const pclStats = getSurveyPclStats(uploadId, settings, surveyId);
      const pmlStats = getSurveyPmlStats(uploadId, settings, surveyId);
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      const korlapList = getSurveyKorlapList(surveyId);
      return {
        title: 'Evaluasi Kinerja',
        activePage: 'performa',
        pclStats,
        pmlStats,
        kecList,
        korlapList,
        filterKec,
        filterKorlap
      };
    }

    case 'deteksi-anomali': {
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      const korlapList = getSurveyKorlapList(surveyId);
      const summary = getSurveyOverviewSummary(uploadId, settings, surveyId);
      return {
        title: 'Audit & Deteksi Anomali',
        activePage: 'deteksi-anomali',
        activeTab: query.tab || 'keluarga',
        filterKec,
        filterKorlap,
        filterStatus,
        searchQuery: filterSearch,
        filteredUsaha: [],
        filteredKeluarga: [],
        filteredPcl: [],
        paginatedUsaha: [],
        paginatedKeluarga: [],
        paginatedPcl: [],
        currentPage: 1,
        pageSize: 50,
        totalPagesUsaha: 1,
        totalPagesKeluarga: 1,
        totalPagesPcl: 1,
        totalRecordsUsaha: 0,
        totalRecordsKeluarga: 0,
        totalRecordsPcl: 0,
        kecList,
        korlapList,
        sheetsData: {
          summary: { 
            total_anomali: 0, 
            total_usaha: 0, 
            total_keluarga: summary.keluarga_total || 0, 
            total_sudah: summary.muatan_selesai || 0, 
            total_belum: Math.max(0, (summary.keluarga_total || 0) - (summary.muatan_selesai || 0)), 
            pct_sudah: summary.muatan_selesai_pct || 0 
          },
          usahaList: [],
          keluargaList: [],
          pclStats: [],
          lastUpdated: 'Real-time Sync',
          fromCache: false
        }
      };
    }

    case 'early-warning': {
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      const korlapList = getSurveyKorlapList(surveyId);
      const pmlList = getSurveyPmlList(surveyId);
      return {
        title: 'Early Warning System',
        activePage: 'earlywarning',
        warning: { zeroPcl: [], slowPcl: [], zeroPml: [], stagnanPcl: [] },
        filterKec,
        filterKorlap,
        filterPml,
        filterStatus,
        kecList,
        korlapList,
        pmlList
      };
    }

    case 'export': {
      const kecList = getSurveyKecList(surveyId);
      const desaList = getSurveyDesaList(surveyId);
      const korlapList = getSurveyKorlapList(surveyId).map(k => k.korlap);
      const pmlList = getSurveyPmlList(surveyId).map(p => p.pml);
      const pclList = getSurveyPclList(surveyId);
      return {
        title: 'Ekspor Data',
        activePage: 'export',
        kecList,
        desaList,
        korlapList,
        pmlList,
        pclList
      };
    }

    case 'pbi': {
      const kecList = getSurveyKecList(surveyId).map(k => ({ kecamatan: k }));
      return {
        title: 'Pendataan PBI',
        activePage: 'pbi',
        pbiStats: [],
        filterKec,
        kecList
      };
    }

    case 'agent': {
      const appSettings = getSettings() || {};
      const geminiModels = appSettings.gemini_models_list
        ? appSettings.gemini_models_list.split(',').map(m => m.trim()).filter(Boolean)
        : ['gemini-2.5-flash', 'gemini-2.5-pro'];
      const openaiModels = appSettings.openai_models_list
        ? appSettings.openai_models_list.split(',').map(m => m.trim()).filter(Boolean)
        : ['gpt-4o'];
      return {
        title: 'Pananyo Taka AI',
        activePage: 'agent',
        provider: 'gemini',
        activeModel: 'gemini-2.5-flash',
        activeProvider: 'gemini',
        activeCategory: locals.surveyConfig ? locals.surveyConfig.name : 'Sakernas',
        geminiModels,
        openaiModels,
        openrouterModels: [],
        selectedGeminiModel: 'gemini-2.5-flash',
        selectedOpenAIModel: 'gpt-4o',
        selectedOpenRouterModel: '',
        hasKey: true,
        hasGeminiKey: true,
        hasOpenAIKey: !!(appSettings.openai_api_key),
        hasOpenRouterKey: !!(appSettings.openrouter_api_key),
        agentName: 'Pananyo Taka AI',
        surveyContext: surveyId
      };
    }

    case 'map': {
      const kecStats = getSurveyKecamatanStats(uploadId, settings, surveyId);
      return {
        title: 'Peta Progres',
        activePage: 'map',
        kecStats,
        filterKec
      };
    }

    default:
      return null;
  }
}

module.exports = { getSurveyData };
