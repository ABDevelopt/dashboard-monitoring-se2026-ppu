const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const https = require('https');
const logger = require('./logger');
const { getSettings } = require('../database');

const customAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  family: 4, // Paksa koneksi IPv4 murni (Mencegah IPv6 DNS resolution delay/block di cPanel/Dewaweb)
  timeout: 30000
});

let sock = null;
let qrCodeDataUri = '';
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED
let userInfo = null;
let isInitializing = false;
let hasEverConnectedInSession = false;

// Memory log buffer untuk WhatsApp (maksimal 100 baris log terbaru)
const waLogs = [];
const MAX_WA_LOGS = 100;

/**
 * Mencatat log koneksi WhatsApp dan menyimpannya di memori buffer untuk dikirim ke browser console & terminal UI
 */
function addWaLog(type, message) {
  const now = new Date();
  const witaOffset = 8 * 60 * 60 * 1000;
  const witaTime = new Date(now.getTime() + witaOffset);
  const hours = String(witaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(witaTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(witaTime.getUTCSeconds()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}:${seconds} WITA`;

  const logEntry = {
    id: Date.now() + Math.random().toString(36).substring(2, 6),
    timestamp: timeStr,
    type, // 'info', 'warn', 'error', 'success'
    message
  };

  waLogs.push(logEntry);
  if (waLogs.length > MAX_WA_LOGS) {
    waLogs.shift();
  }

  // Kirim juga ke logger utama server
  if (type === 'error') logger.error(`[WA-Service] ${message}`);
  else if (type === 'warn') logger.warn(`[WA-Service] ${message}`);
  else logger.info(`[WA-Service] ${message}`);
}

function getLogs() {
  return [...waLogs];
}

// Exponential backoff state untuk reconnect
let reconnectAttempt = 0;
const RECONNECT_DELAY_MIN = 3000;   // 3 detik
const RECONNECT_DELAY_MAX = 30000;  // 30 detik (cap max)

// Health check interval handle
let healthCheckInterval = null;

const authDir = path.join(__dirname, '../.wwebjs_auth/baileys-session');

/**
 * Cek apakah direktori auth berisi file kredensial sesi yang valid (creds.json)
 */
function hasValidSession() {
  const credsFile = path.join(authDir, 'creds.json');
  try {
    return fs.existsSync(credsFile) && fs.statSync(credsFile).size > 10;
  } catch (e) {
    return false;
  }
}

/**
 * Menghitung delay reconnect dengan exponential backoff
 */
function getReconnectDelay() {
  const delay = Math.min(RECONNECT_DELAY_MIN * Math.pow(1.5, reconnectAttempt), RECONNECT_DELAY_MAX);
  reconnectAttempt++;
  addWaLog('info', `[WA-Backoff] Reconnect attempt #${reconnectAttempt}, delay: ${Math.round(delay)}ms`);
  return delay;
}

/**
 * Membersihkan direktori sesi autentikasi (hanya untuk logout penuh / session corrupt)
 */
function cleanAuthDir() {
  try {
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      addWaLog('warn', '[WA-Clean] Session directory cleaned successfully.');
    }
  } catch (e) {
    addWaLog('error', `[WA-Clean] Failed to clean session directory: ${e.message}`);
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
 * Memulai health check interval — deteksi koneksi zombie setiap 60 detik & sembuhkan otomatis
 */
function startHealthCheck() {
  stopHealthCheck();
  healthCheckInterval = setInterval(async () => {
    if (clientStatus !== 'CONNECTED' || !sock) return;
    try {
      // Kirim query ringan untuk memverifikasi koneksi masih hidup
      await sock.fetchStatus('0@s.whatsapp.net').catch(() => {});
      addWaLog('info', '[WA-Health] Heartbeat OK — Koneksi aktif & responsif.');
    } catch (err) {
      addWaLog('warn', '[WA-Health] Heartbeat FAILED — Socket zombie terdeteksi. Merestart koneksi otomatis...');
      await _closeSocket(true);
      initialize();
    }
  }, 60000); // per 60 detik untuk ketahanan ekstra di Dewaweb
}

/**
 * Menutup socket saat ini secara bersih
 * @param {boolean} isReconnecting Jika true, tandai status sebagai CONNECTING bukan DISCONNECTED
 */
async function _closeSocket(isReconnecting = false) {
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
  if (!isReconnecting && !hasValidSession()) {
    clientStatus = 'DISCONNECTED';
    userInfo = null;
  } else if (isReconnecting || hasValidSession()) {
    clientStatus = 'CONNECTING';
  } else {
    clientStatus = 'DISCONNECTED';
  }
  qrCodeDataUri = '';
  isInitializing = false;
}

/**
 * Inisialisasi WhatsApp Client menggunakan Baileys (WebSocket murni)
 */
async function initialize() {
  if (sock || isInitializing) {
    addWaLog('info', '[WA-Init] Socket sudah aktif atau dalam inisialisasi. Melewati panggilan duplikat.');
    return;
  }

  isInitializing = true;
  if (clientStatus !== 'CONNECTED') {
    clientStatus = 'CONNECTING';
  }
  addWaLog('info', '[WA-Init] Menginisialisasi urutan koneksi WhatsApp Baileys...');

  try {
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let version = [2, 3000, 1015901307];
    try {
      const fetchVersionWithTimeout = Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch Baileys version timeout (2s)')), 2000))
      ]);
      const fetchedVersion = await fetchVersionWithTimeout;
      if (fetchedVersion && fetchedVersion.version) {
        version = fetchedVersion.version;
        addWaLog('info', `[WA-Init] Menggunakan versi Baileys fetched: ${version.join('.')}`);
      }
    } catch (e) {
      addWaLog('info', `[WA-Init] Pengecekan versi Baileys skip/timeout. Menggunakan versi stabil: ${version.join('.')}`);
    }

    const newSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Windows', 'Chrome', '121.0.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true,       // Jaga status bot aktif/online di WA Server
      connectTimeoutMs: 60000,         // Timeout 60s
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,      // Ping per 25s (Sesuai batas idle Nginx/Dewaweb)
      retryRequestDelayMs: 2000,
      maxRetries: 5,
      wsOptions: {
        agent: customAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Origin': 'https://web.whatsapp.com'
        }
      }
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
        consecutive408Count = 0;
        addWaLog('info', '[WA-Event] QR Code baru diterima dari WhatsApp Server. Siap di-scan.');
        qrcode.toDataURL(qr, (err, url) => {
          if (err) {
            addWaLog('error', `[WA-Event] Gagal mengkonversi QR Code ke Data URL: ${err.message}`);
            clientStatus = 'DISCONNECTED';
          } else {
            qrCodeDataUri = url;
            clientStatus = 'QR_READY';
          }
        });
      }

      if (connection === 'open') {
        // Reset backoff counter & tandai sudah pernah connect
        reconnectAttempt = 0;
        consecutive408Count = 0;
        hasEverConnectedInSession = true;

        clientStatus = 'CONNECTED';
        qrCodeDataUri = '';

        const userJid = sock.user ? sock.user.id : '';
        const phoneNumber = userJid ? userJid.split('@')[0].split(':')[0] : '';
        const pushName = (sock.user && (sock.user.name || sock.user.notify)) || 'Bot Monitoring SE2026';

        userInfo = {
          pushname: pushName,
          wid: { user: phoneNumber }
        };
        addWaLog('success', `[WA-Event] 🟢 WhatsApp Terhubung & Aktif! User: ${pushName} (${phoneNumber})`);

        // Mulai heartbeat health check
        startHealthCheck();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || String(statusCode || 'Unknown');
        addWaLog('warn', `[WA-Event] ⚠️ Koneksi terputus. StatusCode: ${statusCode}, Reason: ${reason}`);

        const is408Error = statusCode === 408 || reason.includes('WebSocket Error') || statusCode === DisconnectReason.timedOut;
        if (is408Error) {
          consecutive408Count++;
          addWaLog('warn', `[WA-AutoRecovery] Deteksi WebSocket Error 408/Timeout (Percobaan #${consecutive408Count})...`);
        } else {
          consecutive408Count = 0;
        }

        // AUTO-RECOVERY UNTUK LOOP 408: Jika 408 terjadi 3x berturut-turut pada sesi yang belum terverifikasi:
        if (consecutive408Count >= 3 && !hasEverConnectedInSession) {
          addWaLog('warn', '[WA-AutoRecovery] Sesi corrupt terdeteksi (3x WebSocket 408 error berturut-turut). Membersihkan sesi gantung otomatis & menerbitkan QR Code baru...');
          await _closeSocket(false);
          cleanAuthDir();
          consecutive408Count = 0;
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          setTimeout(() => {
            initialize();
          }, 1000);
          return;
        }

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
        const isConflict = statusCode === DisconnectReason.connectionReplaced || statusCode === 440 || reason.includes('conflict');
        const isQrTimeout = statusCode === DisconnectReason.timedOut || reason.includes('QR refs attempts ended');

        // Jika Conflict (440): Sesi sedang dipakai oleh proses Node.js lain di server / device lain
        if (isConflict) {
          addWaLog('warn', '⚠️ [WA-Conflict] Terdeteksi bentrokan koneksi ganda (StatusCode 440 Conflict). Pastikan hanya ada 1 proses node server.js yang berjalan di Dewaweb! Menunda reconnect 12 detik...');
          await _closeSocket(true);
          setTimeout(() => {
            initialize();
          }, 12000);
          return;
        }

        // Jika restartRequired (515) dari Baileys (setelah QR di-scan/sync), SEGERA RECONNECT TANPA RESET SESI
        if (isRestartRequired) {
          addWaLog('info', '[WA-Event] Restart socket diminta oleh Baileys setelah sync. Reconnecting langsung...');
          await _closeSocket(true);
          initialize();
          return;
        }

        // HANYA hapus sesi dari disk jika pengguna EKSPLISIT di-logout dari HP
        if (isLoggedOut && hasEverConnectedInSession) {
          addWaLog('warn', '[WA-Event] Pengguna di-logout dari WhatsApp Mobile. Membersihkan berkas sesi...');
          await _closeSocket(false);
          cleanAuthDir();
          reconnectAttempt = 0;
          hasEverConnectedInSession = false;
          clientStatus = 'DISCONNECTED';
          return;
        }

        // Jika QR Code timeout saat BELUM CONNECTED, otomatis regenerasi QR Code baru!
        if (isQrTimeout && !hasValidSession()) {
          addWaLog('info', '[WA-Event] Batas waktu QR Code habis. Meng-generate QR Code baru...');
          await _closeSocket(false);
          cleanAuthDir();
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          setTimeout(() => {
            initialize();
          }, 1500);
          return;
        }

        // Jika sesi tersimpan di disk (creds.json ADA), SELALU LAKUKAN INFINITE AUTO-RECONNECT!
        if (hasValidSession()) {
          const delay = getReconnectDelay();
          addWaLog('info', `[WA-Event] Sesi tersimpan di disk. Menghubungkan ulang otomatis dalam ${Math.round(delay)}ms...`);
          await _closeSocket(true);
          setTimeout(() => {
            initialize();
          }, delay);
          return;
        }

        // Fallback jika tidak ada sesi dan disconnect acak saat QR pairing
        await _closeSocket(false);
        setTimeout(() => {
          initialize();
        }, 3000);
      }
    });

  } catch (err) {
    // Pastikan flag direset agar initialize() bisa dipanggil ulang
    isInitializing = false;
    if (sock) {
      try { sock.ev.removeAllListeners(); sock.end(undefined); } catch (_) {}
      sock = null;
    }
    addWaLog('error', `[WA-Init] Fatal error pada Baileys initialize(): ${err.message || err}`);

    if (hasValidSession()) {
      clientStatus = 'CONNECTING';
      const delay = getReconnectDelay();
      addWaLog('info', `[WA-Init] Mencoba ulang inisialisasi dalam ${Math.round(delay)}ms...`);
      setTimeout(() => {
        initialize();
      }, delay);
    } else {
      addWaLog('warn', '[WA-Init] Inisialisasi dicoba ulang dalam 5 detik...');
      clientStatus = 'DISCONNECTED';
      setTimeout(() => {
        initialize();
      }, 5000);
    }
  }
}

