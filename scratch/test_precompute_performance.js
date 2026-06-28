const { getLatestUpload, getOverviewSummary, getTrenHarian } = require('d:/SE2026/monitoring-se2026-ppu/database');

async function main() {
  const upload = getLatestUpload();
  if (!upload) {
    console.error('No upload data found.');
    return;
  }
  
  console.log('--- STARTING PERFORMANCE BENCHMARK ---');

  // Test getOverviewSummary
  const start1 = performance.now();
  const summary = getOverviewSummary(upload.id);
  const end1 = performance.now();
  console.log(`getOverviewSummary took ${(end1 - start1).toFixed(2)} ms.`);
  console.log('Total SubSLS:', summary.total);
  console.log('Completed SubSLS:', summary.selesai);
  console.log('Draft total:', summary.draft_total);

  // Test getTrenHarian
  const start2 = performance.now();
  const tren = getTrenHarian();
  const end2 = performance.now();
  console.log(`getTrenHarian took ${(end2 - start2).toFixed(2)} ms.`);
  console.log(`Number of uploads in trend: ${tren.length}`);
  if (tren.length > 0) {
    console.log('Last trend row completed:', tren[tren.length - 1].subsls_selesai);
  }

  console.log('--- BENCHMARK COMPLETED ---');
}

main().catch(console.error);
