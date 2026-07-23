const express = require('express');
const router = express.Router();
const { getTrenHarian, getKecamatanStats, getPclStats, getDb, getSettings, updateSettings, attachProgressPercentages, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula } = require('../database');

// Tren harian (untuk Chart.js)
router.get('/tren', (req, res) => {
  res.json(getTrenHarian());
});

// Stats per kecamatan
router.get('/kecamatan', (req, res) => {
  const uploadId = res.locals.uploadId;
  if (!uploadId) return res.json([]);
  res.json(getKecamatanStats(uploadId, res.locals.settings));
});

// Search SubSLS
router.get('/search', (req, res) => {
  const q = req.query.q || '';
  const uploadId = res.locals.uploadId;
  if (!q || !uploadId) return res.json([]);

  const settings = res.locals.settings;
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');

  const results = getDb().prepare(`
    SELECT m.kode, m.kecamatan, m.desa, m.pcl, m.pml, m.korlap,
           CASE WHEN p.kode IS NOT NULL AND (${targetMuatanFormula}) > 0 AND (${realFormula}) >= (${targetMuatanFormula}) THEN 1 ELSE 0 END AS sudah_diisi
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
  res.json(getOverviewSummary(uploadId, res.locals.settings));
});

// Map Statistics API
router.get('/map-stats', (req, res) => {
  const uploadId = res.locals.uploadId || -1;

  const db = getDb();
  
  const settings = res.locals.settings;
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);

  const singleSelesaiFormula = `CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END`;

  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const desaStats = db.prepare(`
    SELECT 
      SUBSTR(m.kode, 1, 10) AS iddesa,
      m.kecamatan, m.desa,
      COUNT(m.kode) AS total_subsls,
      SUM(${singleSelesaiFormula}) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
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
      (${usahaTotalFormula}) AS usaha_total,
      (${keluargaTotalFormula}) AS keluarga_total,
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

  const settings = res.locals.settings;
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const data = getDb().prepare(`
    SELECT 
      m.pml, m.korlap,
      COUNT(DISTINCT m.pcl) AS jumlah_pcl,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
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

  const settings = res.locals.settings;
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

  const data = getDb().prepare(`
    SELECT 
      m.pcl, m.pml, m.korlap, m.kecamatan,
      COUNT(m.kode) AS total_subsls,
      SUM(CASE WHEN p.kode IS NOT NULL AND (${singleTargetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${singleTargetFormula}) THEN 1 ELSE 0 END) AS selesai,
      SUM(${targetMuatanFormula}) AS total_muatan,
      SUM(${realFormula}) AS muatan_selesai,
      SUM(${usahaTotalFormula}) AS usaha_total,
      SUM(${keluargaTotalFormula}) AS keluarga_total,
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

  const settings = res.locals.settings;
  const singleTargetFormula = getTargetFormula(settings.target_fasih_mode);
  const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
  const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
  const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
  const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

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
      CASE WHEN p.kode IS NOT NULL AND (${targetMuatanFormula}) > 0 AND (${realFormula}) >= (${targetMuatanFormula}) THEN 1 ELSE 0 END AS sudah_diisi,
      (${usahaTotalFormula}) AS usaha_total,
      (${keluargaTotalFormula}) AS keluarga_total
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

// Ubah mode target utama progres secara dinamis per-user session dan global database
router.post('/settings/target-mode', (req, res) => {
  const { target_fasih_mode, target_muatan_mode } = req.body;
  if (!req.session.settings) {
    req.session.settings = {};
  }

  let changed = false;
  const dbUpdates = {};

  if (target_fasih_mode && ['static', 'fasih-sm'].includes(target_fasih_mode)) {
    req.session.settings.target_fasih_mode = target_fasih_mode;
    dbUpdates.target_fasih_mode = target_fasih_mode;
    changed = true;
  }
  if (target_muatan_mode && ['prelist', 'honor'].includes(target_muatan_mode)) {
    req.session.settings.target_muatan_mode = target_muatan_mode;
    dbUpdates.target_muatan_mode = target_muatan_mode;
    changed = true;
  }

  if (changed) {
    try {
      // Perbarui di database global agar memicu rebuild cache dan sinkron dengan WA
      updateSettings(dbUpdates);
      
      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ error: `Gagal menyimpan session: ${err.message}` });
        }
        res.json({ success: true, target_fasih_mode, target_muatan_mode });
      });
    } catch (dbErr) {
      res.status(500).json({ error: `Gagal memperbarui database: ${dbErr.message}` });
    }
  } else {
    res.status(400).json({ error: 'Tidak ada perubahan target yang valid.' });
  }
});

