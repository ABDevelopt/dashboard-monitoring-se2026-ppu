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
  key: null,
  insights: null,
  timestamp: 0
};

// Helper function to call Gemini / LLM directly (multi-key & multi-provider fallback)
async function callGeminiDirect(prompt, settings = {}) {
  // Collect all potential Gemini API keys
  let keysToTry = [];
  
  if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
    keysToTry.push(settings.gemini_api_key.trim());
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() && !keysToTry.includes(process.env.GEMINI_API_KEY.trim())) {
    keysToTry.push(process.env.GEMINI_API_KEY.trim());
  }
  if (settings.gemini_backup_api_keys) {
    try {
      let backups = typeof settings.gemini_backup_api_keys === 'string' 
        ? JSON.parse(settings.gemini_backup_api_keys) 
        : settings.gemini_backup_api_keys;
      if (Array.isArray(backups)) {
        backups.forEach(k => {
          if (typeof k === 'string' && k.trim() && !keysToTry.includes(k.trim())) {
            keysToTry.push(k.trim());
          }
        });
      }
    } catch (e) {}
  }

  const modelName = settings.gemini_model || 'gemini-2.5-flash';
  const TIMEOUT_MS = 12000; // Increased to 12s for reliable hosting connection

  // Try Gemini keys
  for (const apiKey of keysToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

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
        if (!data.error) {
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
        }
      } else {
        let errText = '';
        try { errText = await response.text(); } catch (e) {}
        console.warn(`[AI Insights] Gemini API key (ending ...${apiKey.slice(-4)}) status ${response.status}: ${errText}`);
      }
    } catch (fetchErr) {
      console.warn(`[AI Insights] Fetch attempt failed for Gemini key (...${apiKey.slice(-4)}): ${fetchErr.message}, trying curl fallback...`);
      try {
        const curlRes = await new Promise((resolve, reject) => {
          const { spawn } = require('child_process');
          const child = spawn('curl', [
            '-s', '-X', 'POST',
            '--connect-timeout', '8',
            '-m', '10',
            '-H', 'Content-Type: application/json',
            '-d', requestBody,
            url
          ]);

          const stdoutChunks = [];
          const stderrChunks = [];
          child.stdout.on('data', chunk => stdoutChunks.push(chunk));
          child.stderr.on('data', chunk => stderrChunks.push(chunk));

          child.on('close', code => {
            if (code !== 0) return reject(new Error(`curl exit code ${code}`));
            try {
              const resText = Buffer.concat(stdoutChunks).toString();
              const data = JSON.parse(resText);
              if (data.error) return reject(new Error(data.error.message));
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) resolve(text);
              else reject(new Error('Empty candidate text'));
            } catch (e) {
              reject(e);
            }
          });
        });
        if (curlRes) return curlRes;
      } catch (curlErr) {
        console.warn(`[AI Insights] Curl fallback failed: ${curlErr.message}`);
      }
    }
  }

  // Fallback 2: Try OpenRouter if configured
  const openrouterKey = (settings.openrouter_api_key || process.env.OPENROUTER_API_KEY || '').trim();
  if (openrouterKey) {
    try {
      const orModel = settings.openrouter_model || 'meta-llama/llama-3.3-70b-instruct:free';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: orModel,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      }
    } catch (orErr) {
      console.warn(`[AI Insights] OpenRouter fallback failed: ${orErr.message}`);
    }
  }

  // Fallback 3: Try OpenAI if configured
  const openaiKey = (settings.openai_api_key || process.env.OPENAI_API_KEY || '').trim();
  if (openaiKey) {
    try {
      const oaModel = settings.openai_model || 'gpt-4o-mini';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch('https://api.openai.com/v1:chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: oaModel,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      }
    } catch (oaErr) {
      console.warn(`[AI Insights] OpenAI fallback failed: ${oaErr.message}`);
    }
  }

  throw new Error('Tidak ada API Key yang valid (Gemini / OpenRouter / OpenAI) atau semua permintaan mengalami timeout / error.');
}

