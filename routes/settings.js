const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');

const generalSettingKeys = [
  'page_map',
  'page_earlywarning',
  'page_deteksianomali',
  'page_leaderboard',
  'page_performatrendah',
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
  'overview_kecamatan',
  'overview_bangunan',
  'show_progres_muatan'
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

  if (req.body.target_fasih_mode === 'static' || req.body.target_fasih_mode === 'dynamic') {
    updatedSettings.target_fasih_mode = req.body.target_fasih_mode;
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

  try {
    updateSettings(updatedSettings);
    req.flash('success', 'Pengaturan Chatbot AI berhasil diperbarui.');
  } catch (err) {
    req.flash('error', `Gagal memperbarui pengaturan chatbot: ${err.message}`);
  }

  res.redirect('/admin/settings/chatbot');
});

module.exports = router;