// Endpoint untuk cek status update upload terbaru
router.get('/latest-updates', (req, res) => {
  const { getLatestUploadsDetailed } = require('../database');
  const details = getLatestUploadsDetailed();
  res.json({
    muatan: details.muatan ? {
      id: details.muatan.id,
      created_at: details.muatan.created_at,
      tanggal: details.muatan.tanggal,
      filename: details.muatan.filename
    } : null,
    fasih: details.fasih ? {
      id: details.fasih.id,
      created_at: details.fasih.created_at,
      tanggal: details.fasih.tanggal,
      status_filename: details.fasih.status_filename
    } : null
  });
});

// Endpoint untuk mendapatkan ringkasan early warning petugas
router.get('/early-warning-summary', (req, res) => {
  const { getLatestUpload, getEarlyWarning } = require('../database');
  const latestUpload = getLatestUpload();
  if (!latestUpload) {
    return res.json({
      success: false,
      message: 'Belum ada data upload'
    });
  }

  const ew = getEarlyWarning(latestUpload.id);
  res.json({
    success: true,
    latest_upload_date: latestUpload.tanggal,
    zero_pcl_count: ew.zeroPcl.length,
    slow_pcl_count: ew.slowPcl.length,
    zero_pml_count: ew.zeroPml.length,
    stagnan_pcl_count: ew.stagnanPcl.length,
    low_projected_pcl_count: ew.lowProjectedPcl.length
  });
});

// AI Insights memory cache
let aiInsightsCache = {
  uploadId: null,
  insights: null,
  timestamp: 0
};

// Helper function to call Gemini directly (tool-free and very fast!)
async function callGeminiDirect(prompt, settings) {
  const apiKey = settings.gemini_api_key;
  const modelName = settings.gemini_model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const requestBody = JSON.stringify({
    contents: [{
      parts: [{ text: prompt }]
    }]
  });

  const TIMEOUT_MS = 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.error) {
        throw new Error(`Gemini API Error (${data.error.status || data.error.code}): ${data.error.message}`);
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } else {
      let errText = '';
      try { errText = await response.text(); } catch (e) {}
      let parsedErr;
      try { parsedErr = JSON.parse(errText); } catch (e) {}
      if (parsedErr && parsedErr.error) {
        throw new Error(`Gemini API Error: ${parsedErr.error.message}`);
      }
      throw new Error(`Gemini API returned status ${response.status}: ${errText || 'Unknown Error'}`);
    }
  } catch (fetchErr) {
    console.warn('Native fetch in callGeminiDirect failed or timed out, trying curl fallback...', fetchErr.message);
    
    // Curl fallback with 5 seconds timeout
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const child = spawn('curl', [
        '-s', '-X', 'POST',
        '--connect-timeout', '5',
        '-m', '5',
        '-H', 'Content-Type: application/json',
        '-d', requestBody,
        url
      ]);

      const stdoutChunks = [];
      const stderrChunks = [];

      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`curl failed with code ${code}: ${Buffer.concat(stderrChunks).toString() || 'Timeout'}`));
        }
        try {
          const resText = Buffer.concat(stdoutChunks).toString();
          const data = JSON.parse(resText);
          if (data.error) {
            return reject(new Error(`Gemini API Error (${data.error.status || data.error.code}): ${data.error.message}`));
          }
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) resolve(text);
          else reject(new Error('Format respons Gemini curl tidak valid'));
        } catch (parseErr) {
          reject(new Error(`Gagal mem-parsing respons curl: ${parseErr.message}`));
        }
      });
    });
  }
}

