const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const https = require('https');
const dns = require('dns');
const logger = require('./logger');
const {
  getSettings, acquireProcessLock, renewProcessLock, releaseProcessLock,
  setWhatsappState, getWhatsappState, getAllWhatsappState,
  saveWhatsappLogDb, getWhatsappLogsDb,
  pushWhatsappCommand, popPendingWhatsappCommands,
  queueWhatsappMessage, getPendingWhatsappMessages, updateWhatsappMessageStatus, checkQueuedMessageStatus
} = require('../database');

// Prioritaskan IPv4 pada DNS resolution agar tidak terbentur rute IPv6 cPanel/CloudLinux
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const customAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  family: 4 // Paksa koneksi IPv4 murni (Mencegah IPv6 DNS resolution delay/block di cPanel/Dewaweb)
});

let sock = null;
let qrCodeDataUri = '';
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED
let userInfo = null;
let isInitializing = false;
let hasEverConnectedInSession = false;
let consecutive408Count = 0;

// Memory log buffer untuk WhatsApp (maksimal 100 baris log terbaru)
const waLogs = [];
const MAX_WA_LOGS = 100;

/**
 * Mencatat log koneksi WhatsApp dan menyimpannya di memori buffer serta SQLite shared table
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

  saveWhatsappLogDb(logEntry);

  // Kirim juga ke logger utama server
  if (type === 'error') logger.error(`[WA-Service] ${message}`);
  else if (type === 'warn') logger.warn(`[WA-Service] ${message}`);
  else logger.info(`[WA-Service] ${message}`);
}

function getLogs() {
  const dbLogs = getWhatsappLogsDb(50);
  if (dbLogs && dbLogs.length > 0) {
    return dbLogs;
  }
  return [...waLogs];
}

// Exponential backoff state untuk reconnect
let reconnectAttempt = 0;
const RECONNECT_DELAY_MIN = 3000;   // 3 detik
const RECONNECT_DELAY_MAX = 30000;  // 30 detik (cap max)

// Health check interval handle, Supervisor handle, & Master Task Loop handle
let healthCheckInterval = null;
let supervisorInterval = null;
let masterTaskInterval = null;

const authDir = path.join(__dirname, '../.wwebjs_auth/baileys-session');
let lockHeartbeatInterval = null;

/**
 * Memastikan hanya 1 proses Node.js yang memegang koneksi aktif ke WhatsApp via SQLite Mutex
 */
function acquireLock(force = false) {
  try {
    const res = acquireProcessLock('whatsapp_master', process.pid, 12000, force);
    if (res && res.acquired) {
      startLockHeartbeat();
      return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

function startLockHeartbeat() {
  if (lockHeartbeatInterval) return;
  lockHeartbeatInterval = setInterval(() => {
    try {
      if (sock || clientStatus === 'CONNECTED' || isInitializing) {
        renewProcessLock('whatsapp_master', process.pid);
      }
    } catch (_) {}
  }, 5000);
}

function releaseLock() {
  if (lockHeartbeatInterval) {
    clearInterval(lockHeartbeatInterval);
    lockHeartbeatInterval = null;
  }
  stopMasterTaskLoop();
  try {
    releaseProcessLock('whatsapp_master', process.pid);
  } catch (_) {}
}

// Lepaskan lock saat proses node keluar
process.on('exit', releaseLock);
process.on('SIGINT', releaseLock);
process.on('SIGTERM', releaseLock);

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
 * Memulai health check interval — deteksi koneksi zombie setiap 45 detik & sembuhkan otomatis
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
  }, 45000);
}

/**
 * Loop tugas pemrosesan antrean outbox (hanya aktif di Master process)
 */
function startMasterTaskLoop() {
  if (masterTaskInterval) return;
  masterTaskInterval = setInterval(async () => {
    // Proses antrean pesan keluar (Outbox) jika Master sedang CONNECTED
    if (sock && clientStatus === 'CONNECTED') {
      try {
        const pendingMsgs = getPendingWhatsappMessages();
        for (const msg of pendingMsgs) {
          try {
            let formattedJid = msg.chat_id.trim();
            if (!formattedJid.includes('@')) {
              formattedJid = formattedJid + '@g.us';
            }
            await sock.sendMessage(formattedJid, { text: msg.message });
            updateWhatsappMessageStatus(msg.id, 'SENT');
            addWaLog('success', `[WA-Outbox] Pesan ID ${msg.id} berhasil dikirim oleh Master.`);
          } catch (err) {
            addWaLog('error', `[WA-Outbox] Gagal mengirim pesan ID ${msg.id}: ${err.message}`);
            updateWhatsappMessageStatus(msg.id, 'FAILED', err.message);
          }
        }
      } catch (_) {}
    }
  }, 1500);
}

function stopMasterTaskLoop() {
  if (masterTaskInterval) {
    clearInterval(masterTaskInterval);
    masterTaskInterval = null;
  }
}

