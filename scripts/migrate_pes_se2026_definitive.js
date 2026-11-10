/**
 * Migration Script: Migrasi Alokasi Definitif 22 SLS PES SE2026
 * Menyinkronkan subsls_master, progres, summary_cache, ref_petugas, dan survey_petugas_assignment
 */

const { getDb, getSharedDb, harmonizePesSe2026, rebuildSummaryCache, getOverviewSummary, getSettings } = require('../database');

function runMigration() {
  console.log('=== MEMULAI MIGRASI DEFINITIF PES SE2026 ===');

  const db = getDb('pes-se2026');
  const sharedDb = getSharedDb();

  // 1. Jalankan fungsi harmonisasi definitif
  console.log('[1/5] Menjalankan harmonizePesSe2026...');
  harmonizePesSe2026(db);

  // 2. Verifikasi subsls_master
  console.log('[2/5] Verifikasi konsistensi subsls_master...');
  const totalMaster = db.prepare('SELECT count(*) as c, sum(target_fasih) as t FROM subsls_master').get();
  console.log(`- Total SLS Master: ${totalMaster.c} (Diharapkan: 22)`);
  console.log(`- Total Target FASIH: ${totalMaster.t} (Diharapkan: 2011)`);
  if (totalMaster.c !== 22 || totalMaster.t !== 2011) {
    throw new Error(`Master SLS mismatch! Count: ${totalMaster.c}, Target: ${totalMaster.t}`);
  }

  // Verifikasi PML
  const pmlStats = db.prepare(`
    SELECT pml, count(*) as sls_count, sum(target_fasih) as total_target 
    FROM subsls_master 
    GROUP BY pml 
    ORDER BY pml
  `).all();
  console.log('- Rincian PML di subsls_master:');
  console.table(pmlStats);

  const expectedPml = {
    'Fitrisia Taridipa S.Tr.Stat.': { sls: 8, target: 786 },
    'Nova Nauli Harahap': { sls: 7, target: 683 },
    'Sanjaya Abdillah Karim': { sls: 7, target: 542 }
  };

  for (const row of pmlStats) {
    const exp = expectedPml[row.pml];
    if (!exp) throw new Error(`PML tak terduga: ${row.pml}`);
    if (row.sls_count !== exp.sls || row.total_target !== exp.target) {
      throw new Error(`PML mismatch for ${row.pml}: got sls=${row.sls_count}, target=${row.total_target}, expected sls=${exp.sls}, target=${exp.target}`);
    }
  }

  // Verifikasi PCL
  const pclStats = db.prepare(`
    SELECT pcl, count(*) as sls_count, sum(target_fasih) as total_target 
    FROM subsls_master 
    GROUP BY pcl 
    ORDER BY pcl
  `).all();
  console.log(`- Total PCL unik: ${pclStats.length} (Diharapkan: 10)`);
  console.table(pclStats);

  if (pclStats.length !== 10) {
    throw new Error(`PCL count mismatch! Expected 10, got ${pclStats.length}`);
  }

  // Verifikasi kelengkapan metadata relasional di subsls_master
  const invalidRel = db.prepare(`
    SELECT count(*) as c 
    FROM subsls_master 
    WHERE pcl_id IS NULL OR pml_id IS NULL 
       OR pcl_assignment_id IS NULL OR pml_assignment_id IS NULL
       OR kode_kec IS NULL OR kode_desa IS NULL
  `).get().c;
  console.log(`- SLS dengan relasi tidak lengkap: ${invalidRel} (Diharapkan: 0)`);
  if (invalidRel > 0) {
    throw new Error(`Ada ${invalidRel} baris subsls_master dengan relasi ID/assignment NULL!`);
  }

  // 3. Verifikasi ref_petugas dan survey_petugas_assignment
  console.log('[3/5] Verifikasi direktori dan penugasan relasional...');
  const sharedCount = sharedDb.prepare("SELECT count(*) as c FROM ref_petugas WHERE email IN ('fitrisia.taridipa@bps.go.id', 'nova.harahap@bps.go.id', 's.karim@bps.go.id')").get().c;
  console.log(`- PML di ref_petugas shared.db: ${sharedCount} (Diharapkan: 3)`);
  if (sharedCount !== 3) throw new Error(`PML di shared.db belum lengkap! Got: ${sharedCount}`);

  const localAssignCount = db.prepare("SELECT count(*) as c FROM survey_petugas_assignment WHERE survey_id = 'pes-se2026'").get().c;
  console.log(`- Total record di survey_petugas_assignment (pes-se2026): ${localAssignCount} (Diharapkan: 13)`);
  if (localAssignCount !== 13) throw new Error(`Record survey_petugas_assignment mismatch! Got: ${localAssignCount}`);

  // 4. Verifikasi tabel progres & rebuild cache
  console.log('[4/5] Verifikasi konsistensi tabel progres...');
  const nullPclProgres = db.prepare("SELECT count(*) as c FROM progres WHERE pcl_name IS NULL OR pcl_name = ''").get().c;
  console.log(`- Baris progres dengan pcl_name NULL: ${nullPclProgres} (Diharapkan: 0)`);
  if (nullPclProgres > 0) {
    throw new Error(`Masih ada baris progres tanpa pcl_name: ${nullPclProgres}`);
  }

  // Rebuild seluruh summary_cache
  const uploads = db.prepare('SELECT id FROM uploads').all();
  console.log(`- Merebuild summary_cache untuk ${uploads.length} uploads...`);
  for (const u of uploads) {
    rebuildSummaryCache(u.id, 'pes-se2026');
  }

  // 5. Verifikasi Ringkasan Dashboard Overview & Workload
  console.log('[5/5] Verifikasi Ringkasan Dashboard Overview...');
  const latestUpload = db.prepare('SELECT id, tanggal, filename FROM uploads ORDER BY id DESC LIMIT 1').get();
  const settings = getSettings('pes-se2026');
  const summary = getOverviewSummary(latestUpload.id, settings, 'pes-se2026');

  console.log(`Upload #${latestUpload.id} (${latestUpload.tanggal}):`);
  console.log(`- Total Target FASIH: ${summary.target_fasih_total}`);
  console.log(`- Submitted by PCL: ${summary.submitted_total}`);
  console.log(`- Approved PML: ${summary.approved_total}`);
  console.log(`- Rejected PML: ${summary.rejected_total}`);
  console.log(`- Draft: ${summary.draft_total}`);
  console.log(`- Open: ${summary.open_total}`);
  console.log(`- Total Pengerjaan: ${(summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)}`);

  console.log('=== MIGRASI DEFINITIF PES SE2026 BERHASIL 100% ===');
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
