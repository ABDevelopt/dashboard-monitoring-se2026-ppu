const XLSX = require('xlsx');
const path = require('path');
const { getDb, getSettings } = require('../database');
const fs = require('fs');

// Sanitization helpers to prevent string "null" representation in DB columns
const safeFilename = (val) => {
  if (!val) return '';
  const s = String(val).trim();
  return s.toLowerCase() === 'null' ? '' : s;
};

const safeNullableStr = (val) => {
  if (!val) return null;
  const s = String(val).trim();
  return s.toLowerCase() === 'null' ? null : s;
};


// Load master data dari JSON (dijalankan sekali saat startup)
function loadMasterFromJson(jsonPath, surveyId = 'se2026') {
  const db = getDb(surveyId);
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const insert = db.prepare(`
    INSERT OR REPLACE INTO subsls_master 
      (kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, kode_2025, target_fasih, muatan_original)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            normalizeName(subsls.nama_korlap || ''),
            normalizeName(subsls.nama_pml || ''),
            normalizeName(subsls.nama_pcl || ''),
            subsls.total_muatan_assignment || 0,
            subsls.id_subsls_2025 || subsls.id_subsls,
            subsls.total_muatan_assignment || 0, // Default target_fasih to muatan
            subsls.total_muatan_assignment || 0  // muatan_original
          ]);
        }
      }
    }
  }

  insertMany(rows);

  // Override target_fasih dari rancangan alokasi jika file excel ada (khusus SE2026)
  try {
    const alokasiPath = path.join(__dirname, '../rancangan-muatan-se2026-ppu.xlsx');
    if (surveyId === 'se2026' && fs.existsSync(alokasiPath)) {
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

  // Apply KIPP IKN overrides
  applyKippOverrides(db);

  // Sync muatan column based on target_muatan_mode
  try {
    const settings = getSettings();
    if (settings.target_muatan_mode === 'honor') {
      db.prepare('UPDATE subsls_master SET muatan = COALESCE(target_honor, 0)').run();
    } else {
      db.prepare('UPDATE subsls_master SET muatan = COALESCE(muatan_original, 0)').run();
    }
  } catch (err) {
    console.error('⚠️ Warning: Failed to sync muatan after JSON load:', err.message);
  }

  return rows.length;
}

function findCol(headers, aliases) {
  if (!headers || !Array.isArray(headers)) return -1;
  
  // Clean all headers (lowercase, trim, replace spaces/hyphens with underscores)
  const cleanHeaders = headers.map(h => 
    String(h || '').toLowerCase().trim().replace(/[\s\-]+/g, '_')
  );
  
  // Clean all aliases in the same way
  const cleanAliases = aliases.map(a => 
    String(a || '').toLowerCase().trim().replace(/[\s\-]+/g, '_')
  );
  
  // 1. Exact match of cleaned values in priority order of aliases
  for (const alias of cleanAliases) {
    const idx = cleanHeaders.indexOf(alias);
    if (idx !== -1) return idx;
  }
  
  // 2. Substring match fallback
  for (const alias of cleanAliases) {
    const idx = cleanHeaders.findIndex(h => h.includes(alias));
    if (idx !== -1) return idx;
  }
  
  return -1;
}

const KODE_ALIASES = ['level_6_full_code', 'smallcode', 'kode', 'code', 'idsubsls', 'id_subsls', 'id subsls', 'kode_subsls', 'kode subsls', 'subsls_code', 'subsls code', 'full_code', 'full code', 'id_sls', 'id sls', 'sls_code', 'sls code', 'kode_sls', 'kode sls'];
const DITEMUKAN_ALIASES = ['ditemukan', 'keluarga_ditemukan', 'kk_ditemukan', 'jumlah_keluarga_ditemukan', 'jml_keluarga_ditemukan', 'jumlah_kk_ditemukan', 'jml_kk_ditemukan', 'keluarga_terdata', 'keluarga terdata', 'keluarga_selesai', 'keluarga selesai', 'terdata', 'selesai', 'keluarga', 'kk', 'jml_kk'];
const KELUARGA_BARU_ALIASES = ['baru', 'keluarga baru', 'keluarga_baru', 'kk_baru', 'kk baru', 'jumlah_keluarga_baru', 'jml_keluarga_baru', 'jumlah_kk_baru', 'jml_kk_baru'];
const USAHA_DITEMUKAN_ALIASES = ['usaha_ditemukan', 'usaha ditemukan', 'ditemukan', 'jumlah_usaha_ditemukan', 'jml_usaha_ditemukan', 'usaha_terdata', 'usaha terdata', 'usaha_selesai', 'usaha selesai', 'terdata', 'selesai', 'usaha', 'jml_usaha'];
const USAHA_BARU_ALIASES = ['usaha_baru', 'usaha baru', 'baru', 'jumlah_usaha_baru', 'jml_usaha_baru'];

function findHeaderRowIndex(rows) {
  if (!rows || rows.length === 0) return 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (!rows[i] || !Array.isArray(rows[i])) continue;
    const rowStr = rows[i].map(c => String(c || '').toLowerCase().trim());
    if (rowStr.some(c => KODE_ALIASES.some(alias => c.includes(alias)))) {
      return i;
    }
  }
  return 0;
}

function findDataSheet(wb) {
  const priorityNames = ['query', 'sheet1', wb.SheetNames[0]];
  for (const name of priorityNames) {
    if (!name) continue;
    const actualName = wb.SheetNames.find(s => s.toLowerCase().trim() === name.toLowerCase().trim());
    if (actualName) {
      const ws = wb.Sheets[actualName];
      if (ws) {
        const tempRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        if (tempRows.length > 0) {
          const headerIdx = findHeaderRowIndex(tempRows);
          const tempHeaders = tempRows[headerIdx] ? tempRows[headerIdx].map(h => String(h || '').toLowerCase().trim()) : [];
          const hasKode = tempHeaders.some(h => KODE_ALIASES.some(alias => h.includes(alias)));
          if (hasKode) return ws;
        }
      }
    }
  }

  for (const name of wb.SheetNames) {
    const isPriority = priorityNames.some(p => p && p.toLowerCase().trim() === name.toLowerCase().trim());
    if (isPriority) continue;
    const ws = wb.Sheets[name];
    if (ws) {
      const tempRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      if (tempRows.length > 0) {
        const headerIdx = findHeaderRowIndex(tempRows);
        const tempHeaders = tempRows[headerIdx] ? tempRows[headerIdx].map(h => String(h || '').toLowerCase().trim()) : [];
        const hasKode = tempHeaders.some(h => KODE_ALIASES.some(alias => h.includes(alias)));
        if (hasKode) return ws;
      }
    }
  }

  if (wb.SheetNames.length > 0) {
    return wb.Sheets[wb.SheetNames[0]];
  }
  return null;
}

// Parse Excel dan simpan ke DB
function parseAndSaveExcel(filePath, originalFilename, storedFilename, tanggal, statusFilePath = null, statusOriginalFilename = null, statusStoredFilename = null) {
  const db = getDb();

  // If rekap file (filePath) is missing, but status file is present:
  if (!filePath && statusFilePath) {
    return parseAndSaveStatusExcelOnly(statusFilePath, statusOriginalFilename, statusStoredFilename, tanggal);
  }

  const wb = XLSX.readFile(filePath, { raw: true });

  const ws = findDataSheet(wb);
  if (!ws) throw new Error('File Excel kosong atau tidak memiliki sheet data yang valid.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
  if (rows.length < 2) throw new Error('Sheet data kosong.');

  const headerIdx = findHeaderRowIndex(rows);
  const headers = rows[headerIdx].map(h => String(h || '').toLowerCase().trim());

  // Cari index kolom
  const colIdx = {
    desa: findCol(headers, ['desa', 'nama_desa', 'kelurahan']),
    kode: findCol(headers, KODE_ALIASES),
    usaha_tidak_ditemukan: findCol(headers, ['usaha_tidak_ditemukan', 'usaha tidak ditemukan', 'usaha_tutup_sementara']),
    usaha_ditemukan: findCol(headers, USAHA_DITEMUKAN_ALIASES),
    usaha_baru: findCol(headers, USAHA_BARU_ALIASES),
    usaha_tutup: findCol(headers, ['usaha_tutup', 'usaha tutup', 'usaha_tutup_permanen', 'tutup']),
    usaha_ganda: findCol(headers, ['usaha_ganda', 'usaha ganda', 'ganda']),
    tidak_ditemukan: findCol(headers, ['tidak_ditemukan', 'tidak ditemukan', 'kk_tidak_ditemukan', 'keluarga_tidak_ditemukan']),
    ditemukan: findCol(headers, DITEMUKAN_ALIASES),
    keluarga_baru: findCol(headers, KELUARGA_BARU_ALIASES),
    meninggal: findCol(headers, ['meninggal', 'kk_meninggal', 'kk meninggal', 'keluarga_meninggal']),
    tidak_eligible: findCol(headers, ['tidak_eligible', 'kk_tidak_eligible', 'kk tidak eligible', 'keluarga_tidak_eligible', 'tidak eligible']),
    tidak_dapat_ditemui: findCol(headers, ['tidak_dapat_ditemui', 'kk_tidak_dapat_ditemui', 'kk tidak dapat ditemui', 'keluarga_tidak_dapat_ditemui', 'tidak dapat ditemui']),
    keluarga_khusus: findCol(headers, ['keluarga khusus', 'keluarga_khusus', 'kk_khusus', 'khusus']),
    rumah_tunggal: findCol(headers, ['rumah_tunggal', 'rumah tunggal', 'tunggal']),
    rumah_deret: findCol(headers, ['rumah_deret', 'rumah deret', 'deret']),
    rumah_susun: findCol(headers, ['rumah_susun', 'rumah susun', 'susun']),
    apartemen: findCol(headers, ['apartemen', 'apartment']),
    lainnya: findCol(headers, ['lainnya', 'lain'])
  };

  const missingCols = [];
  if (colIdx.kode === -1) missingCols.push('level_6_full_code / kode');

  if (missingCols.length > 0) {
    throw new Error(`Berkas Progres Utama tidak valid. Kolom kode wajib berikut tidak ditemukan: [${missingCols.join(', ')}]. Pastikan format kolom sesuai dengan template standard.`);
  }

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
      keluarga_khusus: toInt(row[colIdx.keluarga_khusus]),
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
       draft, open, submitted_by_pcl, approved, rejected, target_upload, keluarga_khusus, sls_selesai)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getPrevStatus = db.prepare(`
    SELECT 
      COALESCE(draft, 0) AS draft, 
      COALESCE(open, 0) AS open, 
      COALESCE(submitted_by_pcl, 0) AS submitted_by_pcl, 
      COALESCE(approved, 0) AS approved, 
      COALESCE(rejected, 0) AS rejected,
      COALESCE(target_upload, 0) AS target_upload,
      COALESCE(sls_selesai, 0) AS sls_selesai
    FROM progres 
    WHERE upload_id = ? AND kode = ?
  `);

  const doInsert = db.transaction((uploadId, prevUploadId, rows) => {
    for (const r of rows) {
      let draft = 0, openVal = 0, submitted = 0, approved = 0, rejected = 0, targetUpload = 0, slsSelesai = 0;
      if (prevUploadId) {
        const prev = getPrevStatus.get(prevUploadId, r.kode);
        if (prev) {
          draft = prev.draft;
          openVal = prev.open;
          submitted = prev.submitted_by_pcl;
          approved = prev.approved;
          rejected = prev.rejected;
          targetUpload = prev.target_upload;
          slsSelesai = prev.sls_selesai;
        }
      }
      insertProgres.run(
        uploadId, r.kode,
        r.usaha_tidak_ditemukan, r.usaha_ditemukan, r.usaha_baru, r.usaha_tutup, r.usaha_ganda,
        r.tidak_ditemukan, r.ditemukan, r.keluarga_baru, r.meninggal, r.tidak_eligible, r.tidak_dapat_ditemui,
        r.rumah_tunggal, r.rumah_deret, r.rumah_susun, r.apartemen, r.lainnya,
        draft, openVal, submitted, approved, rejected, targetUpload, r.keluarga_khusus, slsSelesai
      );
    }
  });

  const uploadResult = uploadStmt.run(
    safeFilename(originalFilename),
    safeNullableStr(storedFilename),
    tanggal,
    dataRows.length,
    safeNullableStr(statusOriginalFilename),
    safeNullableStr(statusStoredFilename)
  );
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
  ensureAllSubslsInUpload(uploadId);
  const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
  db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);

  // Rebuild summary cache
  const { rebuildSummaryCache } = require('../database');
  rebuildSummaryCache(uploadId);

  return { uploadId, totalRows: dataRows.length, uniqueSubsls: actualCount };
}

function findStatusColumnIndexes(headers) {
  const findIndex = (possibleNames) => {
    // Try exact match first
    for (const name of possibleNames) {
      const idx = headers.findIndex(h => h === name);
      if (idx !== -1) return idx;
    }
    // Try partial match
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

  const kodeIdx = findIndex(['level_6_full_code', 'smallcode', 'kode subsls', 'idsubsls', 'kode', 'code']);
  const draftIdxs = findMultipleIndexes(['draft', 'revoked']);
  const openIdxs = findMultipleIndexes(['open', 'belum diisi', 'belum_diisi', 'unassigned', 'not_started', 'not started']);
  const approvedIdxs = findMultipleIndexes(['approved', 'completed', 'selesai'])
    .filter(idx => !headers[idx].includes('persentase') && !headers[idx].includes('percent') && !headers[idx].includes('%'));
  // Collect ALL 'rejected' / 'reject' columns (e.g. "REJECTED BY Pengawas", "REJECTED BY Admin Kabupaten", "Reject")
  const rejectedIdxs = findMultipleIndexes(['rejected', 'reject']);

  // Look for submitted / submit columns
  const submittedIdxs = findMultipleIndexes(['submitted_by_pcl', 'submitted by pencacah', 'submitted respondent', 'submitted', 'submit', 'edited']);

  const totalIdx = findIndex(['total', 'target']);
  const desaIdx = findIndex(['desa', 'nama_desa', 'kelurahan']);
  const slsIdx = findIndex(['sls', 'nama_sls', 'subsls']);
  const kecIdx = findIndex(['kecamatan', 'nama_kecamatan', 'kec']);
  const pmlIdx = findIndex(['pengawas', 'pml', 'nama_pml', 'nama pengawas', 'nama_pml_pl']);
  const pclIdx = findIndex(['pencacah', 'pcl', 'nama_pcl', 'nama pencacah', 'nama_pcl_pl']);
  const korlapIdx = findIndex(['korlap', 'nama_korlap', 'kose']);

  const missingCols = [];
  if (kodeIdx === -1 && (desaIdx === -1 || slsIdx === -1)) missingCols.push('level_6_full_code / kode subsls');
  
  const isMonitoringSls = headers.some(h => h.includes('jumlah sls selesai') || h.includes('jumlah sub-sls selesai'));
  
  // If we found 'selesai' column, we can bypass draft/submitted/rejected checks
  const isSimplifiedStatus = approvedIdxs.some(idx => headers[idx].includes('selesai')) || isMonitoringSls;
  
  if (!isSimplifiedStatus) {
    if (draftIdxs.length === 0) missingCols.push('draft');
    if (submittedIdxs.length === 0) missingCols.push('submitted / submit');
    if (approvedIdxs.length === 0) missingCols.push('approved');
    if (rejectedIdxs.length === 0) missingCols.push('rejected / reject');
  } else {
    // If it's monitoring SLS format, we don't even need approved column from approvedIdxs
    if (!isMonitoringSls && approvedIdxs.length === 0) missingCols.push('approved / selesai');
  }

  if (missingCols.length > 0) {
    throw new Error(`Berkas Status tidak valid. Kolom wajib berikut tidak ditemukan: [${missingCols.join(', ')}]. Pastikan format kolom sesuai dengan template standard.`);
  }

  return {
    isSimplifiedStatus,
    isMonitoringSls,
    kode: kodeIdx,
    draftIdxs: draftIdxs,
    openIdxs: openIdxs,
    submittedIdxs: submittedIdxs,
    approvedIdxs: approvedIdxs,
    rejectedIdxs: rejectedIdxs,
    total: totalIdx,
    desa: desaIdx,
    sls: slsIdx,
    kec: kecIdx,
    pml: pmlIdx,
    pcl: pclIdx,
    korlap: korlapIdx
  };
}

// Parse file status dan update ke DB
function parseAndSaveStatusExcel(filePath, uploadId, surveyId = 'se2026') {
  const db = getDb(surveyId);
  const wb = XLSX.readFile(filePath, { raw: true });
  const ws = findDataSheet(wb);
  if (!ws) throw new Error('Sheet dalam file rekap status tidak ditemukan.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
  if (rows.length < 2) return;

  const headerIdx = findHeaderRowIndex(rows);
  const headers = rows[headerIdx].map(h => String(h || '').toLowerCase().trim());
  const colIdx = findStatusColumnIndexes(headers);

  // Pre-fetch master data
  const masterRows = db.prepare('SELECT kode, desa, nama_sls FROM subsls_master ORDER BY kode ASC').all();
  const useIndexFallback = (rows.length - 1 === masterRows.length);

  let masterMap = null;
  const getMasterMap = () => {
    if (!masterMap) {
      masterMap = {};
      for (const m of masterRows) {
        const key = (m.desa + '|' + m.nama_sls).toLowerCase().trim();
        masterMap[key] = m.kode;
      }
    }
    return masterMap;
  };

  const resolveKode = (row, index) => {
    let rawKode = colIdx.kode !== -1 ? String(row[colIdx.kode] || '').trim() : '';
    if (rawKode.endsWith('.0')) rawKode = rawKode.slice(0, -2);

    if (rawKode.length >= 10 && !rawKode.includes('E+') && !rawKode.endsWith('000000000')) {
      return rawKode;
    }

    if (colIdx.desa !== -1 && colIdx.sls !== -1) {
      const desa = String(row[colIdx.desa] || '').trim();
      const sls = String(row[colIdx.sls] || '').trim();
      if (desa && sls) {
        const map = getMasterMap();
        const key = (desa + '|' + sls).toLowerCase().trim();
        if (map[key]) return map[key];
      }
    }

    if (useIndexFallback && index >= 1 && index <= masterRows.length) {
      return masterRows[index - 1].kode;
    }

    return rawKode;
  };

  // Find previous upload that has status data
  const currentUpload = db.prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
  const tanggal = currentUpload ? currentUpload.tanggal : new Date().toISOString().slice(0, 10);

  const prevStatusRow = db.prepare(`
    SELECT u.id FROM uploads u
    JOIN progres p ON u.id = p.upload_id
    WHERE u.tanggal <= ? AND u.id != ?
    GROUP BY u.id
    HAVING SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0
    ORDER BY u.tanggal DESC, u.id DESC LIMIT 1
  `).get(tanggal, uploadId);
  const prevStatusId = prevStatusRow ? prevStatusRow.id : null;

  const getPrevStatusRecord = db.prepare('SELECT * FROM progres WHERE upload_id = ? AND kode = ?');

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO progres (upload_id, kode) VALUES (?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE progres 
    SET draft = ?, open = ?, submitted_by_pcl = ?, approved = ?, rejected = ?, target_upload = ?, sls_selesai = ?
    WHERE upload_id = ? AND kode = ?
  `);

  const updateTx = db.transaction((list) => {
    for (let i = headerIdx + 1; i < list.length; i++) {
      const row = list[i];
      const kode = resolveKode(row, i);
      if (!kode || kode.length < 10) continue;

      let prevDraft = 0, prevOpen = 0, prevSubmitted = 0, prevApproved = 0, prevRejected = 0, prevTarget = 0;
      if (prevStatusId) {
        const prevS = getPrevStatusRecord.get(prevStatusId, kode);
        if (prevS) {
          prevDraft = prevS.draft || 0;
          prevOpen = prevS.open || 0;
          prevSubmitted = prevS.submitted_by_pcl || 0;
          prevApproved = prevS.approved || 0;
          prevRejected = prevS.rejected || 0;
          prevTarget = prevS.target_upload || 0;
        }
      }

      let draft = 0, submitted = 0, approved = 0, rejected = 0, targetUpload = 0, openVal = 0, slsSelesai = 0;

      if (colIdx.isMonitoringSls) {
        // SLS monitoring file upload: preserve previous FASIH status columns
        draft = prevDraft;
        submitted = prevSubmitted;
        approved = prevApproved;
        rejected = prevRejected;
        targetUpload = prevTarget;
        openVal = prevOpen;

        // Compute sls_selesai strictly from "Jumlah SLS Selesai" column
        const selesaiColIdx = headers.findIndex(h => h.includes('jumlah sls selesai') || h.includes('jumlah sub-sls selesai'));
        const jumlahSelesai = parseInt(row[selesaiColIdx] || 0, 10);
        slsSelesai = (jumlahSelesai >= 1 && kode.length === 16) ? 1 : 0;
      } else if (colIdx.isSimplifiedStatus) {
        // SLS status file upload: preserve previous FASIH status columns
        draft = prevDraft;
        submitted = prevSubmitted;
        approved = prevApproved;
        rejected = prevRejected;
        targetUpload = prevTarget;
        openVal = prevOpen;

        // Compute sls_selesai from excel column or preserved document counts
        const approvedFromExcel = colIdx.approvedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        const targetFromExcel = colIdx.total !== -1 ? toInt(row[colIdx.total]) : 1;
        const isSelesaiExcel = (approvedFromExcel >= targetFromExcel || approvedFromExcel > 0);
        const isSelesaiPreserved = (submitted + approved + rejected >= targetUpload && targetUpload > 0);
        slsSelesai = (isSelesaiExcel || isSelesaiPreserved) ? 1 : 0;
      } else {
        // Regular FASIH status file upload
        draft = colIdx.draftIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        submitted = colIdx.submittedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        approved = colIdx.approvedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        rejected = colIdx.rejectedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        targetUpload = colIdx.total !== -1 ? toInt(row[colIdx.total]) : 0;

        openVal = colIdx.openIdxs ? colIdx.openIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0) : 0;
        if (openVal === 0 && targetUpload > 0) {
          openVal = Math.max(0, targetUpload - (draft + submitted + approved + rejected));
        }

        // SLS selesai is computed from FASIH completion
        slsSelesai = (submitted + approved + rejected >= targetUpload && targetUpload > 0) ? 1 : 0;
      }

      // Pastikan baris progres ada untuk upload ini sebelum update status
      insertStmt.run(uploadId, kode);
      updateStmt.run(draft, openVal, submitted, approved, rejected, targetUpload, slsSelesai, uploadId, kode);
    }
  });

  updateTx(rows);
}

