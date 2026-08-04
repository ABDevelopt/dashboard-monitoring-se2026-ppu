const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');
const { getSettings, updateSettings } = require('../database');

// GET /admin/whatsapp - Halaman Utama Integrasi WhatsApp
router.get('/', async (req, res) => {
  const settings = getSettings();
  const waStatus = whatsappService.getStatus();
  
  // Jika terhubung, ambil daftar grup
  let groups = [];
  if (waStatus.status === 'CONNECTED') {
    groups = await whatsappService.getGroups();
  }

  res.render('settings_whatsapp', {
    title: 'Integrasi WhatsApp',
    activePage: 'whatsapp',
    settings,
    waStatus,
    groups
  });
});

// GET /admin/whatsapp/status - API Status Koneksi & QR Code (Untuk Real-time Polling)
router.get('/status', (req, res) => {
  res.json(whatsappService.getStatus());
});

// GET /admin/whatsapp/groups - API Ambil Daftar Grup
router.get('/groups', async (req, res) => {
  const groups = await whatsappService.getGroups();
  res.json(groups);
});

// POST /admin/whatsapp/settings - Simpan Pengaturan WhatsApp
router.post('/settings', (req, res) => {
  const settings = getSettings();
  const updatedSettings = { ...settings };

  updatedSettings.whatsapp_enabled = req.body.whatsapp_enabled === '1' ? '1' : '0';
  updatedSettings.whatsapp_group_id = req.body.whatsapp_group_id ? req.body.whatsapp_group_id.trim() : '';
  updatedSettings.whatsapp_group_name = req.body.whatsapp_group_name ? req.body.whatsapp_group_name.trim() : '';
  if (updatedSettings.whatsapp_group_id && !updatedSettings.whatsapp_group_name) {
    updatedSettings.whatsapp_group_name = 'Grup Notifikasi (Manual)';
  }
  updatedSettings.whatsapp_message_template = req.body.whatsapp_message_template ? req.body.whatsapp_message_template.trim() : '';
  updatedSettings.whatsapp_intraday_enabled = req.body.whatsapp_intraday_enabled === '1' ? '1' : '0';
  updatedSettings.whatsapp_session_cutoff_hour = req.body.whatsapp_session_cutoff_hour ? String(parseInt(req.body.whatsapp_session_cutoff_hour, 10) || 12) : '12';
  updatedSettings.whatsapp_intraday_message_template = req.body.whatsapp_intraday_message_template ? req.body.whatsapp_intraday_message_template.trim() : '';

  try {
    updateSettings(updatedSettings);
    req.flash('success', 'Pengaturan WhatsApp berhasil diperbarui.');
  } catch (err) {
    req.flash('error', `Gagal memperbarui pengaturan: ${err.message}`);
  }

  res.redirect('/admin/whatsapp');
});

// POST /admin/whatsapp/test - Uji Kirim Pesan ke Grup
router.post('/test', async (req, res) => {
  const settings = getSettings();
  const groupId = req.body.whatsapp_group_id || settings.whatsapp_group_id;

  if (!groupId) {
    req.flash('error', 'Grup WhatsApp belum dikonfigurasi.');
    return res.redirect('/admin/whatsapp');
  }

  try {
    const { getDb } = require('../database');
    const db = getDb();
    
    // Ambil data upload terakhir untuk disimulasikan ke dalam template
    const latestUpload = db.prepare('SELECT id FROM uploads ORDER BY id DESC LIMIT 1').get();

    if (latestUpload) {
      // Mengirimkan notifikasi dengan template kustom/bawaan menggunakan data real terakhir
      await whatsappService.sendUpdateNotification(latestUpload.id, groupId);
      req.flash('success', 'Pesan tes menggunakan template notifikasi kustom berhasil dikirim ke grup WhatsApp.');
    } else {
      // Fallback jika database masih kosong
      const testMessage = `🧪 *TES INTEGRASI WHATSAPP SE2026 PPU*\n\n` +
                          `Pesan ini dikirim secara otomatis oleh Dashboard Monitoring SE2026 PPU untuk menguji koneksi bot ke grup WhatsApp ini.\n\n` +
                          `Status: *Koneksi Berhasil* 👍\n` +
                          `Waktu: *${new Date().toLocaleString('id-ID')}*`;
      await whatsappService.sendDirectMessage(groupId, testMessage);
      req.flash('success', 'Pesan tes koneksi dasar berhasil dikirim (tidak ada data upload untuk simulasi template).');
    }
  } catch (err) {
    req.flash('error', `Gagal mengirim pesan tes: ${err.message}`);
  }

  res.redirect('/admin/whatsapp');
});

// POST /admin/whatsapp/logout - Logout Sesi WhatsApp
router.post('/logout', async (req, res) => {
  try {
    await whatsappService.logout();
    req.flash('success', 'Sesi WhatsApp berhasil dikeluarkan. Halaman akan dimuat ulang untuk membuat QR Code baru.');
  } catch (err) {
    req.flash('error', `Gagal mengeluarkan sesi: ${err.message}`);
  }
  res.redirect('/admin/whatsapp');
});

// POST /admin/whatsapp/reconnect - Reset Koneksi WhatsApp (Force Reconnect)
router.post('/reconnect', async (req, res) => {
  try {
    await whatsappService.forceReset();
    req.flash('success', 'Koneksi WhatsApp berhasil di-reset. Mencoba menghubungkan ulang...');
  } catch (err) {
    req.flash('error', `Gagal mereset koneksi: ${err.message}`);
  }
  res.redirect('/admin/whatsapp');
});

module.exports = router;
