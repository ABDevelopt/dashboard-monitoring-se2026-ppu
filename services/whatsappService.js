const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { getSettings } = require('../database');

let sock = null;
let qrCodeDataUri = '';
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED
let userInfo = null;
let isInitializing = false;

// Exponential backoff state
let reconnectAttempt = 0;
const RECONNECT_DELAY_MIN = 5000;   // 5 detik
const RECONNECT_DELAY_MAX = 60000;  // 60 detik

// Health check interval handle
let healthCheckInterval = null;

const authDir = path.join(__dirname, '../.wwebjs_auth/baileys-session');

/**
 * Menghitung delay reconnect dengan exponential backoff
 */
function getReconnectDelay() {
  const delay = Math.min(RECONNECT_DELAY_MIN * Math.pow(2, reconnectAttempt), RECONNECT_DELAY_MAX);
  reconnectAttempt++;
  logger.info(`[WA-Backoff] Reconnect attempt #${reconnectAttempt}, delay: ${delay}ms`);
  return delay;
}

/**
 * Membersihkan direktori sesi autentikasi (hanya untuk logout penuh)
 */
function cleanAuthDir() {
  try {
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      logger.info('[WA-Clean] Session directory cleaned successfully.');
    }
  } catch (e) {
    logger.error('[WA-Clean] Failed to clean session directory:', e.message);
  }
}

/**
 * Menghentikan health check interval
 */
function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Memulai health check interval — deteksi koneksi zombie setiap 90 detik
 */
function startHealthCheck() {
  stopHealthCheck();
  healthCheckInterval = setInterval(async () => {
    if (clientStatus !== 'CONNECTED' || !sock) return;
    try {
      // Kirim query ringan untuk memverifikasi koneksi masih hidup
      await sock.fetchStatus('0@s.whatsapp.net').catch(() => {});
      logger.info('[WA-Health] Heartbeat OK — connection is alive.');
    } catch (err) {
      logger.warn('[WA-Health] Heartbeat FAILED — connection may be zombie. Triggering reconnect...');
      await _closeSocket();
    }
  }, 90000); // setiap 90 detik
}

/**
 * Menutup socket saat ini secara bersih tanpa menghapus sesi
 */
async function _closeSocket() {
  stopHealthCheck();
  if (sock) {
    const oldSock = sock;
    sock = null; // null dulu agar event handler baru tidak trigger
    try {
      oldSock.ev.removeAllListeners();
      oldSock.end(undefined);
    } catch (e) {
      // Ignore close errors
    }
  }
  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;
  isInitializing = false;
}

/**
 * Inisialisasi WhatsApp Client menggunakan Baileys (WebSocket murni)
 */
