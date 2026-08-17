const express = require('express');
const router = express.Router();
const { getOverviewSummary, getKecamatanStats, getTrenHarian, getDb } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const surveyId = res.locals.activeSurvey || 'se2026';
  const db = getDb(surveyId);
  let summary = null;
  let kecStats = [];
  let tren = [];
  let distLast = null;
  let pclDeltas = [];

  if (uploadId) {
    summary = getOverviewSummary(uploadId, res.locals.settings, surveyId);
    kecStats = getKecamatanStats(uploadId, res.locals.settings, surveyId);
    tren = getTrenHarian(surveyId);

    // Hitung sebaran penambahan dokumen oleh petugas (Update Ini)
    const currentUpload = db.prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
    const prevUpload = currentUpload ? db.prepare(`
      SELECT id 
      FROM uploads 
      WHERE total_subsls_terisi > 0 
        AND (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%') 
        AND tanggal < ? 
      ORDER BY tanggal DESC, id DESC 
      LIMIT 1
    `).get(currentUpload.tanggal) : null;
    
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

  // Calculate diffTotal and latestUpdateSpeedPerPcl (productivity from last upload)
  let diffTotal = 0;
  let latestUpdateSpeedPerPcl = 0;
  if (uploadId) {
    const currentUpload = db.prepare('SELECT tanggal FROM uploads WHERE id = ?').get(uploadId);
    const prevUpload = currentUpload ? db.prepare(`
      SELECT id 
      FROM uploads 
      WHERE total_subsls_terisi > 0 
        AND (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%') 
        AND tanggal < ? 
      ORDER BY tanggal DESC, id DESC 
      LIMIT 1
    `).get(currentUpload.tanggal) : null;
    
    if (prevUpload) {
      const prevStats = getOverviewSummary(prevUpload.id, res.locals.settings, surveyId);
      const prevRealisasi = prevStats ? ((prevStats.submitted_total || 0) + (prevStats.approved_total || 0) + (prevStats.rejected_total || 0)) : 0;
      const currRealisasi = summary ? ((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)) : 0;
      diffTotal = Math.max(0, currRealisasi - prevRealisasi);
    } else {
      diffTotal = summary ? ((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)) : 0;
    }
    const totalPcl = summary ? (summary.total_pcl || 1) : 1;
    latestUpdateSpeedPerPcl = totalPcl > 0 ? (diffTotal / totalPcl) : 0;
  }

  res.render('overview', {
    title: 'Overview',
    activePage: 'overview',
    summary,
    kecStats,
    tren: JSON.stringify(tren),
    distLast,
    pclDeltas: JSON.stringify(pclDeltas),
    latestUpdateSpeedPerPcl,
    diffTotal
  });
});

module.exports = router;
