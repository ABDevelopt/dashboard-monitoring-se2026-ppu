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
      (kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, kode_2025, target_fasih)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            subsls.id_subsls_2025 || subsls.id_subsls,
            subsls.total_muatan_assignment || 0 // Default target_fasih to muatan
          ]);
        }
      }
    }
  }

  insertMany(rows);

  // Override target_fasih dari rancangan alokasi jika file excel ada
  try {
    const alokasiPath = path.join(__dirname, '../rancangan-muatan-se2026-ppu.xlsx');
    if (fs.existsSync(alokasiPath)) {
      console.log('Applying target_fasih from rancangan-muatan-se2026-ppu.xlsx...');
      const wb = XLSX.readFile(alokasiPath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const excelRows = XLSX.utils.sheet_to_json(ws);
      const updateStmt = db.prepare('UPDATE subsls_master SET target_fasih = ? WHERE kode = ?');
      let updatedCount = 0;
      db.transaction(() => {
        for (const row of excelRows) {
          const code = String(row['IDSUBSLS beneran'] || row['IDSUBSLS_beneran'] || '').trim();
          const targetFasih = parseInt(row['TOTAL ASSIGNMENT FASIH'] || row['total_assignment_fasih'] || 0, 10);
          if (code) {
            updateStmt.run(targetFasih, code);
            updatedCount++;
          }
        }
      })();
      console.log(`✅ Applied target_fasih from Excel for ${updatedCount} records.`);
    }
  } catch (err) {
    console.error('⚠️ Warning: Failed to apply target_fasih from Excel:', err.message);
  }

  return rows.length;
}

