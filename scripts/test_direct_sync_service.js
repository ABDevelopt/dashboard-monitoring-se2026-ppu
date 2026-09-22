const fasihSyncService = require('../services/fasihSyncService');

async function main() {
  console.log('Testing syncOfficersProgressDirect for se2026...');
  const res = await fasihSyncService.syncOfficersProgressDirect('se2026');
  console.log('Result:', res);
}

main().catch(err => {
  console.error('Error in test:', err);
  process.exit(1);
});