/**
 * Background Supervisor (Watchdog) 24/7
 * Memastikan WhatsApp SELALU aktif di latar belakang tanpa perlu membuka halaman pengaturan
 */
function startSupervisor() {
  if (supervisorInterval) return;
  addWaLog('info', '🛡️ [WA-Watchdog] Background Supervisor 24/7 diaktifkan. WhatsApp selalu dipantau otomatis.');

  // Stagger acak startup (1s - 3s) agar semua worker Passenger tidak berebut acquireLock pada milidetik yang sama
  const initialDelay = Math.floor(Math.random() * 2000) + 1000;
  setTimeout(() => {
    supervisorInterval = setInterval(async () => {
      // 1. Cek Process Lock: Jika proses lain yang memegang Master Lock, standby
      if (!acquireLock()) {
        return;
      }

      // 2. Jika sudah CONNECTED, biarkan healthCheck yang menangani heartbeat
      if (clientStatus === 'CONNECTED' && sock) {
        return;
      }

      // 3. Jika ada sesi tersimpan di disk tapi socket belum CONNECTED dan tidak sedang initializing:
      if (hasValidSession() && clientStatus !== 'CONNECTED' && !isInitializing) {
        addWaLog('info', '🛡️ [WA-Watchdog] Sesi tersimpan ditemukan tapi koneksi belum aktif. Memulai auto-reconnect background...');
        initialize();
        return;
      }

      // 4. Jika belum ada sesi sama sekali dan tidak sedang initializing, siapkan socket agar siap pairing
      if (!hasValidSession() && clientStatus === 'DISCONNECTED' && !isInitializing) {
        addWaLog('info', '🛡️ [WA-Watchdog] Inisialisasi awal background untuk pairing WhatsApp...');
        initialize();
      }
    }, 20000); // Evaluasi setiap 20 detik
  }, initialDelay);
}

/**
 * Menutup socket saat ini secara bersih
 * @param {boolean} isReconnecting Jika true, tandai status sebagai CONNECTING bukan DISCONNECTED
 */
async function _closeSocket(isReconnecting = false) {
  stopHealthCheck();
  stopMasterTaskLoop();
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

  setWhatsappState('status', clientStatus);
  setWhatsappState('qr_code', '');
}

/**
 * Inisialisasi WhatsApp Client menggunakan Baileys (WebSocket murni)
 */