// Rule-based fallback summary insights generator (offline and quota-exhausted guard)
function generateSimulatedInsights(payload) {
  const lowKec = [...payload.kecamatan_stats].sort((a, b) => a.persen_selesai - b.persen_selesai)[0];
  const lowKecText = lowKec ? `khususnya pengawasan intensif di Kecamatan **${lowKec.nama}** yang mencatat capaian terendah (${lowKec.persen_selesai}% selesai)` : 'khususnya pengawasan intensif di wilayah kecamatan tertinggal';
  
  const ewText = payload.early_warning.zero_progress_pcl > 0 
    ? `serta terdeteksinya **${payload.early_warning.zero_progress_pcl} PCL tanpa progres**`
    : `meskipun kinerja petugas relatif stabil tanpa ada yang sepenuhnya mandek`;

  return `<div class="ai-insight-paragraph" style="font-size: 13.5px; line-height: 1.6; color: var(--text-primary); padding: 14px 16px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-light); border-radius: 12px;">
    💡 **Analisis Taktis (Offline Fallback):** Progres sensus lapangan saat ini mencatat tingkat penyelesaian SLS sebesar **${payload.persen_selesai}%** dengan realisasi pengisian FASIH di angka **${payload.fasih.persen}%**. Hambatan kritis utama terletak pada capaian muatan yang masih rendah (**${payload.muatan.persen}%**), ${ewText}. Direkomendasikan untuk segera melakukan konsolidasi tim pengawas lapangan demi melakukan akselerasi penginputan data, ${lowKecText}.
  </div>`;
}

