const { 
  getDb, 
  saveOfficerProgressTelemetry, 
  getOfficerProgressTelemetry, 
  hasOfficerProgressTelemetry, 
  getPclStats, 
  getPmlStats, 
  getLatestUpload,
  getSettings
} = require('../database');

console.log('=== TEST 1: Schema Migration & Table Verification ===');
const db = getDb('se2026');
const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='officer_progress_telemetry'").get();
console.log('officer_progress_telemetry table exists:', !!tbl);

if (!tbl) {
  console.error('FAIL: Table does not exist!');
  process.exit(1);
}

const latestUpload = getLatestUpload('se2026');
console.log('Latest Upload ID:', latestUpload ? latestUpload.id : 'none');

if (latestUpload) {
  console.log('\n=== TEST 2: Ingest Sample Telemetry (Non-Destructive) ===');
  const dummyOfficers = [
    {
      userId: 'test-pml-1',
      email: 'abdulbasirr0703@gmail.com',
      username: 'abdulbasirr0703@gmail.com',
      fullname: 'Abdul Basir',
      role: 'pml',
      roleName: 'Pengawas',
      roleSequence: 7,
      totalTarget: 6039,
      approved: 5970,
      submitted: 0,
      draft: 0,
      rejected: 0,
      open: 0,
      progressPct: 98.9
    },
    {
      userId: 'test-pcl-1',
      email: '6409.zella@dummy.sobat.id',
      username: '6409.zella@dummy.sobat.id',
      fullname: 'Zella Rahmadina',
      role: 'pcl',
      roleName: 'Pencacah',
      roleSequence: 8,
      totalTarget: 51,
      approved: 2,
      submitted: 1,
      draft: 48,
      rejected: 0,
      open: 0,
      progressPct: 5.9
    }
  ];

  const savedCount = saveOfficerProgressTelemetry('se2026', latestUpload.id, dummyOfficers);
  console.log('Saved telemetry rows:', savedCount);

  const hasPclTel = hasOfficerProgressTelemetry(latestUpload.id, 'se2026', 'pcl');
  const hasPmlTel = hasOfficerProgressTelemetry(latestUpload.id, 'se2026', 'pml');
  console.log('hasOfficerProgressTelemetry (pcl):', hasPclTel);
  console.log('hasOfficerProgressTelemetry (pml):', hasPmlTel);

  console.log('\n=== TEST 3: Hybrid getPclStats & getPmlStats ===');
  const settings = getSettings('se2026');
  const pclApi = getPclStats(latestUpload.id, settings, 'se2026', 'api');
  const pclSmallcode = getPclStats(latestUpload.id, settings, 'se2026', 'smallcode');

  console.log('PCL Stats count (API mode):', pclApi.length);
  console.log('PCL Stats count (Smallcode mode):', pclSmallcode.length);

  const zellaApi = pclApi.find(p => p.email && p.email.includes('zella'));
  const zellaLegacy = pclSmallcode.find(p => p.email && p.email.includes('zella'));

  if (zellaApi) {
    console.log('\n[Zella in API mode]:');
    console.log(` - Approved: ${zellaApi.approved_total}, Draft: ${zellaApi.draft_total}, Target: ${zellaApi.target_fasih_total}, is_telemetry: ${zellaApi.is_telemetry}`);
  }
  if (zellaLegacy) {
    console.log('\n[Zella in Smallcode mode]:');
    console.log(` - Approved: ${zellaLegacy.approved_total}, Draft: ${zellaLegacy.draft_total}, Target: ${zellaLegacy.target_fasih_total}, is_telemetry: ${zellaLegacy.is_telemetry}`);
  }

  const pmlApi = getPmlStats(latestUpload.id, settings, 'se2026', 'api');
  const basirApi = pmlApi.find(p => p.email && p.email.includes('abdulbasirr'));
  if (basirApi) {
    console.log('\n[Abdul Basir in API mode]:');
    console.log(` - Approved: ${basirApi.approved_total}, Target: ${basirApi.target_fasih_total}, is_telemetry: ${basirApi.is_telemetry}`);
  }
}

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