async function initialize(forceTakeLock = false) {
  if (sock || isInitializing) {
    addWaLog('info', '[WA-Init] Socket sudah aktif atau dalam inisialisasi. Melewati panggilan duplikat.');
    return;
  }

  // Cek Inter-Process Lock sebelum membuka socket
  if (!acquireLock(forceTakeLock)) {
    addWaLog('info', `[WA-Cluster] Proses (PID ${process.pid}) berstatus STANDBY. Koneksi WhatsApp aktif dikelola oleh proses Master.`);
    return;
  }

  isInitializing = true;
  if (clientStatus !== 'CONNECTED') {
    clientStatus = 'CONNECTING';
    setWhatsappState('status', 'CONNECTING');
  }
  addWaLog('info', `[WA-Init] Menginisialisasi urutan koneksi WhatsApp Baileys (PID ${process.pid})...`);

  try {
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let version = [2, 3000, 1043857760];
    try {
      const fetchVersionWithTimeout = Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch Baileys version timeout (2s)')), 2000))
      ]);
      const fetchedVersion = await fetchVersionWithTimeout;
      if (fetchedVersion && fetchedVersion.version && Array.isArray(fetchedVersion.version)) {
        if (fetchedVersion.version[2] >= 1043857760) {
          version = fetchedVersion.version;
          addWaLog('info', `[WA-Init] Menggunakan versi Baileys fetched: ${version.join('.')}`);
        } else {
          addWaLog('info', `[WA-Init] Versi fetched (${fetchedVersion.version.join('.')}) terdepresiasi. Menggunakan versi stabil: ${version.join('.')}`);
        }
      }
    } catch (e) {
      addWaLog('info', `[WA-Init] Pengecekan versi Baileys skip/timeout. Menggunakan versi stabil: ${version.join('.')}`);
    }

    const newSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 5000,
      maxRetries: 5,
      emitOwnEvents: false,
      agent: customAgent,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async (key) => {
        return {
          conversation: 'Monitoring SE2026 PPU Bot'
        };
      },
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {}
                },
                ...message
              }
            }
          };
        }
        return message;
      }
    });

    // Handle WebSocket close events directly on WS to catch immediate connection drops
    newSock.ws?.on?.('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : '';
      if (code === 440 || code === 408 || reasonStr.includes('conflict') || reasonStr.includes('Stream Errored')) {
        addWaLog('warn', `[WA-WS] WebSocket raw close event code: ${code}, reason: ${reasonStr || 'N/A'}`);
      }
    });

    // Guard against unhandled websocket socket level error
    newSock.ws?.on?.('error', (err) => {
      if (err) {
        const errMsg = err.message || String(err);
        if (!errMsg.includes('ECONNRESET') && !errMsg.includes('EPIPE')) {
          addWaLog('warn', `[WA-WS] WebSocket error: ${errMsg}`);
        }
      }
    });

    // Assign socket hanya setelah berhasil dibuat, reset flag
    sock = newSock;
    isInitializing = false;
    startMasterTaskLoop();

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
            setWhatsappState('status', 'DISCONNECTED');
          } else {
            qrCodeDataUri = url;
            clientStatus = 'QR_READY';
            setWhatsappState('status', 'QR_READY');
            setWhatsappState('qr_code', url);
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
        
        setWhatsappState('status', 'CONNECTED');
        setWhatsappState('qr_code', '');
        setWhatsappState('user_info', { name: pushName, number: phoneNumber });

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

        // AUTO-RECOVERY UNTUK LOOP 408: Hanya jika 408 terjadi 3x berturut-turut DAN belum ada creds tersimpan:
        if (consecutive408Count >= 3 && !hasEverConnectedInSession && !hasValidSession()) {
          addWaLog('warn', '[WA-AutoRecovery] Sesi gantung terdeteksi. Menerbitkan QR Code baru...');
          await _closeSocket(false);
          cleanAuthDir();
          consecutive408Count = 0;
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          setWhatsappState('status', 'DISCONNECTED');
          setTimeout(() => {
            initialize();
          }, 1000);
          return;
        }

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
        const isConflict = statusCode === DisconnectReason.connectionReplaced || statusCode === 440 || reason.includes('conflict');
        const isQrTimeout = statusCode === DisconnectReason.timedOut || reason.includes('QR refs attempts ended');

        // Jika Conflict (440): Sesi sedang dipakai oleh proses Node.js lain atau di device/server lain
        if (isConflict) {
          addWaLog('warn', `⚠️ [WA-Conflict] Terdeteksi bentrokan koneksi WhatsApp (StatusCode 440 Conflict) pada PID ${process.pid}. Melepaskan master lock.`);
          releaseLock();
          await _closeSocket(false);
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
          setWhatsappState('status', 'DISCONNECTED');
          setWhatsappState('qr_code', '');
          setWhatsappState('user_info', null);
          return;
        }

        // Jika QR Code timeout saat BELUM CONNECTED dan belum ada sesi di disk:
        if (isQrTimeout && !hasValidSession()) {
          addWaLog('info', '[WA-Event] Batas waktu QR Code habis. Meng-generate QR Code baru...');
          await _closeSocket(false);
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          setWhatsappState('status', 'DISCONNECTED');
          setTimeout(() => {
            initialize();
          }, 1500);
          return;
        }

        // Jika sesi tersimpan di disk (creds.json ADA), SELALU LAKUKAN INFINITE AUTO-RECONNECT!
        if (hasValidSession()) {
          const delay = getReconnectDelay();
          clientStatus = 'CONNECTING';
          setWhatsappState('status', 'CONNECTING');
          await _closeSocket(true);
          setTimeout(() => {
            initialize();
          }, delay);
          return;
        }

        // Default close: Bersihkan socket tanpa mereset sesi
        await _closeSocket(false);
        const delay = getReconnectDelay();
        setTimeout(() => {
          initialize();
        }, delay);
      }
    });

  } catch (err) {
    isInitializing = false;
    sock = null;
    stopMasterTaskLoop();
    addWaLog('error', `[WA-Init] Inisialisasi WhatsApp gagal (PID ${process.pid}): ${err.message}`);

    if (hasValidSession()) {
      clientStatus = 'CONNECTING';
      setWhatsappState('status', 'CONNECTING');
      const delay = getReconnectDelay();
      addWaLog('info', `[WA-Init] Mencoba ulang inisialisasi dalam ${Math.round(delay)}ms...`);
      setTimeout(() => {
        initialize();
      }, delay);
    } else {
      addWaLog('warn', '[WA-Init] Inisialisasi dicoba ulang dalam 5 detik...');
      clientStatus = 'DISCONNECTED';
      setWhatsappState('status', 'DISCONNECTED');
      setTimeout(() => {
        initialize();
      }, 5000);
    }
  }
}

/**
 * Mendapatkan status koneksi saat ini (Shared antar seluruh worker Passenger)
 */