/**
 * Mendapatkan status koneksi saat ini
 */
function getStatus() {
  let effectiveStatus = clientStatus;
  if (clientStatus === 'DISCONNECTED' && hasValidSession()) {
    effectiveStatus = 'CONNECTING';
  }

  return {
    status: effectiveStatus,
    qrCode: qrCodeDataUri,
    user: userInfo ? {
      name: userInfo.pushname,
      number: userInfo.wid.user
    } : null,
    logs: waLogs.slice(-20) // 20 log terbaru
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
    addWaLog('warn', `WhatsApp getGroups error: ${errMsg}`);
    return [];
  }
}

/**
 * Mengirim pesan langsung ke chat/grup ID tertentu
 */
async function sendDirectMessage(chatId, message) {
  if (clientStatus !== 'CONNECTED' || !sock) {
    addWaLog('error', 'Gagal mengirim pesan: WhatsApp client belum terhubung.');
    throw new Error('WhatsApp client is not connected');
  }
  try {
    let formattedJid = chatId.trim();
    if (!formattedJid.includes('@')) {
      formattedJid = formattedJid + '@g.us';
    }
    const response = await sock.sendMessage(formattedJid, { text: message });
    addWaLog('success', `[WA-Message] Pesan berhasil dikirim ke: ${chatId}`);
    return response;
  } catch (err) {
    addWaLog('error', `[WA-Message] Gagal mengirim pesan ke ${chatId}: ${err.message}`);
    throw err;
  }
}

