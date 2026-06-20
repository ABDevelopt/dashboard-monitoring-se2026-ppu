const XLSX = require('xlsx');
const path = require('path');
const { getDb } = require('../database');
const fs = require('fs');

// Load master data dari JSON (dijalankan sekali saat startup)
function loadMasterFromJson(jsonPath) {
  const db = getDb();
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const insert = db.prepare(`
    INSERT OR REPLACE INTO subsls_master 
      (kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, kode_2025)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });

  const rows = [];
  for (const kec of raw) {
    const kecNama = kec.nama_kec || '';
    const kecKode = kec.kode_kec || '';
    for (const desa of kec.desa || []) {
      const desaNama = desa.nama_desa || '';
      for (const sls of desa.sls || []) {
        const slsNama = sls.nama_sls || '';
        for (const subsls of sls.subsls || []) {
          rows.push([
            subsls.id_subsls,
            kecKode,
            toTitleCase(kecNama),
            toTitleCase(desaNama),
            slsNama,
            subsls.nama_korlap || '',
            normalizeName(subsls.nama_pml || ''),
            normalizeName(subsls.nama_pcl || ''),
            subsls.total_muatan_assignment || 0,
            subsls.id_subsls_2025 || subsls.id_subsls
          ]);
        }
      }
    }
  }

  insertMany(rows);
  return rows.length;
}

// Parse Excel dan simpan ke DB
function parseAndSaveExcel(filePath, originalName, tanggal) {
  const db = getDb();
  const wb = XLSX.readFile(filePath, { raw: true });

  // Ambil sheet query
  const ws = wb.Sheets['query'];
  if (!ws) throw new Error('Sheet "query" tidak ditemukan dalam file Excel.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
  if (rows.length < 2) throw new Error('Sheet "query" kosong.');

  // Header row index 0
  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());

  // Cari index kolom
  const colIdx = {
    desa: headers.indexOf('desa'),
    kode: headers.indexOf('level_6_full_code'),
    usaha_tidak_ditemukan: headers.indexOf('usaha_tidak_ditemukan'),
    usaha_ditemukan: headers.indexOf('usaha_ditemukan'),
    usaha_baru: headers.indexOf('usaha_baru'),
    usaha_tutup: headers.indexOf('usaha_tutup'),
    usaha_ganda: headers.indexOf('usaha_ganda'),
    tidak_ditemukan: headers.indexOf('tidak_ditemukan'),
    ditemukan: headers.indexOf('ditemukan'),
    keluarga_baru: headers.indexOf('keluarga_baru'),
    meninggal: headers.indexOf('meninggal'),
    tidak_eligible: headers.indexOf('tidak_eligible'),
    tidak_dapat_ditemui: headers.indexOf('tidak_dapat_ditemui'),
    rumah_tunggal: headers.indexOf('rumah_tunggal'),
    rumah_deret: headers.indexOf('rumah_deret'),
    rumah_susun: headers.indexOf('rumah_susun'),
    apartemen: headers.indexOf('apartemen'),
    lainnya: headers.indexOf('lainnya'),
  };

  // Insert upload record
  const uploadStmt = db.prepare(`
    INSERT INTO uploads (filename, tanggal, total_subsls_terisi) VALUES (?, ?, ?)
  `);

  // Collect data rows
  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const kode = String(row[colIdx.kode] || '').trim();
    if (!kode || kode.length < 10) continue;

    dataRows.push({
      kode,
      usaha_tidak_ditemukan: toInt(row[colIdx.usaha_tidak_ditemukan]),
      usaha_ditemukan: toInt(row[colIdx.usaha_ditemukan]),
      usaha_baru: toInt(row[colIdx.usaha_baru]),
      usaha_tutup: toInt(row[colIdx.usaha_tutup]),
      usaha_ganda: toInt(row[colIdx.usaha_ganda]),
      tidak_ditemukan: toInt(row[colIdx.tidak_ditemukan]),
      ditemukan: toInt(row[colIdx.ditemukan]),
      keluarga_baru: toInt(row[colIdx.keluarga_baru]),
      meninggal: toInt(row[colIdx.meninggal]),
      tidak_eligible: toInt(row[colIdx.tidak_eligible]),
      tidak_dapat_ditemui: toInt(row[colIdx.tidak_dapat_ditemui]),
      rumah_tunggal: toInt(row[colIdx.rumah_tunggal]),
      rumah_deret: toInt(row[colIdx.rumah_deret]),
      rumah_susun: toInt(row[colIdx.rumah_susun]),
      apartemen: toInt(row[colIdx.apartemen]),
      lainnya: toInt(row[colIdx.lainnya]),
    });
  }

  // Insert semua dalam transaksi
  const insertProgres = db.prepare(`
    INSERT OR REPLACE INTO progres 
      (upload_id, kode,
       usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
       tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
       rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const doInsert = db.transaction((uploadId, rows) => {
    for (const r of rows) {
      insertProgres.run(
        uploadId, r.kode,
        r.usaha_tidak_ditemukan, r.usaha_ditemukan, r.usaha_baru, r.usaha_tutup, r.usaha_ganda,
        r.tidak_ditemukan, r.ditemukan, r.keluarga_baru, r.meninggal, r.tidak_eligible, r.tidak_dapat_ditemui,
        r.rumah_tunggal, r.rumah_deret, r.rumah_susun, r.apartemen, r.lainnya
      );
    }
  });

  const uploadResult = uploadStmt.run(originalName, tanggal, dataRows.length);
  const uploadId = uploadResult.lastInsertRowid;
  doInsert(uploadId, dataRows);

  // Update total_subsls_terisi
  const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
  db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);

  return { uploadId, totalRows: dataRows.length, uniqueSubsls: actualCount };
}

function toInt(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

function normalizeName(name) {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ');
}

function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { parseAndSaveExcel, loadMasterFromJson };