function getStatus() {
  if (sock && (clientStatus === 'CONNECTED' || clientStatus === 'QR_READY' || clientStatus === 'CONNECTING')) {
    setWhatsappState('status', clientStatus);
    setWhatsappState('qr_code', qrCodeDataUri);
    setWhatsappState('user_info', userInfo ? { name: userInfo.pushname, number: userInfo.wid?.user } : null);

    return {
      status: clientStatus,
      qrCode: qrCodeDataUri,
      user: userInfo ? {
        name: userInfo.pushname,
        number: userInfo.wid.user
      } : null,
      logs: getLogs().slice(-20)
    };
  }

  // Jika proses Standby, baca dari SQLite state table
  const shared = getAllWhatsappState();
  let effectiveStatus = shared.status || clientStatus;
  if (effectiveStatus === 'DISCONNECTED' && hasValidSession()) {
    effectiveStatus = 'CONNECTING';
  }

  return {
    status: effectiveStatus,
    qrCode: shared.qr_code || qrCodeDataUri || '',
    user: shared.user_info || (userInfo ? {
      name: userInfo.pushname,
      number: userInfo.wid.user
    } : null),
    logs: getLogs().slice(-20)
  };
}

/**
 * Mengambil daftar grup WhatsApp yang diikuti
 */