function parseAndSaveStatusExcelOnly(filePath, originalFilename, storedFilename, tanggal, surveyId = 'se2026') {
  const db = getDb(surveyId);
  const wb = XLSX.readFile(filePath, { raw: true });
  const ws = findDataSheet(wb);
  if (!ws) throw new Error('Sheet dalam file rekap status tidak ditemukan.');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
  if (rows.length < 2) return { uploadId: null, uniqueSubsls: 0 };

  const headerIdx = findHeaderRowIndex(rows);
  const headers = rows[headerIdx].map(h => String(h || '').toLowerCase().trim());
  const colIdx = findStatusColumnIndexes(headers);

  // Pre-fetch master data (each survey database now has its own subsls_master)
  const masterRows = db.prepare('SELECT kode, desa, nama_sls FROM subsls_master ORDER BY kode ASC').all();
  
  const useIndexFallback = (rows.length - 1 === masterRows.length);

  let masterMap = null;
  const getMasterMap = () => {
    if (!masterMap) {
      masterMap = {};
      for (const m of masterRows) {
        const key = (m.desa + '|' + m.nama_sls).toLowerCase().trim();
        masterMap[key] = m.kode;
      }
    }
    return masterMap;
  };

  const resolveKode = (row, index) => {
    let rawKode = colIdx.kode !== -1 ? String(row[colIdx.kode] || '').trim() : '';
    if (rawKode.endsWith('.0')) rawKode = rawKode.slice(0, -2);

    if (rawKode.length >= 10 && !rawKode.includes('E+') && !rawKode.endsWith('000000000')) {
      return rawKode;
    }

    if (colIdx.desa !== -1 && colIdx.sls !== -1) {
      const desa = String(row[colIdx.desa] || '').trim();
      const sls = String(row[colIdx.sls] || '').trim();
      if (desa && sls) {
        const map = getMasterMap();
        const key = (desa + '|' + sls).toLowerCase().trim();
        if (map[key]) return map[key];
      }
    }

    if (useIndexFallback && index >= 1 && index <= masterRows.length) {
      return masterRows[index - 1].kode;
    }

    return rawKode;
  };

  // Create uploads record first so uploadId exists for FK constraint
  const uploadResult = db.prepare(`
    INSERT INTO uploads (filename, stored_filename, tanggal, total_subsls_terisi, status_filename, stored_status_filename)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('', null, tanggal, 0, safeNullableStr(originalFilename), safeNullableStr(storedFilename));
  const uploadId = uploadResult.lastInsertRowid;

  // Find previous upload that has progress muatan data
  const prevMuatanRow = db.prepare(`
    SELECT u.id FROM uploads u
    JOIN progres p ON u.id = p.upload_id
    WHERE u.tanggal <= ? AND u.id != ?
    GROUP BY u.id
    HAVING SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) > 0
    ORDER BY u.tanggal DESC, u.id DESC LIMIT 1
  `).get(tanggal, uploadId);
  const prevMuatanId = prevMuatanRow ? prevMuatanRow.id : null;

  // Find previous upload that has status data
  const prevStatusRow = db.prepare(`
    SELECT u.id FROM uploads u
    JOIN progres p ON u.id = p.upload_id
    WHERE u.tanggal <= ? AND u.id != ?
    GROUP BY u.id
    HAVING SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0
    ORDER BY u.tanggal DESC, u.id DESC LIMIT 1
  `).get(tanggal, uploadId);
  const prevStatusId = prevStatusRow ? prevStatusRow.id : null;

  const getPrevMuatanRecord = db.prepare('SELECT * FROM progres WHERE upload_id = ? AND kode = ?');
  const getPrevStatusRecord = db.prepare('SELECT * FROM progres WHERE upload_id = ? AND kode = ?');

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO progres (
      upload_id, kode,
      usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
      tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya,
      draft, open, submitted_by_pcl, approved, rejected, target_upload, keluarga_khusus, sls_selesai
    ) VALUES (
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      0, 0, 0, 0, 0,
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE progres 
    SET draft = ?, open = ?, submitted_by_pcl = ?, approved = ?, rejected = ?, target_upload = ?, sls_selesai = ?
    WHERE upload_id = ? AND kode = ?
  `);

  // Prepared statement to dynamically populate subsls_master data
  const insertSubslsMaster = db.prepare(`
    INSERT OR REPLACE INTO subsls_master (
      kode, kecamatan, desa, nama_sls, korlap, pml, pcl, target_fasih
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  let processedCount = 0;
  const updateTx = db.transaction((list) => {
    for (let i = headerIdx + 1; i < list.length; i++) {
      const row = list[i];
      const kode = resolveKode(row, i);
      if (!kode || (surveyId === 'se2026' ? kode.length !== 16 : kode.length < 10)) continue;

      // Get previous status values
      let prevDraft = 0, prevOpen = 0, prevSubmitted = 0, prevApproved = 0, prevRejected = 0, prevTarget = 0;
      if (prevStatusId) {
        const prevS = getPrevStatusRecord.get(prevStatusId, kode);
        if (prevS) {
          prevDraft = prevS.draft || 0;
          prevOpen = prevS.open || 0;
          prevSubmitted = prevS.submitted_by_pcl || 0;
          prevApproved = prevS.approved || 0;
          prevRejected = prevS.rejected || 0;
          prevTarget = prevS.target_upload || 0;
        }
      }

      let draft = 0, submitted = 0, approved = 0, rejected = 0, targetUpload = 0, openVal = 0, slsSelesai = 0;

      if (colIdx.isMonitoringSls) {
        // SLS monitoring file upload: preserve previous FASIH status columns
        draft = prevDraft;
        submitted = prevSubmitted;
        approved = prevApproved;
        rejected = prevRejected;
        targetUpload = prevTarget;
        openVal = prevOpen;

        // Compute sls_selesai strictly from "Jumlah SLS Selesai" column
        const selesaiColIdx = headers.findIndex(h => h.includes('jumlah sls selesai') || h.includes('jumlah sub-sls selesai'));
        const jumlahSelesai = parseInt(row[selesaiColIdx] || 0, 10);
        slsSelesai = (jumlahSelesai >= 1 && kode.length === 16) ? 1 : 0;
      } else if (colIdx.isSimplifiedStatus) {
        // SLS status file upload: preserve previous FASIH status columns
        draft = prevDraft;
        submitted = prevSubmitted;
        approved = prevApproved;
        rejected = prevRejected;
        targetUpload = prevTarget;
        openVal = prevOpen;

        // Compute sls_selesai from excel column or preserved document counts
        const approvedFromExcel = colIdx.approvedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        const targetFromExcel = colIdx.total !== -1 ? toInt(row[colIdx.total]) : 1;
        const isSelesaiExcel = (approvedFromExcel >= targetFromExcel || approvedFromExcel > 0);
        const isSelesaiPreserved = (submitted + approved + rejected >= targetUpload && targetUpload > 0);
        slsSelesai = (isSelesaiExcel || isSelesaiPreserved) ? 1 : 0;
      } else {
        // Regular FASIH status file upload
        draft = colIdx.draftIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        submitted = colIdx.submittedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        approved = colIdx.approvedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        rejected = colIdx.rejectedIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0);
        targetUpload = colIdx.total !== -1 ? toInt(row[colIdx.total]) : 0;

        openVal = colIdx.openIdxs ? colIdx.openIdxs.reduce((sum, idx) => sum + toInt(row[idx]), 0) : 0;
        if (openVal === 0 && targetUpload > 0) {
          openVal = Math.max(0, targetUpload - (draft + submitted + approved + rejected));
        }

        // SLS selesai is computed from FASIH completion
        slsSelesai = (submitted + approved + rejected >= targetUpload && targetUpload > 0) ? 1 : 0;
      }

      // Dynamically populate master data if not se2026
      if (surveyId !== 'se2026') {
        let rowKec = colIdx.kec !== -1 ? String(row[colIdx.kec] || '').trim() : '';
        let rowDesa = colIdx.desa !== -1 ? String(row[colIdx.desa] || '').trim() : '';
        let rowKorlap = colIdx.korlap !== -1 ? String(row[colIdx.korlap] || '').trim() : '';
        let rowPml = colIdx.pml !== -1 ? String(row[colIdx.pml] || '').trim() : '';
        let rowPcl = colIdx.pcl !== -1 ? String(row[colIdx.pcl] || '').trim() : '';

        rowKec = toTitleCase(rowKec) || 'Kecamatan Lain';
        rowDesa = toTitleCase(rowDesa) || 'Desa Lain';
        rowKorlap = normalizeName(rowKorlap) || 'Lainnya';
        rowPml = normalizeName(rowPml) || 'Lainnya';
        rowPcl = normalizeName(rowPcl) || 'Lainnya';

        insertSubslsMaster.run(kode, rowKec, rowDesa, kode, rowKorlap, rowPml, rowPcl, targetUpload);
      }

      let uTd = 0, uDit = 0, uBaru = 0, uTut = 0, uGan = 0, kTd = 0, kDit = 0, kBaru = 0, kMeng = 0, kTe = 0, kTdd = 0, kKhus = 0;
      if (prevMuatanId) {
        const prevM = getPrevMuatanRecord.get(prevMuatanId, kode);
        if (prevM) {
          uTd = prevM.usaha_tidak_ditemukan || 0;
          uDit = prevM.usaha_ditemukan || 0;
          uBaru = prevM.usaha_baru || 0;
          uTut = prevM.usaha_tutup || 0;
          uGan = prevM.usaha_ganda || 0;
          kTd = prevM.tidak_ditemukan || 0;
          kDit = prevM.ditemukan || 0;
          kBaru = prevM.keluarga_baru || 0;
          kMeng = prevM.meninggal || 0;
          kTe = prevM.tidak_eligible || 0;
          kTdd = prevM.tidak_dapat_ditemui || 0;
          kKhus = prevM.keluarga_khusus || 0;
        }
      }

      insertStmt.run(
        uploadId, kode,
        uTd, uDit, uBaru, uTut, uGan,
        kTd, kDit, kBaru, kMeng, kTe, kTdd,
        draft, openVal, submitted, approved, rejected, targetUpload, kKhus, slsSelesai
      );

      updateStmt.run(draft, openVal, submitted, approved, rejected, targetUpload, slsSelesai, uploadId, kode);
      processedCount++;
    }
  });

  updateTx(rows);

  // Sinkronkan urutan status & muatan secara kronologis (mencegah data terhapus/0 saat upload parsial)
  resyncChronologicalData();

  // Update total_subsls_terisi count
  ensureAllSubslsInUpload(uploadId);
  const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
  db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);

  // Rebuild summary cache for this upload
  const { rebuildSummaryCache } = require('../database');
  rebuildSummaryCache(uploadId);

  return { uploadId, uniqueSubsls: processedCount };
}

function toInt(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

function normalizeName(name) {
  if (!name) return '';
  const clean = name.trim().replace(/\s+/g, ' ');
  return toTitleCase(clean);
}

function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function loadMasterFromExcel(filePath, surveyId = 'se2026') {
  const db = getDb(surveyId);
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
    const korlap = colIdx.korlap !== -1 ? normalizeName(String(row[colIdx.korlap] || '')) : '';
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
      target_fasih,
      muatan
    ]);
  }

  if (dataRows.length === 0) throw new Error('Tidak ada baris data master yang valid.');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO subsls_master 
      (kode, kode_kec, kecamatan, desa, nama_sls, korlap, pml, pcl, muatan, kode_2025, target_fasih, muatan_original)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveTx = db.transaction((list) => {
    db.prepare('DELETE FROM subsls_master').run();
    for (const item of list) {
      insert.run(...item);
    }
  });

  saveTx(dataRows);
  
  // Apply KIPP IKN overrides
  applyKippOverrides(db);

  // Sync muatan column based on target_muatan_mode
  try {
    const settings = getSettings();
    if (settings.target_muatan_mode === 'honor') {
      db.prepare('UPDATE subsls_master SET muatan = COALESCE(target_honor, 0)').run();
    } else {
      db.prepare('UPDATE subsls_master SET muatan = COALESCE(muatan_original, 0)').run();
    }
  } catch (err) {
    console.error('⚠️ Warning: Failed to sync muatan after Excel load:', err.message);
  }

  return dataRows.length;
}

function applyKippOverrides(db) {
  try {
    console.log('Applying special KIPP IKN PCL and target_fasih overrides...');
    db.exec(`
      -- Swap PCL for 103 and 101/123/124
      UPDATE subsls_master SET pcl = 'MUHAMAD FIRDAUS EKA TRISNA SAPUTRA', target_fasih = 33 WHERE kode = '6409040004500103';
      UPDATE subsls_master SET pcl = 'Betni Sari', target_fasih = 0 WHERE kode = '6409040004500101';
      UPDATE subsls_master SET pcl = 'Betni Sari', target_fasih = 1 WHERE kode = '6409040004500123';
      UPDATE subsls_master SET pcl = 'Betni Sari', target_fasih = 0 WHERE kode = '6409040004500124';
      UPDATE subsls_master SET pcl = 'Betni Sari', target_fasih = 0 WHERE kode = '6409040004500104';
      
      -- Nurul Hidayanti: shift target from 130 to 127
      UPDATE subsls_master SET target_fasih = 2 WHERE kode = '6409040004500127';
      UPDATE subsls_master SET target_fasih = 0 WHERE kode = '6409040004500130';
    `);
    console.log('✅ Applied special KIPP IKN overrides successfully.');
  } catch (err) {
    console.error('⚠️ Warning: Failed to apply KIPP IKN overrides:', err.message);
  }
}

function parseAndSaveSeparateExports(keluargaPath, usahaPath, originalKeluargaName, originalUsahaName, tanggal, statusFilePath = null, statusOriginalFilename = null, statusStoredFilename = null) {
  const db = getDb();
  
  // Map to hold merged progress data by Sub-SLS code
  const mergedData = {};
  
  // Helper to resolve row index containing column headers
  function findHeaderRowIndex(rows) {
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      if (!rows[i]) continue;
      const rowStr = rows[i].map(c => String(c || '').toLowerCase().trim());
      if (rowStr.some(c => ['level_6_full_code', 'smallcode', 'kode', 'code', 'idsubsls'].some(alias => c.includes(alias)))) {
        return i;
      }
    }
    return 0;
  }

  // 1. Parse Keluarga if provided
  if (keluargaPath && fs.existsSync(keluargaPath)) {
    const wb = XLSX.readFile(keluargaPath, { raw: true });
    const ws = wb.Sheets['KELUARGA'] || findDataSheet(wb);
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
      if (rows.length >= 2) {
        const headerIdx = findHeaderRowIndex(rows);
        const headers = rows[headerIdx].map(h => String(h || '').toLowerCase().trim());
        
        const kodeIdx = findCol(headers, KODE_ALIASES);
        const ditemukanIdx = findCol(headers, DITEMUKAN_ALIASES);
        const baruIdx = findCol(headers, KELUARGA_BARU_ALIASES);
        const meninggalIdx = findCol(headers, ['meninggal', 'keluarga_meninggal', 'kk_meninggal']);
        const teIdx = findCol(headers, ['tidak eligible', 'tidak_eligible', 'kk_tidak_eligible']);
        const tddIdx = findCol(headers, ['tidak dapat ditemui', 'tidak_dapat_ditemui', 'kk_tidak_dapat_ditemui']);
        const tdIdx = findCol(headers, ['tidak ditemukan', 'tidak_ditemukan', 'kk_tidak_ditemukan']);
        const kkKhususIdx = findCol(headers, ['keluarga khusus', 'keluarga_khusus', 'kk_khusus', 'khusus']);
        
        if (kodeIdx !== -1) {
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            let kode = String(row[kodeIdx] || '').trim();
            if (kode.endsWith('.0')) kode = kode.slice(0, -2);
            if (!kode || kode.length < 10 || kode === '6409000000000000' || kode.endsWith('000000000000')) continue;
            
            if (!mergedData[kode]) {
              mergedData[kode] = createEmptyProgresRecord();
            }
            
            mergedData[kode].ditemukan = ditemukanIdx !== -1 ? toInt(row[ditemukanIdx]) : 0;
            mergedData[kode].keluarga_baru = baruIdx !== -1 ? toInt(row[baruIdx]) : 0;
            mergedData[kode].meninggal = meninggalIdx !== -1 ? toInt(row[meninggalIdx]) : 0;
            mergedData[kode].tidak_eligible = teIdx !== -1 ? toInt(row[teIdx]) : 0;
            mergedData[kode].tidak_dapat_ditemui = tddIdx !== -1 ? toInt(row[tddIdx]) : 0;
            mergedData[kode].tidak_ditemukan = tdIdx !== -1 ? toInt(row[tdIdx]) : 0;
            mergedData[kode].keluarga_khusus = kkKhususIdx !== -1 ? toInt(row[kkKhususIdx]) : 0;
          }
        }
      }
    }
  }
  
  // 2. Parse Usaha if provided
  if (usahaPath && fs.existsSync(usahaPath)) {
    const wb = XLSX.readFile(usahaPath, { raw: true });
    
    // Check if workbook has separate sheets 'USAHA PERUSAHAAN' and 'USAHA KELUARGA' (legacy export format)
    const legacySheets = ['USAHA PERUSAHAAN', 'USAHA KELUARGA'].filter(s => wb.Sheets[s]);
    const sheetsToProcess = legacySheets.length > 0 ? legacySheets : [findDataSheet(wb) ? wb.SheetNames.find(s => wb.Sheets[s] === findDataSheet(wb)) || wb.SheetNames[0] : wb.SheetNames[0]];

    for (const sheetName of sheetsToProcess) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: 0 });
      if (rows.length < 2) continue;

      let headerIdx = -1;
      let subHeaders = null;

      for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (rows[i] && rows[i].map(c => String(c || '').toLowerCase()).some(c => KODE_ALIASES.some(alias => c.includes(alias)))) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx !== -1) {
        const headers = rows[headerIdx].map(h => String(h || '').toLowerCase().trim());
        // Check if there is a multi-tier header (like subheaders on next row)
        if (rows[headerIdx + 1] && rows[headerIdx + 1].map(c => String(c || '').toLowerCase()).some(c => c.includes('ditemukan') || c.includes('tutup') || c.includes('baru'))) {
          subHeaders = rows[headerIdx + 1].map(h => String(h || '').toLowerCase().trim());
        }

        const effectiveHeaders = subHeaders ? subHeaders : headers;
        const kodeIdx = findCol(headers, KODE_ALIASES);
        
        const ditemukanIdx = findCol(effectiveHeaders, USAHA_DITEMUKAN_ALIASES);
        const tutupIdx = findCol(effectiveHeaders, ['tutup', 'usaha_tutup', 'usaha_tutup_permanen']);
        const gandaIdx = findCol(effectiveHeaders, ['ganda', 'usaha_ganda']);
        const tdIdx = findCol(effectiveHeaders, ['tidak ditemukan', 'tidak_ditemukan', 'usaha_tidak_ditemukan']);
        const baruIdx = findCol(effectiveHeaders, USAHA_BARU_ALIASES);
        
        const startRow = subHeaders ? headerIdx + 2 : headerIdx + 1;

        if (kodeIdx !== -1) {
          for (let i = startRow; i < rows.length; i++) {
            const row = rows[i];
            let kode = String(row[kodeIdx] || '').trim();
            if (kode.endsWith('.0')) kode = kode.slice(0, -2);
            if (!kode || kode.length < 10 || kode === '6409000000000000' || kode.endsWith('000000000000')) continue;
            
            if (!mergedData[kode]) {
              mergedData[kode] = createEmptyProgresRecord();
            }
            
            mergedData[kode].usaha_ditemukan += ditemukanIdx !== -1 ? toInt(row[ditemukanIdx]) : 0;
            mergedData[kode].usaha_tutup += tutupIdx !== -1 ? toInt(row[tutupIdx]) : 0;
            mergedData[kode].usaha_ganda += gandaIdx !== -1 ? toInt(row[gandaIdx]) : 0;
            mergedData[kode].usaha_tidak_ditemukan += tdIdx !== -1 ? toInt(row[tdIdx]) : 0;
            mergedData[kode].usaha_baru += baruIdx !== -1 ? toInt(row[baruIdx]) : 0;
          }
        }
      }
    }
  }
  
  // 3. Save to database
  const filename = [
    originalKeluargaName ? `Keluarga: ${originalKeluargaName}` : '',
    originalUsahaName ? `Usaha: ${originalUsahaName}` : ''
  ].filter(Boolean).join(' | ') || 'separate_exports';
  
  const uploadStmt = db.prepare(`
    INSERT INTO uploads (filename, stored_filename, tanggal, total_subsls_terisi, status_filename, stored_status_filename) 
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const dataRows = Object.entries(mergedData).map(([kode, val]) => ({
    kode,
    ...val
  })).filter(r => r.kode.length >= 10);
  
  const uploadResult = uploadStmt.run(
    safeFilename(filename),
    null,
    tanggal,
    dataRows.length,
    safeNullableStr(statusOriginalFilename),
    safeNullableStr(statusStoredFilename)
  );
  const uploadId = uploadResult.lastInsertRowid;
  
  // Get previous upload_id strictly before or on this date chronologically
  const prevUploadRow = db.prepare(`
    SELECT u.id 
    FROM uploads u
    JOIN progres p ON u.id = p.upload_id
    WHERE u.tanggal <= ? AND u.id != ?
    GROUP BY u.id
    HAVING SUM(COALESCE(p.draft, 0) + COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) > 0
    ORDER BY u.tanggal DESC, u.id DESC LIMIT 1
  `).get(tanggal, uploadId);

  const prevUploadId = prevUploadRow ? prevUploadRow.id : null;
  
  const insertProgres = db.prepare(`
    INSERT OR REPLACE INTO progres 
      (upload_id, kode,
       usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
       tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
       rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya,
       draft, open, submitted_by_pcl, approved, rejected, target_upload, keluarga_khusus, sls_selesai)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const getPrevStatus = db.prepare(`
    SELECT 
      COALESCE(draft, 0) AS draft, 
      COALESCE(open, 0) AS open, 
      COALESCE(submitted_by_pcl, 0) AS submitted_by_pcl, 
      COALESCE(approved, 0) AS approved, 
      COALESCE(rejected, 0) AS rejected,
      COALESCE(target_upload, 0) AS target_upload,
      COALESCE(sls_selesai, 0) AS sls_selesai
    FROM progres 
    WHERE upload_id = ? AND kode = ?
  `);
  
  db.transaction(() => {
    for (const r of dataRows) {
      let draft = 0, openVal = 0, submitted = 0, approved = 0, rejected = 0, targetUpload = 0, slsSelesai = 0;
      if (prevUploadId) {
        const prev = getPrevStatus.get(prevUploadId, r.kode);
        if (prev) {
          draft = prev.draft;
          openVal = prev.open;
          submitted = prev.submitted_by_pcl;
          approved = prev.approved;
          rejected = prev.rejected;
          targetUpload = prev.target_upload;
          slsSelesai = prev.sls_selesai;
        }
      }
      
      insertProgres.run(
        uploadId, r.kode,
        r.usaha_tidak_ditemukan, r.usaha_ditemukan, r.usaha_baru, r.usaha_tutup, r.usaha_ganda,
        r.tidak_ditemukan, r.ditemukan, r.keluarga_baru, r.meninggal, r.tidak_eligible, r.tidak_dapat_ditemui,
        0, 0, 0, 0, 0,
        draft, openVal, submitted, approved, rejected, targetUpload, r.keluarga_khusus, slsSelesai
      );
    }
  })();
  
  // Process status FASIH if provided
  if (statusFilePath) {
    parseAndSaveStatusExcel(statusFilePath, uploadId);
  }

  // Sinkronkan urutan status secara kronologis (mencegah out-of-order upload issue)
  resyncChronologicalStatus();
  
  // Ensure 100% SubSLS coverage & rebuild summary cache
  ensureAllSubslsInUpload(uploadId);
  const { rebuildSummaryCache } = require('../database');
  rebuildSummaryCache(uploadId);
  
  return { uploadId, totalRows: dataRows.length, uniqueSubsls: dataRows.length };
}

function createEmptyProgresRecord() {
  return {
    usaha_tidak_ditemukan: 0,
    usaha_ditemukan: 0,
    usaha_baru: 0,
    usaha_tutup: 0,
    usaha_ganda: 0,
    tidak_ditemukan: 0,
    ditemukan: 0,
    keluarga_baru: 0,
    meninggal: 0,
    tidak_eligible: 0,
    tidak_dapat_ditemui: 0,
    keluarga_khusus: 0
  };
}

/**
 * Parser dan handler khusus untuk file JSON Rekap Petugas Wilayah (FASIH)
 * Otomatis melakukan auto-seeding master wilayah & nama petugas dari referensi database.
 */
function parseAndSaveJsonStatusOnly(filePath, originalFilename, storedFilename, tanggal, surveyId = 'se2026') {
  const { getDb } = require('../database');
  const db = getDb(surveyId);
  const masterDb = getDb('se2026'); // Reference database for PPU master wilayah hierarchy

  // 1. Read and parse JSON content
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const jsonItems = JSON.parse(rawContent);
  if (!Array.isArray(jsonItems) || jsonItems.length === 0) {
    throw new Error('File JSON kosong atau format tidak sesuai.');
  }

  // 2. Load officer emails lookup from data/petugas_email.json (fallback to SQLite petugas_email)
  const emailMap = {};
  try {
    const petugasJsonPath = path.join(__dirname, '../data/petugas_email.json');
    if (fs.existsSync(petugasJsonPath)) {
      const emailList = JSON.parse(fs.readFileSync(petugasJsonPath, 'utf-8'));
      emailList.forEach(p => {
        const em = (p.Email || '').trim().toLowerCase();
        if (em) {
          emailMap[em] = {
            sobat_id: String(p['Sobat ID'] || p.sobat_id || '').trim(),
            nama_lengkap: String(p['Nama Lengkap'] || p.nama_lengkap || '').trim(),
            jenis_kelamin: String(p['Jenis Kelamin'] || p.jenis_kelamin || '').trim()
          };
        }
      });
    }
  } catch (err) {
    console.error('Error loading data/petugas_email.json:', err);
  }

  // Also check database petugas_email table
  try {
    const dbEmails = db.prepare('SELECT email, nama_lengkap, sobat_id, jenis_kelamin FROM petugas_email').all();
    dbEmails.forEach(p => {
      const em = (p.email || '').trim().toLowerCase();
      if (em && !emailMap[em]) {
        emailMap[em] = {
          sobat_id: p.sobat_id,
          nama_lengkap: p.nama_lengkap,
          jenis_kelamin: p.jenis_kelamin
        };
      }
    });
  } catch (_) {}

  // 3. Separate PML and PPL items
  const pmlItems = jsonItems.filter(d => (d.role || '').toUpperCase() === 'PML');
  const pplItems = jsonItems.filter(d => (d.role || '').toUpperCase() !== 'PML');

  // Lookup wilayah hierarchy from se2026.db master if available
  let getWilayahInfo = null;
  try {
    getWilayahInfo = masterDb.prepare('SELECT kecamatan, desa, nama_sls FROM subsls_master WHERE kode = ?');
  } catch (_) {}

  // 4. Process PML items first if present
  const pmlMap = {};
  pmlItems.forEach(item => {
    const officerStr = item.officer || '';
    const emailMatch = officerStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) return;
    const rawEmail = emailMatch[0].toLowerCase();
    
    let pmlName = '';
    let sobatId = '';
    if (emailMap[rawEmail]) {
      pmlName = emailMap[rawEmail].nama_lengkap;
      sobatId = emailMap[rawEmail].sobat_id;
    } else {
      let username = rawEmail.split('@')[0].replace('-pppk', '').replace(/^\d{4}\./, '');
      if (rawEmail === 'zahrakhairunnisa@bps.go.id') {
        pmlName = 'Zahra Khairunnisa';
      } else {
        pmlName = username.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }

    (item.regions || []).forEach(r => {
      if (!r.code) return;
      const kodeClean = r.code.padStart(16, '0');
      pmlMap[kodeClean] = { pmlName, pmlEmail: rawEmail, sobatId };
    });
  });

  // CASE A: File ONLY contains PML allocations (no PPL)
  if (pmlItems.length > 0 && pplItems.length === 0) {
    let updatedCount = 0;
    db.transaction(() => {
      for (const [kodeClean, pmlInfo] of Object.entries(pmlMap)) {
        const existing = db.prepare('SELECT kode FROM subsls_master WHERE kode = ?').get(kodeClean);
        if (existing) {
          db.prepare('UPDATE subsls_master SET pml = ?, pml_email = ?, pml_sobat_id = ? WHERE kode = ?')
            .run(pmlInfo.pmlName, pmlInfo.pmlEmail, pmlInfo.sobatId, kodeClean);
          updatedCount++;
        } else {
          let kecName = 'Kecamatan Lain', desaName = 'Desa Lain', slsName = kodeClean;
          if (getWilayahInfo) {
            const wInfo = getWilayahInfo.get(kodeClean);
            if (wInfo) {
              kecName = wInfo.kecamatan || kecName;
              desaName = wInfo.desa || desaName;
              slsName = wInfo.nama_sls || slsName;
            }
          }
          db.prepare(`
            INSERT INTO subsls_master (kode, kecamatan, desa, nama_sls, korlap, pml, pml_email, pml_sobat_id, pcl, target_fasih)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(kodeClean, kecName, desaName, slsName, 'Lainnya', pmlInfo.pmlName, pmlInfo.pmlEmail, pmlInfo.sobatId, 'Belum Dialokasikan', 0);
          updatedCount++;
        }
      }
    })();

    const latestUpload = db.prepare('SELECT id FROM uploads ORDER BY id DESC LIMIT 1').get();
    if (latestUpload) {
      const { rebuildSummaryCache } = require('../database');
      rebuildSummaryCache(latestUpload.id, surveyId);
    }

    return {
      uploadId: latestUpload ? latestUpload.id : null,
      uniqueSubsls: updatedCount,
      totalOfficers: pmlItems.length,
      isPmlOnly: true
    };
  }

  // CASE B: File contains PPL (and optionally PML)
  // 5. Create upload record
  const uploadResult = db.prepare(`
    INSERT INTO uploads (filename, stored_filename, tanggal, total_subsls_terisi, status_filename, stored_status_filename)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('', null, tanggal, 0, safeNullableStr(originalFilename), safeNullableStr(storedFilename));
  const uploadId = uploadResult.lastInsertRowid;

  // 6. Prepared statements for master and progres
  const insertSubslsMaster = db.prepare(`
    INSERT OR REPLACE INTO subsls_master (
      kode, kecamatan, desa, nama_sls, korlap, pml, pml_email, pml_sobat_id, pcl, pcl_email, pcl_sobat_id, target_fasih
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const insertProgresStmt = db.prepare(`
    INSERT OR REPLACE INTO progres (
      upload_id, kode, pcl_email, pcl_name, pcl_sobat_id,
      draft, open, submitted_by_pcl, approved, rejected, target_upload,
      usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
      tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0
    )
  `);

  let processedRegions = 0;
  const uniqueEmailsSeen = new Set();
  const uniqueCodesSeen = new Set();

  db.transaction(() => {
    pplItems.forEach(item => {
      const officerStr = item.officer || '';
      const emailMatch = officerStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (!emailMatch) return;
      const rawEmail = emailMatch[0].toLowerCase();
      uniqueEmailsSeen.add(rawEmail);

      let namaLengkap = '';
      let sobatId = '';
      if (emailMap[rawEmail]) {
        namaLengkap = emailMap[rawEmail].nama_lengkap;
        sobatId = emailMap[rawEmail].sobat_id;
      } else {
        let username = rawEmail.split('@')[0].replace('-pppk', '').replace(/^\d{4}\./, '');
        namaLengkap = username.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }

      const regions = item.regions || [];
      regions.forEach(r => {
        const rawKode = r.code || '';
        if (!rawKode) return;
        const kodeClean = rawKode.padStart(16, '0');
        uniqueCodesSeen.add(kodeClean);

        let openVal = 0, draftVal = 0, submittedVal = 0, approvedVal = 0, rejectedVal = 0;
        const statuses = r.statuses || [];
        statuses.forEach(st => {
          const sName = (st.status || '').toUpperCase();
          const cnt = parseInt(st.count || 0, 10);
          if (isNaN(cnt)) return;

          if (sName.includes('OPEN')) openVal += cnt;
          else if (sName.includes('DRAFT')) draftVal += cnt;
          else if (sName.includes('SUBMITTED') || sName.includes('SUBMIT')) submittedVal += cnt;
          else if (sName.includes('APPROVED')) approvedVal += cnt;
          else if (sName.includes('REJECTED') || sName.includes('REVOKED')) rejectedVal += cnt;
        });

        const targetVal = openVal + draftVal + submittedVal + approvedVal + rejectedVal;

        // Wilayah resolution
        let kecName = 'Kecamatan Lain';
        let desaName = 'Desa Lain';
        let slsName = kodeClean;

        if (getWilayahInfo) {
          const wInfo = getWilayahInfo.get(kodeClean);
          if (wInfo) {
            kecName = wInfo.kecamatan || kecName;
            desaName = wInfo.desa || desaName;
            slsName = wInfo.nama_sls || slsName;
          }
        }

        // PML Resolution: priority: pmlMap in this file > existing subsls_master PML > default
        const existingMaster = db.prepare('SELECT pml, pml_email, pml_sobat_id FROM subsls_master WHERE kode = ?').get(kodeClean);
        let assignedPml = 'PML Belum Dialokasikan';
        let assignedPmlEmail = null;
        let assignedPmlSobatId = null;

        if (pmlMap[kodeClean]) {
          assignedPml = pmlMap[kodeClean].pmlName;
          assignedPmlEmail = pmlMap[kodeClean].pmlEmail;
          assignedPmlSobatId = pmlMap[kodeClean].sobatId;
        } else if (existingMaster && existingMaster.pml && existingMaster.pml !== 'PML Belum Dialokasikan') {
          assignedPml = existingMaster.pml;
          assignedPmlEmail = existingMaster.pml_email;
          assignedPmlSobatId = existingMaster.pml_sobat_id;
        }

        // Auto-seed / update subsls_master
        insertSubslsMaster.run(
          kodeClean,
          kecName,
          desaName,
          slsName,
          'Lainnya',                // Korlap
          assignedPml,             // PML
          assignedPmlEmail,
          assignedPmlSobatId,
          namaLengkap,             // PCL
          rawEmail,
          sobatId,
          targetVal
        );

        // Insert into progres
        insertProgresStmt.run(
          uploadId,
          kodeClean,
          rawEmail,
          namaLengkap,
          sobatId,
          draftVal,
          openVal,
          submittedVal,
          approvedVal,
          rejectedVal,
          targetVal
        );

        processedRegions++;
      });
    });
  })();

  // Synchronize and rebuild summary cache
  ensureAllSubslsInUpload(uploadId, surveyId);
  const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
  db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);

  const { rebuildSummaryCache } = require('../database');
  rebuildSummaryCache(uploadId, surveyId);

  return {
    uploadId,
    uniqueSubsls: uniqueCodesSeen.size,
    totalOfficers: uniqueEmailsSeen.size,
    processedRegions
  };
}

