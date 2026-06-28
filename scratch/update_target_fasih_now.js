const { getDb, rebuildSummaryCache } = require('d:/SE2026/monitoring-se2026-ppu/database');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

function main() {
  const db = getDb();
  const alokasiPath = 'd:/SE2026/monitoring-se2026-ppu/rancangan-muatan-se2026-ppu.xlsx';
  if (!fs.existsSync(alokasiPath)) {
    console.error('File excel alokasi tidak ditemukan!');
    return;
  }

  console.log('Reading Excel file:', alokasiPath);
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
        const res = updateStmt.run(targetFasih, code);
        if (res.changes > 0) {
          updatedCount++;
        }
      }
    }
  })();
  
  console.log(`Updated target_fasih for ${updatedCount} records in subsls_master.`);

  // Check sum of target_fasih
  const sumRow = db.prepare('SELECT SUM(target_fasih) as sum FROM subsls_master').get();
  console.log('New target_fasih SUM in subsls_master:', sumRow.sum);

  // Rebuild summary cache for all uploads to update the cached values
  const uploads = db.prepare('SELECT id FROM uploads').all();
  console.log(`Rebuilding summary_cache for ${uploads.length} uploads...`);
  for (const u of uploads) {
    rebuildSummaryCache(u.id);
  }
  console.log('All summary_cache records successfully rebuilt.');
}

main();
