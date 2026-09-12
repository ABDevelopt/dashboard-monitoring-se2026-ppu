/**
 * Script Seed Mandiri Dasbor Sakernas dari file_upload_workspace
 * BPS Kabupaten Penajam Paser Utara
 * 
 * Penggunaan:
 *   node scripts/seed_sakernas_from_workspace.js
 *   node scripts/seed_sakernas_from_workspace.js --force
 */

const fs = require('fs');
const path = require('path');
const { parseAndSaveJsonStatusOnly } = require('../services/excelParser');
const { rebuildSummaryCache, getDb } = require('../database');

const PROJECT_ROOT = path.join(__dirname, '..');
const WS_PMU = path.join(PROJECT_ROOT, 'file_upload_workspace/sakernas-pemutakhiran');
const WS_PDT = path.join(PROJECT_ROOT, 'file_upload_workspace/sakernas-pendataan');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PMU_FILES = [
  { date: '2026-08-03', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260803_153021.json' },
  { date: '2026-08-04', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260804_165859.json' },
  { date: '2026-08-06', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260806_073757.json' },
  { date: '2026-08-08', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260808_200103.json' },
  { date: '2026-08-11', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260811_155036.json' },
  { date: '2026-08-16', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260816_084522.json' }
];

const PDT_FILES = [
  { date: '2026-08-08', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260808_200145.json' },
  { date: '2026-08-11', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260811_160103.json' },
  { date: '2026-08-12', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260812_083856.json' },
  { date: '2026-08-16', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260816_084658.json' },
  { date: '2026-08-17', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260817_195822.json' },
  { date: '2026-08-19', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260819_195616.json' },
  { date: '2026-08-21', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260821_084821.json' },
  { date: '2026-08-24', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260824_081148.json' },
  { date: '2026-08-25', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260825_084551.json' },
  { date: '2026-08-27', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260827_083218.json' },
  { date: '2026-09-01', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260901_083055.json' },
  { date: '2026-09-08', file: 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260908_050009.json' }
];

function seedSurvey(surveyId, allocationJsonName, fileList, force = false) {
  const wsDir = surveyId === 'sakernas-pemutakhiran' ? WS_PMU : WS_PDT;
  const allocPath = path.join(wsDir, allocationJsonName);

  if (!fs.existsSync(allocPath)) {
    console.error('[SEED] File alokasi tidak ditemukan:', allocPath);
    return false;
  }

  const initDb = getDb(surveyId);
  const existingUploads = initDb.prepare('SELECT COUNT(*) as n FROM uploads').get().n;

  if (existingUploads > 0 && !force) {
    console.log('[SEED] ' + surveyId + ' sudah memiliki ' + existingUploads + ' uploads. Gunakan --force untuk seed ulang.');
    return false;
  }

  console.log('[SEED] Memproses ' + surveyId + ' (force=' + force + ')...');

  initDb.transaction(() => {
    initDb.prepare('DELETE FROM progres').run();
    initDb.prepare('DELETE FROM summary_cache').run();
    initDb.prepare('DELETE FROM uploads').run();
    initDb.prepare('DELETE FROM subsls_master').run();

    const allocationRows = JSON.parse(fs.readFileSync(allocPath, 'utf-8'));
    const insertMaster = initDb.prepare(`
      INSERT INTO subsls_master (
        kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan,
        kode_2025, target_fasih, target_honor, muatan_original,
        pcl_email, pcl_sobat_id, pml_email, pml_sobat_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    for (const r of allocationRows) {
      insertMaster.run(
        r.kode,
        r.kode_kec,
        r.kecamatan,
        r.desa,
        r.nama_sls,
        r.korlap || 'Lainnya',
        r.pml,
        r.pcl,
        r.muatan,
        r.kode,
        r.target_fasih,
        0,
        r.muatan,
        r.pcl_email,
        r.pcl_sobat_id,
        r.pml_email,
        r.pml_sobat_id
      );
    }
  })();

  console.log('   Master subsls_master ' + surveyId + ' berhasil di-seed.');

  for (const item of fileList) {
    const wsFile = path.join(wsDir, item.file);
    if (!fs.existsSync(wsFile)) {
      console.warn('   [WARN] File milestone tidak ditemukan:', wsFile);
      continue;
    }

    const uploadFilename = Date.now() + '_' + item.file;
    const uploadDst = path.join(UPLOADS_DIR, uploadFilename);
    fs.copyFileSync(wsFile, uploadDst);

    const res = parseAndSaveJsonStatusOnly(uploadDst, item.file, uploadFilename, item.date, surveyId);
    console.log('   [' + surveyId + '] ' + item.date + ' -> Upload ID: ' + res.uploadId);
  }

  const uploads = initDb.prepare('SELECT id FROM uploads ORDER BY id ASC').all();
  for (const u of uploads) {
    rebuildSummaryCache(u.id, surveyId);
  }
  console.log('   [' + surveyId + '] Selesai. ' + uploads.length + ' upload terproses.\n');
  return true;
}

function seedAll(force = false) {
  console.log('=== MEMULAI SINKRONISASI & SEED DATABASE SAKERNAS ===');
  seedSurvey('sakernas-pemutakhiran', 'alokasi_petugas_sakernas_pemutakhiran.json', PMU_FILES, force);
  seedSurvey('sakernas-pendataan', 'alokasi_petugas_sakernas_pendataan.json', PDT_FILES, force);
  console.log('=== SINKRONISASI SAKERNAS SELESAI ===');
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  seedAll(force);
}

module.exports = { seedAll, seedSurvey, PMU_FILES, PDT_FILES };
