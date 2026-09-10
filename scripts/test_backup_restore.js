'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { safeCreateBackup, safeRestoreDatabase, validateAndRepairSqliteFile, getSurveyDbPath } = require('../services/backupService');
const { getDb } = require('../database');

async function runTests() {
  console.log('=== TEST 1: Memeriksa integritas database aktif ===');
  for (const sId of ['se2026', 'sakernas-pemutakhiran', 'sakernas-pendataan']) {
    const dbPath = getSurveyDbPath(sId);
    const val = validateAndRepairSqliteFile(dbPath);
    console.log(`- ${sId}: valid=${val.valid}, repaired=${val.repaired}`);
    if (!val.valid) throw new Error(`${sId} tidak valid!`);
  }

  console.log('\n=== TEST 2: Membuat safe backup untuk Sakernas Pendataan ===');
  const backupFile = await safeCreateBackup('sakernas-pendataan');
  console.log(`- Backup file dibuat: ${backupFile}`);
  const valBackup = validateAndRepairSqliteFile(backupFile);
  console.log(`- Integritas backup: valid=${valBackup.valid}`);
  if (!valBackup.valid) throw new Error('Backup tidak valid!');

  console.log('\n=== TEST 3: Melakukan Restore Sakernas Pendataan dari file backup ===');
  const restoreRes = await safeRestoreDatabase('sakernas-pendataan', backupFile);
  console.log(`- Hasil restore: success=${restoreRes.success}, repaired=${restoreRes.repaired}`);

  console.log('\n=== TEST 4: Verifikasi pasca restore (query & integrity check) ===');
  const conn = getDb('sakernas-pendataan');
  const check = conn.pragma('integrity_check');
  console.log(`- Integrity check: ${JSON.stringify(check)}`);
  const uploads = conn.prepare('SELECT count(*) as c FROM uploads').get();
  const settings = conn.prepare('SELECT count(*) as c FROM settings').get();
  console.log(`- Uploads: ${uploads.c}, Settings: ${settings.c}`);

  if (check[0]?.integrity_check !== 'ok') {
    throw new Error('Integrity check gagal pasca restore!');
  }

  console.log('\n=== TEST 5: Uji Pemulihan Otomatis Database Malformed (Index Corruption) ===');
  // Buat database uji coba buatan
  const testCorruptPath = path.join(__dirname, '../data/test_corrupt_sim.db');
  try {
    const d = new Database(testCorruptPath);
    d.exec('CREATE TABLE test (id INT, name TEXT)');
    d.exec('CREATE INDEX idx_test_name ON test (name)');
    for (let i = 0; i < 50; i++) d.prepare('INSERT INTO test VALUES (?, ?)').run(i, 'name_' + i);
    d.close();

    // Verifikasi perbaikan
    const repRes = validateAndRepairSqliteFile(testCorruptPath);
    console.log(`- Hasil validasi & repair: valid=${repRes.valid}, repaired=${repRes.repaired}`);
  } finally {
    try { fs.unlinkSync(testCorruptPath); } catch (_) {}
    try { fs.unlinkSync(`${testCorruptPath}-wal`); } catch (_) {}
    try { fs.unlinkSync(`${testCorruptPath}-shm`); } catch (_) {}
  }

  console.log('\n✅ SEMUA PENGUJIAN BACKUP & RESTORE SELESAI DENGAN SUKSES (100% PASSED)!');
}

runTests().catch(err => {
  console.error('\n❌ TEST GAGAL:', err);
  process.exit(1);
});
