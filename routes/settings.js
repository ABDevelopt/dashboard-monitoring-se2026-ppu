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

module.exports = router;