async function getGroups() {
  if (sock && clientStatus === 'CONNECTED') {
    try {
      const fetchWithTimeout = Promise.race([
        sock.groupFetchAllParticipating(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed Out (5s)')), 5000))
      ]);
      const groups = await fetchWithTimeout;
      if (groups) {
        const formatted = Object.values(groups).map(group => ({
          id: group.id,
          name: group.subject || 'Grup Tanpa Nama'
        }));
        setWhatsappState('groups', formatted);
        return formatted;
      }
    } catch (err) {
      const errMsg = err && (err.message || String(err));
      addWaLog('warn', `WhatsApp getGroups: ${errMsg}`);
    }
  }

  // Standby worker reads cached groups from SQLite
  const cached = getWhatsappState('groups');
  if (Array.isArray(cached)) return cached;
  return [];
}

/**
 * Mengirim pesan langsung ke chat/grup ID tertentu (Mendukung Standby & Master worker)
 */
async function sendDirectMessage(chatId, message) {
  // Jika Master terhubung, kirim langsung via socket
  if (sock && clientStatus === 'CONNECTED') {
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

  // Jika Standby worker, antrekan ke SQLite Outbox
  addWaLog('info', `[WA-Outbox] Mengantrekan pesan ke ${chatId} via SQLite Outbox...`);
  const queueId = queueWhatsappMessage(chatId, message);
  if (!queueId) {
    throw new Error('Gagal mengantrekan pesan ke database outbox');
  }

  // Tunggu konfirmasi pengiriman dari Master hingga 10 detik
  const startTime = Date.now();
  while (Date.now() - startTime < 10000) {
    await new Promise(r => setTimeout(r, 500));
    const statusObj = checkQueuedMessageStatus(queueId);
    if (statusObj) {
      if (statusObj.status === 'SENT') {
        return { success: true };
      }
      if (statusObj.status === 'FAILED') {
        throw new Error(statusObj.error || 'Pengiriman gagal di proses Master');
      }
    }
  }

  throw new Error('Batas waktu tunggu pengiriman pesan habis (Master sedang offline/sibuk)');
}

/**
 * Keluar (Logout) penuh — hapus sesi, minta scan QR ulang
 */
async function logout() {
  addWaLog('warn', '[WA-Logout] Logout penuh dipicu. Membersihkan sesi & meminta QR baru...');
  stopHealthCheck();
  stopMasterTaskLoop();

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

  setWhatsappState('status', 'DISCONNECTED');
  setWhatsappState('qr_code', '');
  setWhatsappState('user_info', null);

  // Hapus sesi agar pengguna perlu scan QR ulang
  cleanAuthDir();

  // Ambil alih lock untuk inisialisasi QR baru
  acquireLock(true);
  setTimeout(() => {
    initialize(true);
  }, 1000);
}

/**
 * Force Reset — Mereset koneksi WhatsApp
 * @param {boolean} cleanSession Jika true, hapus file sesi temporary/corrupt untuk memaksa penerbitan QR Code baru dari awal
 */
async function forceReset(cleanSession = false) {
  addWaLog('info', `[WA-Reset] Force reset koneksi dipicu (cleanSession: ${cleanSession}, PID ${process.pid})...`);

  // Stop socket aktif jika proses ini adalah Master
  await _closeSocket(false);
  reconnectAttempt = 0;
  isInitializing = false;

  if (cleanSession) {
    addWaLog('warn', '[WA-Reset] Membersihkan berkas sesi temporary untuk pembuatan QR Code baru dari awal...');
    cleanAuthDir();
    hasEverConnectedInSession = false;
    userInfo = null;
    setWhatsappState('status', 'DISCONNECTED');
    setWhatsappState('qr_code', '');
    setWhatsappState('user_info', null);
  }

  clientStatus = 'CONNECTING';
  setWhatsappState('status', 'CONNECTING');

  // Rebut status Master agar proses yang menangani request pengguna ini langsung memproduksi QR Code
  acquireLock(true);

  setTimeout(() => {
    initialize(true);
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
    fullFormatted: 'Waktu tidak terdeteksi',
    timeOnly: '-',
    dateOnly: '-'
  };
}

/**
 * Format angka ribuan dengan titik
 */
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('id-ID');
}

/**
 * Format tanggal Indonesia lengkap (cth: "14 Juli 2026")
 */
function formatIndonesianDate(dateStr) {
  if (!dateStr) return '-';
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      const month = months[parseInt(parts[1], 10) - 1];
      const year = parts[0];
      return `${day} ${month} ${year}`;
    }
    const d = new Date(dateStr);
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

/**
 * Membangun pesan notifikasi WhatsApp dari template dan data upload
 */
function buildNotificationMessage(template, uploadData, summary, kecStats, pmlStats, pclStats, settings) {
  const db = require('../database');
  const timeInfo = extractUploadDataTime(uploadData);
  
  // Waktu sekarang (WITA UTC+8)
  const nowUtc = new Date();
  const nowWita = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tglSekarang = `${nowWita.getUTCDate()} ${monthNames[nowWita.getUTCMonth()]} ${nowWita.getUTCFullYear()}`;
  const jamSekarang = `${String(nowWita.getUTCHours()).padStart(2, '0')}.${String(nowWita.getUTCMinutes()).padStart(2, '0')} WITA`;
  const waktuUpdateSystem = `${dayNames[nowWita.getUTCDay()]}, ${tglSekarang} ${jamSekarang}`;

  // Sesi upload (Pagi / Siang / Sore)
  let uploadHour = 12;
  const fn = uploadData.status_filename || uploadData.filename || '';
  const matchFn = fn.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  if (matchFn) {
    uploadHour = parseInt(matchFn[4], 10);
  }
  const cutoff = parseInt(settings.whatsapp_session_cutoff_hour, 10) || 12;
  const sesiUpload = uploadHour < cutoff ? 'Pagi' : 'Siang/Sore';

  // Summary counts
  const totalApproved = summary ? (summary.approved_total || 0) : 0;
  const totalSubmitted = summary ? (summary.submitted_total || 0) : 0;
  const totalRejected = summary ? (summary.rejected_total || 0) : 0;
  const totalDraft = summary ? (summary.draft_total || 0) : 0;
  const totalOpen = summary ? (summary.open_total || 0) : 0;
  const totalFasih = summary ? (summary.target_fasih_total || 0) : 0;
  const totalPcl = summary ? (summary.total_pcl || 0) : (Array.isArray(pclStats) ? pclStats.length : 0);
  const totalSubsls = summary ? (summary.total || summary.total_subsls || 0) : 0;

  const fasihReal = totalApproved + totalSubmitted + totalRejected;
  const fasihPct = totalFasih > 0 ? ((fasihReal / totalFasih) * 100).toFixed(1) : '0.0';

  const totalMuatan = summary ? (summary.total_muatan || 0) : 0;
  const realisasiMuatan = summary ? (summary.muatan_selesai || summary.realisasi_muatan || 0) : 0;
  const persenMuatan = totalMuatan > 0 ? ((realisasiMuatan / totalMuatan) * 100).toFixed(1) : '0.0';

  // Cari previous upload untuk menghitung DIFF
  let prevUpload = null;
  let prevSummary = null;
  let prevPclStats = [];
  try {
    if (uploadData && uploadData.id) {
      prevUpload = db.getDb().prepare(`SELECT * FROM uploads WHERE id < ? ORDER BY id DESC LIMIT 1`).get(uploadData.id);
      if (prevUpload) {
        prevSummary = db.getOverviewSummary(prevUpload.id, settings);
        prevPclStats = db.getPclStats(prevUpload.id, settings);
      }
    }
  } catch (_) {}

  const prevTimeInfo = prevUpload ? extractUploadDataTime(prevUpload) : null;
  const waktuUploadSebelumnya = prevTimeInfo ? prevTimeInfo.fullFormatted : '-';

  const prevSubmitted = prevSummary ? (prevSummary.submitted_total || 0) : 0;
  const prevApproved = prevSummary ? (prevSummary.approved_total || 0) : 0;
  const prevRejected = prevSummary ? (prevSummary.rejected_total || 0) : 0;
  const prevReal = prevSubmitted + prevApproved + prevRejected;

  const diffSubmittedNum = totalSubmitted - prevSubmitted;
  const diffApprovedNum = totalApproved - prevApproved;
  const diffRejectedNum = totalRejected - prevRejected;
  const diffTotalNum = fasihReal - prevReal;

  const diffSubmitted = (diffSubmittedNum >= 0 ? '+' : '') + formatNumber(diffSubmittedNum);
  const diffApproved = (diffApprovedNum >= 0 ? '+' : '') + formatNumber(diffApprovedNum);
  const diffRejected = (diffRejectedNum >= 0 ? '+' : '') + formatNumber(diffRejectedNum);
  const diffTotal = (diffTotalNum >= 0 ? '+' : '') + formatNumber(diffTotalNum);

  // Per PCL diff map (penambahan realisasi per PCL sejak upload sebelumnya)
  const prevPclMap = new Map();
  if (Array.isArray(prevPclStats)) {
    prevPclStats.forEach(p => {
      const key = p.email || p.pcl || p.sobat_id;
      const real = (p.fasih_real_total || ((p.approved_total || 0) + (p.submitted_total || 0) + (p.rejected_total || 0)));
      if (key) prevPclMap.set(key, real);
    });
  }

  let activeDiffPclCount = 0;
  let dist0 = 0, dist1_4 = 0, dist5_7 = 0, dist8_12 = 0, dist13Plus = 0;
  if (Array.isArray(pclStats)) {
    pclStats.forEach(p => {
      const key = p.email || p.pcl || p.sobat_id;
      const curReal = (p.fasih_real_total || ((p.approved_total || 0) + (p.submitted_total || 0) + (p.rejected_total || 0)));
      const oldReal = key && prevPclMap.has(key) ? prevPclMap.get(key) : 0;
      const diffPcl = Math.max(0, curReal - oldReal);

      if (diffPcl > 0) {
        activeDiffPclCount++;
      }

      // Sebaran produktivitas petugas (sejak upload sebelumnya)
      if (diffPcl === 0) dist0++;
      else if (diffPcl >= 1 && diffPcl <= 4) dist1_4++;
      else if (diffPcl >= 5 && diffPcl <= 7) dist5_7++;
      else if (diffPcl >= 8 && diffPcl <= 12) dist8_12++;
      else if (diffPcl >= 13) dist13Plus++;
    });
  }

  const avgDiffAll = totalPcl > 0 ? (diffTotalNum / totalPcl).toFixed(1) : '0.0';
  const avgDiffActive = activeDiffPclCount > 0 ? (diffTotalNum / activeDiffPclCount).toFixed(1) : '0.0';

  // Target Standar & Speedometer Calculations
  const startSensusDate = new Date((settings && settings.speedometer_start_date) || '2026-06-15');
  const deadline = new Date((settings && settings.speedometer_target_date) || '2026-08-31');
  const totalDays = Math.max(1, Math.ceil((deadline - startSensusDate) / (1000 * 60 * 60 * 24)));
  
  const uploadDate = uploadData.tanggal ? new Date(uploadData.tanggal) : new Date();
  const diffDays = Math.max(1, Math.round((uploadDate - startSensusDate) / (1000 * 60 * 60 * 24)) + 1);

  // Target Harian Normal (Target Speed Total)
  let targetNormalHarian = 2145;
  if (settings && settings.speedometer_calc_mode === 'pcl_speed') {
    const targetSpeedPerPcl = parseFloat(settings.speedometer_target_speed_per_pcl || '13') || 13;
    targetNormalHarian = Math.round(targetSpeedPerPcl * totalPcl);
  } else {
    targetNormalHarian = totalDays > 0 ? Math.round(totalFasih / totalDays) : 2145;
  }

  // Deviasi Update = Realisasi Masuk pada update ini vs Target Normal Harian
  const deviasiUpdateNum = diffTotalNum - targetNormalHarian;
  const deviasiUpdateStr = (deviasiUpdateNum >= 0 ? '+' : '') + formatNumber(deviasiUpdateNum);

  // Laju Kumulatif saat ini vs Target Normal Harian (Defisit/Surplus Laju Kumulatif)
  const currentSpeed = diffDays > 0 ? (fasihReal / diffDays) : 0;
  const defisitLajuKumulatifNum = currentSpeed - targetNormalHarian;
  const defisitLajuKumulatifStr = (defisitLajuKumulatifNum >= 0 ? '+' : '') + formatNumber(Math.round(defisitLajuKumulatifNum));

  // Rincian per Kecamatan
  let rincianKecamatan = '';
  if (Array.isArray(kecStats) && kecStats.length > 0) {
    rincianKecamatan = kecStats.map((k, i) => {
      const kApp = k.approved_total || 0;
      const kSub = k.submitted_total || 0;
      const kRej = k.rejected_total || 0;
      const kReal = kApp + kSub + kRej;
      const kTgt = k.target_fasih_total || 0;
      const kPct = kTgt > 0 ? ((kReal / kTgt) * 100).toFixed(1) : '0.0';
      return `${i + 1}. *${k.kecamatan}*: ${kPct}% (${formatNumber(kReal)}/${formatNumber(kTgt)} dok)`;
    }).join('\n');
  } else {
    rincianKecamatan = '_Data per kecamatan belum tersedia_';
  }

  // Top 5 PCL
  let topPclList = '';
  if (Array.isArray(pclStats) && pclStats.length > 0) {
    const sortedPcl = [...pclStats].sort((a, b) => (b.approved_total || b.approved || 0) - (a.approved_total || a.approved || 0)).slice(0, 5);
    topPclList = sortedPcl.map((p, i) => {
      const badge = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${badge} *${p.pcl || p.nama_pcl || p.nama || '-'}*: ${formatNumber(p.approved_total || p.approved || 0)} approved (${p.kecamatan || '-'})`;
    }).join('\n');
  } else {
    topPclList = '_Data petugas belum tersedia_';
  }

  // Baseline target analisis
  const targetDateStr = (settings && settings.speedometer_target_date) ? settings.speedometer_target_date : '2026-08-31';
  const targetDateFormatted = formatIndonesianDate(targetDateStr);

  const variables = {
    // Waktu & Meta
    '{waktu_pengambilan_data}': timeInfo.fullFormatted,
    '{waktu_update_system}': waktuUpdateSystem,
    '{tanggal_sekarang}': tglSekarang,
    '{jam_sekarang}': jamSekarang,
    '{sesi_upload}': sesiUpload,
    '{waktu_upload_sebelumnya}': waktuUploadSebelumnya,
    '{label_fasih}': 'Dokumen FASIH SE2026',
    '{filename}': uploadData.filename || uploadData.status_filename || '-',
    '{nama_file}': uploadData.filename || uploadData.status_filename || '-',
    '{tanggal_data}': formatIndonesianDate(uploadData.tanggal),
    '{tanggal}': formatIndonesianDate(uploadData.tanggal),
    '{jam}': timeInfo.timeOnly,
    '{waktu_lengkap}': timeInfo.fullFormatted,
    '{url_dashboard}': (settings && settings.app_url) ? settings.app_url : 'https://monitoring.bpsppu.com',
    '{subsls_count}': formatNumber(totalSubsls),

    // Realisasi & Target FASIH
    '{realisasi_fasih}': formatNumber(fasihReal),
    '{total_realisasi_fasih}': formatNumber(fasihReal),
    '{target_fasih}': formatNumber(totalFasih),
    '{persen_fasih}': `${fasihPct}%`,
    '{progres_fasih_pct}': `${fasihPct}%`,
    '{sisa_fasih}': formatNumber(Math.max(0, totalFasih - fasihReal)),

    // Muatan
    '{realisasi_muatan}': formatNumber(realisasiMuatan),
    '{target_muatan}': formatNumber(totalMuatan),
    '{persen_muatan}': `${persenMuatan}%`,

    // Breakdown Dokumen
    '{open_total}': formatNumber(totalOpen),
    '{draft_total}': formatNumber(totalDraft),
    '{submitted_total}': formatNumber(totalSubmitted),
    '{total_submitted}': formatNumber(totalSubmitted),
    '{approved_total}': formatNumber(totalApproved),
    '{total_approved}': formatNumber(totalApproved),
    '{rejected_total}': formatNumber(totalRejected),
    '{total_rejected}': formatNumber(totalRejected),
    '{total_pcl}': formatNumber(totalPcl),
    '{target_date}': targetDateFormatted,

    // Diff / Penambahan Progres
    '{diff_submitted}': diffSubmitted,
    '{diff_approved}': diffApproved,
    '{diff_rejected}': diffRejected,
    '{diff_total}': diffTotal,
    '{avg_diff_all}': avgDiffAll,
    '{avg_diff_active}': avgDiffActive,
    '{active_diff_pcl_count}': formatNumber(activeDiffPclCount),
    '{deviasi_update}': deviasiUpdateStr,
    '{deviasi_kumulatif}': defisitLajuKumulatifStr,
    '{target_normal_harian}': formatNumber(targetNormalHarian),

    // Sebaran PCL (sejak upload sebelumnya)
    '{dist_0}': formatNumber(dist0),
    '{dist_1_4}': formatNumber(dist1_4),
    '{dist_5_7}': formatNumber(dist5_7),
    '{dist_8_12}': formatNumber(dist8_12),
    '{dist_13_plus}': formatNumber(dist13Plus),

    // Rincian
    '{rincian_kecamatan}': rincianKecamatan,
    '{top_pcl}': topPclList
  };

  let message = template;
  for (const [placeholder, val] of Object.entries(variables)) {
    message = message.split(placeholder).join(val !== undefined && val !== null ? String(val) : '-');
  }

  return message;
}

/**
 * Mengirim notifikasi update data ke grup WhatsApp
 */
async function sendUpdateNotification(uploadInput, targetGroupOverride = null, customSummary = null, customKecStats = null, customPmlStats = null, customPclStats = null) {
  const db = require('../database');
  let uploadData = uploadInput;
  let summary = customSummary;
  let kecStats = customKecStats;
  let pmlStats = customPmlStats;
  let pclStats = customPclStats;

  if (typeof uploadInput === 'number' || typeof uploadInput === 'string') {
    const uploadId = parseInt(uploadInput, 10);
    uploadData = db.getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId) || db.getLatestUpload();
    if (!summary) summary = db.getOverviewSummary(uploadId);
    if (!kecStats) kecStats = db.getKecamatanStats(uploadId);
    if (!pmlStats) pmlStats = db.getPmlStats(uploadId);
    if (!pclStats) pclStats = db.getPclStats(uploadId);
  } else if (!uploadInput) {
    uploadData = db.getLatestUpload();
    if (uploadData) {
      if (!summary) summary = db.getOverviewSummary(uploadData.id);
      if (!kecStats) kecStats = db.getKecamatanStats(uploadData.id);
      if (!pmlStats) pmlStats = db.getPmlStats(uploadData.id);
      if (!pclStats) pclStats = db.getPclStats(uploadData.id);
    }
  }

  const settings = db.getSettings();
  
  // Periksa apakah notifikasi WhatsApp diaktifkan
  const isEnabled = settings.whatsapp_enabled === '1' || settings.wa_notif_enabled === '1';
  if (!isEnabled && !targetGroupOverride) {
    addWaLog('info', '[WA-Notif] Notifikasi otomatis dinonaktifkan di pengaturan (whatsapp_enabled = 0).');
    return { skipped: true, reason: 'Notifikasi otomatis dinonaktifkan di pengaturan.' };
  }

  // Ambil ID grup tujuan
  const targetGroup = (typeof targetGroupOverride === 'string' && targetGroupOverride.trim()) 
    ? targetGroupOverride 
    : (settings.whatsapp_group_id || settings.wa_target_group);

  if (!targetGroup) {
    addWaLog('warn', '[WA-Notif] Grup WhatsApp tujuan belum dipilih di pengaturan.');
    return { skipped: true, reason: 'Grup WhatsApp tujuan belum dipilih di pengaturan.' };
  }

  if (!uploadData) {
    addWaLog('warn', '[WA-Notif] Data upload tidak ditemukan.');
    return { skipped: true, reason: 'Data upload tidak ditemukan.' };
  }

  // Pilih template (Dukung Intraday Template jika diaktifkan & sebelum batas jam cutoff)
  let chosenTemplate = settings.whatsapp_message_template || settings.wa_notif_template;
  if (settings.whatsapp_intraday_enabled === '1' && settings.whatsapp_intraday_message_template) {
    let uploadHour = 12;
    const fn = uploadData.status_filename || uploadData.filename || '';
    const match = fn.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
    if (match) {
      uploadHour = parseInt(match[4], 10);
    }
    const cutoff = parseInt(settings.whatsapp_session_cutoff_hour, 10) || 12;
    if (uploadHour < cutoff) {
      chosenTemplate = settings.whatsapp_intraday_message_template;
      addWaLog('info', `[WA-Notif] Menggunakan template intraday (Sesi Pagi, Jam upload: ${uploadHour}:00 < Cutoff: ${cutoff}:00).`);
    }
  }

  const defaultTemplate = `📊 *UPDATE MONITORING SE2026 PPU*
🗓️ *{waktu_lengkap}*

*Capaian Dokumen FASIH:*
• Progress: *{progres_fasih_pct}* ({total_realisasi_fasih} / {target_fasih} dok)
• Approved: *{total_approved}* dok
• Submitted: *{total_submitted}* dok
• Rejected: *{total_rejected}* dok
• Sisa Beban: *{sisa_fasih}* dok

📍 *Progress per Kecamatan:*
{rincian_kecamatan}

🏆 *Top 5 PCL:*
{top_pcl}

🔗 Dashboard: {url_dashboard}
_Pesan otomatis Sistem Monitoring SE2026 BPS Kab. Penajam Paser Utara_`;

  const template = chosenTemplate || defaultTemplate;
  const message = buildNotificationMessage(template, uploadData, summary, kecStats, pmlStats, pclStats, settings);

  try {
    addWaLog('info', `[WA-Notif] Mengirim notifikasi update data ke grup: ${targetGroup}...`);
    const res = await sendDirectMessage(targetGroup, message);
    addWaLog('success', '[WA-Notif] Notifikasi update data berhasil dikirim ke grup WhatsApp.');
    return { 
      success: true, 
      groupId: targetGroup, 
      groupName: settings.whatsapp_group_name || 'Grup Notifikasi', 
      messageId: res?.key?.id || 'sent' 
    };
  } catch (err) {
    addWaLog('error', `[WA-Notif] Gagal mengirim notifikasi update data: ${err.message}`);
    return { error: err.message, groupId: targetGroup };
  }
}

module.exports = {
  initialize,
  startSupervisor,
  hasValidSession,
  getStatus,
  getGroups,
  sendDirectMessage,
  sendUpdateNotification,
  buildNotificationMessage,
  extractUploadDataTime,
  getLogs,
  addWaLog,
  logout,
  forceReset
};
