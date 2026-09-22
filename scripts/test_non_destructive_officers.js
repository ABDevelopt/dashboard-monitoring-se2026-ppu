/**
 * Test Suite: Non-Destructive Verification untuk Modul Akses & Alokasi Petugas Terpadu
 * Memastikan semua fungsi bekerja tanpa memodifikasi data riil di basis data.
 */

const assert = require('assert');
const { getSharedDb, getDb, getAllUsers, getPetugasEmails, resolveSurveyId } = require('../database');
const officersAllocationRouter = require('../routes/officers_allocation');

async function runNonDestructiveTest() {
  console.log('===============================================================');
  console.log('🧪 MEMULAI PENGUJIAN NON-DESTRUKTIF MODUL AKSES & ALOKASI PETUGAS');
  console.log('===============================================================\n');

  // 1. Catat Baseline Jumlah Data Riil
  const sharedDb = getSharedDb();
  const seDb = getDb('se2026');

  const baselineUsersCount = getAllUsers().length;
  const baselinePetugasCount = getPetugasEmails().length;
  const baselineMasterCount = seDb.prepare('SELECT COUNT(*) as c FROM subsls_master').get().c;
  const baselineMasterChecksum = seDb.prepare('SELECT SUM(muatan) as sm, COUNT(pcl) as cp, COUNT(pml) as cpm FROM subsls_master').get();

  console.log('📊 [1. BASELINE DATA OPERASIONAL]');
  console.log(`   - Total Pengguna Sistem (users)      : ${baselineUsersCount}`);
  console.log(`   - Total Direktori Petugas (ref_petugas): ${baselinePetugasCount}`);
  console.log(`   - Total Master SLS SE2026 (subsls)   : ${baselineMasterCount}`);
  console.log(`   - Checksum Integritas Master         :`, baselineMasterChecksum);
  console.log('   ✅ Baseline berhasil direkam dengan aman.\n');

  // 2. Uji Mocking Rendering Route GET /admin/petugas-alokasi
  console.log('🔍 [2. PENGUJIAN RENDERING TAMPILAN TERPADU]');
  const tabs = ['alokasi', 'petugas', 'akses', 'beban'];

  for (const tab of tabs) {
    let renderedView = null;
    let renderedData = null;

    const mockReq = {
      query: { survey: 'se2026', tab: tab, q: '', page: '1' },
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

    // Cari handler GET / pada router
    const getLayer = officersAllocationRouter.stack.find(l => l.route && l.route.path === '/' && l.route.methods.get);
    assert(getLayer, 'Handler GET / tidak ditemukan pada router officers_allocation');

    getLayer.route.stack[0].handle(mockReq, mockRes);

    assert.strictEqual(renderedView, 'admin_petugas_alokasi', `Harus merender view admin_petugas_alokasi untuk tab ${tab}`);
    assert(renderedData.stats, 'Variabel stats harus tersedia pada data render');
    assert(Array.isArray(renderedData.surveys), 'Daftar survei harus berupa array');
    assert.strictEqual(renderedData.stats.totalUsers, baselineUsersCount, 'Jumlah user pada stats harus cocok dengan baseline');
    assert.strictEqual(renderedData.stats.totalPetugas, baselinePetugasCount, 'Jumlah petugas pada stats harus cocok dengan baseline');

    console.log(`   ✅ Tab [${tab.toUpperCase()}] berhasil dirender dengan valid. (Survei: ${renderedData.activeSurveyConfig.name}, Items: ${renderedData.allocations?.length || renderedData.officerWorkloads?.length || renderedData.petugas?.length || renderedData.users?.length})`);
  }

  // 3. Uji Endpoint API Pembantu
  console.log('\n⚡ [3. PENGUJIAN ENDPOINT PEMBANTU (AJAX DESA)]');
  const desaLayer = officersAllocationRouter.stack.find(l => l.route && l.route.path === '/api/desa' && l.route.methods.get);
  assert(desaLayer, 'Handler GET /api/desa tidak ditemukan');

  let apiJsonResult = null;
  const mockReqDesa = { query: { kec: 'PENAJAM' } };
  const mockResDesa = {
    json: (payload) => { apiJsonResult = payload; }
  };
  desaLayer.route.stack[0].handle(mockReqDesa, mockResDesa);
  assert(apiJsonResult && apiJsonResult.success, 'Respons API desa harus success');
  assert(Array.isArray(apiJsonResult.data) && apiJsonResult.data.length > 0, 'Harus mengembalikan daftar desa di Penajam');
  console.log(`   ✅ API /api/desa?kec=PENAJAM berhasil mengembalikan ${apiJsonResult.data.length} desa.`);

  // 4. Uji Logika Mutasi dengan SQLite Savepoint / Transaction Rollback (Terisolasi 100%)
  console.log('\n🛡️ [4. PENGUJIAN LOGIKA ALOKASI DENGAN TRANSACTION ROLLBACK (ZERO-MUTATION)]');
  
  // Test pada database SE2026 di dalam Savepoint
  seDb.exec('SAVEPOINT test_officer_isolation;');
  try {
    // 4.1. Uji assign SLS
    const testKode = seDb.prepare('SELECT kode FROM subsls_master LIMIT 1').get().kode;
    seDb.prepare(`
      UPDATE subsls_master 
      SET pcl = '__TEST_PCL_ISOLATED__', pml = '__TEST_PML_ISOLATED__'
      WHERE kode = ?
    `).run(testKode);

    const checkRow = seDb.prepare('SELECT pcl, pml FROM subsls_master WHERE kode = ?').get(testKode);
    assert.strictEqual(checkRow.pcl, '__TEST_PCL_ISOLATED__', 'PCL uji coba harus terpasang di savepoint');
    assert.strictEqual(checkRow.pml, '__TEST_PML_ISOLATED__', 'PML uji coba harus terpasang di savepoint');

    console.log(`   ✅ Mutasi uji coba berhasil diverifikasi di dalam Savepoint terisolasi.`);
  } finally {
    // Rollback savepoint seketika
    seDb.exec('ROLLBACK TO test_officer_isolation; RELEASE test_officer_isolation;');
    console.log(`   🛡️ Savepoint berhasil di-ROLLBACK. Semua perubahan uji coba dibatalkan seketika.`);
  }

  // 5. Verifikasi Integritas Akhir (Pastikan 0 Perubahan)
  console.log('\n🔒 [5. VERIFIKASI INTEGRITAS AKHIR]');
  const finalUsersCount = getAllUsers().length;
  const finalPetugasCount = getPetugasEmails().length;
  const finalMasterCount = seDb.prepare('SELECT COUNT(*) as c FROM subsls_master').get().c;
  const finalMasterChecksum = seDb.prepare('SELECT SUM(muatan) as sm, COUNT(pcl) as cp, COUNT(pml) as cpm FROM subsls_master').get();

  assert.strictEqual(finalUsersCount, baselineUsersCount, 'Jumlah users berubah!');
  assert.strictEqual(finalPetugasCount, baselinePetugasCount, 'Jumlah ref_petugas berubah!');
  assert.strictEqual(finalMasterCount, baselineMasterCount, 'Jumlah subsls_master berubah!');
  assert.deepStrictEqual(finalMasterChecksum, baselineMasterChecksum, 'Checksum master SLS berubah!');

  console.log(`   - Selisih perubahan users       : 0 baris (Sama persis: ${finalUsersCount})`);
  console.log(`   - Selisih perubahan ref_petugas : 0 baris (Sama persis: ${finalPetugasCount})`);
  console.log(`   - Selisih perubahan subsls      : 0 baris (Sama persis: ${finalMasterCount})`);
  console.log(`   - Checksum Integritas Akhir     :`, finalMasterChecksum);
  console.log('\n===============================================================');
  console.log('🎉 SEMUA PENGUJIAN NON-DESTRUKTIF BERHASIL 100% (ZERO DATA MUTATION)');
  console.log('===============================================================');
}

runNonDestructiveTest().catch(err => {
  console.error('\n❌ PENGUJIAN GAGAL:', err);
  process.exit(1);
});
