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

    // Dapatkan data upload saat ini dan upload valid sebelumnya (Single Query)
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

      const prevStats = getOverviewSummary(prevUpload.id, res.locals.settings, surveyId);
      const prevRealisasi = prevStats ? ((prevStats.submitted_total || 0) + (prevStats.approved_total || 0) + (prevStats.rejected_total || 0)) : 0;
      const currRealisasi = summary ? ((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)) : 0;
      diffTotal = Math.max(0, currRealisasi - prevRealisasi);
    } else {
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

      diffTotal = summary ? ((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)) : 0;
    }

    // Hitung distribusi bucket distLast berdasarkan jenis kegiatan (survei sampel vs sensus)
    const isSakernas = surveyId.startsWith('sakernas');
    let buckets;
    if (isSakernas) {
      buckets = { bucket_0: 0, bucket_1: 0, bucket_2: 0, bucket_3_4: 0, bucket_5_plus: 0 };
      for (let i = 0; i < pclDeltas.length; i++) {
        const d = pclDeltas[i].diff || 0;
        if (d <= 0) buckets.bucket_0++;
        else if (d === 1) buckets.bucket_1++;
        else if (d === 2) buckets.bucket_2++;
        else if (d <= 4) buckets.bucket_3_4++;
        else buckets.bucket_5_plus++;
      }
    } else {
      buckets = { bucket_0: 0, bucket_1_4: 0, bucket_5_7: 0, bucket_8_12: 0, bucket_13_plus: 0 };
      for (let i = 0; i < pclDeltas.length; i++) {
        const d = pclDeltas[i].diff || 0;
        if (d <= 0) buckets.bucket_0++;
        else if (d <= 4) buckets.bucket_1_4++;
        else if (d <= 7) buckets.bucket_5_7++;
        else if (d <= 12) buckets.bucket_8_12++;
        else buckets.bucket_13_plus++;
      }
    }
    distLast = buckets;

    const totalPcl = summary ? (summary.total_pcl || 1) : 1;
    let daysBetween = 1;
    if (prevUpload && currentUpload && prevUpload.tanggal && currentUpload.tanggal) {
      const dCur = new Date(currentUpload.tanggal);
      const dPrv = new Date(prevUpload.tanggal);
      const diffTime = dCur - dPrv;
      daysBetween = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));
    }
    const latestDailySpeedTotal = diffTotal / daysBetween;
    latestUpdateSpeedPerPcl = totalPcl > 0 ? (latestDailySpeedTotal / totalPcl) : 0;
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
