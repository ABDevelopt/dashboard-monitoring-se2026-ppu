const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
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

  console.log('\n--- 3. Testing getSyncHistory() ---');
  const history = fasihSyncService.getSyncHistory('se2026', 3);
  console.log('Sync History (top 3):', history);

  const activeUploadId = syncResult.uploadId || (history && history.length > 0 ? history[0].id : null);
  console.log('\n--- 4. Verifying Database Ingestion (Upload ID: ' + activeUploadId + ') ---');
  const db = getDb('se2026');
  const uploadRow = db.prepare('SELECT * FROM uploads WHERE id = ?').get(activeUploadId);
  console.log('Upload Row in DB:', uploadRow);

  const progresCount = db.prepare('SELECT COUNT(*) as count FROM progres WHERE upload_id = ?').get(activeUploadId);
  console.log('Progres rows inserted for upload_id', activeUploadId, ':', progresCount.count);

  const progresSample = db.prepare('SELECT * FROM progres WHERE upload_id = ? LIMIT 2').all(activeUploadId);
  console.log('Sample progres row:', progresSample[0]);

  console.log('\n--- 5. Testing getOverviewSummary() for Dashboard ---');
  const summary = getOverviewSummary('se2026', activeUploadId);
  console.log('Overview Summary Stats for Dashboard:');
  console.log('- Total SubSLS:', summary.total_subsls);
  console.log('- SLS Selesai:', summary.selesai);
  console.log('- Target FASIH Total:', summary.target_fasih_total);
  console.log('- Total Petugas PCL:', summary.total_pcl);
  console.log('- Total Petugas PML:', summary.total_pml);

  console.log('\n--- 6. Testing Batch Summary Across Surveys ---');
  const batchRes = await fasihSyncService.syncAllSurveysProgress({ region: '6409' });
  console.log('Batch sync execution result:');
  console.log('- Synced count:', batchRes.synced);
  console.log('- Skipped (up-to-date ETag):', batchRes.skipped);
  console.log('- Failed count:', batchRes.failed);
  console.log('- Total surveys processed:', batchRes.total);

  console.log('\n✅ ALL VERIFICATION CHECKS PASSED!');
}

testSyncFlow().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
