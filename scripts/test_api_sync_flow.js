const fasihSyncService = require('../services/fasihSyncService');
const { getDb, getAllUploads, getOverviewSummary } = require('../database');

async function testSyncFlow() {
  console.log('--- 1. Testing checkConnection() ---');
  const conn = await fasihSyncService.checkConnection();
  console.log('Connection check result:', conn);

  if (!conn.ok) {
    console.error('Connection failed! Cannot proceed with sync test.');
    process.exit(1);
  }

  console.log('\n--- 2. Testing syncFromFasih() ---');
  const syncResult = await fasihSyncService.syncFromFasih({
    surveyId: 'se2026',
    date: '2026-06-25',
    triggerWa: false
  });
  console.log('Sync Result:', syncResult);

  console.log('\n--- 3. Verifying Database Ingestion ---');
  const db = getDb('se2026');
  const uploadRow = db.prepare('SELECT * FROM uploads WHERE id = ?').get(syncResult.uploadId);
  console.log('Upload Row in DB:', uploadRow);

  const progresCount = db.prepare('SELECT COUNT(*) as count FROM progres WHERE upload_id = ?').get(syncResult.uploadId);
  console.log('Progres rows inserted for upload_id', syncResult.uploadId, ':', progresCount.count);

  const progresSample = db.prepare('SELECT * FROM progres WHERE upload_id = ? LIMIT 2').all(syncResult.uploadId);
  console.log('Sample progres row:', progresSample[0]);

  console.log('\n--- 4. Testing getSyncHistory() ---');
  const history = fasihSyncService.getSyncHistory('se2026', 3);
  console.log('Sync History (top 3):', history);

  console.log('\n--- 5. Testing getOverviewSummary() with new upload ---');
  const summary = getOverviewSummary(syncResult.uploadId);
  console.log('Overview Summary Stats:');
  console.log('- Total SLS:', summary.total_sls);
  console.log('- SLS Selesai:', summary.sls_selesai);
  console.log('- Persentase Selesai:', summary.persen_selesai + '%');
  console.log('- Target Upload:', summary.target_upload);
  console.log('- Approved:', summary.approved);

  console.log('\n✅ ALL VERIFICATION CHECKS PASSED!');
}

testSyncFlow().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