// Endpoint untuk mendapatkan AI Smart Insights (proactive analytics)
router.get('/ai-insights', async (req, res) => {
  const uploadId = res.locals.uploadId;
  const settings = res.locals.settings;

  if (!uploadId) {
    return res.json({ success: false, error: 'Belum ada data upload' });
  }

  // Cek cache jika bukan force refresh
  const forceRefresh = req.query.refresh === 'true';
  if (!forceRefresh && aiInsightsCache.uploadId === uploadId && aiInsightsCache.insights) {
    return res.json({ success: true, insights: aiInsightsCache.insights, fromCache: true });
  }

  try {
    const { getOverviewSummary, getKecamatanStats, getEarlyWarning } = require('../database');
    const summary = getOverviewSummary(uploadId, settings);
    if (!summary) {
      return res.json({ success: false, error: 'Gagal memuat ringkasan progres data' });
    }

    const kecs = getKecamatanStats(uploadId, settings);
    const ew = getEarlyWarning(uploadId);

    const payload = {
      tanggal_data: summary.tanggal_data || 'Tidak diketahui',
      total_sls: summary.total,
      sls_selesai: summary.selesai,
      persen_selesai: summary.total ? Number(((summary.selesai / summary.total) * 100).toFixed(2)) : 0,
      muatan: {
        total: summary.total_muatan,
        realisasi: summary.muatan_selesai,
        persen: summary.muatan_pct || 0
      },
      fasih: {
        target: summary.target_fasih_total,
        realisasi: (summary.submitted_total + summary.approved_total + summary.rejected_total),
        persen: summary.fasih_pct || 0,
        draft: summary.draft_total,
        submitted: summary.submitted_total,
        approved: summary.approved_total,
        rejected: summary.rejected_total
      },
      early_warning: {
        zero_progress_pcl: ew.zeroPcl ? ew.zeroPcl.length : 0,
        slow_progress_pcl: ew.slowPcl ? ew.slowPcl.length : 0,
        stagnant_pcl: ew.stagnanPcl ? ew.stagnanPcl.length : 0,
        low_projected_pcl: ew.lowProjectedPcl ? ew.lowProjectedPcl.length : 0
      },
      kecamatan_stats: (kecs || []).map(k => ({
        nama: k.kecamatan,
        total_sls: k.total_subsls,
        persen_selesai: k.total_subsls ? Number(((k.selesai / k.total_subsls) * 100).toFixed(2)) : 0,
        muatan_total: k.total_muatan,
        muatan_selesai: k.muatan_selesai,
        persen_muatan: k.muatan_pct || 0,
        persen_fasih: k.fasih_pct || 0
      }))
    };

    const prompt = `
Anda adalah AI Analyst senior untuk sistem Monitoring Lapangan SE2026 PPU BPS.
Tugas Anda adalah menganalisis data progres lapangan berikut dan memberikan analisis strategis mendalam, tajam, dan solutif dalam satu paragraf utuh (single block).

DATA PROGRES TERKINI (Tanggal Rekap Data: ${payload.tanggal_data}):
- Total SLS Terdaftar: ${payload.total_sls} SLS
- SLS Selesai (FASIH): ${payload.sls_selesai} SLS (${payload.persen_selesai}%)
- Progres Muatan (Target vs Realisasi): ${payload.muatan.realisasi} / ${payload.muatan.total} (${payload.muatan.persen}%)
- Dokumen FASIH (Target vs Realisasi): ${payload.fasih.realisasi} / ${payload.fasih.target} (${payload.fasih.percent || payload.fasih.persen}%)
  - Rincian Dokumen FASIH: Draft: ${payload.fasih.draft}, Submitted: ${payload.fasih.submitted}, Approved: ${payload.fasih.approved}, Rejected: ${payload.fasih.rejected}
- Early Warning Petugas:
  - Petugas tanpa progres (Zero Progress): ${payload.early_warning.zero_progress_pcl} PCL
  - Petugas berkinerja lambat (Slow Progress): ${payload.early_warning.slow_progress_pcl} PCL
  - Petugas dengan progres stagnan: ${payload.early_warning.stagnant_pcl} PCL
  - Proyeksi target rendah: ${payload.early_warning.low_projected_pcl} PCL
- Progres Per Kecamatan:
${payload.kecamatan_stats.map(k => `  * Kecamatan ${k.nama}: SLS Selesai: ${k.persen_selesai}%, Muatan: ${k.persen_muatan}%, Dokumen FASIH: ${k.persen_fasih}%`).join('\n')}

ATURAN FORMAT JAWABAN (WAJIB DIIKUTI):
1. Hasil analisis harus berupa SATU PARAGRAF saja (TIDAK BOLEH dibuat terpisah-pisah, bullet points, daftar list, kolom, atau jeda baris).
2. Tulis kalimat yang mengalir secara natural, profesional, mendalam, tajam, dan langsung menyoroti isu kritis.
3. Hubungkan data progres SLS selesai (${payload.persen_selesai}%), realisasi muatan (${payload.muatan.percent || payload.muatan.persen}%), dokumen FASIH (${payload.fasih.persen}%), serta peta status petugas peringatan dini (${payload.early_warning.zero_progress_pcl} tanpa progres, ${payload.early_warning.slow_progress_pcl} lambat) untuk merumuskan simpulan dan saran taktis.
4. Bungkus paragraf analisis Anda menggunakan struktur HTML berikut agar menyatu dengan UI dasbor:
   <div class="ai-insight-paragraph" style="font-size: 13.5px; line-height: 1.6; color: var(--text-primary); padding: 14px 16px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-light); border-radius: 12px;">
     💡 **Analisis Lapangan Terpadu:** [Tulis paragraf analisis strategis Anda di sini secara menyatu. Gunakan format markdown **bold** untuk menebalkan angka statistik, nama kecamatan terendah, atau kata kunci penting]
   </div>
5. PENTING: Gunakan markdown sederhana seperti **bold** untuk penekanan teks penting. Jangan gunakan tag <ul>, <li>, <ol>, atau format markdown list/kolom apa pun.
`;

    let content = null;
    let isFallback = false;
    try {
      content = await callGeminiDirect(prompt, settings);
      if (content) {
        // Bersihkan markdown code block wraps (```html ... ```) jika ada
        content = content.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
      }
    } catch (apiErr) {
      console.warn('Gagal memanggil Gemini API, menggunakan local fallback generator:', apiErr.message);
      content = generateSimulatedInsights(payload);
      isFallback = true;
    }

    // Simpan ke cache jika sukses
    if (content) {
      if (isFallback) {
        content = content.replace('</div>', '<br><small style="opacity:0.75; font-size:10px;">💡 <i>Statistik teranalisis otomatis oleh sistem internal (Offline Fallback).</i></small></div>');
      }
      aiInsightsCache = {
        uploadId,
        insights: content,
        timestamp: Date.now()
      };
      res.json({ success: true, insights: content, fromCache: false, fallback: isFallback });
    } else {
      throw new Error('Respons kosong dari Gemini API');
    }
  } catch (error) {
    console.error('Error generating AI Insights:', error);
    res.json({ success: false, error: 'Gagal menghasilkan AI Smart Insights: ' + error.message });
  }
});

module.exports = router;


