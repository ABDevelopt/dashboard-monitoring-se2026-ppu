// Template query yang sudah dioptimasi dan ditest untuk Sensus Ekonomi 2026 (SE2026) PPU
// AI Agent dapat menggunakan template ini secara langsung atau sebagai acuan.
const QUERY_HINTS = {
  rerata_fasih: {
    description: 'Rata-rata progres realisasi dokumen FASIH per kecamatan',
    sql: `
      SELECT kecamatan,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(target_fasih_total) AS target_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total) / NULLIF(SUM(target_fasih_total), 0), 2) AS pct
      FROM summary_cache
      WHERE upload_id = :uploadId
      GROUP BY kecamatan
      ORDER BY pct DESC
    `
  },
  pcl_fasih_terendah: {
    description: 'PCL dengan capaian realisasi dokumen FASIH terendah/terburuk, bisa difilter berdasarkan kecamatan',
    sql: `
      SELECT pcl, pml, kecamatan, 
        (submitted_total + approved_total + rejected_total) AS realisasi_fasih, 
        target_fasih_total,
        ROUND(100.0 * (submitted_total + approved_total + rejected_total) / NULLIF(target_fasih_total, 0), 2) AS pct
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND target_fasih_total > 0
      ORDER BY pct ASC
      LIMIT :limit
    `
  },
  pcl_fasih_tertinggi: {
    description: 'PCL dengan capaian realisasi dokumen FASIH tertinggi/terbaik (leaderboard), bisa difilter berdasarkan kecamatan',
    sql: `
      SELECT pcl, pml, kecamatan, 
        (submitted_total + approved_total + rejected_total) AS realisasi_fasih, 
        target_fasih_total,
        ROUND(100.0 * (submitted_total + approved_total + rejected_total) / NULLIF(target_fasih_total, 0), 2) AS pct
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND target_fasih_total > 0
      ORDER BY pct DESC, realisasi_fasih DESC
      LIMIT :limit
    `
  },
  overview_kabupaten: {
    description: 'Ringkasan total progres (FASIH & Muatan) se-Kabupaten PPU',
    sql: `
      SELECT
        SUM(total_sls)      AS total_sls,
        SUM(total_muatan)   AS total_muatan,
        SUM(muatan_selesai) AS muatan_selesai,
        SUM(target_fasih_total) AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(draft_total)    AS draft_total,
        SUM(submitted_total) AS submitted_total,
        SUM(approved_total) AS approved_total,
        SUM(rejected_total) AS rejected_total,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total) / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih,
        ROUND(100.0 * SUM(muatan_selesai) / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
    `
  }
};

module.exports = { QUERY_HINTS };