async function initialize() {
  if (sock || isInitializing) {
    logger.info('[WA-Init] Already initialized or initializing, skip.');
    return;
  }
  isInitializing = true;
  clientStatus = 'CONNECTING';
  logger.info('[WA-Init] Starting WhatsApp Baileys initialization sequence...');

  try {
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let version = [2, 3000, 1015901307];
    try {
      const fetchedVersion = await fetchLatestBaileysVersion();
      if (fetchedVersion && fetchedVersion.version) {
        version = fetchedVersion.version;
        logger.info(`[WA-Init] Using Baileys version: ${version.join('.')}`);
      }
    } catch (e) {
      logger.warn('[WA-Init] Could not fetch latest Baileys version, using fallback:', e.message);
    }

    const newSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['SE2026 Monitoring PPU', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 2000,
    });

    // Assign socket hanya setelah berhasil dibuat, reset flag
    sock = newSock;
    isInitializing = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      // Guard: pastikan event ini dari socket yang sedang aktif
      if (newSock !== sock) return;

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('[WA-Event] QR Code received via Baileys.');
        qrcode.toDataURL(qr, (err, url) => {
          if (err) {
            logger.error('[WA-Event] Failed to convert QR to Data URL:', err);
            clientStatus = 'DISCONNECTED';
          } else {
            qrCodeDataUri = url;
            clientStatus = 'QR_READY';
          }
        });
      }

      if (connection === 'open') {
        // Reset backoff counter karena berhasil connect
        reconnectAttempt = 0;

        logger.info('[WA-Event] WhatsApp Connection OPENED & CONNECTED!');
        clientStatus = 'CONNECTED';
        qrCodeDataUri = '';

        const userJid = sock.user ? sock.user.id : '';
        const phoneNumber = userJid ? userJid.split('@')[0].split(':')[0] : '';
        const pushName = (sock.user && (sock.user.name || sock.user.notify)) || 'Bot Monitoring SE2026';

        userInfo = {
          pushname: pushName,
          wid: { user: phoneNumber }
        };
        logger.info(`[WA-Event] Connected: ${pushName} (${phoneNumber})`);

        // Mulai heartbeat health check
        startHealthCheck();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || statusCode || 'Unknown';
        logger.warn(`[WA-Event] Connection Closed. StatusCode: ${statusCode}, Reason: ${reason}`);

        // Tutup socket lama secara bersih (tanpa hapus sesi)
        await _closeSocket();

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        if (isLoggedOut) {
          logger.warn('[WA-Event] Logged out by server. Cleaning session...');
          cleanAuthDir();
          reconnectAttempt = 0; // Reset backoff untuk fresh start
        }

        // Reconnect dengan exponential backoff
        const delay = getReconnectDelay();
        logger.info(`[WA-Event] Will reconnect in ${delay}ms...`);
        setTimeout(() => {
          initialize();
        }, delay);
      }
    });

  } catch (err) {
    // Pastikan flag direset agar initialize() bisa dipanggil ulang
    isInitializing = false;
    clientStatus = 'DISCONNECTED';
    if (sock) {
      try { sock.ev.removeAllListeners(); sock.end(undefined); } catch (_) {}
      sock = null;
    }
    logger.error('[WA-Init] Fatal error during Baileys initialize():', err.message || err);

    // Coba reconnect setelah backoff
    const delay = getReconnectDelay();
    logger.info(`[WA-Init] Will retry initialization in ${delay}ms...`);
    setTimeout(() => {
      initialize();
    }, delay);
  }
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
  if (clientStatus !== 'CONNECTED' || !sock) {
    return [];
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    if (!groups) return [];

    return Object.values(groups).map(group => ({
      id: group.id,
      name: group.subject || 'Grup Tanpa Nama'
    }));
  } catch (err) {
    const errMsg = err && (err.message || String(err));
    logger.warn(`WhatsApp getGroups error: ${errMsg}`);
    return [];
  }
}

/**
 * Mengirim pesan langsung ke chat/grup ID tertentu
 */
async function sendDirectMessage(chatId, message) {
  if (clientStatus !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp client is not connected');
  }
  try {
    let formattedJid = chatId.trim();
    if (!formattedJid.includes('@')) {
      formattedJid = formattedJid + '@g.us';
    }
    const response = await sock.sendMessage(formattedJid, { text: message });
    return response;
  } catch (err) {
    logger.error(`Failed to send WhatsApp message to ${chatId}:`, err);
    throw err;
  }
}

/**
 * Keluar (Logout) penuh — hapus sesi, minta scan QR ulang
 */
async function logout() {
  logger.info('Logging out WhatsApp client (full logout + clean session)...');
  stopHealthCheck();

  if (sock) {
    const oldSock = sock;
    sock = null;
    try {
      oldSock.ev.removeAllListeners();
      await oldSock.logout();
    } catch (err) {
      logger.error('Error during WhatsApp logout:', err.message);
      try { oldSock.end(undefined); } catch (_) {}
    }
  }

  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;
  isInitializing = false;
  reconnectAttempt = 0;

  // Hapus sesi agar pengguna perlu scan QR ulang
  cleanAuthDir();

  setTimeout(() => {
    initialize();
  }, 3000);
}

