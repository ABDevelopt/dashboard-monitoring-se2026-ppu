const express = require('express');
const router = express.Router();
const path = require('path');
const {
  getDb,
  getSharedDb,
  resolveSurveyId,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserByUsername,
  getPetugasEmails,
  searchPetugasEmails,
  getPetugasEmailById,
  insertPetugasEmail,
  updatePetugasEmail,
  deletePetugasEmail,
  resyncPetugasEmailsToMaster,
  getRefKecamatan,
  getRefDesa,
  getSurveyPetugasAssignments,
  assignPetugasToSurvey,
  getPetugasCrossSurveyStats
} = require('../database');

/**
 * Helper: Ambil daftar seluruh survei yang terkonfigurasi
 */
function getAvailableSurveys() {
  try {
    const surveysJson = require('../config/surveys.json');
    return Object.keys(surveysJson).map(key => ({
      id: key,
      name: surveysJson[key].shortName || surveysJson[key].name || key,
      fullName: surveysJson[key].name || key,
      category: surveysJson[key].category || 'Umum'
    }));
  } catch (_) {
    return [{ id: 'se2026', name: 'SE2026 PPU', fullName: 'Sensus Ekonomi 2026 PPU', category: 'Sensus' }];
  }
}

/**
 * GET /admin/petugas-alokasi
 * Halaman Utama Terpadu Manajemen Akses dan Alokasi Petugas
 */
