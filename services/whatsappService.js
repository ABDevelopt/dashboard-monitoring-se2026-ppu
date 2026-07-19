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
    logger.info('WhatsApp Client already initialized or initializing.');
    return;
  }

  // Bersihkan lock file usang sebelum startup
  removeSingletonLock();

  clientStatus = 'CONNECTING';
  logger.info('Initializing WhatsApp Client...');

  // Timeout lebih panjang untuk server yang lambat (60s)
  if (initTimeout) clearTimeout(initTimeout);
  initTimeout = setTimeout(() => {
    if (clientStatus === 'CONNECTING') {
      logger.warn('[WA] Initialization timed out (60s stuck at CONNECTING). Resetting...');
      clientStatus = 'DISCONNECTED';
      qrCodeDataUri = '';
      try { if (client) client.destroy(); } catch (e) {}
      client = null;
    }
  }, 60000);

  /**
   * Deteksi executable Chromium/Chrome yang tersedia di server.
   * Mendukung Linux hosting (Dewaweb/cPanel), macOS, dan Windows.
   */
  function findChromiumExecutable() {
    // Prioritas: environment variable > lokasi umum di Linux
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.env.CHROME_PATH) {
      return process.env.CHROME_PATH;
    }
    const { execSync } = require('child_process');
    // Coba deteksi otomatis via `which` (Linux/macOS)
    const candidates = [
      'google-chrome-stable',
      'google-chrome',
      'chromium-browser',
      'chromium',
    ];
    for (const name of candidates) {
      try {
        const p = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (p) { logger.info(`[WA] Found browser: ${p}`); return p; }
      } catch (_) {}
    }
    // Path statis umum di server Linux
    const staticPaths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/local/bin/chromium',
      '/usr/local/bin/google-chrome',
    ];
    for (const p of staticPaths) {
      if (fs.existsSync(p)) { logger.info(`[WA] Found browser at: ${p}`); return p; }
    }
    // Fallback: biarkan puppeteer-core cari sendiri (lokal dev)
    logger.warn('[WA] No system Chromium found, falling back to bundled/default.');
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
    ],
  };
  // --single-process dihapus: menyebabkan crash di beberapa server
  // executablePath hanya diset jika ditemukan
  if (executablePath) puppeteerConfig.executablePath = executablePath;

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'se2026-monitoring',
      dataPath: path.join(__dirname, '../.wwebjs_auth')
    }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    },
    puppeteer: puppeteerConfig
  });

  client.on('qr', (qr) => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.info('WhatsApp QR Code generated.');
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        logger.error('Failed to convert QR code to Data URL:', err);
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
    logger.info('WhatsApp Client is ready!');
    clientStatus = 'CONNECTED';
    qrCodeDataUri = '';
    try {
      userInfo = client.info;
    } catch (err) {
      logger.error('Failed to get WhatsApp user info:', err);
    }
  });

  client.on('authenticated', () => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.info('WhatsApp Client authenticated successfully.');
  });

  client.on('auth_failure', (msg) => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.error('WhatsApp Authentication failure:', msg);
    clientStatus = 'DISCONNECTED';
    qrCodeDataUri = '';
  });

  client.on('disconnected', (reason) => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.warn('WhatsApp Client disconnected:', reason);
    clientStatus = 'DISCONNECTED';
    qrCodeDataUri = '';
    userInfo = null;
    
    try {
      client.destroy();
    } catch (e) {}
    client = null;
    
    // Auto reinitialize after 5 seconds to get a new QR code
    setTimeout(() => {
      initialize();
    }, 5000);
  });

  client.on('message', async (msg) => {
    try {
      if (msg.body && msg.body.trim() === '!groupid') {
        const chat = await msg.getChat();
        if (chat.isGroup) {
          await chat.sendMessage(`📢 *INFO GRUP WHATSAPP*\n\n` +
                                  `Nama Grup: *${chat.name}*\n` +
                                  `ID Grup (JID): \`${chat.id._serialized}\`\n\n` +
                                  `Salin ID di atas dan tempel di Pengaturan Integrasi WhatsApp Dashboard.`);
        } else {
          await msg.reply(`Ini bukan grup. ID Chat Anda adalah: \`${chat.id._serialized}\``);
        }
      }
    } catch (err) {
      logger.error('Error handling !groupid command:', err);
    }
  });

  client.initialize().catch(err => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
    logger.error('Error during WhatsApp Client initialization:', err);
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