/**
 * Keluar (Logout) penuh — hapus sesi, minta scan QR ulang
 */
async function logout() {
  addWaLog('warn', '[WA-Logout] Logout penuh dipicu. Membersihkan sesi & meminta QR baru...');
  stopHealthCheck();

  if (sock) {
    const oldSock = sock;
    sock = null;
    try {
      oldSock.ev.removeAllListeners();
      await oldSock.logout();
    } catch (err) {
      addWaLog('error', `[WA-Logout] Error saat logout: ${err.message}`);
      try { oldSock.end(undefined); } catch (_) {}
    }
  }

  clientStatus = 'DISCONNECTED';
  qrCodeDataUri = '';
  userInfo = null;
  isInitializing = false;
  reconnectAttempt = 0;
  hasEverConnectedInSession = false;

  // Hapus sesi agar pengguna perlu scan QR ulang
  cleanAuthDir();

  // Inisialisasi ulang untuk minta QR baru
  setTimeout(() => {
    initialize();
  }, 1000);
}

/**
 * Force Reset — Mereset koneksi WhatsApp
 * @param {boolean} cleanSession Jika true, hapus file sesi temporary/corrupt untuk memaksa penerbitan QR Code baru dari awal
 */
async function forceReset(cleanSession = false) {
  addWaLog('info', `[WA-Reset] Force reset koneksi dipicu (cleanSession: ${cleanSession})...`);

  // Stop socket aktif
  await _closeSocket(false);
  reconnectAttempt = 0;
  isInitializing = false;

  if (cleanSession) {
    addWaLog('warn', '[WA-Reset] Membersihkan berkas sesi temporary untuk pembuatan QR Code baru dari awal...');
    cleanAuthDir();
    hasEverConnectedInSession = false;
    userInfo = null;
  }

  clientStatus = 'CONNECTING';

  setTimeout(() => {
    initialize();
  }, 500);
}

