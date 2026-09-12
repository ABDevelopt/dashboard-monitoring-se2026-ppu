const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');

console.log('=== VERIFIKASI DATA DAN STATUS SAKERNAS ===\n');

// 1. Pemutakhiran DB
const pmuDb = new Database(path.join(PROJECT_ROOT, 'data/sakernas-pemutakhiran.db'));
const pmuMasterCount = pmuDb.prepare('SELECT COUNT(*) as n, SUM(muatan) as total_muatan, SUM(target_fasih) as total_fasih, COUNT(DISTINCT pml) as total_pml, COUNT(DISTINCT pcl) as total_ppl FROM subsls_master').get();
console.log('1. SAKERNAS PEMUTAKHIRAN DB:');
console.log('   - Master BS:', pmuMasterCount.n);
console.log('   - Total Muatan Keluarga:', pmuMasterCount.total_muatan);
console.log('   - Total Target FASIH:', pmuMasterCount.total_fasih);
console.log('   - Total Pengawas (PML):', pmuMasterCount.total_pml);
console.log('   - Total Petugas Lapangan (PPL):', pmuMasterCount.total_ppl);

const pmuUploads = pmuDb.prepare('SELECT id, tanggal, status_filename, total_subsls_terisi FROM uploads ORDER BY tanggal ASC').all();
console.log('   - Uploads (', pmuUploads.length, '):');
pmuUploads.forEach(u => {
  const cache = pmuDb.prepare('SELECT SUM(target_fasih_total) as total_muatan, SUM(muatan_selesai) as muatan_selesai, SUM(approved_total) as approved_total, SUM(submitted_total) as submitted_total, SUM(open_total) as open_total, SUM(draft_total) as draft_total FROM summary_cache WHERE upload_id = ?').get(u.id) || {};
  const progressPct = cache.total_muatan > 0 ? (((cache.approved_total || 0) + (cache.submitted_total || 0)) / cache.total_muatan * 100).toFixed(1) : '0.0';
  console.log(`     * ID ${u.id} | ${u.tanggal} | BS: ${u.total_subsls_terisi} | Progress: ${progressPct}% | Open: ${cache.open_total || 0} | Draft: ${cache.draft_total || 0} | Submitted: ${cache.submitted_total || 0} | Approved: ${cache.approved_total || 0} | Target: ${cache.total_muatan || 0}`);
});

// 2. Pendataan DB
console.log('\n2. SAKERNAS PENDATAAN DB:');
const pdtDb = new Database(path.join(PROJECT_ROOT, 'data/sakernas-pendataan.db'));
const pdtMasterCount = pdtDb.prepare('SELECT COUNT(*) as n, SUM(muatan) as total_muatan, SUM(target_fasih) as total_fasih, COUNT(DISTINCT pml) as total_pml, COUNT(DISTINCT pcl) as total_ppl FROM subsls_master').get();
console.log('   - Master BS:', pdtMasterCount.n);
console.log('   - Total Sampel RT (Muatan):', pdtMasterCount.total_muatan);
console.log('   - Total Target FASIH:', pdtMasterCount.total_fasih);
console.log('   - Total Pengawas (PML):', pdtMasterCount.total_pml);
console.log('   - Total Petugas Lapangan (PPL):', pdtMasterCount.total_ppl);

const pdtUploads = pdtDb.prepare('SELECT id, tanggal, status_filename, total_subsls_terisi FROM uploads ORDER BY tanggal ASC').all();
console.log('   - Uploads (', pdtUploads.length, '):');
pdtUploads.forEach(u => {
  const cache = pdtDb.prepare('SELECT SUM(target_fasih_total) as total_muatan, SUM(muatan_selesai) as muatan_selesai, SUM(approved_total) as approved_total, SUM(submitted_total) as submitted_total, SUM(open_total) as open_total, SUM(draft_total) as draft_total FROM summary_cache WHERE upload_id = ?').get(u.id) || {};
  const progressPct = cache.total_muatan > 0 ? (((cache.approved_total || 0) + (cache.submitted_total || 0)) / cache.total_muatan * 100).toFixed(1) : '0.0';
  console.log(`     * ID ${u.id} | ${u.tanggal} | BS: ${u.total_subsls_terisi} | Progress: ${progressPct}% | Open: ${cache.open_total || 0} | Draft: ${cache.draft_total || 0} | Submitted: ${cache.submitted_total || 0} | Approved: ${cache.approved_total || 0} | Target: ${cache.total_muatan || 0}`);
});

// 3. Workspace Files
console.log('\n3. WORKSPACE FILES:');
const wsPmu = path.join(PROJECT_ROOT, 'file_upload_workspace/sakernas-pemutakhiran');
const wsPdt = path.join(PROJECT_ROOT, 'file_upload_workspace/sakernas-pendataan');
console.log('   - sakernas-pemutakhiran:', fs.readdirSync(wsPmu));
console.log('   - sakernas-pendataan:', fs.readdirSync(wsPdt));

pmuDb.close();
pdtDb.close();
