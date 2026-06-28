const { getDb, rebuildSummaryCache } = require('d:/SE2026/monitoring-se2026-ppu/database');

function toTitleCase(str) {
  if (!str) return '';
  return str.trim().toLowerCase().split(/\s+/).map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

async function main() {
  console.log('--- STARTING OFFICER NORMALIZATION ---');
  const db = getDb();
  
  // 1. Fetch all subsls_master entries
  const rows = db.prepare('SELECT kode, pcl, pml FROM subsls_master').all();
  console.log(`Fetched ${rows.length} rows from subsls_master.`);

  // 2. Perform transaction to update PCL and PML to Title Case
  const updateStmt = db.prepare('UPDATE subsls_master SET pcl = ?, pml = ? WHERE kode = ?');
  
  const transaction = db.transaction((entries) => {
    let count = 0;
    for (const entry of entries) {
      const normalizedPcl = toTitleCase(entry.pcl);
      const normalizedPml = toTitleCase(entry.pml);
      if (normalizedPcl !== entry.pcl || normalizedPml !== entry.pml) {
        updateStmt.run(normalizedPcl, normalizedPml, entry.kode);
        count++;
      }
    }
    return count;
  });

  const updatedCount = transaction(rows);
  console.log(`Successfully normalized casing/spacing for ${updatedCount} entries in subsls_master.`);

  // 3. Rebuild summary cache for all uploads
  const uploads = db.prepare('SELECT id, filename FROM uploads').all();
  console.log(`Rebuilding summary_cache for ${uploads.length} uploads...`);
  for (const upload of uploads) {
    console.log(`- Rebuilding upload ID ${upload.id} (${upload.filename})...`);
    rebuildSummaryCache(upload.id);
  }

  console.log('--- OFFICER NORMALIZATION COMPLETED ---');
}

main().catch(console.error);
