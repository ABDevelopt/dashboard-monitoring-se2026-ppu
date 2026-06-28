const { getDb, getLatestUpload } = require('d:/SE2026/monitoring-se2026-ppu/database');

async function main() {
  const db = getDb();
  const upload = getLatestUpload();
  if (!upload) {
    console.error('No upload data found.');
    return;
  }
  
  console.log('--- RUNNING PCL QUERY BENCHMARK ---');

  // Test old query format (using subsls_master + progres JOIN)
  const start1 = performance.now();
  const res1 = db.prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
  `).all(upload.id);
  const end1 = performance.now();
  console.log(`Old subsls_master + progres JOIN query took ${(end1 - start1).toFixed(2)} ms. Returned ${res1.length} rows.`);

  // Test new query format (using summary_cache)
  const start2 = performance.now();
  const res2 = db.prepare(`
    SELECT 
      pcl, pml, korlap, kecamatan,
      SUM(total_sls) AS total_subsls,
      SUM(selesai) AS selesai,
      SUM(total_muatan) AS total_muatan,
      SUM(muatan_selesai) AS muatan_selesai,
      SUM(usaha_total) AS usaha_total,
      SUM(keluarga_total) AS keluarga_total
    FROM summary_cache
    WHERE upload_id = ?
    GROUP BY pcl, pml, korlap, kecamatan
  `).all(upload.id);
  const end2 = performance.now();
  console.log(`New summary_cache query took ${(end2 - start2).toFixed(2)} ms. Returned ${res2.length} rows.`);

  console.log('--- BENCHMARK COMPLETED ---');
}

main().catch(console.error);
