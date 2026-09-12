const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { getDb } = require('../database');

function generateAllocationFiles() {
  console.log('[Generator] Menyiapkan file alokasi Sakernas...');

  // Pastikan direktori workspace target ada
  const wsDirPmu = path.join(__dirname, '../file_upload_workspace/sakernas-pemutakhiran');
  const wsDirPdt = path.join(__dirname, '../file_upload_workspace/sakernas-pendataan');
  if (!fs.existsSync(wsDirPmu)) fs.mkdirSync(wsDirPmu, { recursive: true });
  if (!fs.existsSync(wsDirPdt)) fs.mkdirSync(wsDirPdt, { recursive: true });

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

  const pmuFile1 = path.join(__dirname, '../alokasi_sakernas_pemutakhiran.xlsx');
  const pmuFile2 = path.join(__dirname, '../alokasi_petugas_sakernas_pemutakhiran.xlsx');
  const pmuWsFile = path.join(wsDirPmu, 'alokasi_petugas_sakernas_pemutakhiran.xlsx');

  XLSX.writeFile(wbPmu, pmuFile1);
  XLSX.writeFile(wbPmu, pmuFile2);
  XLSX.writeFile(wbPmu, pmuWsFile);
  console.log(`[Generator] ✔ File alokasi Sakernas Pemutakhiran dibuat: ${pmuFile2}`);

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

  const pdtFile1 = path.join(__dirname, '../alokasi_sakernas_pendataan.xlsx');
  const pdtFile2 = path.join(__dirname, '../alokasi_petugas_sakernas_pendataan.xlsx');
  const pdtWsFile = path.join(wsDirPdt, 'alokasi_petugas_sakernas_pendataan.xlsx');

  XLSX.writeFile(wbPdt, pdtFile1);
  XLSX.writeFile(wbPdt, pdtFile2);
  XLSX.writeFile(wbPdt, pdtWsFile);
  console.log(`[Generator] ✔ File alokasi Sakernas Pendataan dibuat: ${pdtFile2}`);

  // ─── FILE 3: MASTER ALOKASI TERPADU DENGAN FORMAT JSON ───
  const pmuJson1 = path.join(__dirname, '../alokasi_sakernas_pemutakhiran.json');
  const pmuJson2 = path.join(__dirname, '../alokasi_petugas_sakernas_pemutakhiran.json');
  const pmuWsJson = path.join(wsDirPmu, 'alokasi_petugas_sakernas_pemutakhiran.json');
  const jsonContentPmu = JSON.stringify(rowsPmu, null, 2);
  fs.writeFileSync(pmuJson1, jsonContentPmu, 'utf8');
  fs.writeFileSync(pmuJson2, jsonContentPmu, 'utf8');
  fs.writeFileSync(pmuWsJson, jsonContentPmu, 'utf8');

  const pdtJson1 = path.join(__dirname, '../alokasi_sakernas_pendataan.json');
  const pdtJson2 = path.join(__dirname, '../alokasi_petugas_sakernas_pendataan.json');
  const pdtWsJson = path.join(wsDirPdt, 'alokasi_petugas_sakernas_pendataan.json');
  const jsonContentPdt = JSON.stringify(rowsPdt, null, 2);
  fs.writeFileSync(pdtJson1, jsonContentPdt, 'utf8');
  fs.writeFileSync(pdtJson2, jsonContentPdt, 'utf8');
  fs.writeFileSync(pdtWsJson, jsonContentPdt, 'utf8');

  // ─── FILE 4: FILE MONITORING STATUS FASIH (UNTUK MENU UPLOAD FASIH) ───
  const fasihRowsPmu = rowsPmu.map(r => ({
    level_6_full_code: r.kode,
    nama_kecamatan: r.kecamatan,
    nama_desa: r.desa,
    nama_sls: r.nama_sls,
    pengawas: r.pml,
    pencacah: r.pcl,
    target: r.target_fasih || r.muatan || 0,
    open: r.target_fasih || r.muatan || 0,
    draft: 0,
    submitted: 0,
    approved: 0,
    rejected: 0
  }));
  const wbFasihPmu = XLSX.utils.book_new();
  const wsFasihPmu = XLSX.utils.json_to_sheet(fasihRowsPmu);
  XLSX.utils.book_append_sheet(wbFasihPmu, wsFasihPmu, 'monitoring_status');
  const fasihPmuFile = path.join(__dirname, '../monitoring_fasih_sakernas_pemutakhiran.xlsx');
  const fasihPmuWsFile = path.join(wsDirPmu, 'monitoring_fasih_sakernas_pemutakhiran.xlsx');
  XLSX.writeFile(wbFasihPmu, fasihPmuFile);
  XLSX.writeFile(wbFasihPmu, fasihPmuWsFile);

  const fasihRowsPdt = rowsPdt.map(r => ({
    level_6_full_code: r.kode,
    nama_kecamatan: r.kecamatan,
    nama_desa: r.desa,
    nama_sls: r.nama_sls,
    pengawas: r.pml,
    pencacah: r.pcl,
    target: r.target_fasih || r.muatan || 10,
    open: r.target_fasih || r.muatan || 10,
    draft: 0,
    submitted: 0,
    approved: 0,
    rejected: 0
  }));
  const wbFasihPdt = XLSX.utils.book_new();
  const wsFasihPdt = XLSX.utils.json_to_sheet(fasihRowsPdt);
  XLSX.utils.book_append_sheet(wbFasihPdt, wsFasihPdt, 'monitoring_status');
  const fasihPdtFile = path.join(__dirname, '../monitoring_fasih_sakernas_pendataan.xlsx');
  const fasihPdtWsFile = path.join(wsDirPdt, 'monitoring_fasih_sakernas_pendataan.xlsx');
  XLSX.writeFile(wbFasihPdt, fasihPdtFile);
  XLSX.writeFile(wbFasihPdt, fasihPdtWsFile);

  console.log('[Generator] Selesai! Semua file alokasi master & monitoring FASIH siap diupload ke dasbor.');
  return {
    pmuExcel: pmuFile2,
    pdtExcel: pdtFile2,
    pmuJson: pmuJson2,
    pdtJson: pdtJson2,
    pmuFasih: fasihPmuFile,
    pdtFasih: fasihPdtFile,
    totalBs: rowsPmu.length
  };
}

if (require.main === module) {
  generateAllocationFiles();
}

module.exports = { generateAllocationFiles };
