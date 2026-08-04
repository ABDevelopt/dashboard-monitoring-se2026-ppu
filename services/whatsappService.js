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

const authDir = path.join(__dirname, '../.wwebjs_auth/baileys-session');

/**
 * Membersihkan direktori sesi autentikasi
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
 * Inisialisasi WhatsApp Client menggunakan Baileys (WebSocket murni)
 */
async function initialize() {
  if (sock || isInitializing) {
    logger.info('[WA-Init] WhatsApp Baileys Client already initialized or initializing.');
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
      }
    } catch (e) {
      logger.warn('[WA-Init] Could not fetch latest Baileys version, using fallback:', e.message);
    }

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['SE2026 Monitoring PPU', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });

    isInitializing = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('[WA-Event] WhatsApp QR Code received via Baileys.');
        qrcode.toDataURL(qr, (err, url) => {
          if (err) {
            logger.error('[WA-Event] Failed to convert QR code to Data URL:', err);
            clientStatus = 'DISCONNECTED';
          } else {
            qrCodeDataUri = url;
            clientStatus = 'QR_READY';
          }
        });
      }

      if (connection === 'open') {
        logger.info('[WA-Event] WhatsApp Baileys Connection OPENED & CONNECTED!');
        clientStatus = 'CONNECTED';
        qrCodeDataUri = '';

        const userJid = sock.user ? sock.user.id : '';
        const phoneNumber = userJid ? userJid.split('@')[0].split(':')[0] : '';
        const pushName = (sock.user && (sock.user.name || sock.user.notify)) || 'Bot Monitoring SE2026';

        userInfo = {
          pushname: pushName,
          wid: { user: phoneNumber }
        };
        logger.info(`[WA-Event] Connected user info: ${pushName} (${phoneNumber})`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || statusCode || 'Unknown';
        logger.warn(`[WA-Event] WhatsApp Connection Closed. StatusCode: ${statusCode}, Reason: ${reason}`);

        clientStatus = 'DISCONNECTED';
        qrCodeDataUri = '';
        userInfo = null;
        sock = null;

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        if (isLoggedOut) {
          logger.warn('[WA-Event] User logged out. Cleaning session credentials...');
          cleanAuthDir();
        }

        // Auto reconnect after 5 seconds
        logger.info('[WA-Event] Scheduling reconnection in 5 seconds...');
        setTimeout(() => {
          initialize();
        }, 5000);
      }
    });

  } catch (err) {
    isInitializing = false;
    clientStatus = 'DISCONNECTED';
    sock = null;
    logger.error('[WA-Init] Fatal error during Baileys initialize():', err);
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
 * Keluar (Logout) dan Hapus Sesi
 */
async function logout() {
  logger.info('Logging out WhatsApp client...');
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      logger.error('Error logging out WhatsApp:', err);
    }
  }
  sock = null;
  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;

  cleanAuthDir();

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
    const uploadDate = new Date(upload.tanggal);
    const startDate = new Date(startDateStr);
    const deadline = new Date(targetDateStr);

    const targetTetap = 13 * totalPcl;

    // Hitung deviasi harian (24 jam & update terakhir) terhadap Target Tetap
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

    // Hitung deviasi kumulatif
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

/**
 * Force Reset WhatsApp Client
 */
async function forceReset() {
  logger.info('Force resetting WhatsApp client...');
  if (sock) {
    try {
      sock.end(undefined);
    } catch (e) {}
  }
  sock = null;
  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;

  cleanAuthDir();

  setTimeout(() => {
    initialize();
  }, 2000);
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
