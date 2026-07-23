const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');
const { getAnomalySheetsData, updateAnomalyStatusInGoogleSheets } = require('../services/googleSheetsAnomalyService');

// GET: Display Spreadsheet Sync Management Dashboard
router.get('/', async (req, res) => {
  const settings = getSettings();
  let sheetsData = null;
  let syncError = null;

  try {
    // Fetch live summary without forcing fresh network request unless requested
    sheetsData = await getAnomalySheetsData(settings, req.query.refresh === 'true');
  } catch (err) {
    syncError = err.message;
  }

  res.render('settings_spreadsheet', {
    title: 'Pengelolaan Sinkronisasi Spreadsheet',
    activePage: 'admin-spreadsheet',
    settings,
    sheetsData,
    syncError,
    activeTab: req.query.tab || 'config'
  });
});

// POST: Save Spreadsheet URLs
router.post('/save', (req, res) => {
  const settings = getSettings();
  const updatedSettings = { ...settings };

  if (req.body.google_sheets_anomaly_url !== undefined) {
    updatedSettings.google_sheets_anomaly_url = req.body.google_sheets_anomaly_url.trim();
  }

  if (req.body.google_sheets_apps_script_url !== undefined) {
    updatedSettings.google_sheets_apps_script_url = req.body.google_sheets_apps_script_url.trim();
  }

  try {
    updateSettings(updatedSettings);
    req.flash('success', 'Konfigurasi integrasi Google Spreadsheet berhasil disimpan.');
  } catch (err) {
    req.flash('error', `Gagal menyimpan konfigurasi: ${err.message}`);
  }

  res.redirect('/admin/spreadsheet');
});

// POST: Force instant sync
router.post('/sync-now', async (req, res) => {
  const settings = getSettings();
  try {
    const freshData = await getAnomalySheetsData(settings, true);
    req.flash('success', `Berhasil menyinkronkan ${freshData.summary.total_anomali} data anomali langsung dari Google Spreadsheet!`);
  } catch (err) {
    req.flash('error', `Gagal menyinkronkan Google Spreadsheet: ${err.message}`);
  }
  res.redirect('/admin/spreadsheet');
});

// POST: Test Webhook connection to Apps Script
router.post('/test-webhook', async (req, res) => {
  const settings = getSettings();
  try {
    const sheetsData = await getAnomalySheetsData(settings, false).catch(() => null);
    const sampleItem = sheetsData && ((sheetsData.usahaList && sheetsData.usahaList[0]) || (sheetsData.keluargaList && sheetsData.keluargaList[0]));

    const testResult = await updateAnomalyStatusInGoogleSheets({
      assignment_id: sampleItem ? sampleItem.assignment_id : 'test_ping_connection',
      type: sampleItem ? sampleItem.type : 'usaha',
      nama: sampleItem ? (sampleItem.nama_usaha || sampleItem.nama_kk) : 'Test Ping',
      no: sampleItem ? sampleItem.no : '1',
      tindak_lanjut: sampleItem ? sampleItem.tindak_lanjut : 'Belum Ditindaklanjuti',
      penjelasan: sampleItem ? sampleItem.penjelasan : 'Test ping koneksi',
      is_test: true
    }, settings);

    req.flash('success', `Tes koneksi Apps Script Web App BERHASIL! Webhook terhubung secara 2-arah. ${testResult.message}`);
  } catch (err) {
    req.flash('error', `Tes koneksi Apps Script GAGAL: ${err.message}`);
  }
  res.redirect('/admin/spreadsheet');
});

module.exports = router;