// Parser khusus untuk file Rekap Petugas Wilayah (kode wilayah & email petugas)
function parseJsonRekapPetugas(jsonPath) {
  const rawContent = fs.readFileSync(jsonPath, 'utf-8');
  const jsonItems = JSON.parse(rawContent);
  const rows = [];
  jsonItems.forEach(item => {
    const officerStr = item.officer || '';
    const emailMatch = officerStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) return;
    const email = emailMatch[0].toLowerCase();

    const tgtMatch = officerStr.match(/Total Assignment\s+(\d+)/i);
    const officerTotalTarget = tgtMatch ? parseInt(tgtMatch[1], 10) : 0;

    const regions = item.regions || [];
    const regionCount = regions.length;
    const targetPerRegion = regionCount > 0 ? (officerTotalTarget / regionCount) : 0;

    regions.forEach(r => {
      const kode = r.code || '';
      if (!kode) return;

      let openVal = 0, draftVal = 0, submittedVal = 0, approvedVal = 0, rejectedVal = 0;
      const statuses = r.statuses || [];
      statuses.forEach(st => {
        const sName = (st.status || '').toUpperCase();
        const cnt = parseInt(st.count || 0, 10);
        if (isNaN(cnt)) return;

        if (sName.includes('OPEN')) openVal += cnt;
        else if (sName.includes('DRAFT')) draftVal += cnt;
        else if (sName.includes('SUBMITTED')) submittedVal += cnt;
        else if (sName.includes('APPROVED')) approvedVal += cnt;
        else if (sName.includes('REJECTED') || sName.includes('REVOKED')) rejectedVal += cnt;
      });

      const targetVal = targetPerRegion > 0 ? targetPerRegion : (openVal + draftVal + submittedVal + approvedVal + rejectedVal);
      rows.push({
        kode,
        email,
        draft: draftVal,
        open: openVal,
        approved: approvedVal,
        rejected: rejectedVal,
        submitted: submittedVal,
        target_upload: targetVal
      });
    });
  });
  return rows;
}

