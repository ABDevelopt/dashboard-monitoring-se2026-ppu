const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { getDb } = require('../database');

function generateAllocationFiles() {
  console.log('[Generator] Menyiapkan file alokasi Sakernas...');

  // 1. Ambil data dari database Sakernas Pemutakhiran
  const dbPmu = getDb('sakernas-pemutakhiran');
  const rowsPmu = dbPmu.prepare(`
    SELECT 
      kode,
      kode_kec,
      kecamatan,
      desa,
      nama_sls,
      korlap,
      pml,
      pcl,
      muatan,
      target_fasih,
      pcl_email,
      pcl_sobat_id,
      pml_email
    FROM subsls_master 
    ORDER BY kode_kec, desa, kode
  `).all();

  console.log(`[Generator] Ditemukan ${rowsPmu.length} record master Sakernas Pemutakhiran.`);

  // 2. Ambil data dari database Sakernas Pendataan
  const dbPdt = getDb('sakernas-pendataan');
  const rowsPdt = dbPdt.prepare(`
    SELECT 
      kode,
      kode_kec,
      kecamatan,
      desa,
      nama_sls,
      korlap,
      pml,
      pcl,
      muatan,
      target_fasih,
      pcl_email,
      pcl_sobat_id,
      pml_email
    FROM subsls_master 
    ORDER BY kode_kec, desa, kode
  `).all();

  console.log(`[Generator] Ditemukan ${rowsPdt.length} record master Sakernas Pendataan.`);

  // Setting lebar kolom yang rapi
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
    { wch: 30 }  // pml_email
  ];

  // ─── FILE 1: ALOKASI SAKERNAS PEMUTAKHIRAN (.xlsx) ───
  const wbPmu = XLSX.utils.book_new();
  const wsPmu = XLSX.utils.json_to_sheet(rowsPmu);
  wsPmu['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wbPmu, wsPmu, 'master');

  // Tambahkan sheet rekapitulasi petugas & alokasi per kecamatan
  const rekapKecPmu = {};
  rowsPmu.forEach(r => {
    if (!rekapKecPmu[r.kecamatan]) {
      rekapKecPmu[r.kecamatan] = { kecamatan: r.kecamatan, jumlah_bs: 0, total_muatan_keluarga: 0, target_fasih: 0, pml: new Set(), ppl: new Set() };
    }
    rekapKecPmu[r.kecamatan].jumlah_bs += 1;
    rekapKecPmu[r.kecamatan].total_muatan_keluarga += (r.muatan || 0);
    rekapKecPmu[r.kecamatan].target_fasih += (r.target_fasih || 0);
    if (r.pml) rekapKecPmu[r.kecamatan].pml.add(r.pml);
    if (r.pcl) rekapKecPmu[r.kecamatan].ppl.add(r.pcl);
  });

  const rekapRowsPmu = Object.values(rekapKecPmu).map(k => ({
    'Kecamatan': k.kecamatan,
    'Jumlah Blok Sensus Sampel': k.jumlah_bs,
    'Total Target Muatan Keluarga': k.total_muatan_keluarga,
    'Target Dokumen Listing (FASIH)': k.target_fasih,
    'Jumlah Pengawas (PML)': k.pml.size,
    'Jumlah Petugas Lapangan (PPL)': k.ppl.size
  }));
  const wsRekapPmu = XLSX.utils.json_to_sheet(rekapRowsPmu);
  wsRekapPmu['!cols'] = [{ wch: 18 }, { wch: 25 }, { wch: 28 }, { wch: 30 }, { wch: 22 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wbPmu, wsRekapPmu, 'rekapitulasi_kecamatan');

  const pmuFilePath = path.join(__dirname, '../alokasi_sakernas_pemutakhiran.xlsx');
  XLSX.writeFile(wbPmu, pmuFilePath);
  console.log(`[Generator] ✔ File alokasi Sakernas Pemutakhiran dibuat: ${pmuFilePath}`);

  // ─── FILE 2: ALOKASI SAKERNAS PENDATAAN (.xlsx) ───
  const wbPdt = XLSX.utils.book_new();
  const wsPdt = XLSX.utils.json_to_sheet(rowsPdt);
  wsPdt['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wbPdt, wsPdt, 'master');

  const rekapKecPdt = {};
  rowsPdt.forEach(r => {
    if (!rekapKecPdt[r.kecamatan]) {
      rekapKecPdt[r.kecamatan] = { kecamatan: r.kecamatan, jumlah_bs: 0, total_muatan_bs: 0, target_sampel_rt: 0, pml: new Set(), ppl: new Set() };
    }
    rekapKecPdt[r.kecamatan].jumlah_bs += 1;
    rekapKecPdt[r.kecamatan].total_muatan_bs += (r.muatan || 0);
    rekapKecPdt[r.kecamatan].target_sampel_rt += (r.target_fasih || 0);
    if (r.pml) rekapKecPdt[r.kecamatan].pml.add(r.pml);
    if (r.pcl) rekapKecPdt[r.kecamatan].ppl.add(r.pcl);
  });

  const rekapRowsPdt = Object.values(rekapKecPdt).map(k => ({
    'Kecamatan': k.kecamatan,
    'Jumlah Blok Sensus Sampel': k.jumlah_bs,
    'Total Muatan BS': k.total_muatan_bs,
    'Target Sampel Rumah Tangga (CAPI)': k.target_sampel_rt,
    'Jumlah Pengawas (PML)': k.pml.size,
    'Jumlah Petugas Lapangan (PPL)': k.ppl.size
  }));
  const wsRekapPdt = XLSX.utils.json_to_sheet(rekapRowsPdt);
  wsRekapPdt['!cols'] = [{ wch: 18 }, { wch: 25 }, { wch: 20 }, { wch: 32 }, { wch: 22 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wbPdt, wsRekapPdt, 'rekapitulasi_kecamatan');

  const pdtFilePath = path.join(__dirname, '../alokasi_sakernas_pendataan.xlsx');
  XLSX.writeFile(wbPdt, pdtFilePath);
  console.log(`[Generator] ✔ File alokasi Sakernas Pendataan dibuat: ${pdtFilePath}`);

  // ─── FILE 3: MASTER ALOKASI TERPADU DENGAN FORMAT CSV & JSON ───
  // Juga sediakan versi CSV dan JSON agar pengguna dapat mengunggah dengan berbagai format yang didukung
  const pmuJsonPath = path.join(__dirname, '../alokasi_sakernas_pemutakhiran.json');
  fs.writeFileSync(pmuJsonPath, JSON.stringify(rowsPmu, null, 2), 'utf8');

  const pdtJsonPath = path.join(__dirname, '../alokasi_sakernas_pendataan.json');
  fs.writeFileSync(pdtJsonPath, JSON.stringify(rowsPdt, null, 2), 'utf8');

  console.log('[Generator] Selesai! Semua file alokasi siap diupload ke dasbor.');
  return {
    pmuExcel: pmuFilePath,
    pdtExcel: pdtFilePath,
    pmuJson: pmuJsonPath,
    pdtJson: pdtJsonPath,
    totalBs: rowsPmu.length
  };
}

if (require.main === module) {
  generateAllocationFiles();
}

module.exports = { generateAllocationFiles };