/**
 * Mengekstrak waktu pengambilan data dari nama file upload FASIH
 */
function extractUploadDataTime(upload) {
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  
  const fn = upload.status_filename || upload.filename || '';
  const match = fn.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})?/);
  
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const second = match[6] ? parseInt(match[6], 10) : 0;
    
    // Waktu di filename FASIH adalah WITA (UTC+8)
    const dateUtc = new Date(Date.UTC(year, month, day, hour - 8, minute, second));
    if (!isNaN(dateUtc.getTime())) {
      const witaTime = new Date(dateUtc.getTime() + 8 * 60 * 60 * 1000);
      const dayName = dayNames[witaTime.getUTCDay()];
      const dateStr = witaTime.getUTCDate();
      const monthName = monthNames[witaTime.getUTCMonth()];
      const yearStr = witaTime.getUTCFullYear();
      const hours = String(witaTime.getUTCHours()).padStart(2, '0');
      const minutes = String(witaTime.getUTCMinutes()).padStart(2, '0');
      return {
        fullFormatted: `${dayName}, ${dateStr} ${monthName} ${yearStr} ${hours}.${minutes} WITA`,
        timeOnly: `${hours}.${minutes} WITA`,
        dateOnly: `${dayName}, ${dateStr} ${monthName} ${yearStr}`
      };
    }
  }

  // Fallback ke created_at
  const createdStr = upload.created_at || upload.tanggal;
  if (createdStr) {
    const dateUtc = new Date(createdStr.replace(' ', 'T') + (createdStr.includes('T') ? '' : 'Z'));
    const witaTime = new Date(dateUtc.getTime() + 8 * 60 * 60 * 1000);
    const dayName = dayNames[witaTime.getUTCDay()];
    const dateStr = witaTime.getUTCDate();
    const monthName = monthNames[witaTime.getUTCMonth()];
    const yearStr = witaTime.getUTCFullYear();
    const hours = String(witaTime.getUTCHours()).padStart(2, '0');
    const minutes = String(witaTime.getUTCMinutes()).padStart(2, '0');
    return {
      fullFormatted: `${dayName}, ${dateStr} ${monthName} ${yearStr} ${hours}.${minutes} WITA`,
      timeOnly: `${hours}.${minutes} WITA`,
      dateOnly: `${dayName}, ${dateStr} ${monthName} ${yearStr}`
    };
  }

  return {
    fullFormatted: upload.tanggal || 'Awal Pendataan',
    timeOnly: '',
    dateOnly: upload.tanggal || ''
  };
}

