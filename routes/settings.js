const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');

const generalSettingKeys = [
  'page_map',
  'page_earlywarning',
  'page_deteksianomali',
  'page_leaderboard',
  'page_performatrendah',
  'page_performa',
  'page_kecamatan',
  'page_subsls',
  'page_korlap',
  'page_pml',
  'page_pcl',
  'page_export',
  'page_aiagent',
  'overview_fasih',
  'overview_muatan',
  'overview_tren_muatan',
  'overview_tren_fasih',
  'overview_heatmap',
  'overview_kecamatan',
  'overview_bangunan',
  'show_progres_muatan',
  'show_status_open',
  'show_status_draft',
  'show_status_submitted',
  'show_status_approved',
  'show_status_rejected'
];

const chatbotSettingKeys = [
  'agent_provider',
  'gemini_api_key',
  'gemini_model',
  'gemini_models_list',
  'openai_api_key',
  'openai_model',
  'openai_models_list',
  'openrouter_api_key',
  'openrouter_model',
  'openrouter_models_list',
  'chatbot_smart_switch'
];

// ─────────────────────────────────────────────
// GENERAL DISPLAY SETTINGS
// ─────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('settings', {
    title: 'Pengaturan Tampilan',
    activePage: 'settings',
    settings: getSettings()
  });
});

router.post('/', (req, res) => {
  const settings = getSettings();
  const updatedSettings = { ...settings };

  for (const key of generalSettingKeys) {
    updatedSettings[key] = req.body[key] === '1' ? '1' : '0';
  }

  if (['static', 'fasih-sm'].includes(req.body.target_fasih_mode)) {
    updatedSettings.target_fasih_mode = req.body.target_fasih_mode;
  }

  if (['prelist', 'honor'].includes(req.body.target_muatan_mode)) {
    updatedSettings.target_muatan_mode = req.body.target_muatan_mode;
  }

  if (req.body.google_sheets_anomaly_url !== undefined) {
    updatedSettings.google_sheets_anomaly_url = req.body.google_sheets_anomaly_url.trim();
  }

  if (req.body.google_sheets_apps_script_url !== undefined) {
    updatedSettings.google_sheets_apps_script_url = req.body.google_sheets_apps_script_url.trim();
  }

  if (req.body.speedometer_start_date !== undefined) {
    updatedSettings.speedometer_start_date = req.body.speedometer_start_date.trim();
  }

  if (req.body.speedometer_target_date !== undefined) {
    updatedSettings.speedometer_target_date = req.body.speedometer_target_date.trim();
  }

  if (req.body.speedometer_target_speed_per_pcl !== undefined) {
    updatedSettings.speedometer_target_speed_per_pcl = req.body.speedometer_target_speed_per_pcl.trim();
  }

  if (['total_target', 'pcl_speed'].includes(req.body.speedometer_calc_mode)) {
    updatedSettings.speedometer_calc_mode = req.body.speedometer_calc_mode;
  }

  try {
    updateSettings(updatedSettings);
    req.flash('success', 'Pengaturan tampilan berhasil diperbarui.');
  } catch (err) {
    req.flash('error', `Gagal memperbarui pengaturan: ${err.message}`);
  }

  res.redirect('/admin/settings');
});

// ─────────────────────────────────────────────
// CHATBOT CONFIGURATION SETTINGS
// ─────────────────────────────────────────────
router.get('/chatbot', (req, res) => {
  res.render('settings_chatbot', {
    title: 'Pengaturan Chatbot AI',
    activePage: 'chatbot-settings',
    settings: getSettings()
  });
});

router.post('/chatbot', (req, res) => {
  const settings = getSettings();
  const updatedSettings = { ...settings };

  for (const key of chatbotSettingKeys) {
    if (key === 'chatbot_smart_switch') {
      updatedSettings[key] = req.body[key] === '1' ? '1' : '0';
    } else {
      updatedSettings[key] = req.body[key] ? req.body[key].trim() : '';
    }
  }

  // Handle backup API keys specifically
  let backupKeys = req.body.gemini_backup_keys;
  if (!backupKeys) {
    updatedSettings['gemini_backup_api_keys'] = '[]';
  } else {
    if (!Array.isArray(backupKeys)) {
      backupKeys = [backupKeys];
    }
    const cleanedKeys = backupKeys
      .map(k => k.trim())
      .filter(k => k.length > 0);
    updatedSettings['gemini_backup_api_keys'] = JSON.stringify(cleanedKeys);
  }

  try {
    updateSettings(updatedSettings);
    req.flash('success', 'Pengaturan Chatbot AI berhasil diperbarui.');
  } catch (err) {
    req.flash('error', `Gagal memperbarui pengaturan chatbot: ${err.message}`);
  }

  res.redirect('/admin/settings/chatbot');
});