function parseRekapPetugasWilayah(filePath) {
  const db = getDb();
  let rows = [];

  const ext = path.extname(filePath).toLowerCase();
  const jsonCandidatePath = filePath.replace(/\.(csv|xlsx|xls)$/i, '.json');
  const outputJsonPath = path.join('C:', 'Users', 'ajian', 'vercel-agent-browser', 'output', 'rekap_petugas_wilayah_20260726_112523.json');

  if (ext === '.json') {
    rows = parseJsonRekapPetugas(filePath);
  } else if (fs.existsSync(jsonCandidatePath)) {
    rows = parseJsonRekapPetugas(jsonCandidatePath);
  } else if (fs.existsSync(outputJsonPath) && filePath.includes('20260726_112523')) {
    rows = parseJsonRekapPetugas(outputJsonPath);
  } else if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawJson = XLSX.utils.sheet_to_json(ws);
    rows = rawJson.map(r => {
      let kw = '', em = '';
      for (const k of Object.keys(r)) {
        const kl = k.toLowerCase();
        if (kl.includes('kode') || kl.includes('wilayah') || kl.includes('subsls')) kw = String(r[k]).trim();
        if (kl.includes('email')) em = String(r[k]).trim().toLowerCase();
      }
      return { kode: kw, email: em };
    });
  } else {
    // CSV parsing
    const content = fs.readFileSync(filePath, 'utf-8');
    const firstLine = content.split(/\r?\n/)[0] || '';
    let sep = ';';
    if (firstLine.includes(';')) sep = ';';
    else if (firstLine.includes(',')) sep = ',';
    else if (firstLine.includes('\t')) sep = '\t';

    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) throw new Error('File rekap petugas wilayah kosong.');

    const header = lines[0].split(sep).map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
    const kodeIdx = header.findIndex(h => h.includes('kode') || h.includes('subsls') || h.includes('wilayah'));
    const emailIdx = header.findIndex(h => h.includes('email'));

    if (kodeIdx === -1 || emailIdx === -1) {
      throw new Error('Header file harus berisi kolom "kode wilayah" dan "email petugas".');
    }

    const draftIdx = header.findIndex(h => h.includes('draft'));
    const approvedIdx = header.findIndex(h => h.includes('approved'));
    const rejectedIdx = header.findIndex(h => h.includes('rejected'));
    const revokedIdx = header.findIndex(h => h.includes('revoked'));
    const openIdx = header.findIndex(h => h.includes('open'));
    const submittedIdx = header.findIndex(h => h.includes('submitted') || h.includes('submit') || h.includes('pencacah'));
    const totalIdx = header.findIndex(h => h.includes('total') || h.includes('assignment'));

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
      if (cols.length <= Math.max(kodeIdx, emailIdx)) continue;
      
      const draftVal = draftIdx !== -1 ? parseInt(cols[draftIdx] || 0, 10) : 0;
      const openVal = openIdx !== -1 ? parseInt(cols[openIdx] || 0, 10) : 0;
      const approvedVal = approvedIdx !== -1 ? parseInt(cols[approvedIdx] || 0, 10) : 0;
      const rejectedVal = (rejectedIdx !== -1 ? parseInt(cols[rejectedIdx] || 0, 10) : 0) + (revokedIdx !== -1 ? parseInt(cols[revokedIdx] || 0, 10) : 0);
      const targetVal = totalIdx !== -1 ? parseInt(cols[totalIdx] || 0, 10) : 0;
      const submittedVal = submittedIdx !== -1 ? parseInt(cols[submittedIdx] || 0, 10) : 0;

      rows.push({
        kode: cols[kodeIdx],
        email: cols[emailIdx].toLowerCase(),
        draft: draftVal,
        open: openVal,
        approved: approvedVal,
        rejected: rejectedVal,
        submitted: submittedVal,
        target_upload: targetVal
      });
    }
  }

  // Pre-load existing emails
  const existingEmails = db.prepare('SELECT email, nama_lengkap, sobat_id FROM petugas_email').all();
  const emailMap = {};
  existingEmails.forEach(r => {
    if (r.email) emailMap[r.email.trim().toLowerCase()] = r;
  });

  const updateSubslsStmt = db.prepare(`
    UPDATE subsls_master 
    SET pcl_email = ?, pcl_sobat_id = ?, pcl = ?
    WHERE kode = ? OR kode_2025 = ?
  `);

  const insertEmailStmt = db.prepare(`
    INSERT INTO petugas_email (sobat_id, nama_lengkap, email, jenis_kelamin)
    VALUES (?, ?, ?, ?)
  `);

  const latestUpload = db.prepare('SELECT id FROM uploads ORDER BY id DESC LIMIT 1').get();
  const uploadId = latestUpload ? latestUpload.id : 1;

  // Find previous upload_id that has progres records
  const prevUploadRow = db.prepare(`
    SELECT u.id 
    FROM uploads u
    JOIN progres p ON u.id = p.upload_id
    WHERE u.id < ? 
    GROUP BY u.id
    ORDER BY u.id DESC LIMIT 1
  `).get(uploadId);
  const prevUploadId = prevUploadRow ? prevUploadRow.id : null;

  const getPrevMuatan = db.prepare(`
    SELECT 
      usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
      tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya, submitted_by_pcl
    FROM progres
    WHERE upload_id = ? AND kode = ? AND COALESCE(pcl_email, '') = COALESCE(?, '')
    LIMIT 1
  `);

  const insertProgresStmt = db.prepare(`
    INSERT INTO progres (
      upload_id, kode, pcl_email, pcl_name, pcl_sobat_id,
      draft, open, submitted_by_pcl, approved, rejected, target_upload,
      usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
      tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(upload_id, kode, COALESCE(pcl_email, '')) DO UPDATE SET
      draft = excluded.draft,
      open = excluded.open,
      submitted_by_pcl = excluded.submitted_by_pcl,
      approved = excluded.approved,
      rejected = excluded.rejected,
      target_upload = excluded.target_upload,
      pcl_email = excluded.pcl_email,
      pcl_name = excluded.pcl_name,
      pcl_sobat_id = excluded.pcl_sobat_id,
      usaha_tidak_ditemukan = excluded.usaha_tidak_ditemukan,
      usaha_ditemukan = excluded.usaha_ditemukan,
      usaha_baru = excluded.usaha_baru,
      usaha_tutup = excluded.usaha_tutup,
      usaha_ganda = excluded.usaha_ganda,
      tidak_ditemukan = excluded.tidak_ditemukan,
      ditemukan = excluded.ditemukan,
      keluarga_baru = excluded.keluarga_baru,
      meninggal = excluded.meninggal,
      tidak_eligible = excluded.tidak_eligible,
      tidak_dapat_ditemui = excluded.tidak_dapat_ditemui,
      rumah_tunggal = excluded.rumah_tunggal,
      rumah_deret = excluded.rumah_deret,
      rumah_susun = excluded.rumah_susun,
      apartemen = excluded.apartemen,
      lainnya = excluded.lainnya
  `);

  let totalRows = 0;
  let updatedSubsls = 0;
  let newEmailsCount = 0;
  const uniqueEmailsSeen = new Set();

  // Pre-calculate per-officer max target and subsls count
  const officerSubslsCounts = {};
  const officerMaxTargets = {};
  for (const item of rows) {
    if (!item.email) continue;
    officerSubslsCounts[item.email] = (officerSubslsCounts[item.email] || 0) + 1;
    if (item.target_upload > (officerMaxTargets[item.email] || 0)) {
      officerMaxTargets[item.email] = item.target_upload;
    }
  }

  db.transaction(() => {
    for (const item of rows) {
      const rawKode = item.kode;
      const rawEmail = item.email;

      if (!rawKode || !rawEmail) continue;

      const kodeClean = rawKode.padStart(16, '0');
      uniqueEmailsSeen.add(rawEmail);

      let namaLengkap = '';
      let sobatId = '';

      if (emailMap[rawEmail]) {
        namaLengkap = emailMap[rawEmail].nama_lengkap;
        sobatId = emailMap[rawEmail].sobat_id || '';
      } else {
        const username = rawEmail.split('@')[0];
        namaLengkap = username.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        sobatId = '';
        try {
          insertEmailStmt.run(sobatId, namaLengkap, rawEmail, '');
          emailMap[rawEmail] = { email: rawEmail, nama_lengkap: namaLengkap, sobat_id: sobatId };
          newEmailsCount++;
        } catch (_) {}
      }

      const res = updateSubslsStmt.run(rawEmail, sobatId, namaLengkap, kodeClean, rawKode);
      if (res.changes > 0) {
        updatedSubsls += res.changes;
      }

      const subslsCnt = officerSubslsCounts[rawEmail] || 1;
      const maxTgt = officerMaxTargets[rawEmail] || item.target_upload || 0;
      const targetPerSubsls = (item.target_upload !== undefined && item.target_upload > 0) ? item.target_upload : (subslsCnt > 0 ? (maxTgt / subslsCnt) : 0);

      let usaha_tidak_ditemukan = 0, usaha_ditemukan = 0, usaha_baru = 0, usaha_tutup = 0, usaha_ganda = 0;
      let tidak_ditemukan = 0, ditemukan = 0, keluarga_baru = 0, meninggal = 0, tidak_eligible = 0, tidak_dapat_ditemui = 0;
      let rumah_tunggal = 0, rumah_deret = 0, rumah_susun = 0, apartemen = 0, lainnya = 0;
      let submitted_by_pcl = item.submitted !== -1 ? item.submitted : 0;

      if (prevUploadId) {
        const prev = getPrevMuatan.get(prevUploadId, kodeClean, rawEmail);
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
          if (item.submitted === -1) {
            submitted_by_pcl = prev.submitted_by_pcl || 0;
          }
        }
      }

      // Save individual officer progress row
      try {
        insertProgresStmt.run(
          uploadId,
          kodeClean,
          rawEmail,
          namaLengkap,
          sobatId,
          item.draft || 0,
          item.open || 0,
          submitted_by_pcl,
          item.approved || 0,
          item.rejected || 0,
          targetPerSubsls,
          usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
          tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
          rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya
        );
      } catch (_) {}

      totalRows++;
    }
  })();

  // Rebuild summary cache
  try {
    ensureAllSubslsInUpload(uploadId);
    const { rebuildSummaryCache } = require('../database');
    rebuildSummaryCache(uploadId);
  } catch (_) {}

  return {
    totalRows,
    updatedSubsls,
    uniqueEmails: uniqueEmailsSeen.size,
    newEmailsCount
  };
}

