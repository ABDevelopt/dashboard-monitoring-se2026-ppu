const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { parseAndSaveJsonStatusOnly } = require('../services/excelParser');
const { rebuildSummaryCache } = require('../database');
const { buildAllocationRecords } = require('./build_sakernas_allocation');

const VERCEL_OUTPUT_DIR = 'C:/Users/ajian/vercel-agent-browser/output';
const PROJECT_ROOT = path.join(__dirname, '..');
const WS_PMU = path.join(PROJECT_ROOT, 'file_upload_workspace/sakernas-pemutakhiran');
const WS_PDT = path.join(PROJECT_ROOT, 'file_upload_workspace/sakernas-pendataan');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');

if (!fs.existsSync(WS_PMU)) fs.mkdirSync(WS_PMU, { recursive: true });
if (!fs.existsSync(WS_PDT)) fs.mkdirSync(WS_PDT, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

async function runSakernasPipeline() {
  console.log('=== [PIPELINE] MULAI PROSES KURASI DAN PEMUTAKHIRAN SAKERNAS ===\n');

  // 1. BACKUP DATABASE LAMA
  console.log('1. Membuat backup database SQLite Sakernas...');
  const pmuDbPath = path.join(PROJECT_ROOT, 'data/sakernas-pemutakhiran.db');
  const pdtDbPath = path.join(PROJECT_ROOT, 'data/sakernas-pendataan.db');

  if (fs.existsSync(pmuDbPath)) fs.copyFileSync(pmuDbPath, pmuDbPath + '.backup_pre_curation');
  if (fs.existsSync(pdtDbPath)) fs.copyFileSync(pdtDbPath, pdtDbPath + '.backup_pre_curation');
  console.log('   Backup selesai (.backup_pre_curation).\n');

  // 2. BANGUN DATA MASTER ALOKASI CLEANING
  console.log('2. Membangun data master alokasi yang sudah dibersihkan...');
  const pmuSourcePath = path.join(VERCEL_OUTPUT_DIR, 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260816_084522.json');
  const pdtSourcePath = path.join(VERCEL_OUTPUT_DIR, 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260816_084658.json');

  const pmuRaw = JSON.parse(fs.readFileSync(pmuSourcePath, 'utf8'));
  const pdtRaw = JSON.parse(fs.readFileSync(pdtSourcePath, 'utf8'));

  const pmuAllocation = buildAllocationRecords(pmuRaw, 'pemutakhiran');
  const pdtAllocation = buildAllocationRecords(pdtRaw, 'pendataan');

  console.log(`   Master Pemutakhiran: ${pmuAllocation.length} Blok Sensus, Total Target Muatan: ${pmuAllocation.reduce((a, b) => a + b.muatan, 0)} RT`);
  console.log(`   Master Pendataan: ${pdtAllocation.length} Blok Sensus, Total Target Sampel: ${pdtAllocation.reduce((a, b) => a + b.muatan, 0)} RT\n`);

  // 3. GENERATE FILE ALOKASI (EXCEL & JSON) UNTUK WORKSPACE & ROOT
  console.log('3. Menyimpan file alokasi terstruktur (Excel & JSON) ke workspace...');
  const colWidths = [
    { wch: 20 }, // kode
    { wch: 10 }, // kode_kec
    { wch: 16 }, // kecamatan
    { wch: 22 }, // desa
    { wch: 22 }, // nama_sls
    { wch: 12 }, // korlap
    { wch: 24 }, // pml (Pengawas)
    { wch: 24 }, // pcl (PPL)
    { wch: 14 }, // muatan (Keluarga / BS)
    { wch: 14 }, // target_fasih
    { wch: 30 }, // pcl_email
    { wch: 18 }, // pcl_sobat_id
    { wch: 30 }, // pml_email
    { wch: 18 }  // pml_sobat_id
  ];

  function writeExcelAllocation(rows, targetPath, surveyName) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, 'master');

    // Sheet rekapitulasi kecamatan
    const rekap = {};
    rows.forEach(r => {
      if (!rekap[r.kecamatan]) {
        rekap[r.kecamatan] = { kecamatan: r.kecamatan, jumlah_bs: 0, total_target: 0, pml: new Set(), ppl: new Set() };
      }
      rekap[r.kecamatan].jumlah_bs += 1;
      rekap[r.kecamatan].total_target += (r.muatan || 0);
      if (r.pml) rekap[r.kecamatan].pml.add(r.pml);
      if (r.pcl) rekap[r.kecamatan].ppl.add(r.pcl);
    });

    const rekapRows = Object.values(rekap).map(k => ({
      'Kecamatan': k.kecamatan,
      'Jumlah Blok Sensus': k.jumlah_bs,
      'Total Target': k.total_target,
      'Jumlah Pengawas (PML)': k.pml.size,
      'Jumlah Petugas Lapangan (PPL)': k.ppl.size
    }));
    const wsRekap = XLSX.utils.json_to_sheet(rekapRows);
    wsRekap['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, wsRekap, 'rekapitulasi_kecamatan');

    XLSX.writeFile(wb, targetPath);
  }

  // Simpan Pemutakhiran
  const pmuXlsxWs = path.join(WS_PMU, 'alokasi_petugas_sakernas_pemutakhiran.xlsx');
  const pmuJsonWs = path.join(WS_PMU, 'alokasi_petugas_sakernas_pemutakhiran.json');
  writeExcelAllocation(pmuAllocation, pmuXlsxWs, 'Pemutakhiran');
  fs.writeFileSync(pmuJsonWs, JSON.stringify(pmuAllocation, null, 2), 'utf8');

  // Copy ke root
  fs.copyFileSync(pmuXlsxWs, path.join(PROJECT_ROOT, 'alokasi_petugas_sakernas_pemutakhiran.xlsx'));
  fs.copyFileSync(pmuXlsxWs, path.join(PROJECT_ROOT, 'alokasi_sakernas_pemutakhiran.xlsx'));
  fs.copyFileSync(pmuJsonWs, path.join(PROJECT_ROOT, 'alokasi_petugas_sakernas_pemutakhiran.json'));
  fs.copyFileSync(pmuJsonWs, path.join(PROJECT_ROOT, 'alokasi_sakernas_pemutakhiran.json'));

  // Simpan Pendataan
  const pdtXlsxWs = path.join(WS_PDT, 'alokasi_petugas_sakernas_pendataan.xlsx');
  const pdtJsonWs = path.join(WS_PDT, 'alokasi_petugas_sakernas_pendataan.json');
  writeExcelAllocation(pdtAllocation, pdtXlsxWs, 'Pendataan');
  fs.writeFileSync(pdtJsonWs, JSON.stringify(pdtAllocation, null, 2), 'utf8');

  // Copy ke root
  fs.copyFileSync(pdtXlsxWs, path.join(PROJECT_ROOT, 'alokasi_petugas_sakernas_pendataan.xlsx'));
  fs.copyFileSync(pdtXlsxWs, path.join(PROJECT_ROOT, 'alokasi_sakernas_pendataan.xlsx'));
  fs.copyFileSync(pdtJsonWs, path.join(PROJECT_ROOT, 'alokasi_petugas_sakernas_pendataan.json'));
  fs.copyFileSync(pdtJsonWs, path.join(PROJECT_ROOT, 'alokasi_sakernas_pendataan.json'));

  console.log('   File alokasi (.xlsx & .json) berhasil dibuat di workspace dan project root.\n');

  // 4. RESET TABEL DATABASE DENGAN DATA MASTER BARU
  console.log('4. Memperbarui tabel subsls_master di database SQLite...');
  const dbPmu = new Database(pmuDbPath);
  const dbPdt = new Database(pdtDbPath);

  function resetAndSeedMaster(dbConn, allocationRows) {
    dbConn.transaction(() => {
      // Bersihkan data lama
      dbConn.prepare('DELETE FROM progres').run();
      dbConn.prepare('DELETE FROM summary_cache').run();
      dbConn.prepare('DELETE FROM uploads').run();
      dbConn.prepare('DELETE FROM subsls_master').run();

      const insertStmt = dbConn.prepare(`
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
        insertStmt.run(
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
  }

  resetAndSeedMaster(dbPmu, pmuAllocation);
  resetAndSeedMaster(dbPdt, pdtAllocation);
  dbPmu.close();
  dbPdt.close();
  console.log('   subsls_master untuk kedua survei berhasil di-seed ulang dengan 68 Blok Sensus.\n');

  // 5. KURASI FILE-FILE SAKERNAS DARI VERCEL AGENT BROWSER
  console.log('5. Mengkurasi dan mengimpor file progres harian Sakernas...');

  const pmuCuratedFiles = [
    { date: '2026-08-03', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260803_153021.json' },
    { date: '2026-08-04', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260804_165859.json' },
    { date: '2026-08-06', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260806_073757.json' },
    { date: '2026-08-08', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260808_200103.json' },
    { date: '2026-08-11', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260811_155036.json' },
    { date: '2026-08-16', file: 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260816_084522.json' }
  ];

  const pdtCuratedFiles = [
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

  console.log('   Importing Pemutakhiran files...');
  for (const item of pmuCuratedFiles) {
    const srcPath = path.join(VERCEL_OUTPUT_DIR, item.file);
    const wsPath = path.join(WS_PMU, item.file);
    const uploadPath = path.join(UPLOADS_DIR, `${Date.now()}_${item.file}`);

    // Salin ke workspace
    fs.copyFileSync(srcPath, wsPath);
    // Salin ke uploads folder
    fs.copyFileSync(srcPath, uploadPath);

    const res = parseAndSaveJsonStatusOnly(uploadPath, item.file, path.basename(uploadPath), item.date, 'sakernas-pemutakhiran');
    console.log(`   [PMU] ${item.date} (${item.file}) -> Upload ID: ${res.uploadId}, SubSLS: ${res.uniqueSubsls}`);
  }

  console.log('\n   Importing Pendataan files...');
  for (const item of pdtCuratedFiles) {
    const srcPath = path.join(VERCEL_OUTPUT_DIR, item.file);
    const wsPath = path.join(WS_PDT, item.file);
    const uploadPath = path.join(UPLOADS_DIR, `${Date.now()}_${item.file}`);

    // Salin ke workspace
    fs.copyFileSync(srcPath, wsPath);
    // Salin ke uploads folder
    fs.copyFileSync(srcPath, uploadPath);

    const res = parseAndSaveJsonStatusOnly(uploadPath, item.file, path.basename(uploadPath), item.date, 'sakernas-pendataan');
    console.log(`   [PDT] ${item.date} (${item.file}) -> Upload ID: ${res.uploadId}, SubSLS: ${res.uniqueSubsls}`);
  }

  // 6. REBUILD SUMMARY CACHE
  console.log('\n6. Membangun ulang seluruh summary cache...');
  const verifyDbPmu = new Database(pmuDbPath);
  const pmuUploads = verifyDbPmu.prepare('SELECT id FROM uploads ORDER BY id ASC').all();
  for (const u of pmuUploads) {
    rebuildSummaryCache(u.id, 'sakernas-pemutakhiran');
  }
  const pmuCacheCount = verifyDbPmu.prepare('SELECT COUNT(*) as n FROM summary_cache').get().n;
  console.log(`   Sakernas Pemutakhiran: ${pmuUploads.length} uploads, ${pmuCacheCount} summary cache records.`);

  const verifyDbPdt = new Database(pdtDbPath);
  const pdtUploads = verifyDbPdt.prepare('SELECT id FROM uploads ORDER BY id ASC').all();
  for (const u of pdtUploads) {
    rebuildSummaryCache(u.id, 'sakernas-pendataan');
  }
  const pdtCacheCount = verifyDbPdt.prepare('SELECT COUNT(*) as n FROM summary_cache').get().n;
  console.log(`   Sakernas Pendataan: ${pdtUploads.length} uploads, ${pdtCacheCount} summary cache records.`);

  verifyDbPmu.close();
  verifyDbPdt.close();

  console.log('\n=== [PIPELINE SELESAI DENGAN SUKSES] ===');
}

if (require.main === module) {
  runSakernasPipeline().catch(err => {
    console.error('Fatal Pipeline Error:', err);
    process.exit(1);
  });
}

module.exports = { runSakernasPipeline };
