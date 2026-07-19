const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { getSettings } = require('../database');

let client = null;
let qrCodeDataUri = '';
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED
let userInfo = null;
let initTimeout = null;

/**
 * Remove stale SingletonLock to prevent Puppeteer hanging
 */
function removeSingletonLock() {
  const lockPath = path.join(__dirname, '../.wwebjs_auth/session-se2026-monitoring/SingletonLock');
  if (fs.existsSync(lockPath)) {
    try {
      fs.unlinkSync(lockPath);
      logger.info('Successfully removed stale SingletonLock file.');
    } catch (err) {
      logger.warn('Failed to remove stale SingletonLock (might be locked by active process):', err.message);
    }
  }
}

/**
 * Inisialisasi WhatsApp Client
 */
function initialize() {
  if (client) {
    logger.info('[WA-Init] WhatsApp Client already initialized or initializing.');
    return;
  }

  // Bersihkan lock file usang sebelum startup
  removeSingletonLock();

  clientStatus = 'CONNECTING';
  logger.info('[WA-Init] Starting WhatsApp Client initialization sequence...');

  // Timeout lebih panjang untuk server yang lambat (60s)
  if (initTimeout) clearTimeout(initTimeout);
  initTimeout = setTimeout(() => {
    if (clientStatus === 'CONNECTING') {
      logger.warn('[WA-Init] Timeout reached (60s stuck at CONNECTING). Destroying stuck client...');
      clientStatus = 'DISCONNECTED';
      qrCodeDataUri = '';
      try { if (client) client.destroy(); } catch (e) {
        logger.error('[WA-Init] Error during client destroy on timeout:', e.message);
      }
      client = null;
    }
  }, 60000);

  /**
   * Deteksi executable Chromium/Chrome yang tersedia di server.
   */
  function findChromiumExecutable() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      logger.info(`[WA-Init] Using env PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.env.CHROME_PATH) {
      logger.info(`[WA-Init] Using env CHROME_PATH: ${process.env.CHROME_PATH}`);
      return process.env.CHROME_PATH;
    }

    try {
      const puppeteer = require('puppeteer');
      const execPath = puppeteer.executablePath();
      if (execPath && fs.existsSync(execPath)) {
        logger.info(`[WA-Init] Using puppeteer bundled Chrome: ${execPath}`);
        return execPath;
      }
    } catch (e) {
      logger.warn('[WA-Init] puppeteer package not available or Chrome not yet downloaded:', e.message);
    }

    const { execSync } = require('child_process');
    const candidates = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'];
    for (const name of candidates) {
      try {
        const p = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (p) { logger.info(`[WA-Init] Found system browser via which: ${p}`); return p; }
      } catch (_) {}
    }

    const staticPaths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/local/bin/chromium',
      '/usr/local/bin/google-chrome',
    ];
    for (const p of staticPaths) {
      if (fs.existsSync(p)) { logger.info(`[WA-Init] Found static browser path: ${p}`); return p; }
    }

    logger.warn('[WA-Init] No Chrome/Chromium found on this system. WhatsApp may fail to start.');
    return undefined;
  }

  const executablePath = findChromiumExecutable();
  const puppeteerConfig = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--safebrowsing-disable-auto-update',
      '--js-flags=--max-old-space-size=512',
      // Tambahan khusus bypass Passenger restriction:
      '--single-process',
      '--disable-features=site-per-process',
      '--disable-features=dbus',
    ],
  };
  
  if (executablePath) {
    logger.info(`[WA-Init] Configuring Puppeteer with executablePath: ${executablePath}`);
    puppeteerConfig.executablePath = executablePath;
  } else {
    logger.warn('[WA-Init] Configuring Puppeteer WITHOUT custom executablePath (falling back to default launcher)');
  }

  logger.info('[WA-Init] Instantiating Client instance...');
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'se2026-monitoring',
      dataPath: path.join(__dirname, '../.wwebjs_auth')
    }),
    // Gunakan versi web statis yang stabil dan cocok untuk Chrome 122+ untuk bypass link device rejection
    webVersion: '2.3000.1017849495',
    webVersionCache: {
      type: 'local'
    },
    puppeteer: puppeteerConfig
  });

  logger.info('[WA-Init] Binding connection event listeners...');

  client.on('qr', (qr) => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.info('[WA-Event] WhatsApp QR Code generated successfully. Ready to be scanned.');
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        logger.error('[WA-Event] Failed to convert QR code to Data URL:', err);
        clientStatus = 'DISCONNECTED';
      } else {
        qrCodeDataUri = url;
        clientStatus = 'QR_READY';
      }
    });
  });

  client.on('ready', async () => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.info('[WA-Event] WhatsApp Client is fully READY and CONNECTED!');
    clientStatus = 'CONNECTED';
    qrCodeDataUri = '';
    try {
      userInfo = client.info;
      logger.info(`[WA-Event] Connected user info: ${userInfo.pushname} (${userInfo.wid.user})`);
    } catch (err) {
      logger.error('[WA-Event] Failed to retrieve WhatsApp user info:', err);
    }
  });

  client.on('authenticated', () => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.info('[WA-Event] Sesi WhatsApp terautentikasi (authenticated).');
  });

  client.on('auth_failure', (msg) => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.error('[WA-Event] Authentication failed:', msg);
    clientStatus = 'DISCONNECTED';
    qrCodeDataUri = '';
  });

  client.on('disconnected', (reason) => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.warn('[WA-Event] WhatsApp Client disconnected. Reason:', reason);
    clientStatus = 'DISCONNECTED';
    qrCodeDataUri = '';
    userInfo = null;
    
    try {
      logger.info('[WA-Event] Destroying old client instance...');
      client.destroy();
    } catch (e) {
      logger.error('[WA-Event] Error destroying client after disconnect:', e.message);
    }
    client = null;
    
    // Auto reinitialize after 5 seconds to get a new QR code
    logger.info('[WA-Event] Scheduling automatic reinitialization in 5 seconds...');
    setTimeout(() => {
      initialize();
    }, 5000);
  });

  logger.info('[WA-Init] Calling client.initialize() promise...');
  client.initialize().then(() => {
    logger.info('[WA-Init] client.initialize() promise resolved successfully.');
  }).catch(err => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.error('[WA-Init] Fatal error during client.initialize() execution:', err);
    if (err.stack) logger.error('[WA-Init] Stack: ' + err.stack);
    clientStatus = 'DISCONNECTED';
    client = null;
  });
}

/**
 * Mendapatkan status koneksi saat ini
 */
function getStatus() {
  return {
    status: clientStatus,
    qrCode: qrCodeDataUri,
    user: userInfo ? {
      name: userInfo.pushname,
      number: userInfo.wid.user
    } : null
  };
}

/**
 * Mengambil daftar grup WhatsApp yang diikuti
 */
async function getGroups() {
  if (clientStatus !== 'CONNECTED' || !client) {
    return [];
  }
  try {
    const chats = await client.getChats();
    return chats
      .filter(chat => chat.isGroup)
      .map(group => ({
        id: group.id._serialized,
        name: group.name
      }));
  } catch (err) {
    logger.error('Failed to get WhatsApp groups:', err);
    return [];
  }
}

/**
 * Mengirim pesan langsung ke chat/grup ID tertentu
 */
async function sendDirectMessage(chatId, message) {
  if (clientStatus !== 'CONNECTED' || !client) {
    throw new Error('WhatsApp client is not connected');
  }
  try {
    const response = await client.sendMessage(chatId, message);
    return response;
  } catch (err) {
    logger.error(`Failed to send WhatsApp message to ${chatId}:`, err);
    throw err;
  }
}

/**
 * Keluar (Logout) dan Hapus Sesi
 */
async function logout() {
  if (!client) return;
  logger.info('Logging out WhatsApp client...');
  try {
    await client.logout();
    await client.destroy();
  } catch (err) {
    logger.error('Error logging out WhatsApp:', err);
    try {
      await client.destroy();
    } catch (e) {}
  }
  client = null;
  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;
  
  setTimeout(() => {
    initialize();
  }, 3000);
}

/**
 * Mengirimkan notifikasi update data setelah sukses upload
 */
async function sendUpdateNotification(uploadId, overrideGroupId = null) {
  try {
    const settings = getSettings();
    const groupId = overrideGroupId || settings.whatsapp_group_id;

    if (!overrideGroupId && (settings.whatsapp_enabled !== '1' || !settings.whatsapp_group_id)) {
      logger.info('WhatsApp notifications are disabled or group ID is not configured.');
      return;
    }

    if (!groupId) {
      logger.warn('No group ID specified for WhatsApp notification.');
      return;
    }

    const { getDb, getOverviewSummary } = require('../database');
    const db = getDb();
    
    // Ambil detail data upload
    const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!upload) {
      logger.warn(`Upload with ID ${uploadId} not found. Cannot send notification.`);
      return;
    }

    // Ambil statistik summary
    const stats = getOverviewSummary(uploadId, settings);
    if (!stats) {
      logger.warn('Failed to retrieve summary stats for WhatsApp notification.');
      return;
    }

    // Waktu sekarang dalam format WITA (UTC+8)
    const now = new Date();
    const witaOffset = 8 * 60 * 60 * 1000;
    const witaTime = new Date(now.getTime() + witaOffset);
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    const dayName = dayNames[witaTime.getUTCDay()];
    const dateStr = witaTime.getUTCDate();
    const monthName = monthNames[witaTime.getUTCMonth()];
    const yearStr = witaTime.getUTCFullYear();
    const hours = String(witaTime.getUTCHours()).padStart(2, '0');
    const minutes = String(witaTime.getUTCMinutes()).padStart(2, '0');
    
    const timeFormatted = `${dayName}, ${dateStr} ${monthName} ${yearStr} ${hours}.${minutes} WITA`;
    const timeOnlyFormatted = `${hours}.${minutes} WITA`;

    // Kalkulasi persentase dan format realisasi
    const realisasiFasih = (stats.submitted_total || 0) + (stats.approved_total || 0) + (stats.rejected_total || 0);
    const targetFasih = stats.target_fasih_total || 0;
    const persenFasih = stats.fasih_pct_str || '0.00';

    const realisasiMuatan = stats.muatan_selesai || 0;
    const targetMuatan = stats.total_muatan || 0;
    const persenMuatan = stats.muatan_pct_str || '0.00';

    // Tentukan label berdasarkan pengaturan website
    let labelFasih = 'FASIH';
    if (settings.target_fasih_mode === 'fasih-sm') {
      labelFasih = 'FASIH-SM';
    } else if (settings.target_fasih_mode === 'dynamic') {
      labelFasih = 'FASIH Dinamis';
    } else if (settings.target_fasih_mode === 'static') {
      labelFasih = 'FASIH Statis';
    }

    let message = '';
    if (settings.whatsapp_message_template && settings.whatsapp_message_template.trim() !== '') {
      // Ganti variabel dalam template kustom
      message = settings.whatsapp_message_template
        .replace(/\{tanggal_sekarang\}/g, timeFormatted)
        .replace(/\{jam_sekarang\}/g, timeOnlyFormatted)
        .replace(/\{label_fasih\}/g, labelFasih)
        .replace(/\{filename\}/g, upload.filename)
        .replace(/\{tanggal_data\}/g, upload.tanggal)
        .replace(/\{subsls_count\}/g, upload.total_subsls_terisi)
        .replace(/\{realisasi_fasih\}/g, realisasiFasih)
        .replace(/\{target_fasih\}/g, targetFasih)
        .replace(/\{persen_fasih\}/g, persenFasih)
        .replace(/\{realisasi_muatan\}/g, realisasiMuatan)
        .replace(/\{target_muatan\}/g, targetMuatan)
        .replace(/\{persen_muatan\}/g, persenMuatan);
    } else {
      // Pesan bawaan sistem
      message = `📢 *NOTIFIKASI UPDATE DATA SE2026 PPU*\n` +
                `Hari/Waktu: ${timeFormatted}\n\n` +
                `Berhasil memproses unggah data progres:\n` +
                `📦 Berkas: *${upload.filename}*\n` +
                `📆 Tanggal Data: *${upload.tanggal}*\n` +
                `🗺️ Jumlah SubSLS Baru Terproses: *${upload.total_subsls_terisi}*\n\n` +
                `*Ringkasan Progres Kabupaten PPU:*\n` +
                `👥 Realisasi Keluarga (${labelFasih}): *${persenFasih}%* (${realisasiFasih}/${targetFasih})\n` +
                `💼 Realisasi Muatan Usaha: *${persenMuatan}%* (${realisasiMuatan}/${targetMuatan})\n\n` +
                `Silakan cek dashboard lengkap untuk analisis lebih lanjut.`;
    }

    logger.info(`Sending data update notification to group ${groupId}...`);
    await sendDirectMessage(groupId, message);
    logger.info('WhatsApp notification successfully sent.');
  } catch (err) {
    logger.error('Failed to send WhatsApp update notification:', err);
  }
}

/**
 * Force Reset WhatsApp Client
 */
async function forceReset() {
  logger.info('Force resetting WhatsApp client...');
  if (initTimeout) {
    clearTimeout(initTimeout);
    initTimeout = null;
  }
  
  if (client) {
    try {
      await client.destroy();
    } catch (e) {}
  }
  
  client = null;
  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;
  
  removeSingletonLock();
  
  initialize();
}

module.exports = {
  initialize,
  getStatus,
  getGroups,
  sendDirectMessage,
  sendUpdateNotification,
  logout,
  forceReset
};