// Rule-based fallback summary insights generator (offline and quota-exhausted guard)
function generateSimulatedInsights(payload) {
  let parts = [];
  
  if (payload.show_fasih && payload.fasih) {
    parts.push(`realisasi pengisian Dokumen FASIH saat ini mencatat pencapaian sebesar **${payload.fasih.persen}%** (${payload.fasih.realisasi} dari target ${payload.fasih.target} dokumen, mode ${payload.target_fasih_mode})`);
  }

  if (payload.show_muatan && payload.muatan) {
    parts.push(`capaian pengumpulan data muatan berada di angka **${payload.muatan.persen}%** (${payload.muatan.realisasi} dari target ${payload.muatan.total} muatan, mode ${payload.target_muatan_mode})`);
  }

  let ewText = '';
  if (payload.show_early_warning && payload.early_warning) {
    if (payload.early_warning.zero_progress_pcl > 0) {
      ewText = `terdeteksi **${payload.early_warning.zero_progress_pcl} PCL tanpa progres** dan **${payload.early_warning.slow_progress_pcl} PCL berkinerja lambat** yang memerlukan evaluasi lapangan`;
    } else {
      ewText = `kinerja petugas pencacah relatif stabil tanpa adanya indikasi petugas yang sepenuhnya stagnan`;
    }
  }

  let lowKecText = '';
  if (payload.show_kecamatan && payload.kecamatan_stats && payload.kecamatan_stats.length > 0) {
    const sorted = [...payload.kecamatan_stats].sort((a, b) => {
      const valA = payload.show_fasih ? a.persen_fasih : a.persen_muatan;
      const valB = payload.show_fasih ? b.persen_fasih : b.persen_muatan;
      return valA - valB;
    });
    const lowKec = sorted[0];
    if (lowKec) {
      const metricVal = payload.show_fasih ? `${lowKec.persen_fasih}% FASIH` : `${lowKec.persen_muatan}% Muatan`;
      lowKecText = `Fokus pendampingan dan akselerasi hendaknya diprioritaskan pada Kecamatan **${lowKec.nama}** yang saat ini mencatat progres terendah (${metricVal})`;
    }
  }

  const mainStatsText = parts.length > 0 ? parts.join(', serta ') : 'monitoring progres lapangan berjalan secara berkala';
  const ewSection = ewText ? `. Terkait kendala lapangan, ${ewText}` : '';
  const kecSection = lowKecText ? `. ${lowKecText}.` : '.';

  return `<div class="ai-insight-paragraph" style="font-size: 13.5px; line-height: 1.6; color: var(--text-primary); padding: 14px 16px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-light); border-radius: 12px;">
    💡 **Analisis Taktis (Offline Fallback):** Berdasarkan data pengawasan aktif, ${mainStatsText}${ewSection}${kecSection}
  </div>`;
}

