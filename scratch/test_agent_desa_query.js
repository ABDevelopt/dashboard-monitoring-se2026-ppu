const { fetchPageData } = require('d:/SE2026/monitoring-se2026-ppu/services/agentService');

async function main() {
  console.log('--- STARTING AGENT DESA QUERY TEST ---');

  // Test 1: Fetch all villages across all kecamatan
  console.log('\n1. Fetching all villages:');
  const res1 = fetchPageData('/kecamatan');
  console.log('Keys returned:', Object.keys(res1));
  console.log(`Found ${res1.desaStats.length} villages in total.`);
  if (res1.desaStats.length > 0) {
    console.log('Sample village from Babulu:', res1.desaStats.find(d => d.kecamatan.toLowerCase() === 'babulu'));
    console.log('Sample village from Sepaku:', res1.desaStats.find(d => d.kecamatan.toLowerCase() === 'sepaku'));
    console.log('✅ Test 1 Success: Retrieved all villages.');
  } else {
    console.error('❌ Test 1 Failed: No villages returned.');
  }

  // Test 2: Fetch villages for Sepaku only
  console.log('\n2. Fetching villages for Kecamatan Sepaku only:');
  const res2 = fetchPageData('/kecamatan', { kecamatan: 'Sepaku' });
  console.log(`Found ${res2.desaStats.length} villages in Sepaku.`);
  
  const nonSepaku = res2.desaStats.filter(d => d.kecamatan.toLowerCase() !== 'sepaku');
  if (nonSepaku.length > 0) {
    console.error('❌ Test 2 Failed: Found non-Sepaku villages:', nonSepaku);
  } else if (res2.desaStats.length === 0) {
    console.error('❌ Test 2 Failed: No villages returned for Sepaku.');
  } else {
    console.log('Villages in Sepaku:', res2.desaStats.map(d => d.desa));
    console.log('✅ Test 2 Success: Retrieved Sepaku villages only.');
  }

  console.log('\n--- ALL AGENT DESA QUERY TESTS COMPLETED ---');
}

main().catch(console.error);
