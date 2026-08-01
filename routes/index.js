const express = require('express');
const router = express.Router();
const { getOverviewSummary, getKecamatanStats, getTrenHarian } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let summary = null;
  let kecStats = [];
  let tren = [];
  let distLast = null;

  if (uploadId) {
    summary = getOverviewSummary(uploadId, res.locals.settings);
    kecStats = getKecamatanStats(uploadId, res.locals.settings);
    tren = getTrenHarian();

    // Hitung sebaran penambahan dokumen oleh petugas (Update Ini)
    const { getDb } = require('../database');
    const db = getDb();
    const prevUpload = db.prepare('SELECT id FROM uploads WHERE id < ? ORDER BY id DESC LIMIT 1').get(uploadId);
    
    let pclDeltas = [];
    if (prevUpload) {
      distLast = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN diff <= 0 THEN 1 ELSE 0 END), 0) AS bucket_0,
          COALESCE(SUM(CASE WHEN diff BETWEEN 1 AND 4 THEN 1 ELSE 0 END), 0) AS bucket_1_4,
          COALESCE(SUM(CASE WHEN diff BETWEEN 5 AND 7 THEN 1 ELSE 0 END), 0) AS bucket_5_7,
          COALESCE(SUM(CASE WHEN diff BETWEEN 8 AND 12 THEN 1 ELSE 0 END), 0) AS bucket_8_12,
          COALESCE(SUM(CASE WHEN diff >= 13 THEN 1 ELSE 0 END), 0) AS bucket_13_plus
        FROM (
          SELECT 
            m.pcl,
            (SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) -
             SUM(COALESCE(p_prev.submitted_by_pcl, 0) + COALESCE(p_prev.approved, 0) + COALESCE(p_prev.rejected, 0))) AS diff
          FROM subsls_master m
          LEFT JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
          LEFT JOIN progres p_prev ON m.kode = p_prev.kode AND p_prev.upload_id = ?
          WHERE m.pcl IS NOT NULL AND m.pcl != ''
          GROUP BY m.pcl
        )
      `).get(uploadId, prevUpload.id);

      pclDeltas = db.prepare(`
        SELECT 
          m.pcl,
          (SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) -
           SUM(COALESCE(p_prev.submitted_by_pcl, 0) + COALESCE(p_prev.approved, 0) + COALESCE(p_prev.rejected, 0))) AS diff
        FROM subsls_master m
        LEFT JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
        LEFT JOIN progres p_prev ON m.kode = p_prev.kode AND p_prev.upload_id = ?
        WHERE m.pcl IS NOT NULL AND m.pcl != ''
        GROUP BY m.pcl
        ORDER BY m.pcl ASC
      `).all(uploadId, prevUpload.id);
    } else {
      distLast = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN diff <= 0 THEN 1 ELSE 0 END), 0) AS bucket_0,
          COALESCE(SUM(CASE WHEN diff BETWEEN 1 AND 4 THEN 1 ELSE 0 END), 0) AS bucket_1_4,
          COALESCE(SUM(CASE WHEN diff BETWEEN 5 AND 7 THEN 1 ELSE 0 END), 0) AS bucket_5_7,
          COALESCE(SUM(CASE WHEN diff BETWEEN 8 AND 12 THEN 1 ELSE 0 END), 0) AS bucket_8_12,
          COALESCE(SUM(CASE WHEN diff >= 13 THEN 1 ELSE 0 END), 0) AS bucket_13_plus
        FROM (
          SELECT 
            m.pcl,
            SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) AS diff
          FROM subsls_master m
          LEFT JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
          WHERE m.pcl IS NOT NULL AND m.pcl != ''
          GROUP BY m.pcl
        )
      `).get(uploadId);

      pclDeltas = db.prepare(`
        SELECT 
          m.pcl,
          SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) AS diff
        FROM subsls_master m
        LEFT JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
        WHERE m.pcl IS NOT NULL AND m.pcl != ''
        GROUP BY m.pcl
        ORDER BY m.pcl ASC
      `).all(uploadId);
    }
  }

  res.render('overview', {
    title: 'Overview',
    activePage: 'overview',
    summary,
    kecStats,
    tren: JSON.stringify(tren),
    distLast,
    pclDeltas: JSON.stringify(pclDeltas)
  });
});

module.exports = router;