// Endpoint untuk mendapatkan AI Smart Insights (proactive analytics)
router.get('/ai-insights', async (req, res) => {
  const uploadId = res.locals.uploadId;
  const settings = res.locals.settings || {};

  if (!uploadId) {
    return res.json({ success: false, error: 'Belum ada data upload' });
  }

  // Cek visibilitas data sesuai pengaturan admin
  const showMuatan = settings.show_progres_muatan !== '0' && settings.overview_muatan !== '0';
  const showFasih = settings.overview_fasih !== '0';
  const showKecamatan = settings.overview_kecamatan !== '0';
  const showEarlyWarning = settings.page_earlywarning !== '0';

  const settingsKey = `${uploadId}_m${showMuatan ? 1 : 0}_f${showFasih ? 1 : 0}_k${showKecamatan ? 1 : 0}_e${showEarlyWarning ? 1 : 0}_tm${settings.target_muatan_mode}_tf${settings.target_fasih_mode}`;

  // Cek cache jika bukan force refresh
  const forceRefresh = req.query.refresh === 'true';
  if (!forceRefresh && aiInsightsCache.uploadId === uploadId && aiInsightsCache.key === settingsKey && aiInsightsCache.insights) {
    return res.json({ success: true, insights: aiInsightsCache.insights, fromCache: true });
  }

  try {
    const { getOverviewSummary, getKecamatanStats, getEarlyWarning } = require('../database');
    const summary = getOverviewSummary(uploadId, settings);
    if (!summary) {
      return res.json({ success: false, error: 'Gagal memuat ringkasan progres data' });
    }

    const payload = {
      tanggal_data: summary.tanggal_data || 'Tidak diketahui',
      target_fasih_mode: settings.target_fasih_mode === 'fasih-sm' ? 'Target FASIH-SM' : 'Target Statis',
      target_muatan_mode: settings.target_muatan_mode === 'honor' ? 'Target Honor' : 'Target Prelist',
      show_muatan: showMuatan,
      show_fasih: showFasih,
      show_kecamatan: showKecamatan,
      show_early_warning: showEarlyWarning
    };

    if (showFasih) {
      payload.fasih = {
        target: summary.target_fasih_total,
        realisasi: (summary.submitted_total + summary.approved_total + summary.rejected_total),
        persen: summary.fasih_pct || 0,
        draft: summary.draft_total,
        submitted: summary.submitted_total,
        approved: summary.approved_total,
        rejected: summary.rejected_total
      };
    }

    if (showMuatan) {
      payload.muatan = {
        total: summary.total_muatan,
        realisasi: summary.muatan_selesai,
        persen: summary.muatan_pct || 0
      };
    }

    if (showEarlyWarning) {
      const ew = getEarlyWarning(uploadId);
      payload.early_warning = {
        zero_progress_pcl: ew.zeroPcl ? ew.zeroPcl.length : 0,
        slow_progress_pcl: ew.slowPcl ? ew.slowPcl.length : 0,
        stagnant_pcl: ew.stagnanPcl ? ew.stagnanPcl.length : 0,
        low_projected_pcl: ew.lowProjectedPcl ? ew.lowProjectedPcl.length : 0
      };
    }

    if (showKecamatan) {
      const kecs = getKecamatanStats(uploadId, settings);
      payload.kecamatan_stats = (kecs || []).map(k => {
        const item = {
          nama: k.kecamatan,
          persen_fasih: k.fasih_pct || 0
        };
        if (showMuatan) {
          item.muatan_total = k.total_muatan;
          item.muatan_selesai = k.muatan_selesai;
          item.persen_muatan = k.muatan_pct || 0;
        }
        return item;
      });
    }

    let promptSections = [];
    promptSections.push(`DATA PROGRES TERKINI (Tanggal Rekap Data: ${payload.tanggal_data}):`);
    
    if (showFasih && payload.fasih) {
      promptSections.push(`- Dokumen FASIH (${payload.target_fasih_mode} - Target vs Realisasi): ${payload.fasih.realisasi} / ${payload.fasih.target} (${payload.fasih.persen}%)`);
      promptSections.push(`  - Rincian Dokumen FASIH: Draft: ${payload.fasih.draft}, Submitted: ${payload.fasih.submitted}, Approved: ${payload.fasih.approved}, Rejected: ${payload.fasih.rejected}`);
    }

    if (showMuatan && payload.muatan) {
      promptSections.push(`- Progres Muatan (${payload.target_muatan_mode} - Target vs Realisasi): ${payload.muatan.realisasi} / ${payload.muatan.total} (${payload.muatan.persen}%)`);
    }

    if (showEarlyWarning && payload.early_warning) {
      promptSections.push(`- Early Warning Petugas:`);
      promptSections.push(`  - Petugas tanpa progres (Zero Progress): ${payload.early_warning.zero_progress_pcl} PCL`);
      promptSections.push(`  - Petugas berkinerja lambat (Slow Progress): ${payload.early_warning.slow_progress_pcl} PCL`);
      promptSections.push(`  - Petugas dengan progres stagnan: ${payload.early_warning.stagnant_pcl} PCL`);
      promptSections.push(`  - Proyeksi target rendah: ${payload.early_warning.low_projected_pcl} PCL`);
    }

    if (showKecamatan && payload.kecamatan_stats && payload.kecamatan_stats.length > 0) {
      promptSections.push(`- Progres Per Kecamatan:`);
      payload.kecamatan_stats.forEach(k => {
        let kecDetail = `  * Kecamatan ${k.nama}: Dokumen FASIH: ${k.persen_fasih}%`;
        if (showMuatan) {
          kecDetail += `, Muatan: ${k.persen_muatan}%`;
        }
        promptSections.push(kecDetail);
      });
    }

    const promptDataText = promptSections.join('\n');

    const prompt = `
Anda adalah AI Analyst senior untuk sistem Monitoring Lapangan SE2026 PPU BPS.
Tugas Anda adalah menganalisis data progres lapangan berikut yang DITAMPILKAN SANGAT SPESIFIK SESUAI DENGAN PENGATURAN DASBOR ADMIN dan memberikan analisis strategis mendalam, tajam, serta solutif dalam satu paragraf utuh (single block).

${promptDataText}

ATURAN STRICT & FORMAT JAWABAN (WAJIB DIIKUTI TANPA PENGECUALIAN):
1. Hasil analisis HARUS HANYA MENGGUNAKAN INDIKATOR DATA DI ATAS. JANGAN PERNAH menyebutkan atau mengarang indikator yang tidak ditampilkan di atas (khususnya JANGAN sebutkan persen SLS Selesai atau SLS Selesai karena data belum valid).
2. Hasil analisis harus berupa SATU PARAGRAF saja (TIDAK BOLEH dibuat terpisah-pisah, bullet points, daftar list, kolom, atau jeda baris).
3. Tulis kalimat yang mengalir secara natural, profesional, mendalam, tajam, dan langsung menyoroti isu kritis berdasarkan data aktif yang tersedia.
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
        key: settingsKey,
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