/**
 * Force Reset — tutup koneksi dan reconnect, TANPA menghapus sesi
 * (Pengguna tidak perlu scan QR ulang jika sesi masih valid)
 */
async function forceReset() {
  logger.info('Force resetting WhatsApp connection (keeping session)...');

  // Tutup socket lama secara bersih (TIDAK menghapus session credentials)
  await _closeSocket();
  reconnectAttempt = 0; // Reset backoff agar reconnect segera

  setTimeout(() => {
    initialize();
  }, 2000);
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
      baseUpload24h = db.prepare('SELECT * FROM uploads ORDER BY id ASC LIMIT 1').get();
    }
    if (baseUpload24h && baseUpload24h.id !== uploadId) {
      stats24h = getOverviewSummary(baseUpload24h.id, settings);
    }

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

    const realisasiFasih = (stats.submitted_total || 0) + (stats.approved_total || 0) + (stats.rejected_total || 0);
    const targetFasih = stats.target_fasih_total || 0;
    const persenFasih = stats.fasih_pct_str || '0.00';

    const realisasiMuatan = stats.muatan_selesai || 0;
    const targetMuatan = stats.total_muatan || 0;
    const persenMuatan = stats.muatan_pct_str || '0.00';

    const diffSubmitted = stats.submitted_total - (prevStats ? prevStats.submitted_total : 0);
    const diffApproved = stats.approved_total - (prevStats ? prevStats.approved_total : 0);
    const diffRejected = stats.rejected_total - (prevStats ? prevStats.rejected_total : 0);
    const diffTotal = realisasiFasih - (prevStats ? ((prevStats.submitted_total || 0) + (prevStats.approved_total || 0) + (prevStats.rejected_total || 0)) : 0);

    const diff24Submitted = stats.submitted_total - (stats24h ? stats24h.submitted_total : 0);
    const diff24Approved = stats.approved_total - (stats24h ? stats24h.approved_total : 0);
    const diff24Rejected = stats.rejected_total - (stats24h ? stats24h.rejected_total : 0);
    const diff24Total = realisasiFasih - (stats24h ? ((stats24h.submitted_total || 0) + (stats24h.approved_total || 0) + (stats24h.rejected_total || 0)) : 0);

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
    const uploadDate = new Date(upload.tanggal);
    const startDate = new Date(startDateStr);
    const deadline = new Date(targetDateStr);

    const targetTetap = 13 * totalPcl;

    const deviasi24h = diff24Total - targetTetap;
    const deviasi24hSign = deviasi24h >= 0 ? '+' : '';
    const deviasi24hFormatted = deviasi24h < 0 
      ? `–${Math.round(Math.abs(deviasi24h)).toLocaleString('id-ID')}` 
      : `${deviasi24hSign}${Math.round(deviasi24h).toLocaleString('id-ID')}`;

    const deviasiUpdate = diffTotal - targetTetap;
    const deviasiUpdateSign = deviasiUpdate >= 0 ? '+' : '';
    const deviasiUpdateFormatted = deviasiUpdate < 0 
      ? `–${Math.round(Math.abs(deviasiUpdate)).toLocaleString('id-ID')}` 
      : `${deviasiUpdateSign}${Math.round(deviasiUpdate).toLocaleString('id-ID')}`;

    const diffTime = uploadDate - startDate;
    const diffDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);
    const currentSpeedKumulatif = diffDays > 0 ? (realisasiFasih / diffDays) : 0;

    const daysRemaining = Math.max(0, Math.ceil((deadline - uploadDate) / (1000 * 60 * 60 * 24)));
    const remainingFasih = Math.max(0, targetFasih - realisasiFasih);
    const reqSpeed = daysRemaining > 0 ? (remainingFasih / daysRemaining) : 0;

    const stdDeficit = Math.max(0, targetTetap - currentSpeedKumulatif);
    const reqDeficit = Math.max(0, reqSpeed - currentSpeedKumulatif);
    const maxDeficitKumulatif = Math.max(stdDeficit, reqDeficit);
    const deviasiKumulatifFormatted = maxDeficitKumulatif > 0 ? `–${Math.ceil(maxDeficitKumulatif).toLocaleString('id-ID')}` : 'Terpenuhi';

    const avgDiffAll = totalPcl > 0 ? parseFloat((diffTotal / totalPcl).toFixed(2)) : 0;
    const avgDiffActive = activeDiffPclCount > 0 ? parseFloat((diffTotal / activeDiffPclCount).toFixed(2)) : 0;

    const avgDiff24All = totalPcl > 0 ? parseFloat((diff24Total / totalPcl).toFixed(2)) : 0;
    const avgDiff24Active = activeDiffPcl24hCount > 0 ? parseFloat((diff24Total / activeDiffPcl24hCount).toFixed(2)) : 0;

    function getPclPerformanceDistribution(currId, prevId = null) {
      if (prevId) {
        return db.prepare(`
          SELECT 
            COALESCE(SUM(CASE WHEN diff <= 0 THEN 1 ELSE 0 END), 0) AS bucket_0,
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
            LEFT JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
            LEFT JOIN progres p_prev ON m.kode = p_prev.kode AND p_prev.upload_id = ?
            WHERE m.pcl IS NOT NULL AND m.pcl != ''
            GROUP BY m.pcl COLLATE NOCASE
          )
        `).get(currId, prevId);
      } else {
        return db.prepare(`
          SELECT 
            COALESCE(SUM(CASE WHEN diff <= 0 THEN 1 ELSE 0 END), 0) AS bucket_0,
            COALESCE(SUM(CASE WHEN diff BETWEEN 1 AND 4 THEN 1 ELSE 0 END), 0) AS bucket_1_4,
            COALESCE(SUM(CASE WHEN diff BETWEEN 5 AND 7 THEN 1 ELSE 0 END), 0) AS bucket_5_7,
            COALESCE(SUM(CASE WHEN diff BETWEEN 8 AND 12 THEN 1 ELSE 0 END), 0) AS bucket_8_12,
            COALESCE(SUM(CASE WHEN diff >= 13 THEN 1 ELSE 0 END), 0) AS bucket_13_plus
          FROM (
            SELECT 
              m.pcl,
              SUM(COALESCE(p_curr.submitted_by_pcl, 0) + COALESCE(p_curr.approved, 0) + COALESCE(p_curr.rejected, 0)) AS diff
            FROM subsls_master m
            LEFT JOIN progres p_curr ON m.kode = p_curr.kode AND p_curr.upload_id = ?
            WHERE m.pcl IS NOT NULL AND m.pcl != ''
            GROUP BY m.pcl COLLATE NOCASE
          )
        `).get(currId);
      }
    }

    const distLast = getPclPerformanceDistribution(uploadId, prevUpload ? prevUpload.id : null);
    const dist24h = getPclPerformanceDistribution(uploadId, baseUpload24h && baseUpload24h.id !== uploadId ? baseUpload24h.id : null);

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

      message = `*📢 UPDATE HARIAN SE2026 PPU*\n` +
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
                `DEADLINE: 17 AGUSTUS 2026\n` +
                `📨 Realisasi Masuk: *${diffTotal.toLocaleString('id-ID')}* dokumen\n` +
                `👤 Produktifitas petugas keseluruhan: *${avgDiffAll.toFixed(2)}* dokumen/petugas/hari\n` +
                `📈 Deviasi vs Target Tetap (Update): *${deviasiUpdateFormatted}* dokumen\n` +
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

module.exports = {
  initialize,
  getStatus,
  getGroups,
  sendDirectMessage,
  sendUpdateNotification,
  logout,
  forceReset
};
