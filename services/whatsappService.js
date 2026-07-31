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
  if (clientStatus !== 'CONNECTED' || !client || !client.pupPage || client.pupPage.isClosed()) {
    return [];
  }
  try {
    // Beri batas waktu (timeout 6 detik) agar getChats tidak menggantung jika WhatsApp Web sedang sinkronisasi
    const getChatsPromise = client.getChats();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Sinkronisasi chat WhatsApp Web masih berlangsung')), 6000)
    );

    const chats = await Promise.race([getChatsPromise, timeoutPromise]);
    if (!Array.isArray(chats)) return [];

    return chats
      .filter(chat => chat && chat.isGroup)
      .map(group => ({
        id: group.id ? group.id._serialized : '',
        name: group.name || 'Grup Tanpa Nama'
      }));
  } catch (err) {
    const errMsg = err && (err.message || String(err));
    logger.warn(`WhatsApp getGroups: ${errMsg}`);
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

    // Ambil detail data upload sebelumnya
    const prevUpload = db.prepare('SELECT * FROM uploads WHERE id < ? ORDER BY id DESC LIMIT 1').get(uploadId);
    let prevStats = null;
    if (prevUpload) {
      prevStats = getOverviewSummary(prevUpload.id, settings);
    }

    // Ambil detail data upload 24 jam yang lalu
    const upload24h = db.prepare(`
      SELECT * FROM uploads 
      WHERE created_at <= datetime(?, '-1 day') 
      ORDER BY created_at DESC LIMIT 1
    `).get(upload.created_at);
    let stats24h = null;
    let baseUpload24h = upload24h;
    if (!baseUpload24h) {
      // Fallback: gunakan upload pertama
      baseUpload24h = db.prepare('SELECT * FROM uploads ORDER BY id ASC LIMIT 1').get();
    }
    if (baseUpload24h && baseUpload24h.id !== uploadId) {
      stats24h = getOverviewSummary(baseUpload24h.id, settings);
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

    let prevUploadTimeStr = 'Awal Pendataan';
    if (prevUpload) {
      const prevDate = new Date(prevUpload.created_at.replace(' ', 'T') + 'Z');
      const witaPrev = new Date(prevDate.getTime() + witaOffset);
      const prevDayName = dayNames[witaPrev.getUTCDay()];
      const prevDateStr = witaPrev.getUTCDate();
      const prevMonthName = monthNames[witaPrev.getUTCMonth()];
      const prevYearStr = witaPrev.getUTCFullYear();
      const prevHours = String(witaPrev.getUTCHours()).padStart(2, '0');
      const prevMinutes = String(witaPrev.getUTCMinutes()).padStart(2, '0');
      prevUploadTimeStr = `${prevDayName}, ${prevDateStr} ${prevMonthName} ${prevYearStr} ${prevHours}.${prevMinutes} WITA`;
    }

    // Kalkulasi persentase dan format realisasi
    const realisasiFasih = (stats.submitted_total || 0) + (stats.approved_total || 0) + (stats.rejected_total || 0);
    const targetFasih = stats.target_fasih_total || 0;
    const persenFasih = stats.fasih_pct_str || '0.00';

    const realisasiMuatan = stats.muatan_selesai || 0;
    const targetMuatan = stats.total_muatan || 0;
    const persenMuatan = stats.muatan_pct_str || '0.00';

    // Penambahan dari update sebelumnya
    const diffSubmitted = stats.submitted_total - (prevStats ? prevStats.submitted_total : 0);
    const diffApproved = stats.approved_total - (prevStats ? prevStats.approved_total : 0);
    const diffRejected = stats.rejected_total - (prevStats ? prevStats.rejected_total : 0);
    const diffTotal = realisasiFasih - (prevStats ? ((prevStats.submitted_total || 0) + (prevStats.approved_total || 0) + (prevStats.rejected_total || 0)) : 0);

    // Penambahan dalam 24 jam terakhir (atau sejak data pertama)
    const diff24Submitted = stats.submitted_total - (stats24h ? stats24h.submitted_total : 0);
    const diff24Approved = stats.approved_total - (stats24h ? stats24h.approved_total : 0);
    const diff24Rejected = stats.rejected_total - (stats24h ? stats24h.rejected_total : 0);
    const diff24Total = realisasiFasih - (stats24h ? ((stats24h.submitted_total || 0) + (stats24h.approved_total || 0) + (stats24h.rejected_total || 0)) : 0);

    // Hitung petugas aktif yang bertambah progresnya sejak update terakhir
    let activeDiffPclCount = 0;
    if (prevUpload) {
      const activeDiffResult = db.prepare(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT 
            m.pcl,
            (SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) -
             SUM(COALESCE(p_prev.submitted_by_pcl, 0) + COALESCE(p_prev.approved, 0) + COALESCE(p_prev.rejected, 0))) AS diff
          FROM subsls_master m
          JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
          LEFT JOIN progres p_prev ON m.kode = p_prev.kode AND p_prev.upload_id = ?
          WHERE m.pcl IS NOT NULL AND m.pcl != ''
          GROUP BY m.pcl
          HAVING diff > 0
        )
      `).get(uploadId, prevUpload.id);
      activeDiffPclCount = activeDiffResult ? activeDiffResult.cnt : 0;
    } else {
      activeDiffPclCount = stats.active_pcl || 0;
    }

    // Hitung petugas aktif yang bertambah progresnya dalam 24 jam terakhir (atau sejak data pertama)
    let activeDiffPcl24hCount = 0;
    const base24hId = baseUpload24h ? baseUpload24h.id : null;
    if (base24hId && base24hId !== uploadId) {
      const activeDiff24hResult = db.prepare(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT 
            m.pcl,
            (SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) -
             SUM(COALESCE(p_24h.submitted_by_pcl, 0) + COALESCE(p_24h.approved, 0) + COALESCE(p_24h.rejected, 0))) AS diff
          FROM subsls_master m
          JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
          LEFT JOIN progres p_24h ON m.kode = p_24h.kode AND p_24h.upload_id = ?
          WHERE m.pcl IS NOT NULL AND m.pcl != ''
          GROUP BY m.pcl
          HAVING diff > 0
        )
      `).get(uploadId, base24hId);
      activeDiffPcl24hCount = activeDiff24hResult ? activeDiff24hResult.cnt : 0;
    } else {
      activeDiffPcl24hCount = stats.active_pcl || 0;
    }

    const totalPcl = stats.total_pcl || 1;
    const startDateStr = settings.speedometer_start_date || '2026-06-15';
    const targetDateStr = settings.speedometer_target_date || '2026-08-31';
    const startDate = new Date(startDateStr + 'T00:00:00');
    const targetDate = new Date(targetDateStr + 'T23:59:59');
    const totalDays = Math.max(1, Math.ceil(Math.max(0, targetDate - startDate) / (1000 * 60 * 60 * 24)));

    let targetSpeedTotal = 0;
    if (settings.speedometer_calc_mode === 'pcl_speed') {
      const targetSpeedPerPcl = parseFloat(settings.speedometer_target_speed_per_pcl) || 13;
      targetSpeedTotal = targetSpeedPerPcl * totalPcl;
    } else {
      // Mode Default: 'total_target' (Berbasis Total Target FASIH)
      targetSpeedTotal = totalDays > 0 ? (targetFasih / totalDays) : 0;
    }

    // Hitung deviasi harian (24 jam & update terakhir)
    const deviasi24h = diff24Total - targetSpeedTotal;
    const deviasi24hSign = deviasi24h >= 0 ? '+' : '';
    const deviasi24hFormatted = deviasi24h < 0 ? `–${Math.abs(deviasi24h).toLocaleString('id-ID')}` : `${deviasi24hSign}${deviasi24h.toLocaleString('id-ID')}`;

    const deviasiUpdate = diffTotal - targetSpeedTotal;
    const deviasiUpdateSign = deviasiUpdate >= 0 ? '+' : '';
    const deviasiUpdateFormatted = deviasiUpdate < 0 ? `–${Math.abs(deviasiUpdate).toLocaleString('id-ID')}` : `${deviasiUpdateSign}${deviasiUpdate.toLocaleString('id-ID')}`;

    // Hitung deviasi kumulatif (Sejak awal pendataan, 100% persis seperti di Halaman Overview)
    const diffTime = Math.max(0, now - startDate);
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const currentSpeedKumulatif = diffDays > 0 ? (realisasiFasih / diffDays) : 0;

    const daysRemaining = Math.max(1, Math.ceil(Math.max(0, targetDate - now) / (1000 * 60 * 60 * 24)));
    const remainingFasih = Math.max(0, targetFasih - realisasiFasih);
    const reqSpeed = daysRemaining > 0 ? (remainingFasih / daysRemaining) : 0;

    const stdDeficit = Math.max(0, targetSpeedTotal - currentSpeedKumulatif);
    const reqDeficit = Math.max(0, reqSpeed - currentSpeedKumulatif);
    const maxDeficitKumulatif = Math.max(stdDeficit, reqDeficit);
    const deviasiKumulatifFormatted = maxDeficitKumulatif > 0 ? `–${Math.ceil(maxDeficitKumulatif).toLocaleString('id-ID')}` : 'Terpenuhi';

    // Rata-rata penambahan progres petugas
    const avgDiffAll = totalPcl > 0 ? parseFloat((diffTotal / totalPcl).toFixed(2)) : 0;
    const avgDiffActive = activeDiffPclCount > 0 ? parseFloat((diffTotal / activeDiffPclCount).toFixed(2)) : 0;

    const avgDiff24All = totalPcl > 0 ? parseFloat((diff24Total / totalPcl).toFixed(2)) : 0;
    const avgDiff24Active = activeDiffPcl24hCount > 0 ? parseFloat((diff24Total / activeDiffPcl24hCount).toFixed(2)) : 0;

    // Hitung sebaran performa petugas
    function getPclPerformanceDistribution(currId, prevId = null) {
      if (prevId) {
        return db.prepare(`
          SELECT 
            COALESCE(SUM(CASE WHEN diff = 0 THEN 1 ELSE 0 END), 0) AS bucket_0,
            COALESCE(SUM(CASE WHEN diff BETWEEN 1 AND 4 THEN 1 ELSE 0 END), 0) AS bucket_1_4,
            COALESCE(SUM(CASE WHEN diff BETWEEN 5 AND 7 THEN 1 ELSE 0 END), 0) AS bucket_5_7,
            COALESCE(SUM(CASE WHEN diff BETWEEN 8 AND 12 THEN 1 ELSE 0 END), 0) AS bucket_8_12,
            COALESCE(SUM(CASE WHEN diff >= 13 THEN 1 ELSE 0 END), 0) AS bucket_13_plus
          FROM (
            SELECT 
              m.pcl,
              (SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) -
               SUM(COALESCE(p_prev.submitted_by_pcl, 0) + COALESCE(p_prev.approved, 0) + COALESCE(p_prev.rejected, 0))) AS diff
            FROM subsls_master m
            JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
            LEFT JOIN progres p_prev ON m.kode = p_prev.kode AND p_prev.upload_id = ?
            WHERE m.pcl IS NOT NULL AND m.pcl != ''
            GROUP BY m.pcl
          )
        `).get(currId, prevId);
      } else {
        return db.prepare(`
          SELECT 
            COALESCE(SUM(CASE WHEN diff = 0 THEN 1 ELSE 0 END), 0) AS bucket_0,
            COALESCE(SUM(CASE WHEN diff BETWEEN 1 AND 4 THEN 1 ELSE 0 END), 0) AS bucket_1_4,
            COALESCE(SUM(CASE WHEN diff BETWEEN 5 AND 7 THEN 1 ELSE 0 END), 0) AS bucket_5_7,
            COALESCE(SUM(CASE WHEN diff BETWEEN 8 AND 12 THEN 1 ELSE 0 END), 0) AS bucket_8_12,
            COALESCE(SUM(CASE WHEN diff >= 13 THEN 1 ELSE 0 END), 0) AS bucket_13_plus
          FROM (
            SELECT 
              m.pcl,
              SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) AS diff
            FROM subsls_master m
            JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
            WHERE m.pcl IS NOT NULL AND m.pcl != ''
            GROUP BY m.pcl
          )
        `).get(currId);
      }
    }

    const distLast = getPclPerformanceDistribution(uploadId, prevUpload ? prevUpload.id : null);
    const dist24h = getPclPerformanceDistribution(uploadId, baseUpload24h && baseUpload24h.id !== uploadId ? baseUpload24h.id : null);

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
        .replace(/\{waktu_upload_sebelumnya\}/g, prevUploadTimeStr)
        .replace(/\{label_fasih\}/g, labelFasih)
        .replace(/\{filename\}/g, upload.filename)
        .replace(/\{tanggal_data\}/g, upload.tanggal)
        .replace(/\{subsls_count\}/g, upload.total_subsls_terisi)
        .replace(/\{realisasi_fasih\}/g, realisasiFasih)
        .replace(/\{target_fasih\}/g, targetFasih)
        .replace(/\{persen_fasih\}/g, persenFasih)
        .replace(/\{realisasi_muatan\}/g, realisasiMuatan)
        .replace(/\{target_muatan\}/g, targetMuatan)
        .replace(/\{persen_muatan\}/g, persenMuatan)
        .replace(/\{open_total\}/g, stats.open_total || 0)
        .replace(/\{draft_total\}/g, stats.draft_total || 0)
        .replace(/\{submitted_total\}/g, stats.submitted_total || 0)
        .replace(/\{approved_total\}/g, stats.approved_total || 0)
        .replace(/\{rejected_total\}/g, stats.rejected_total || 0)
        // placeholder baru
        .replace(/\{diff_submitted\}/g, diffSubmitted)
        .replace(/\{diff_approved\}/g, diffApproved)
        .replace(/\{diff_rejected\}/g, diffRejected)
        .replace(/\{diff_total\}/g, diffTotal)
        .replace(/\{diff_24h_submitted\}/g, diff24Submitted)
        .replace(/\{diff_24h_approved\}/g, diff24Approved)
        .replace(/\{diff_24h_rejected\}/g, diff24Rejected)
        .replace(/\{diff_24h_total\}/g, diff24Total)
        .replace(/\{avg_diff_all\}/g, avgDiffAll)
        .replace(/\{avg_diff_active\}/g, avgDiffActive)
        .replace(/\{avg_diff_24h_all\}/g, avgDiff24All)
        .replace(/\{avg_diff_24h_active\}/g, avgDiff24Active)
        .replace(/\{active_diff_pcl_count\}/g, activeDiffPclCount)
        .replace(/\{active_diff_pcl_24h_count\}/g, activeDiffPcl24hCount)
        .replace(/\{deviasi_24h\}/g, deviasi24hFormatted)
        .replace(/\{deviasi_update\}/g, deviasiUpdateFormatted)
        .replace(/\{deviasi_kumulatif\}/g, deviasiKumulatifFormatted)
        // distribution placeholders
        .replace(/\{dist_0\}/g, distLast.bucket_0)
        .replace(/\{dist_1_4\}/g, distLast.bucket_1_4)
        .replace(/\{dist_5_7\}/g, distLast.bucket_5_7)
        .replace(/\{dist_8_12\}/g, distLast.bucket_8_12)
        .replace(/\{dist_13_plus\}/g, distLast.bucket_13_plus)
        .replace(/\{dist_24h_0\}/g, dist24h.bucket_0)
        .replace(/\{dist_24h_1_4\}/g, dist24h.bucket_1_4)
        .replace(/\{dist_24h_5_7\}/g, dist24h.bucket_5_7)
        .replace(/\{dist_24h_8_12\}/g, dist24h.bucket_8_12)
        .replace(/\{dist_24h_13_plus\}/g, dist24h.bucket_13_plus);
    } else {
      const formattedDateWweb = `${witaTime.getUTCDate()} ${monthNames[witaTime.getUTCMonth()]} ${witaTime.getUTCFullYear()}`;
      const formattedTimeWweb = `${hours}.${minutes} WITA`;

      // Pesan bawaan sistem baru sesuai contoh pengguna
      message = `*UPDATE HARIAN SE2026 PPU*\n` +
                `🗓️ ${formattedDateWweb} | ⏰ ${formattedTimeWweb}\n\n` +
                `*AKUMULASI PROGRES PENDATAAN*\n` +
                `✅ Selesai (Subm/Appr/Rej): *${realisasiFasih.toLocaleString('id-ID')}* dokumen (*${persenFasih}%*)\n` +
                `   ├ 🟢 Approved: *${(stats.approved_total || 0).toLocaleString('id-ID')}* dokumen\n` +
                `   ├ 📨 Submitted PCL: *${(stats.submitted_total || 0).toLocaleString('id-ID')}* dokumen\n` +
                `   └ 🔴 Rejected: *${(stats.rejected_total || 0).toLocaleString('id-ID')}* dokumen\n` +
                `🟠 Open (Belum Diisi): *${(stats.open_total || 0).toLocaleString('id-ID')}* dokumen\n` +
                `🟡 Draft (Sedang Diisi): *${(stats.draft_total || 0).toLocaleString('id-ID')}* dokumen\n` +
                `📋 Total Assignment FASIH: *${targetFasih.toLocaleString('id-ID')}* dokumen\n\n` +
                `*KINERJA REALISASI SEJAK UPLOAD SEBELUMNYA (${prevUploadTimeStr})*\n` +
                `📨 Realisasi Masuk: *${diffTotal.toLocaleString('id-ID')}* dokumen\n` +
                `👤 Produktifitas petugas keseluruhan: *${avgDiffAll.toFixed(2)}* dokumen/petugas/hari\n` +
                `📈 Deviasi vs Target Normal (Update): *${deviasiUpdateFormatted}* dokumen\n` +
                `📉 Defisit Laju Kumulatif: *${deviasiKumulatifFormatted}* dokumen/hari\n\n` +
                `*SEBARAN PRODUKTIVITAS PETUGAS (SEJAK UPLOAD SEBELUMNYA)*\n` +
                `🔴 0 dokumen: *${distLast.bucket_0}* orang\n` +
                `🟠 1–4 dokumen: *${distLast.bucket_1_4}* orang\n` +
                `🟡 5–7 dokumen: *${distLast.bucket_5_7}* orang\n` +
                `🔵 8–12 dokumen: *${distLast.bucket_8_12}* orang\n` +
                `🟢 ≥13 dokumen: *${distLast.bucket_13_plus}* orang\n\n` +
                `_Notifikasi otomatis [monitoring.bpsppu.com]_`;
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
