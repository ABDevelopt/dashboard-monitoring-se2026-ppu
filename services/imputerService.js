const { getDb, rebuildSummaryCache } = require('../database');
const fs = require('fs');
const path = require('path');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Mendeteksi hari kosong di database dan melakukan imputasi linear (bagi rata)
 * dari data tanggal setelahnya.
 * @returns {number} Jumlah tanggal baru yang berhasil diimputasi
 */
function runAutoImputation(surveyId = 'se2026') {
  const db = getDb(surveyId);
  
  // Ambil upload riil terbaru (terakhir di-upload) untuk setiap tanggal
  // Untuk membedakan, upload imputasi ditandai dengan filename 'Imputasi Otomatis (Hari Kosong)'
  const uploads = db.prepare(`
    SELECT id, tanggal, filename FROM uploads 
    WHERE filename != 'Imputasi Otomatis (Hari Kosong)'
    AND id IN (SELECT MAX(id) FROM uploads GROUP BY tanggal)
    ORDER BY tanggal ASC
  `).all();
  
  if (uploads.length < 2) {
    console.log('[Imputer] Upload data kurang dari 2. Imputasi dilewati.');
    return 0;
  }

  // Map untuk memantau semua tanggal yang sudah memiliki upload (termasuk yang sudah diimputasi)
  const allUploadsMap = new Map();
  const allUploads = db.prepare('SELECT id, tanggal, filename FROM uploads').all();
  allUploads.forEach(u => {
    allUploadsMap.set(u.tanggal, u);
  });

  // Tentukan tanggal batas bawah (upload tertua) dan batas atas (upload terbaru)
  const minDateStr = uploads[0].tanggal;
  const maxDateStr = uploads[uploads.length - 1].tanggal;
  
  const startDate = new Date(minDateStr);
  const endDate = new Date(maxDateStr);

  let current = new Date(startDate);
  current.setDate(current.getDate() + 1); // mulai dari hari setelah upload pertama

  let imputedCount = 0;

  db.transaction(() => {
    while (current <= endDate) {
      const targetTanggal = formatDate(current);
      
      // Jika tanggal ini belum memiliki upload sama sekali
      if (!allUploadsMap.has(targetTanggal)) {
        console.log(`[Imputer] Mendeteksi hari kosong: ${targetTanggal}. Melakukan imputasi...`);
        
        // Cari upload riil terdekat SEBELUMNYA
        let prevUpload = null;
        let prevDateStr = '';
        let testDate = new Date(current);
        while (true) {
          testDate.setDate(testDate.getDate() - 1);
          const testStr = formatDate(testDate);
          const match = uploads.find(u => u.tanggal === testStr);
          if (match) {
            prevUpload = match;
            prevDateStr = testStr;
            break;
          }
          if (testDate < startDate) break; // safeguard
        }
        
        // Cari upload riil terdekat SETELAHNYA
        let nextUpload = null;
        let nextDateStr = '';
        testDate = new Date(current);
        while (true) {
          testDate.setDate(testDate.getDate() + 1);
          const testStr = formatDate(testDate);
          const match = uploads.find(u => u.tanggal === testStr);
          if (match) {
            nextUpload = match;
            nextDateStr = testStr;
            break;
          }
          if (testDate > endDate) break; // safeguard
        }
        
        if (prevUpload && nextUpload) {
          const kDays = Math.round((new Date(nextDateStr) - new Date(prevDateStr)) / (1000 * 60 * 60 * 24));
          const dDays = Math.round((new Date(targetTanggal) - new Date(prevDateStr)) / (1000 * 60 * 60 * 24));
          
          console.log(`[Imputer]   Interpolasi: ${prevDateStr} (ID: ${prevUpload.id}) -> ${targetTanggal} -> ${nextDateStr} (ID: ${nextUpload.id}) (K=${kDays}, d=${dDays})`);
          
          // 1. Insert record upload baru untuk tanggal imputasi
          const uploadRes = db.prepare(`
            INSERT INTO uploads (tanggal, created_at, filename) 
            VALUES (?, ?, ?)
          `).run(targetTanggal, `${targetTanggal} 12:00:00`, 'Imputasi Otomatis (Hari Kosong)');
          
          const newUploadId = uploadRes.lastInsertRowid;
          
          // 2. Ambil seluruh data progres dari prev dan next
          const prevRows = db.prepare('SELECT * FROM progres WHERE upload_id = ?').all(prevUpload.id);
          const nextRows = db.prepare('SELECT * FROM progres WHERE upload_id = ?').all(nextUpload.id);
          
          const nextRowMap = new Map();
          nextRows.forEach(r => {
            nextRowMap.set(r.kode, r);
          });
          
          // Kolom numerik yang perlu di-interpolasi
          const numericCols = [
            'draft', 'open', 'submitted_by_pcl', 'approved', 'rejected',
            'usaha_tidak_ditemukan', 'usaha_ditemukan', 'usaha_baru',
            'usaha_tutup', 'usaha_ganda', 'tidak_ditemukan', 'ditemukan',
            'keluarga_baru', 'meninggal', 'tidak_eligible', 'tidak_dapat_ditemui',
            'rumah_tunggal', 'rumah_deret', 'rumah_susun', 'apartemen', 'lainnya',
            'target_upload'
          ];
          
          const progresCols = db.prepare("PRAGMA table_info(progres)").all().map(c => c.name).filter(n => n !== 'id');
          const insertSql = `
            INSERT INTO progres (${progresCols.join(', ')}) 
            VALUES (${progresCols.map(() => '?').join(', ')})
          `;
          const stmt = db.prepare(insertSql);
          
          prevRows.forEach(prevRow => {
            const nextRow = nextRowMap.get(prevRow.kode) || prevRow;
            const newRow = { ...prevRow };
            newRow.upload_id = newUploadId;
            
            numericCols.forEach(col => {
              if (col in prevRow && col in nextRow) {
                const pVal = prevRow[col] || 0;
                const nVal = nextRow[col] || 0;
                newRow[col] = Math.round(pVal + (dDays * (nVal - pVal)) / kDays);
              }
            });
            
            const vals = progresCols.map(col => newRow[col]);
            stmt.run(vals);
          });
          
          // 3. Rebuild summary cache untuk upload imputasi
          rebuildSummaryCache(newUploadId);
          imputedCount++;
          
          // Tambahkan ke map agar iterasi berikutnya mengetahui tanggal ini sudah terisi
          allUploadsMap.set(targetTanggal, { id: newUploadId, tanggal: targetTanggal, filename: 'Imputasi Otomatis (Hari Kosong)' });
        }
      }
      
      current.setDate(current.getDate() + 1);
    }
  })();

  return imputedCount;
}

module.exports = {
  runAutoImputation
};
