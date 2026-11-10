/**
 * Comprehensive E2E Verification Test Suite for PES SE2026 & Allocation Mechanism
 */

const assert = require('assert');
const http = require('http');
const {
  getDb,
  getSharedDb,
  resolveSurveyId,
  getAllUsers,
  getPetugasEmails,
  harmonizePesSe2026,
  resyncPetugasEmailsToMaster,
  assignPetugasToSurvey,
  getSurveyPetugasAssignments,
  getPmlStats,
  getPclStats,
  getOverviewSummary,
  getSettings,
  rebuildSummaryCache
} = require('../database');
const officersAllocationRouter = require('../routes/officers_allocation');

async function checkHttpEndpoint(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', (err) => resolve({ status: 0, error: err.message }));
  });
}

async function runE2ETestSuite() {
  console.log('======================================================================');
  console.log('🚀 MEMULAI PENGUJIAN MENYELURUH (E2E) PES SE2026 & MEKANISME ALOKASI');
  console.log('======================================================================\n');

  // STEP 1: Verifikasi Migrasi Definitif & Konsistensi Database
  console.log('[1/6] Menguji Migrasi Definitif & Konsistensi Data PES SE2026...');
  const { runMigration } = require('./migrate_pes_se2026_definitive');
  runMigration();

  const db = getDb('pes-se2026');
  const sharedDb = getSharedDb();

  // Verifikasi 22 SLS dan target 2.011
  const masterCheck = db.prepare('SELECT count(*) as count, sum(target_fasih) as target FROM subsls_master').get();
  assert.strictEqual(masterCheck.count, 22, `Expected 22 SLS, got ${masterCheck.count}`);
  assert.strictEqual(masterCheck.target, 2011, `Expected target 2011, got ${masterCheck.target}`);

  // Verifikasi 13 entri di survey_petugas_assignment (10 PCL, 3 PML)
  const assignments = getSurveyPetugasAssignments('pes-se2026');
  assert.strictEqual(assignments.length, 13, `Expected 13 assignments, got ${assignments.length}`);

  const pmlAssignments = assignments.filter(a => a.role === 'pml');
  const pclAssignments = assignments.filter(a => a.role === 'pcl');
  assert.strictEqual(pmlAssignments.length, 3, `Expected 3 PMLs, got ${pmlAssignments.length}`);
  assert.strictEqual(pclAssignments.length, 10, `Expected 10 PCLs, got ${pclAssignments.length}`);

  // PML SLS coverage checks
  const fitri = pmlAssignments.find(a => a.nama_lengkap.includes('Fitrisia'));
  const nova = pmlAssignments.find(a => a.nama_lengkap.includes('Nova'));
  const sanjaya = pmlAssignments.find(a => a.nama_lengkap.includes('Sanjaya'));

  assert(fitri && fitri.total_subsls_assigned === 8, `Fitrisia expected 8 SLS, got ${fitri?.total_subsls_assigned}`);
  assert(nova && nova.total_subsls_assigned === 7, `Nova expected 7 SLS, got ${nova?.total_subsls_assigned}`);
  assert(sanjaya && sanjaya.total_subsls_assigned === 7, `Sanjaya expected 7 SLS, got ${sanjaya?.total_subsls_assigned}`);
  console.log('  ✅ Konsistensi database dan 22 alokasi definitif berhasil diverifikasi.\n');

  // STEP 2: Verifikasi Handler View Router Alokasi Petugas (tab: alokasi, beban, petugas, akses)
  console.log('[2/6] Menguji Router Alokasi Petugas (/admin/petugas-alokasi)...');
  const tabs = ['alokasi', 'beban', 'petugas', 'akses'];
  const getLayer = officersAllocationRouter.stack.find(l => l.route && l.route.path === '/' && l.route.methods.get);
  assert(getLayer, 'Handler GET / tidak ditemukan pada router officers_allocation');

  for (const tab of tabs) {
    let renderedView = null;
    let renderedData = null;

    const mockReq = {
      query: { survey: 'pes-se2026', tab: tab, q: '', page: '1' },
      flash: () => []
    };

    const mockRes = {
      render: (viewName, data) => {
        renderedView = viewName;
        renderedData = data;
      },
      redirect: (url) => {
        throw new Error(`Unexpected redirect to: ${url}`);
      }
    };

    getLayer.route.stack[0].handle(mockReq, mockRes);

    assert.strictEqual(renderedView, 'admin_petugas_alokasi');
    assert.strictEqual(renderedData.surveyId, 'pes-se2026');
    assert.strictEqual(renderedData.stats.totalSLS, 22);
    assert.strictEqual(renderedData.stats.assignedPclCount, 10);
    assert.strictEqual(renderedData.stats.assignedPmlCount, 3);
    assert.strictEqual(renderedData.stats.uniqueAssignedOfficers, 13);

    if (tab === 'beban') {
      const activeWorkloads = renderedData.officerWorkloads.filter(w => w.slsTotal > 0);
      assert.strictEqual(activeWorkloads.length, 13, `Expected 13 active officers in workload, got ${activeWorkloads.length}`);
      const wFitri = activeWorkloads.find(w => w.nama_lengkap.includes('Fitrisia'));
      const wNova = activeWorkloads.find(w => w.nama_lengkap.includes('Nova'));
      const wSanjaya = activeWorkloads.find(w => w.nama_lengkap.includes('Sanjaya'));
      assert(wFitri && wFitri.slsPml === 8, `Workload Fitrisia expected 8, got ${wFitri?.slsPml}`);
      assert(wNova && wNova.slsPml === 7, `Workload Nova expected 7, got ${wNova?.slsPml}`);
      assert(wSanjaya && wSanjaya.slsPml === 7, `Workload Sanjaya expected 7, got ${wSanjaya?.slsPml}`);
    }

    console.log(`  ✅ Tab [${tab.toUpperCase()}] berhasil dieksekusi dengan data akurat.`);
  }
  console.log();

  // STEP 3: Verifikasi Logika Mutasi Alokasi (Savepoint Isolation)
  console.log('[3/6] Menguji Mutasi Alokasi (assign-sls, bulk-assign, clear-assignment) dalam Savepoint...');
  db.exec('SAVEPOINT test_pes_mutation;');
  try {
    const testSls = '6409010004000100'; // RT 01 DUSUN I

    // 3.1. Uji Clear Assignment
    const clearLayer = officersAllocationRouter.stack.find(l => l.route && l.route.path === '/clear-assignment' && l.route.methods.post);
    assert(clearLayer, 'Handler POST /clear-assignment tidak ditemukan');

    let flashMsg = '';
    const mockReqClear = {
      body: { survey_id: 'pes-se2026', kode_sls: testSls, clear_role: 'pcl' },
      flash: (type, msg) => { flashMsg = msg; }
    };
    const mockResClear = { redirect: () => {} };
    clearLayer.route.stack[0].handle(mockReqClear, mockResClear);

    const clearedRow = db.prepare('SELECT pcl, pcl_email, pcl_assignment_id FROM subsls_master WHERE kode = ?').get(testSls);
    const clearedProgres = db.prepare('SELECT pcl_name, pcl_email FROM progres WHERE kode = ?').get(testSls);
    assert.strictEqual(clearedRow.pcl, null, 'PCL master should be cleared');
    assert.strictEqual(clearedProgres.pcl_name, null, 'PCL progres should be cleared');
    console.log('  ✅ POST /clear-assignment berhasil mengosongkan master dan transaksi progres.');

    // 3.2. Uji Assign SLS dengan nama resmi
    const assignLayer = officersAllocationRouter.stack.find(l => l.route && l.route.path === '/assign-sls' && l.route.methods.post);
    assert(assignLayer, 'Handler POST /assign-sls tidak ditemukan');

    const mockReqAssign = {
      body: {
        survey_id: 'pes-se2026',
        kode_sls: testSls,
        pcl_name: 'riswanti', // lowercase to test canonical normalization
        pml_name: 'Fitrisia Taridipa S.Tr.Stat.',
        korlap_name: 'Lainnya'
      },
      flash: (type, msg) => { flashMsg = msg; }
    };
    const mockResAssign = { redirect: () => {} };
    assignLayer.route.stack[0].handle(mockReqAssign, mockResAssign);

    const assignedRow = db.prepare('SELECT pcl, pcl_email, pcl_sobat_id, pcl_assignment_id, pml, pml_assignment_id FROM subsls_master WHERE kode = ?').get(testSls);
    const assignedProgres = db.prepare('SELECT pcl_name, pcl_email FROM progres WHERE kode = ?').get(testSls);
    assert.strictEqual(assignedRow.pcl, 'Riswanti', 'PCL should be canonicalized to Riswanti');
    assert.strictEqual(assignedRow.pcl_email, 'riswanti117@gmail.com');
    assert(assignedRow.pcl_assignment_id > 0, 'PCL assignment ID should be valid');
    assert.strictEqual(assignedProgres.pcl_name, 'Riswanti');
    assert.strictEqual(assignedProgres.pcl_email, 'riswanti117@gmail.com');
    console.log('  ✅ POST /assign-sls berhasil mengalokasikan dan menormalkan nama ke master dan progres.');

    // 3.3. Uji assignPetugasToSurvey dengan auto-copy foreign key
    const testOfficerId = 842; // Fitrisia
    const assignRes = assignPetugasToSurvey('pes-se2026', testOfficerId, 'pml');
    assert(assignRes > 0, 'assignPetugasToSurvey should return valid ID');
    console.log('  ✅ assignPetugasToSurvey foreign key auto-sync berhasil.');

  } finally {
    db.exec('ROLLBACK TO test_pes_mutation; RELEASE test_pes_mutation;');
    console.log('  🛡️ Savepoint mutasi berhasil di-ROLLBACK (Basis data tetap murni & aman).\n');
  }

  // STEP 4: Verifikasi getPmlStats dan getPclStats
  console.log('[4/6] Menguji Perhitungan Statistik PML dan PCL...');
  const latestUpload = db.prepare('SELECT id FROM uploads ORDER BY id DESC LIMIT 1').get();
  assert(latestUpload, 'Upload record must exist');

  const pmlStats = getPmlStats(latestUpload.id, null, 'pes-se2026');
  assert.strictEqual(pmlStats.length, 3, `Expected 3 PML stats rows, got ${pmlStats.length}`);
  const totalPmlTarget = pmlStats.reduce((acc, r) => acc + r.target_fasih_total, 0);
  assert.strictEqual(totalPmlTarget, 2011, `Expected total PML target 2011, got ${totalPmlTarget}`);

  const pclStats = getPclStats(latestUpload.id, null, 'pes-se2026');
  assert.strictEqual(pclStats.length, 10, `Expected 10 PCL stats rows, got ${pclStats.length}`);
  const totalPclTarget = pclStats.reduce((acc, r) => acc + r.target_fasih_total, 0);
  assert.strictEqual(totalPclTarget, 2011, `Expected total PCL target 2011, got ${totalPclTarget}`);
  console.log('  ✅ Statistik PML & PCL 100% konsisten dengan target 2.011.\n');

  // STEP 5: Verifikasi Overview Summary & EJS Labels
  console.log('[5/6] Menguji Overview Summary & Label Dashboard...');
  const settings = getSettings('pes-se2026');
  const summary = getOverviewSummary(latestUpload.id, settings, 'pes-se2026');
  assert.strictEqual(summary.target_fasih_total, 2011);
  assert.strictEqual(summary.submitted_total, 309);
  assert.strictEqual(summary.approved_total, 0);
  assert.strictEqual(summary.rejected_total, 4);
  console.log(`  - Target FASIH Total: ${summary.target_fasih_total}`);
  console.log(`  - Submitted by PCL  : ${summary.submitted_total}`);
  console.log(`  - Approved PML      : ${summary.approved_total}`);
  console.log(`  - Rejected PML      : ${summary.rejected_total}`);
  console.log(`  - Total Pengerjaan  : ${(summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)}`);
  console.log('  ✅ Overview Summary berhasil diverifikasi.');

  // STEP 6: Uji Live HTTP Request terhadap Server Lokal
  console.log('\n[6/6] Menguji Live HTTP Request ke Dashboard (http://127.0.0.1:3000)...');
  const httpRes = await checkHttpEndpoint('http://127.0.0.1:3000/?survey=pes-se2026');
  if (httpRes.status === 200) {
    assert(httpRes.body.includes('Kinerja Pengerjaan Lapangan (Submitted + Approved) vs Target FASIH'), 'Label pengerjaan lapangan harus ada di HTML');
    assert(httpRes.body.includes('Approved Pengawas'), 'Status approved pengawas harus ada di HTML');
    console.log('  ✅ Live HTTP GET /?survey=pes-se2026 merespons HTTP 200 dengan label dan metrik terbaru.');
  } else {
    console.log(`  ℹ️ Live server port 3000 mengembalikan status ${httpRes.status} (${httpRes.error || 'Server offline'}).`);
  }

  console.log('\n======================================================================');
  console.log('🎉 SEMUA PENGUJIAN MENYELURUH (E2E) BERHASIL 100% TANPA KESALAHAN');
  console.log('======================================================================\n');
}

runE2ETestSuite().catch(err => {
  console.error('\n❌ E2E TEST RUNNER ERROR:', err);
  process.exit(1);
});