// ─────────────────────────────────────────────
// DIAGNOSTIK: Uji Validitas Semua Gemini API Keys
// ─────────────────────────────────────────────
router.post('/test-gemini-keys', async (req, res) => {
  try {
    const keyPool = require('../services/ai/keyPool');
    const settings = getSettings();

    // Jika form mengirimkan keys secara realtime dari input, gunakan nilai realtime tsb
    const reqPrimary = req.body.gemini_api_key;
    let reqBackups = req.body.gemini_backup_keys;

    const testSettings = { ...settings };
    if (typeof reqPrimary === 'string') {
      testSettings.gemini_api_key = reqPrimary.trim();
    }
    if (reqBackups) {
      if (!Array.isArray(reqBackups)) reqBackups = [reqBackups];
      testSettings.gemini_backup_api_keys = JSON.stringify(reqBackups.map(k => k.trim()).filter(Boolean));
    }
    if (req.body.gemini_model) {
      testSettings.gemini_model = req.body.gemini_model.trim();
    }

    const report = await keyPool.testAllGeminiKeys(testSettings);
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// DIAGNOSTIK: Ambil Log Sistem Chatbot AI
// ─────────────────────────────────────────────
router.get('/chatbot-logs', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '../logs/combined.log');
    
    if (!fs.existsSync(logFile)) {
      return res.json({ success: true, logs: [] });
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const lastLines = lines.slice(-250); // Ambil 250 baris log terakhir

    const parsedLogs = lastLines.map(line => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return { message: line, level: 'info', timestamp: new Date().toISOString() };
      }
    });

    res.json({ success: true, logs: parsedLogs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// DIAGNOSTIK: Bersihkan File Log Sistem
// ─────────────────────────────────────────────
router.post('/chatbot-logs/clear', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(__dirname, '../logs');
    
    ['combined.log', 'errors.log'].forEach(f => {
      const p = path.join(logDir, f);
      if (fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
    });

    res.json({ success: true, message: 'Log sistem berhasil dibersihkan.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// MAINTENANCE: Reset SLS Selesai dari Excel BPS
// ─────────────────────────────────────────────
router.post('/reset-sls-selesai', (req, res) => {

  const activeSurvey = res.locals.activeSurvey || 'se2026';
  try {
    const { getDb } = require('../database');
    const { parseAndSaveStatusExcelOnly } = require('../services/excelParser');
    const path = require('path');
    const fs = require('fs');
    const db = getDb(activeSurvey);

    // 1. Cari file monitoring SLS BPS yang tersimpan (berdasarkan nama file)
    const monitoringUpload = db.prepare(`
      SELECT id, tanggal, status_filename, stored_status_filename
      FROM uploads
      WHERE (
        status_filename LIKE '%Monitoring_SLS%'
        OR status_filename LIKE '%monitoring_sls%'
        OR status_filename LIKE '%Monitoring SLS%'
        OR status_filename LIKE '%Export_Monitoring%'
      )
      AND stored_status_filename IS NOT NULL
      AND stored_status_filename != ''
      ORDER BY id DESC
      LIMIT 1
    `).get();

    if (!monitoringUpload) {
      req.flash('error', 'Tidak ditemukan file upload Excel Monitoring SLS BPS. Silakan upload terlebih dahulu melalui halaman Upload.');
      return res.redirect('/admin/settings');
    }

    const filePath = path.join(__dirname, '../uploads', monitoringUpload.stored_status_filename);
    if (!fs.existsSync(filePath)) {
      req.flash('error', `File monitoring SLS tidak ditemukan di server: ${monitoringUpload.stored_status_filename}. Silakan upload ulang.`);
      return res.redirect('/admin/settings');
    }

    // 2. Reset semua sls_selesai = 0
    const beforeCount = db.prepare('SELECT COUNT(*) as c FROM progres WHERE sls_selesai = 1').get().c;
    db.prepare('UPDATE progres SET sls_selesai = 0').run();

    // 3. Reimport sls_selesai dari file BPS (proses ulang semua upload_id)
    //    parseAndSaveStatusExcelOnly akan update semua upload_id yang ada di DB
    parseAndSaveStatusExcelOnly(
      filePath,
      monitoringUpload.status_filename,
      monitoringUpload.stored_status_filename,
      monitoringUpload.tanggal,
      activeSurvey
    );

    const afterCount = db.prepare('SELECT COUNT(*) as c FROM progres WHERE sls_selesai = 1').get().c;
    const uniqueKodes = db.prepare("SELECT COUNT(DISTINCT kode) as c FROM progres WHERE sls_selesai = 1").get().c;

    req.flash('success', `✅ Reset SLS Selesai berhasil. Sebelum: ${beforeCount} baris → Sesudah: ${afterCount} baris (${uniqueKodes} Sub-SLS unik selesai berdasarkan Excel BPS: ${monitoringUpload.status_filename})`);
    console.log(`[MAINTENANCE] reset-sls-selesai: ${beforeCount} → ${afterCount} rows, file: ${monitoringUpload.status_filename}`);
  } catch (err) {
    console.error('[MAINTENANCE] reset-sls-selesai error:', err);
    req.flash('error', `Gagal reset SLS Selesai: ${err.message}`);
  }
  res.redirect('/admin/settings');
});

module.exports = router;