router.get('/', (req, res) => {
  const activeTab = req.query.tab || 'alokasi'; // 'alokasi' | 'akses' | 'petugas' | 'beban'
  const surveyId = resolveSurveyId(req.query.survey || 'se2026');
  const kecFilter = req.query.kec || '';
  const desaFilter = req.query.desa || '';
  const q = req.query.q ? req.query.q.trim() : '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;

  const db = getDb(surveyId);
  const surveys = getAvailableSurveys();
  const allUsers = getAllUsers();
  const allPetugas = getPetugasEmails();
  const kecamatans = getRefKecamatan();
  let resolvedKodeKec = kecFilter;
  if (kecFilter && !/^\d+$/.test(kecFilter)) {
    const match = kecamatans.find(k => (k.nama_kecamatan || k.nama_kec || '').toUpperCase() === kecFilter.toUpperCase());
    if (match) resolvedKodeKec = match.kode_kec;
  }
  const desas = resolvedKodeKec ? getRefDesa(resolvedKodeKec) : [];

  // 1. Hitung Statistik Terpadu
  let totalSLS = 0;
  let assignedPclCount = 0;
  let assignedPmlCount = 0;
  let uniqueAssignedOfficers = 0;

  try {
    const statRow = db.prepare(`
      SELECT 
        COUNT(*) as total_sls,
        COUNT(DISTINCT CASE WHEN pcl IS NOT NULL AND TRIM(pcl) != '' THEN pcl END) as unique_pcl,
        COUNT(DISTINCT CASE WHEN pml IS NOT NULL AND TRIM(pml) != '' THEN pml END) as unique_pml
      FROM subsls_master
    `).get();
    if (statRow) {
      totalSLS = statRow.total_sls || 0;
      assignedPclCount = statRow.unique_pcl || 0;
      assignedPmlCount = statRow.unique_pml || 0;
    }

    const assignedNames = db.prepare(`
      SELECT DISTINCT LOWER(TRIM(pcl)) as name FROM subsls_master WHERE pcl IS NOT NULL AND TRIM(pcl) != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(pml)) as name FROM subsls_master WHERE pml IS NOT NULL AND TRIM(pml) != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(korlap)) as name FROM subsls_master WHERE korlap IS NOT NULL AND TRIM(korlap) != ''
    `).all();
    uniqueAssignedOfficers = assignedNames.length;
  } catch (err) {
    console.error('[Petugas Alokasi] Error calculating stats:', err.message);
  }

  // 2. Query Data Alokasi SubSLS
  let where = 'WHERE 1=1';
  const params = [];

  if (kecFilter) {
    where += ' AND (m.kecamatan = ? OR m.kode_kec = ?)';
    params.push(kecFilter, kecFilter);
  }
  if (desaFilter) {
    where += ' AND (m.desa = ? OR m.kode_desa = ?)';
    params.push(desaFilter, desaFilter);
  }
  if (q) {
    where += ' AND (m.kode LIKE ? OR m.nama_sls LIKE ? OR m.pcl LIKE ? OR m.pml LIKE ? OR m.korlap LIKE ?)';
    const s = `%${q}%`;
    params.push(s, s, s, s, s);
  }

  let totalAllocations = 0;
  let allocations = [];

  try {
    totalAllocations = db.prepare(`SELECT COUNT(*) as n FROM subsls_master m ${where}`).get(...params).n;
    allocations = db.prepare(`
      SELECT m.*,
             (SELECT COUNT(*) FROM progres p WHERE p.kode = m.kode) as has_progress
      FROM subsls_master m
      ${where}
      ORDER BY m.kecamatan, m.desa, m.nama_sls, m.kode
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
  } catch (err) {
    console.error('[Petugas Alokasi] Error querying allocations:', err.message);
  }

  const totalPages = Math.ceil(totalAllocations / limit) || 1;

  // 3. Query Matriks Beban Kerja Petugas (Workload Summary)
  let officerWorkloads = [];
  try {
    // Agregasi jumlah SLS per petugas di survei aktif
    const activeSurveyCounts = db.prepare(`
      SELECT LOWER(TRIM(pcl)) as nama, COUNT(*) as sls_count, 'PCL' as role FROM subsls_master WHERE pcl IS NOT NULL AND TRIM(pcl) != '' GROUP BY LOWER(TRIM(pcl))
      UNION ALL
      SELECT LOWER(TRIM(pml)) as nama, COUNT(*) as sls_count, 'PML' as role FROM subsls_master WHERE pml IS NOT NULL AND TRIM(pml) != '' GROUP BY LOWER(TRIM(pml))
    `).all();

    const countMap = {};
    for (const row of activeSurveyCounts) {
      if (!countMap[row.nama]) countMap[row.nama] = { pcl: 0, pml: 0, total: 0 };
      if (row.role === 'PCL') countMap[row.nama].pcl += row.sls_count;
      if (row.role === 'PML') countMap[row.nama].pml += row.sls_count;
      countMap[row.nama].total += row.sls_count;
    }

    officerWorkloads = allPetugas.map(p => {
      const cleanName = (p.nama_lengkap || '').toLowerCase().trim();
      const usage = countMap[cleanName] || { pcl: 0, pml: 0, total: 0 };
      let statusBeban = 'Cadangan';
      let badgeClass = 'bg-slate-100 text-slate-700 border-slate-300';

      if (usage.total > 15) {
        statusBeban = 'Beban Tinggi';
        badgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
      } else if (usage.total > 5) {
        statusBeban = 'Beban Ideal';
        badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      } else if (usage.total > 0) {
        statusBeban = 'Beban Ringan';
        badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
      }

      return {
        ...p,
        slsPcl: usage.pcl,
        slsPml: usage.pml,
        slsTotal: usage.total,
        statusBeban,
        badgeClass
      };
    }).sort((a, b) => b.slsTotal - a.slsTotal || a.nama_lengkap.localeCompare(b.nama_lengkap));
  } catch (err) {
    console.error('[Petugas Alokasi] Error calculating workloads:', err.message);
  }

  res.render('admin_petugas_alokasi', {
    title: 'Manajemen Akses & Alokasi Petugas Terpadu',
    activePage: 'petugas-alokasi',
    activeTab,
    surveyId,
    surveys,
    activeSurveyConfig: surveys.find(s => s.id === surveyId) || { id: surveyId, name: surveyId },
    kecFilter,
    desaFilter,
    kecamatans,
    desas,
    q,
    page,
    totalPages,
    totalAllocations,
    limit,
    allocations,
    users: allUsers,
    petugas: allPetugas,
    officerWorkloads,
    stats: {
      totalUsers: allUsers.length,
      totalPetugas: allPetugas.length,
      totalSLS,
      assignedPclCount,
      assignedPmlCount,
      uniqueAssignedOfficers,
      idleOfficersCount: Math.max(0, allPetugas.length - uniqueAssignedOfficers)
    }
  });
});

/**
 * GET /admin/petugas-alokasi/api/desa
 * Ambil daftar desa berdasarkan kecamatan (JSON)
 */
router.get('/api/desa', (req, res) => {
  const { kec } = req.query;
  if (!kec) return res.json({ success: true, data: [] });
  let resolvedKode = kec;
  if (!/^\d+$/.test(kec)) {
    const match = getRefKecamatan().find(k => (k.nama_kecamatan || k.nama_kec || '').toUpperCase() === kec.toUpperCase());
    if (match) resolvedKode = match.kode_kec;
  }
  const desas = getRefDesa(resolvedKode);
  res.json({ success: true, data: desas });
});

/**
 * POST /admin/petugas-alokasi/assign-sls
 * Menugaskan petugas lapangan (PCL, PML, Korlap) pada satu SLS tertentu
 */
router.post('/assign-sls', (req, res) => {
  const { survey_id, kode_sls, pcl_name, pml_name, korlap_name } = req.body;
  const surveyId = resolveSurveyId(survey_id || 'se2026');

  if (!kode_sls) {
    req.flash('error', 'Kode SLS wajib disertakan.');
    return res.redirect(`/admin/petugas-alokasi?survey=${surveyId}&tab=alokasi`);
  }

  try {
    const db = getDb(surveyId);
    const pclVal = (pcl_name || '').trim();
    const pmlVal = (pml_name || '').trim();
    const korlapVal = (korlap_name || '').trim();

    // Dapatkan info kontak dari ref_petugas jika ada
    const sharedDb = getSharedDb();
    const pclPetugas = pclVal ? sharedDb.prepare('SELECT id, email, sobat_id FROM ref_petugas WHERE LOWER(nama_lengkap) = LOWER(?)').get(pclVal) : null;
    const pmlPetugas = pmlVal ? sharedDb.prepare('SELECT id, email, sobat_id FROM ref_petugas WHERE LOWER(nama_lengkap) = LOWER(?)').get(pmlVal) : null;
    const korlapPetugas = korlapVal ? sharedDb.prepare('SELECT id, email, sobat_id FROM ref_petugas WHERE LOWER(nama_lengkap) = LOWER(?)').get(korlapVal) : null;

    db.prepare(`
      UPDATE subsls_master
      SET pcl = ?, pcl_id = ?, pcl_email = ?, pcl_sobat_id = ?,
          pml = ?, pml_id = ?, pml_email = ?, pml_sobat_id = ?,
          korlap = ?, korlap_id = ?, korlap_email = ?, korlap_sobat_id = ?
      WHERE kode = ?
    `).run(
      pclVal, pclPetugas ? pclPetugas.id : null, pclPetugas ? pclPetugas.email : null, pclPetugas ? pclPetugas.sobat_id : null,
      pmlVal, pmlPetugas ? pmlPetugas.id : null, pmlPetugas ? pmlPetugas.email : null, pmlPetugas ? pmlPetugas.sobat_id : null,
      korlapVal, korlapPetugas ? korlapPetugas.id : null, korlapPetugas ? korlapPetugas.email : null, korlapPetugas ? korlapPetugas.sobat_id : null,
      kode_sls
    );

    req.flash('success', `Alokasi petugas untuk SLS ${kode_sls} berhasil diperbarui.`);
  } catch (err) {
    console.error('[Petugas Alokasi] Error assigning SLS:', err.message);
    req.flash('error', `Gagal mengalokasikan petugas: ${err.message}`);
  }

  res.redirect(`/admin/petugas-alokasi?survey=${surveyId}&tab=alokasi`);
});

/**
 * POST /admin/petugas-alokasi/bulk-assign
 * Alokasi massal per wilayah (Kecamatan atau Desa)
 */
router.post('/bulk-assign', (req, res) => {
  const { survey_id, kecamatan, desa, target_role, officer_name } = req.body;
  const surveyId = resolveSurveyId(survey_id || 'se2026');

  if (!officer_name || !target_role) {
    req.flash('error', 'Petugas dan peran (PCL/PML) wajib dipilih.');
    return res.redirect(`/admin/petugas-alokasi?survey=${surveyId}&tab=alokasi`);
  }

  try {
    const db = getDb(surveyId);
    const sharedDb = getSharedDb();
    const officerInfo = sharedDb.prepare('SELECT id, email, sobat_id FROM ref_petugas WHERE LOWER(nama_lengkap) = LOWER(?)').get(officer_name.trim());

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (kecamatan) {
      whereClause += ' AND (kecamatan = ? OR kode_kec = ?)';
      params.push(kecamatan, kecamatan);
    }
    if (desa) {
      whereClause += ' AND (desa = ? OR kode_desa = ?)';
      params.push(desa, desa);
    }

    let updateSql = '';
    if (target_role === 'pcl') {
      updateSql = `UPDATE subsls_master SET pcl = ?, pcl_id = ?, pcl_email = ?, pcl_sobat_id = ? ${whereClause}`;
    } else if (target_role === 'pml') {
      updateSql = `UPDATE subsls_master SET pml = ?, pml_id = ?, pml_email = ?, pml_sobat_id = ? ${whereClause}`;
    } else if (target_role === 'korlap') {
      updateSql = `UPDATE subsls_master SET korlap = ?, korlap_id = ?, korlap_email = ?, korlap_sobat_id = ? ${whereClause}`;
    }

    const fullParams = [
      officer_name.trim(),
      officerInfo ? officerInfo.id : null,
      officerInfo ? officerInfo.email : null,
      officerInfo ? officerInfo.sobat_id : null,
      ...params
    ];

    const result = db.prepare(updateSql).run(...fullParams);
    req.flash('success', `Berhasil mengalokasikan ${result.changes} SLS kepada ${officer_name} sebagai ${target_role.toUpperCase()}.`);
  } catch (err) {
    console.error('[Petugas Alokasi] Error bulk assigning:', err.message);
    req.flash('error', `Gagal menjalankan alokasi massal: ${err.message}`);
  }

  res.redirect(`/admin/petugas-alokasi?survey=${surveyId}&tab=alokasi`);
});

/**
 * POST /admin/petugas-alokasi/clear-assignment
 * Melepaskan alokasi petugas pada SLS tertentu
 */
router.post('/clear-assignment', (req, res) => {
  const { survey_id, kode_sls, clear_role } = req.body;
  const surveyId = resolveSurveyId(survey_id || 'se2026');

  try {
    const db = getDb(surveyId);
    if (clear_role === 'pcl') {
      db.prepare('UPDATE subsls_master SET pcl = NULL, pcl_id = NULL, pcl_email = NULL, pcl_sobat_id = NULL WHERE kode = ?').run(kode_sls);
    } else if (clear_role === 'pml') {
      db.prepare('UPDATE subsls_master SET pml = NULL, pml_id = NULL, pml_email = NULL, pml_sobat_id = NULL WHERE kode = ?').run(kode_sls);
    } else {
      db.prepare(`
        UPDATE subsls_master 
        SET pcl = NULL, pcl_id = NULL, pcl_email = NULL, pcl_sobat_id = NULL,
            pml = NULL, pml_id = NULL, pml_email = NULL, pml_sobat_id = NULL
        WHERE kode = ?
      `).run(kode_sls);
    }
    req.flash('success', `Alokasi petugas pada SLS ${kode_sls} berhasil dilepaskan.`);
  } catch (err) {
    req.flash('error', `Gagal melepaskan alokasi: ${err.message}`);
  }

  res.redirect(`/admin/petugas-alokasi?survey=${surveyId}&tab=alokasi`);
});

/**
 * POST /admin/petugas-alokasi/create-user
 * Tambah Pengguna Baru (Manajemen Akses)
 */
router.post('/create-user', (req, res) => {
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password : '';
  const role = req.body.role ? req.body.role : 'user';

  if (!username || !password) {
    req.flash('error', 'Username dan password wajib diisi.');
    return res.redirect('/admin/petugas-alokasi?tab=akses');
  }

  const existing = getUserByUsername(username);
  if (existing) {
    req.flash('error', `Gagal: Username "${username}" sudah terdaftar.`);
    return res.redirect('/admin/petugas-alokasi?tab=akses');
  }

  try {
    createUser(username, password, role);
    req.flash('success', `Pengguna "${username}" dengan peran [${role}] berhasil dibuat.`);
  } catch (err) {
    req.flash('error', `Gagal membuat pengguna: ${err.message}`);
  }

  res.redirect('/admin/petugas-alokasi?tab=akses');
});

/**
 * POST /admin/petugas-alokasi/create-officer
 * Tambah Petugas Lapangan Baru (Direktori Petugas)
 */
router.post('/create-officer', (req, res) => {
  const nama_lengkap = req.body.nama_lengkap ? req.body.nama_lengkap.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const sobat_id = req.body.sobat_id ? req.body.sobat_id.trim() : '';
  const jenis_kelamin = req.body.jenis_kelamin ? req.body.jenis_kelamin.trim() : 'Lk';

  if (!nama_lengkap || !email) {
    req.flash('error', 'Nama lengkap dan email petugas wajib diisi.');
    return res.redirect('/admin/petugas-alokasi?tab=petugas');
  }

  try {
    insertPetugasEmail({ sobat_id, nama_lengkap, email, jenis_kelamin });
    req.flash('success', `Petugas "${nama_lengkap}" (${email}) berhasil ditambahkan ke direktori.`);
  } catch (err) {
    req.flash('error', `Gagal menambahkan petugas: ${err.message}`);
  }

  res.redirect('/admin/petugas-alokasi?tab=petugas');
});

/**
 * POST /admin/petugas-alokasi/resync-master
 * Sinkronisasi data email/Sobat ID ke master SLS seluruh survei
 */
router.post('/resync-master', (req, res) => {
  try {
    const activeSurvey = req.body.survey_id || 'se2026';
    const count = resyncPetugasEmailsToMaster(activeSurvey);
    req.flash('success', `Berhasil menyinkronkan profil kontak ke ${count} SLS pada survei [${activeSurvey}].`);
    res.redirect(`/admin/petugas-alokasi?survey=${activeSurvey}&tab=alokasi`);
  } catch (err) {
    req.flash('error', `Gagal menyinkronkan kontak master: ${err.message}`);
    res.redirect('/admin/petugas-alokasi');
  }
});

module.exports = router;
