const express = require('express');
const router = express.Router();
const { getTrenHarian, getKecamatanStats, getPclStats, getDb, getSettings, attachProgressPercentages, getTargetFormula } = require('../database');

// Tren harian (untuk Chart.js)
router.get('/tren', (req, res) => {
  res.json(getTrenHarian());
});

// Stats per kecamatan
router.get('/kecamatan', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.json([]);
  res.json(getKecamatanStats(uploadId));
});

// Search SubSLS
router.get('/search', (req, res) => {
  const q = req.query.q || '';
  const uploadId = res.locals.uploadId;
  if (!q || !uploadId) return res.json([]);

  const results = getDb().prepare(`
    SELECT m.kode, m.kecamatan, m.desa, m.pcl, m.pml, m.korlap,
           CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END AS sudah_diisi
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.kode LIKE ? OR m.desa LIKE ? OR m.pcl LIKE ?
    LIMIT 20
  `).all(uploadId, `%${q}%`, `%${q}%`, `%${q}%`);

  res.json(results);
});

// Summary API
router.get('/summary', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.json(null);

  const { getOverviewSummary } = require('../database');
  res.json(getOverviewSummary(uploadId));
});

// Map Statistics API
router.get('/map-stats', (req, res) => {
  const uploadId = res.locals.uploadId || -1;

  const db = getDb();
  
  const settings = getSettings();
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const desaStats = db.prepare(`
    SELECT 
      SUBSTR(m.kode, 1, 10) AS iddesa,
      m.kecamatan, m.desa,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.kecamatan, m.desa
  `).all(uploadId);

  const slsStats = db.prepare(`
    SELECT 
      m.kode,
      m.nama_sls,
      m.desa,
      m.kecamatan,
      m.korlap,
      m.pml,
      m.pcl,
      m.muatan,
      (${singleSelesaiFormula}) AS selesai,
      COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
      COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total,
      COALESCE(p.draft, 0) AS draft,
      COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
      COALESCE(p.approved, 0) AS approved,
      COALESCE(p.rejected, 0) AS rejected,
      (${singleTargetFormula}) AS target_fasih,
      COALESCE(m.target_fasih, 0) AS target_static,
      COALESCE(p.target_upload, 0) AS target_upload
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
  `).all(uploadId);

  res.json({ desaStats: attachProgressPercentages(desaStats), slsStats: attachProgressPercentages(slsStats) });
});

// Detail Korlap
router.get('/detail/korlap', (req, res) => {
  const uploadId = res.locals.uploadId;
  const name = req.query.name;
  if (!uploadId || !name) return res.json({ error: 'Parameter uploadId atau nama Korlap tidak ditemukan.' });

  const settings = getSettings();
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const data = getDb().prepare(`
    SELECT 
      m.pml, m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.korlap = ?
    GROUP BY m.pml
    ORDER BY selesai ASC
  `).all(uploadId, name);

  res.json(attachProgressPercentages(data));
});

// Detail PML
router.get('/detail/pml', (req, res) => {
  const uploadId = res.locals.uploadId;
  const name = req.query.name;
  if (!uploadId || !name) return res.json({ error: 'Parameter uploadId atau nama PML tidak ditemukan.' });

  const settings = getSettings();
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const data = getDb().prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END) AS selesai,
      SUM(m.muatan) AS total_muatan,
      SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
      SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
      SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
      SUM(COALESCE(p.draft, 0)) AS draft_total,
      SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
      SUM(COALESCE(p.approved, 0)) AS approved_total,
      SUM(COALESCE(p.rejected, 0)) AS rejected_total,
      SUM(${singleTargetFormula}) AS target_fasih_total,
      SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
      SUM(COALESCE(p.target_upload, 0)) AS target_upload_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.pml = ?
    GROUP BY m.pcl, m.kecamatan
    ORDER BY selesai ASC
  `).all(uploadId, name);

  res.json(attachProgressPercentages(data));
});

// Detail PCL
router.get('/detail/pcl', (req, res) => {
  const uploadId = res.locals.uploadId;
  const name = req.query.name;
  if (!uploadId || !name) return res.json({ error: 'Parameter uploadId atau nama PCL tidak ditemukan.' });

  const settings = getSettings();
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const data = getDb().prepare(`
    SELECT 
      m.kode, m.kecamatan, m.desa, m.nama_sls,
      m.korlap, m.pml, m.pcl, m.muatan,
      m.target_fasih AS target_fasih_awal,
      COALESCE(p.draft, 0) AS draft,
      COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
      COALESCE(p.approved, 0) AS approved,
      COALESCE(p.rejected, 0) AS rejected,
      (${singleTargetFormula}) AS target_fasih,
      COALESCE(m.target_fasih, 0) AS target_static,
      COALESCE(p.target_upload, 0) AS target_upload,
      CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN 1 ELSE 0 END AS sudah_diisi,
      COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
      COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    WHERE m.pcl = ?
    ORDER BY m.kecamatan, m.desa, m.kode
  `).all(uploadId, name);

  res.json(attachProgressPercentages(data));
});

// Simpan data cuaca harian
router.post('/weather', (req, res) => {
  const { tanggal, temp, code, humidity } = req.body;
  if (!tanggal || temp === undefined || code === undefined || humidity === undefined) {
    return res.status(400).json({ error: 'Data cuaca tidak lengkap.' });
  }
  const { saveDailyWeather } = require('../database');
  const success = saveDailyWeather(tanggal, temp, code, humidity);
  res.json({ success });
});

// Ambil riwayat cuaca
router.get('/weather/history', (req, res) => {
  const { getWeatherHistory } = require('../database');
  res.json(getWeatherHistory());
});

// Ubah mode target utama progres secara dinamis
router.post('/settings/target-mode', (req, res) => {
  const { target_fasih_mode, target_muatan_mode } = req.body;
  const { getSettings, updateSettings } = require('../database');
  const settings = getSettings();
  const updatedSettings = { ...settings };

  let changed = false;
  if (target_fasih_mode && ['static', 'dynamic', 'fasih-sm', 'honor'].includes(target_fasih_mode)) {
    updatedSettings.target_fasih_mode = target_fasih_mode;
    changed = true;
  }
  if (target_muatan_mode && ['prelist', 'honor'].includes(target_muatan_mode)) {
    updatedSettings.target_muatan_mode = target_muatan_mode;
    changed = true;
  }

  if (changed) {
    try {
      updateSettings(updatedSettings);
      res.json({ success: true, target_fasih_mode, target_muatan_mode });
    } catch (err) {
      res.status(500).json({ error: `Gagal memperbarui target mode: ${err.message}` });
    }
  } else {
    res.status(400).json({ error: 'Tidak ada perubahan target yang valid.' });
  }
});

module.exports = router;

