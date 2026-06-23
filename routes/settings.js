const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');

const settingKeys = [
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
  'overview_bangunan'
];

router.get('/', (req, res) => {
  res.render('settings', {
    title: 'Pengaturan Tampilan',
    activePage: 'settings',
    settings: getSettings()
  });
});

router.post('/', (req, res) => {
  const updatedSettings = {};
  for (const key of settingKeys) {
    // Checkbox sends '1' if checked, otherwise it is omitted from request body.
    updatedSettings[key] = req.body[key] === '1' ? '1' : '0';
  }

  try {
    updateSettings(updatedSettings);
    req.flash('success', 'Pengaturan tampilan berhasil diperbarui.');
  } catch (err) {
    req.flash('error', `Gagal memperbarui pengaturan: ${err.message}`);
  }

  res.redirect('/admin/settings');
});

module.exports = router;