function ensureAllSubslsInUpload(uploadId, surveyId = 'se2026') {
  const { getDb } = require('../database');
  const db = getDb(surveyId);

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

  const masterSubsls = db.prepare('SELECT kode, target_fasih FROM subsls_master').all();
  const existingSubsls = new Set(
    db.prepare('SELECT kode FROM progres WHERE upload_id = ?').all(uploadId).map(r => r.kode)
  );

  const missingSubsls = masterSubsls.filter(m => !existingSubsls.has(m.kode));
  if (missingSubsls.length === 0) return 0;

  const getPrevProgres = db.prepare('SELECT * FROM progres WHERE upload_id = ? AND kode = ?');
  const insertProgres = db.prepare(`
    INSERT OR REPLACE INTO progres (
      upload_id, kode,
      usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
      tidak_ditemukan, ditemukan, keluarga_baru, meninggal, tidak_eligible, tidak_dapat_ditemui,
      rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya,
      draft, open, submitted_by_pcl, approved, rejected, target_upload, sls_selesai
    ) VALUES (
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  db.transaction(() => {
    for (const m of missingSubsls) {
      let prev = null;
      if (prevUploadId) {
        prev = getPrevProgres.get(prevUploadId, m.kode);
      }
      insertProgres.run(
        uploadId, m.kode,
        prev ? prev.usaha_tidak_ditemukan : 0,
        prev ? prev.usaha_ditemukan : 0,
        prev ? prev.usaha_baru : 0,
        prev ? prev.usaha_tutup : 0,
        prev ? prev.usaha_ganda : 0,
        prev ? prev.tidak_ditemukan : 0,
        prev ? prev.ditemukan : 0,
        prev ? prev.keluarga_baru : 0,
        prev ? prev.meninggal : 0,
        prev ? prev.tidak_eligible : 0,
        prev ? prev.tidak_dapat_ditemui : 0,
        prev ? prev.rumah_tunggal : 0,
        prev ? prev.rumah_deret : 0,
        prev ? prev.rumah_susun : 0,
        prev ? prev.apartemen : 0,
        prev ? prev.lainnya : 0,
        prev ? prev.draft : 0,
        prev ? prev.open : 0,
        prev ? prev.submitted_by_pcl : 0,
        prev ? prev.approved : 0,
        prev ? prev.rejected : 0,
        prev ? (prev.target_upload || m.target_fasih) : m.target_fasih,
        prev ? (prev.sls_selesai || 0) : 0
      );
    }
  })();

  const actualCount = db.prepare('SELECT COUNT(*) as n FROM progres WHERE upload_id = ?').get(uploadId).n;
  db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(actualCount, uploadId);
  return missingSubsls.length;
}

/**
 * Menyinkronkan status FASIH dan progres muatan secara kronologis berdasarkan urutan tanggal (tanggal ASC, id ASC)
 * sehingga apabila pengguna meng-upload salah satu jenis berkas saja (parsial), data jenis berkas lainnya
 * TIDAK PERNAH terhapus atau bernilai 0.
 */
function resyncChronologicalData() {
  const db = getDb();
  const uploads = db.prepare('SELECT id, tanggal FROM uploads ORDER BY tanggal ASC, id ASC').all();
  if (uploads.length <= 1) return;

  let lastKnownStatusUploadId = null;
  let lastKnownMuatanUploadId = null;

  for (const u of uploads) {
    // 1. Cek keberadaan data status FASIH / SLS Selesai
    const hasStatus = db.prepare(`
      SELECT SUM(COALESCE(draft, 0) + COALESCE(submitted_by_pcl, 0) + COALESCE(approved, 0) + COALESCE(rejected, 0) + COALESCE(sls_selesai, 0)) AS total
      FROM progres WHERE upload_id = ?
    `).get(u.id);

    if (hasStatus && hasStatus.total > 0) {
      lastKnownStatusUploadId = u.id;
    } else if (lastKnownStatusUploadId && lastKnownStatusUploadId !== u.id) {
      db.transaction(() => {
        db.prepare(`
          UPDATE progres 
          SET 
            draft = (SELECT COALESCE(p2.draft, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            open = (SELECT COALESCE(p2.open, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            submitted_by_pcl = (SELECT COALESCE(p2.submitted_by_pcl, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            approved = (SELECT COALESCE(p2.approved, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            rejected = (SELECT COALESCE(p2.rejected, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            target_upload = (SELECT COALESCE(p2.target_upload, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            sls_selesai = (SELECT COALESCE(p2.sls_selesai, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode)
          WHERE upload_id = ?
        `).run(
          lastKnownStatusUploadId, lastKnownStatusUploadId, lastKnownStatusUploadId, 
          lastKnownStatusUploadId, lastKnownStatusUploadId, lastKnownStatusUploadId, 
          lastKnownStatusUploadId,
          u.id
        );
      })();
    }

    // 2. Cek keberadaan data progres muatan (keluarga & usaha)
    const hasMuatan = db.prepare(`
      SELECT SUM(COALESCE(usaha_ditemukan, 0) + COALESCE(usaha_baru, 0) + COALESCE(ditemukan, 0) + COALESCE(keluarga_baru, 0)) AS total
      FROM progres WHERE upload_id = ?
    `).get(u.id);

    if (hasMuatan && hasMuatan.total > 0) {
      lastKnownMuatanUploadId = u.id;
    } else if (lastKnownMuatanUploadId && lastKnownMuatanUploadId !== u.id) {
      db.transaction(() => {
        db.prepare(`
          UPDATE progres 
          SET 
            usaha_tidak_ditemukan = (SELECT COALESCE(p2.usaha_tidak_ditemukan, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            usaha_ditemukan = (SELECT COALESCE(p2.usaha_ditemukan, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            usaha_baru = (SELECT COALESCE(p2.usaha_baru, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            usaha_tutup = (SELECT COALESCE(p2.usaha_tutup, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            usaha_ganda = (SELECT COALESCE(p2.usaha_ganda, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            tidak_ditemukan = (SELECT COALESCE(p2.tidak_ditemukan, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            ditemukan = (SELECT COALESCE(p2.ditemukan, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            keluarga_baru = (SELECT COALESCE(p2.keluarga_baru, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            meninggal = (SELECT COALESCE(p2.meninggal, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            tidak_eligible = (SELECT COALESCE(p2.tidak_eligible, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode),
            tidak_dapat_ditemui = (SELECT COALESCE(p2.tidak_dapat_ditemui, 0) FROM progres p2 WHERE p2.upload_id = ? AND p2.kode = progres.kode)
          WHERE upload_id = ?
        `).run(
          lastKnownMuatanUploadId, lastKnownMuatanUploadId, lastKnownMuatanUploadId,
          lastKnownMuatanUploadId, lastKnownMuatanUploadId, lastKnownMuatanUploadId,
          lastKnownMuatanUploadId, lastKnownMuatanUploadId, lastKnownMuatanUploadId,
          lastKnownMuatanUploadId, lastKnownMuatanUploadId,
          u.id
        );
      })();
    }
  }
}

function resyncChronologicalStatus() {
  resyncChronologicalData();
}

module.exports = {
  parseAndSaveExcel,
  loadMasterFromJson,
  loadMasterFromExcel,
  parseAndSaveStatusExcel,
  parseAndSaveStatusExcelOnly,
  parseAndSaveJsonStatusOnly,
  parseAndSaveSeparateExports,
  parseRekapPetugasWilayah,
  ensureAllSubslsInUpload,
  resyncChronologicalStatus,
  resyncChronologicalData
};