// Parse Excel dan simpan ke DB
function parseAndSaveExcel(filePath, originalFilename, storedFilename, tanggal, statusFilePath = null, statusOriginalFilename = null, statusStoredFilename = null) {
  const db = getDb();

  // If rekap file (filePath) is missing, but status file is present:
  if (!filePath && statusFilePath) {
    const uploadStmt = db.prepare(`
      INSERT INTO uploads (filename, stored_filename, tanggal, total_subsls_terisi, status_filename, stored_status_filename) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const finalFilename = originalFilename || statusOriginalFilename || 'status_only';
    const uploadResult = uploadStmt.run(finalFilename, storedFilename, tanggal, 0, statusOriginalFilename, statusStoredFilename);
    const uploadId = uploadResult.lastInsertRowid;

    // Find previous upload_id
    const prevUploadRow = db.prepare('SELECT id FROM uploads WHERE id < ? ORDER BY id DESC LIMIT 1').get(uploadId);
    const prevUploadId = prevUploadRow ? prevUploadRow.id : null;

    // Process status file
    parseAndSaveStatusExcelOnly(statusFilePath, uploadId, prevUploadId);

    // Update total_subsls_terisi
    const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
    db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);

    // Rebuild summary cache
    const { rebuildSummaryCache } = require('../database');
    rebuildSummaryCache(uploadId);

    return { uploadId, totalRows: 0, uniqueSubsls: actualCount };
  }

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
    INSERT INTO uploads (filename, stored_filename, tanggal, total_subsls_terisi, status_filename, stored_status_filename) 
    VALUES (?, ?, ?, ?, ?, ?)
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
       rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya,
       draft, submitted_by_pcl, approved, rejected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getPrevStatus = db.prepare(`
    SELECT 
      COALESCE(draft, 0) AS draft, 
      COALESCE(submitted_by_pcl, 0) AS submitted_by_pcl, 
      COALESCE(approved, 0) AS approved, 
      COALESCE(rejected, 0) AS rejected
    FROM progres 
    WHERE upload_id = ? AND kode = ?
  `);

  const doInsert = db.transaction((uploadId, prevUploadId, rows) => {
    for (const r of rows) {
      let draft = 0, submitted = 0, approved = 0, rejected = 0;
      if (prevUploadId) {
        const prev = getPrevStatus.get(prevUploadId, r.kode);
        if (prev) {
          draft = prev.draft;
          submitted = prev.submitted_by_pcl;
          approved = prev.approved;
          rejected = prev.rejected;
        }
      }
      insertProgres.run(
        uploadId, r.kode,
        r.usaha_tidak_ditemukan, r.usaha_ditemukan, r.usaha_baru, r.usaha_tutup, r.usaha_ganda,
        r.tidak_ditemukan, r.ditemukan, r.keluarga_baru, r.meninggal, r.tidak_eligible, r.tidak_dapat_ditemui,
        r.rumah_tunggal, r.rumah_deret, r.rumah_susun, r.apartemen, r.lainnya,
        draft, submitted, approved, rejected
      );
    }
  });

  const uploadResult = uploadStmt.run(originalFilename, storedFilename, tanggal, dataRows.length, statusOriginalFilename, statusStoredFilename);
  const uploadId = uploadResult.lastInsertRowid;

  // Cari upload_id sebelumnya yang memiliki status data non-nol
  const prevUploadRow = db.prepare(`
    SELECT u.id 
    FROM uploads u
    JOIN progres p ON u.id = p.upload_id
    WHERE u.id < ? 
    GROUP BY u.id
    HAVING SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0
    ORDER BY u.id DESC LIMIT 1
  `).get(uploadId);
  const prevUploadId = prevUploadRow ? prevUploadRow.id : null;

  doInsert(uploadId, prevUploadId, dataRows);

  // Jika ada file status FASIH, proses pengisian status
  if (statusFilePath) {
    parseAndSaveStatusExcel(statusFilePath, uploadId);
  }

  // Update total_subsls_terisi
  const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
  db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);

  // Rebuild summary cache
  const { rebuildSummaryCache } = require('../database');
  rebuildSummaryCache(uploadId);

  return { uploadId, totalRows: dataRows.length, uniqueSubsls: actualCount };
}

function findStatusColumnIndexes(headers) {
  const findIndex = (possibleNames) => {
    for (const name of possibleNames) {
      const idx = headers.findIndex(h => h.includes(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const findMultipleIndexes = (possibleNames) => {
    const indexes = [];
    headers.forEach((h, idx) => {
      for (const name of possibleNames) {
        if (h.includes(name)) {
          indexes.push(idx);
          break;
        }
      }
    });
    return indexes;
  };

  const kodeIdx = findIndex(['level_6_full_code', 'smallcode', 'kode', 'code']);
  const draftIdx = findIndex(['draft']);
  const approvedIdx = findIndex(['approved', 'approved by pengawas']);
  const rejectedIdx = findIndex(['rejected', 'rejected by pengawas']);
  
  // Look for submitted columns
  const submittedIdxs = findMultipleIndexes(['submitted_by_pcl', 'submitted by pencacah', 'submitted respondent', 'submitted']);

  return {
    kode: kodeIdx,
    draft: draftIdx,
    submittedIdxs: submittedIdxs,
    approved: approvedIdx,
    rejected: rejectedIdx
  };
}

// Parse file status dan update ke DB
function parseAndSaveStatusExcel(filePath, uploadId) {
  const db = getDb();
  const wb = XLSX.readFile(filePath, { raw: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Sheet dalam file rekap status tidak ditemukan.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
  if (rows.length < 2) return;

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
  const colIdx = findStatusColumnIndexes(headers);

  if (colIdx.kode === -1) throw new Error('Kolom identitas wilayah/SLS ("level_6_full_code" atau "smallcode") tidak ditemukan dalam file rekap status.');

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO progres (upload_id, kode) VALUES (?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE progres 
    SET draft = ?, submitted_by_pcl = ?, approved = ?, rejected = ?
    WHERE upload_id = ? AND kode = ?
  `);

  const updateTx = db.transaction((list) => {
    for (let i = 1; i < list.length; i++) {
      const row = list[i];
      const kode = String(row[colIdx.kode] || '').trim();
      if (!kode || kode.length < 10) continue;

      const draft = colIdx.draft !== -1 ? toInt(row[colIdx.draft]) : 0;
      const submitted = colIdx.submittedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
      const approved = colIdx.approved !== -1 ? toInt(row[colIdx.approved]) : 0;
      const rejected = colIdx.rejected !== -1 ? toInt(row[colIdx.rejected]) : 0;

      // Pastikan baris progres ada untuk upload ini sebelum update status
      insertStmt.run(uploadId, kode);
      updateStmt.run(draft, submitted, approved, rejected, uploadId, kode);
    }
  });

  updateTx(rows);
}

function parseAndSaveStatusExcelOnly(filePath, uploadId, prevUploadId = null) {
  const db = getDb();
  const wb = XLSX.readFile(filePath, { raw: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Sheet dalam file rekap status tidak ditemukan.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
  if (rows.length < 2) return;

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
  const colIdx = findStatusColumnIndexes(headers);

  if (colIdx.kode === -1) throw new Error('Kolom identitas wilayah/SLS ("level_6_full_code" atau "smallcode") tidak ditemukan dalam file rekap status.');

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO progres (
      upload_id, kode,
      usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
      tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya,
      draft, submitted_by_pcl, approved, rejected
    ) VALUES (
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const getPrevRecord = db.prepare(`
    SELECT * FROM progres WHERE upload_id = ? AND kode = ?
  `);

  const updateStmt = db.prepare(`
    UPDATE progres 
    SET draft = ?, submitted_by_pcl = ?, approved = ?, rejected = ?
    WHERE upload_id = ? AND kode = ?
  `);

  const updateTx = db.transaction((list) => {
    for (let i = 1; i < list.length; i++) {
      const row = list[i];
      const kode = String(row[colIdx.kode] || '').trim();
      if (!kode || kode.length < 10) continue;

      const draft = colIdx.draft !== -1 ? toInt(row[colIdx.draft]) : 0;
      const submitted = colIdx.submittedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
      const approved = colIdx.approved !== -1 ? toInt(row[colIdx.approved]) : 0;
      const rejected = colIdx.rejected !== -1 ? toInt(row[colIdx.rejected]) : 0;

      let usaha_tidak_ditemukan = 0, usaha_ditemukan = 0, usaha_baru = 0, usaha_tutup = 0, usaha_ganda = 0;
      let tidak_ditemukan = 0, ditemukan = 0, keluarga_baru = 0, meninggal = 0, tidak_eligible = 0, tidak_dapat_ditemui = 0;
      let rumah_tunggal = 0, rumah_deret = 0, rumah_susun = 0, apartemen = 0, lainnya = 0;

      if (prevUploadId) {
        const prev = getPrevRecord.get(prevUploadId, kode);
        if (prev) {
          usaha_tidak_ditemukan = prev.usaha_tidak_ditemukan || 0;
          usaha_ditemukan = prev.usaha_ditemukan || 0;
          usaha_baru = prev.usaha_baru || 0;
          usaha_tutup = prev.usaha_tutup || 0;
          usaha_ganda = prev.usaha_ganda || 0;
          tidak_ditemukan = prev.tidak_ditemukan || 0;
          ditemukan = prev.ditemukan || 0;
          keluarga_baru = prev.keluarga_baru || 0;
          meninggal = prev.meninggal || 0;
          tidak_eligible = prev.tidak_eligible || 0;
          tidak_dapat_ditemui = prev.tidak_dapat_ditemui || 0;
          rumah_tunggal = prev.rumah_tunggal || 0;
          rumah_deret = prev.rumah_deret || 0;
          rumah_susun = prev.rumah_susun || 0;
          apartemen = prev.apartemen || 0;
          lainnya = prev.lainnya || 0;
        }
      }

      insertStmt.run(
        uploadId, kode,
        usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
        tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
        rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya,
        draft, submitted, approved, rejected
      );

      updateStmt.run(draft, submitted, approved, rejected, uploadId, kode);
    }
  });

  updateTx(rows);
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

function loadMasterFromExcel(filePath) {
  const db = getDb();
  const wb = XLSX.readFile(filePath, { raw: true });
  const sheetName = wb.Sheets['master'] ? 'master' : (wb.SheetNames.find(s => s.toLowerCase().includes('data pencacahan')) || wb.SheetNames[0]);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Sheet master data tidak ditemukan.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (rows.length < 2) throw new Error('File Excel master data kosong.');

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());

  // Helper to find column index with aliases
  const findCol = (aliases) => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // INTERCEPT: Jika file yang diupload adalah rancangan-muatan (punya kolom 'idsubsls beneran')
  if (headers.includes('idsubsls beneran') || headers.includes('idsubsls_beneran')) {
    const kodeIdx = findCol(['idsubsls beneran', 'idsubsls_beneran']);
    const targetIdx = findCol(['total assignment fasih', 'target_fasih', 'total_assignment_fasih', 'assignment_fasih', 'fasih_target']);
    
    if (targetIdx === -1) throw new Error('Kolom "TOTAL ASSIGNMENT FASIH" tidak ditemukan di file rancangan.');
    
    let updatedCount = 0;
    const updateStmt = db.prepare('UPDATE subsls_master SET target_fasih = ? WHERE kode = ? OR kode_2025 = ?');
    
    db.transaction(() => {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        let kode = String(row[kodeIdx] || '').trim();
        if (!kode) continue;
        const target = toInt(row[targetIdx]);
        const res = updateStmt.run(target, kode, kode);
        if (res.changes > 0) updatedCount++;
      }
    })();
    return updatedCount; // Selesai update target_fasih, tidak lanjut ke load master normal
  }

  const colIdx = {
    kode: findCol(['kode', 'id_subsls', 'id subsls', 'id_sls', 'id sls']),
    kode_kec: findCol(['kode_kec', 'kode kec', 'id_kec', 'id kec']),
    kecamatan: findCol(['kecamatan', 'kec']),
    desa: findCol(['desa', 'kelurahan', 'desa_kelurahan', 'desa/kelurahan']),
    nama_sls: findCol(['nama_sls', 'nama sls', 'sls', 'nama_sls_master']),
    korlap: findCol(['korlap', 'nama_korlap', 'nama korlap']),
    pml: findCol(['pml', 'nama_pml', 'nama pml', 'pengawas']),
    pcl: findCol(['pcl', 'nama_pcl', 'nama pcl', 'pencacah']),
    muatan: findCol(['muatan', 'total_muatan', 'total_muatan_assignment', 'assignment', 'beban']),
    kode_2025: findCol(['kode_2025', 'id_subsls_2025', 'id_subsls_2025']),
    target_fasih: findCol(['target_fasih', 'total_assignment_fasih', 'total assignment fasih', 'assignment_fasih', 'fasih_target'])
  };

  if (colIdx.kode === -1) throw new Error('Kolom "kode" atau "id_subsls" tidak ditemukan.');
  if (colIdx.kecamatan === -1) throw new Error('Kolom "kecamatan" tidak ditemukan.');
  if (colIdx.desa === -1) throw new Error('Kolom "desa" tidak ditemukan.');

  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const kode = String(row[colIdx.kode] || '').trim();
    if (!kode) continue;

    const kode_kec = colIdx.kode_kec !== -1 ? String(row[colIdx.kode_kec] || '').trim() : kode.substring(6, 8);
    const kecamatan = toTitleCase(String(row[colIdx.kecamatan] || '').trim());
    const desa = toTitleCase(String(row[colIdx.desa] || '').trim());
    const nama_sls = colIdx.nama_sls !== -1 ? String(row[colIdx.nama_sls] || '').trim() : '';
    const korlap = colIdx.korlap !== -1 ? String(row[colIdx.korlap] || '').trim() : '';
    const pml = colIdx.pml !== -1 ? normalizeName(String(row[colIdx.pml] || '')) : '';
    const pcl = colIdx.pcl !== -1 ? normalizeName(String(row[colIdx.pcl] || '')) : '';
    const muatan = colIdx.muatan !== -1 ? toInt(row[colIdx.muatan]) : 0;
    const kode_2025 = colIdx.kode_2025 !== -1 ? String(row[colIdx.kode_2025] || '').trim() : kode;
    const target_fasih = colIdx.target_fasih !== -1 ? toInt(row[colIdx.target_fasih]) : 0; // fallback to 0 instead of muatan

    dataRows.push([
      kode,
      kode_kec,
      kecamatan,
      desa,
      nama_sls,
      korlap,
      pml,
      pcl,
      muatan,
      kode_2025,
      target_fasih
    ]);
  }

  if (dataRows.length === 0) throw new Error('Tidak ada baris data master yang valid.');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO subsls_master 
      (kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, kode_2025, target_fasih)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveTx = db.transaction((list) => {
    db.prepare('DELETE FROM subsls_master').run();
    for (const item of list) {
      insert.run(...item);
    }
  });

  saveTx(dataRows);
  return dataRows.length;
}

module.exports = { parseAndSaveExcel, loadMasterFromJson, loadMasterFromExcel };