/**
 * Mengirimkan notifikasi update data setelah sukses upload
 */
async function sendUpdateNotification(uploadId, overrideGroupId = null) {
  try {
    const settings = getSettings();
    const groupId = overrideGroupId || settings.whatsapp_group_id;

    if (!overrideGroupId && (settings.whatsapp_enabled !== '1' || !settings.whatsapp_group_id)) {
      addWaLog('info', 'Notifikasi WhatsApp tidak aktif atau grup ID belum dikonfigurasi.');
      return;
    }

    if (!groupId) {
      addWaLog('warn', 'Grup ID tidak ditentukan untuk notifikasi WhatsApp.');
      return;
    }

    const { getDb, getOverviewSummary } = require('../database');
    const db = getDb();
    
    // Ambil detail data upload
    const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!upload) {
      addWaLog('warn', `Upload ID ${uploadId} tidak ditemukan. Batal mengirim notifikasi.`);
      return;
    }

    // Ambil detail data upload sebelumnya (hanya upload riil pengguna yang terisi valid)
    const prevUpload = db.prepare(`
      SELECT * FROM uploads 
      WHERE total_subsls_terisi > 0 
        AND (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%') 
        AND tanggal < ?
      ORDER BY tanggal DESC, created_at DESC, id DESC 
      LIMIT 1
    `).get(upload.tanggal);
    let prevStats = null;
    if (prevUpload) {
      prevStats = getOverviewSummary(prevUpload.id, settings);
    }

    // Ambil detail data upload 24 jam / hari sebelumnya (hanya upload riil pengguna)
    const upload24h = db.prepare(`
      SELECT * FROM uploads 
      WHERE total_subsls_terisi > 0 
        AND (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%') 
        AND tanggal < ?
      ORDER BY tanggal DESC, created_at DESC, id DESC 
      LIMIT 1
    `).get(upload.tanggal);
    let stats24h = null;
    let baseUpload24h = upload24h || prevUpload;
    if (!baseUpload24h) {
      baseUpload24h = db.prepare(`
        SELECT * FROM uploads 
        WHERE (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%')
        ORDER BY tanggal ASC, id ASC 
        LIMIT 1
      `).get();
    }
    if (baseUpload24h && baseUpload24h.id !== uploadId) {
      stats24h = getOverviewSummary(baseUpload24h.id, settings);
    }

    const stats = getOverviewSummary(uploadId, settings);
    if (!stats) {
      addWaLog('warn', 'Gagal mengambil data ringkasan untuk notifikasi WhatsApp.');
      return;
    }

    // Waktu System Update / Notifikasi (WITA UTC+8)
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
    
    const systemUpdateFormatted = `${dayName}, ${dateStr} ${monthName} ${yearStr} ${hours}.${minutes} WITA`;
    const systemUpdateHoursOnly = `${hours}.${minutes} WITA`;

    // Waktu Pengambilan Data dari Filename FASIH (misal rekap_..._20260806_084332.csv)
    const dataTimeObj = extractUploadDataTime(upload);
    const dataTimeFormatted = dataTimeObj.fullFormatted;
    const dataTimeHoursOnly = dataTimeObj.timeOnly;
    const dataTimeDateOnly = dataTimeObj.dateOnly;

    // Waktu Upload Sebelumnya
    let prevUploadTimeStr = 'Awal Pendataan';
    if (prevUpload) {
      const prevDataObj = extractUploadDataTime(prevUpload);
      prevUploadTimeStr = prevDataObj.fullFormatted;
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
        .replace(/\{waktu_pengambilan_data\}/g, dataTimeFormatted)
        .replace(/\{waktu_update_system\}/g, systemUpdateFormatted)
        .replace(/\{jam_pengambilan_data\}/g, dataTimeHoursOnly)
        .replace(/\{tanggal_pengambilan_data\}/g, dataTimeDateOnly)
        .replace(/\{tanggal_sekarang\}/g, systemUpdateFormatted)
        .replace(/\{jam_sekarang\}/g, systemUpdateHoursOnly)
        .replace(/\{waktu_upload_sebelumnya\}/g, prevUploadTimeStr)
        .replace(/\{label_fasih\}/g, labelFasih)
        .replace(/\{filename\}/g, upload.filename)
        .replace(/\{tanggal_data\}/g, upload.tanggal)
        .replace(/\{subsls_count\}/g, upload.total_subsls_terisi)
        .replace(/\{realisasi_fasih\}/g, realisasiFasih.toLocaleString('id-ID'))
        .replace(/\{target_fasih\}/g, targetFasih.toLocaleString('id-ID'))
        .replace(/\{persen_fasih\}/g, persenFasih)
        .replace(/\{realisasi_muatan\}/g, realisasiMuatan.toLocaleString('id-ID'))
        .replace(/\{target_muatan\}/g, targetMuatan.toLocaleString('id-ID'))
        .replace(/\{persen_muatan\}/g, persenMuatan)
        .replace(/\{open_total\}/g, (stats.open_total || 0).toLocaleString('id-ID'))
        .replace(/\{draft_total\}/g, (stats.draft_total || 0).toLocaleString('id-ID'))
        .replace(/\{submitted_total\}/g, (stats.submitted_total || 0).toLocaleString('id-ID'))
        .replace(/\{approved_total\}/g, (stats.approved_total || 0).toLocaleString('id-ID'))
        .replace(/\{rejected_total\}/g, (stats.rejected_total || 0).toLocaleString('id-ID'))
        .replace(/\{diff_submitted\}/g, diffSubmitted.toLocaleString('id-ID'))
        .replace(/\{diff_approved\}/g, diffApproved.toLocaleString('id-ID'))
        .replace(/\{diff_rejected\}/g, diffRejected.toLocaleString('id-ID'))
        .replace(/\{diff_total\}/g, diffTotal.toLocaleString('id-ID'))
        .replace(/\{diff_24h_submitted\}/g, diff24Submitted.toLocaleString('id-ID'))
        .replace(/\{diff_24h_approved\}/g, diff24Approved.toLocaleString('id-ID'))
        .replace(/\{diff_24h_rejected\}/g, diff24Rejected.toLocaleString('id-ID'))
        .replace(/\{diff_24h_total\}/g, diff24Total.toLocaleString('id-ID'))
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
      message = `*📢 UPDATE HARIAN SE2026 PPU*\n` +
                `📥 Data FASIH: *${dataTimeFormatted}*\n` +
                `⏰ Update System: *${systemUpdateFormatted}*\n\n` +
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

    addWaLog('info', `Mengirim notifikasi update data ke grup WhatsApp ${groupId}...`);
    await sendDirectMessage(groupId, message);
    addWaLog('success', 'Notifikasi WhatsApp berhasil dikirim ke grup!');
  } catch (err) {
    addWaLog('error', `Gagal mengirim notifikasi update WhatsApp: ${err.message}`);
  }
}

module.exports = {
  initialize,
  getStatus,
  getGroups,
  getLogs,
  sendDirectMessage,
  sendUpdateNotification,
  logout,
  forceReset,
  hasValidSession
};
