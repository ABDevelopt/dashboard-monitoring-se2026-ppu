const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const https = require('https');
const dns = require('dns');
const logger = require('./logger');

// Paksa semua DNS resolution di Node.js untuk selalu mengutamakan IPv4
// Ini mengatasi AggregateError WebSocket di server Dewaweb yang tidak mendukung IPv6
// Tanpa ini, Node.js mencoba koneksi ke semua IP (termasuk IPv6) secara paralel
// dan semua gagal → AggregateError
dns.setDefaultResultOrder('ipv4first');

const { 
  getSettings, acquireProcessLock, renewProcessLock, releaseProcessLock,
  saveWhatsappState, getWhatsappState, savePendingCommand, getPendingCommand, clearPendingCommand,
  queueWhatsappMessage, getPendingWhatsappMessages, updateWhatsappMessageStatus, checkQueuedMessageStatus
} = require('../database');

const customAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  family: 4 // Paksa koneksi IPv4 murni (lapisan kedua perlindungan selain dns.setDefaultResultOrder)
});

let sock = null;
let qrCodeDataUri = '';
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED
let userInfo = null;
let isInitializing = false;
let hasEverConnectedInSession = false;
let consecutive408Count = 0;
let globalNetworkErrorCount = 0;  // Hitung error 408 AggregateError lintas-sesi (reset hanya saat CONNECTED)
const MAX_GLOBAL_NETWORK_ERRORS = 5; // Batas sebelum berhenti total & tunggu watchdog

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

  // Persist logs ke SQLite jika proses ini aktif/Master agar dibaca semua worker
  if (sock || clientStatus === 'CONNECTED' || isInitializing || clientStatus === 'CONNECTING') {
    try {
      const dbConn = require('../database').getDb('se2026');
      dbConn.prepare(`
        INSERT INTO whatsapp_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run('wa_logs', JSON.stringify(waLogs.slice(-40)), Date.now());
    } catch (_) {}
  }

  // Kirim juga ke logger utama server
  if (type === 'error') logger.error(`[WA-Service] ${message}`);
  else if (type === 'warn') logger.warn(`[WA-Service] ${message}`);
  else logger.info(`[WA-Service] ${message}`);
}

function getLogs() {
  try {
    const dbConn = require('../database').getDb('se2026');
    const row = dbConn.prepare("SELECT value FROM whatsapp_state WHERE key = 'wa_logs'").get();
    if (row && row.value) {
      return JSON.parse(row.value);
    }
  } catch (_) {}
  return [...waLogs];
}

// Exponential backoff state untuk reconnect
let reconnectAttempt = 0;
const RECONNECT_DELAY_MIN = 3000;   // 3 detik
const RECONNECT_DELAY_MAX = 30000;  // 30 detik (cap max)

// Health check interval handle & Background Supervisor handle
let healthCheckInterval = null;
let supervisorInterval = null;

const authDir = path.join(__dirname, '../.wwebjs_auth/baileys-session');
const lockFilePath = path.join(__dirname, '../.wwebjs_auth/wa_instance.lock');
let lockHeartbeatInterval = null;

/**
 * Memastikan hanya 1 proses Node.js yang memegang koneksi aktif ke WhatsApp via file lock
 */
function acquireLock() {
  try {
    const now = Date.now();
    if (fs.existsSync(lockFilePath)) {
      const raw = fs.readFileSync(lockFilePath, 'utf8');
      try {
        const lockData = JSON.parse(raw);
        const isAlive = (now - lockData.timestamp) < 15000;
        
        // Periksa apakah PID tersebut memang masih aktif di sistem
        let processExists = true;
        if (lockData.pid && lockData.pid !== process.pid) {
          try {
            process.kill(lockData.pid, 0);
          } catch (err) {
            if (err.code === 'ESRCH') {
              processExists = false;
            }
          }
        }

        if (isAlive && lockData.pid !== process.pid && processExists) {
          // Lock masih aktif dipegang oleh proses lain
          return false;
        }
      } catch (_) {}
    }
    
    // Pastikan direktori folder lock ada
    const parentDir = path.dirname(lockFilePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    fs.writeFileSync(lockFilePath, JSON.stringify({ pid: process.pid, timestamp: now }));
    startLockHeartbeat();
    return true;
  } catch (e) {
    return true; // Fallback jika gagal baca/tulis lock
  }
}

function startLockHeartbeat() {
  if (lockHeartbeatInterval) return;
  lockHeartbeatInterval = setInterval(async () => {
    try {
      if (sock || clientStatus === 'CONNECTED' || isInitializing || clientStatus === 'CONNECTING') {
        // Tulis ulang lock data dengan timestamp terbaru ke file lock
        try {
          fs.writeFileSync(lockFilePath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
        } catch (_) {}
        
        // Sync state ke SQLite agar dibaca oleh Standby worker
        saveWhatsappState(clientStatus, qrCodeDataUri, userInfo);

        // Periksa apakah ada perintah tertunda dari proses Standby
        const cmd = getPendingCommand();
        if (cmd) {
          addWaLog('info', `[WA-IPC] Menjalankan perintah IPC dari proses Standby: ${cmd.toUpperCase()}`);
          clearPendingCommand();
          if (cmd === 'logout') {
            await logout();
          } else if (cmd === 'reconnect') {
            await forceReset(false);
          } else if (cmd === 'force_reset') {
            await forceReset(true);
          }
        }

        // Proses antrean pesan keluar (outbox) jika terhubung
        if (sock && clientStatus === 'CONNECTED') {
          await processWhatsappOutbox();
        }
      }
    } catch (_) {}
  }, 3000); // 3 detik agar pengiriman outbox responsif
}

function releaseLock() {
  if (lockHeartbeatInterval) {
    clearInterval(lockHeartbeatInterval);
    lockHeartbeatInterval = null;
  }
  try {
    if (fs.existsSync(lockFilePath)) {
      const raw = fs.readFileSync(lockFilePath, 'utf8');
      try {
        const lockData = JSON.parse(raw);
        if (lockData.pid === process.pid) {
          fs.unlinkSync(lockFilePath);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// Lepaskan lock saat proses node keluar
process.on('exit', releaseLock);
process.on('SIGINT', () => {
  releaseLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(0);
});

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

  // Cek Inter-Process Lock sebelum membuka socket
  if (!acquireLock()) {
    addWaLog('info', `[WA-Cluster] Proses (PID ${process.pid}) berstatus STANDBY. Koneksi WhatsApp aktif dikelola oleh proses Master.`);
    return;
  }

  isInitializing = true;
  if (clientStatus !== 'CONNECTED') {
    clientStatus = 'CONNECTING';
  }
  addWaLog('info', `[WA-Init] Menginisialisasi urutan koneksi WhatsApp Baileys (PID ${process.pid})...`);

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
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 5000,
      maxRetries: 5,
      emitOwnEvents: false,
      wsOptions: {
        agent: customAgent
      },
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
        // Reset semua counter saat berhasil terhubung
        reconnectAttempt = 0;
        consecutive408Count = 0;
        globalNetworkErrorCount = 0;
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

        // Simpan langsung status CONNECTED ke SQLite agar dibaca instan oleh worker Standby
        saveWhatsappState(clientStatus, qrCodeDataUri, userInfo);

        // Ambil dan cache daftar grup ke SQLite setelah sinkronisasi internal Baileys selesai
        setTimeout(async () => {
          try {
            const grps = await getGroups();
            if (grps && grps.length > 0) {
              const dbConn = require('../database').getDb('se2026');
              dbConn.prepare(`
                INSERT INTO whatsapp_state (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
              `).run('wa_groups', JSON.stringify(grps), Date.now());
            }
          } catch (_) {}
        }, 2000);

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
          globalNetworkErrorCount++;
          addWaLog('warn', `[WA-AutoRecovery] Deteksi WebSocket Error 408/Timeout (Percobaan #${consecutive408Count}, Global: #${globalNetworkErrorCount})...`);
        } else {
          consecutive408Count = 0;
        }

        // HARD STOP: Jika error jaringan terlalu banyak berturut-turut, kemungkinan besar server diblokir.
        // Berhenti reconnect agresif dan biarkan watchdog yang evaluasi ulang setelah 60 detik.
        if (globalNetworkErrorCount >= MAX_GLOBAL_NETWORK_ERRORS) {
          addWaLog('warn', `[WA-AutoRecovery] Terlalu banyak error jaringan (${globalNetworkErrorCount}x). Menghentikan reconnect agresif. Watchdog akan coba ulang dalam ~60 detik...`);
          await _closeSocket(false);
          consecutive408Count = 0;
          globalNetworkErrorCount = 0;
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          // JANGAN cleanAuthDir() — sesi mungkin masih valid, hanya jaringan yang bermasalah
          return;
        }

        // AUTO-RECOVERY UNTUK LOOP 408: Hanya bersihkan sesi jika belum pernah terhubung SAMA SEKALI
        // dan bukan merupakan AggregateError murni jaringan
        if (consecutive408Count >= 3 && !hasEverConnectedInSession && !reason.includes('AggregateError')) {
          addWaLog('warn', '[WA-AutoRecovery] Sesi corrupt terdeteksi (3x 408 berturut-turut tanpa koneksi). Membersihkan sesi & menerbitkan QR Code baru...');
          await _closeSocket(false);
          cleanAuthDir();
          consecutive408Count = 0;
          globalNetworkErrorCount = 0;
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          setTimeout(() => {
            initialize();
          }, 5000); // Tunggu 5 detik sebelum coba lagi
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
          // Jangan langsung loop reconnect agresif; biarkan Background Supervisor mengevaluasi secara teratur
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
          consecutive408Count = 0;
          globalNetworkErrorCount = 0;
          reconnectAttempt = 0;
          clientStatus = 'DISCONNECTED';
          setTimeout(() => {
            initialize();
          }, 3000); // Tunggu 3 detik agar tidak langsung hit server
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
  try {
    const state = getWhatsappState();
    // Gunakan state ter-sinkronisasi dari SQLite jika terupdate kurang dari 35s lalu
    if (state && state.status) {
      let eff = state.status;
      if (eff === 'DISCONNECTED' && hasValidSession()) {
        eff = 'CONNECTING';
      }
      return {
        status: eff,
        qrCode: state.qrCode,
        user: state.user,
        logs: getLogs().slice(-20)
      };
    }
  } catch (_) {}

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
    logs: getLogs().slice(-20) // 20 log terbaru
  };
}

/**
 * Mengambil daftar grup WhatsApp yang diikuti
 */
async function getGroups() {
  // Jika Master, fetch langsung dari socket
  if (sock && clientStatus === 'CONNECTED') {
    try {
      const fetchWithTimeout = Promise.race([
        sock.groupFetchAllParticipating(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed Out (5s)')), 5000))
      ]);
      const groups = await fetchWithTimeout;
      if (groups) {
        return Object.values(groups).map(group => ({
          id: group.id,
          name: group.subject || 'Grup Tanpa Nama'
        }));
      }
    } catch (err) {
      const errMsg = err && (err.message || String(err));
      addWaLog('warn', `WhatsApp getGroups fetch langsung: ${errMsg}`);
    }
  }

  // Fallback ke SQLite cache agar standby worker bisa membaca daftar grup
  try {
    const dbConn = require('../database').getDb('se2026');
    const row = dbConn.prepare("SELECT value FROM whatsapp_state WHERE key = 'wa_groups'").get();
    if (row && row.value) {
      return JSON.parse(row.value);
    }
  } catch (_) {}

  return [];
}

/**
 * Memproses antrean pesan (outbox) dari database SQLite (Dipanggil eksklusif oleh proses Master)
 */
async function processWhatsappOutbox() {
  if (!sock || clientStatus !== 'CONNECTED') return;

  try {
    const pendingMsgs = getPendingWhatsappMessages();
    if (!pendingMsgs || pendingMsgs.length === 0) return;

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

/**
 * Mengirim pesan langsung ke chat/grup ID tertentu (Mendukung Multi-process / Standby worker)
 */
async function sendDirectMessage(chatId, message) {
  // Jika proses ini adalah Master dan terhubung, kirim langsung
  if (sock && clientStatus === 'CONNECTED') {
    try {
      let formattedJid = chatId.trim();
      if (!formattedJid.includes('@')) {
        formattedJid = formattedJid + '@g.us';
      }
      const response = await sock.sendMessage(formattedJid, { text: message });
      addWaLog('success', `[WA-Message] Pesan berhasil dikirim langsung ke: ${chatId}`);
      return response;
    } catch (err) {
      addWaLog('error', `[WA-Message] Gagal mengirim pesan langsung ke ${chatId}: ${err.message}`);
      throw err;
    }
  }

  // Jika proses ini adalah Standby (tidak memiliki socket aktif), antrekan ke Outbox SQLite
  addWaLog('info', `[WA-Outbox] Mengantrekan pesan ke ${chatId} via SQLite Outbox...`);
  const queueId = queueWhatsappMessage(chatId, message);
  if (!queueId) {
    throw new Error('Gagal menyimpan pesan ke database outbox');
  }

  // Polling status pengiriman dari SQLite selama maksimal 12 detik
  const startTime = Date.now();
  while (Date.now() - startTime < 12000) {
    await new Promise(r => setTimeout(r, 500));
    const msgState = checkQueuedMessageStatus(queueId);
    if (msgState) {
      if (msgState.status === 'SENT') {
        return { success: true };
      } else if (msgState.status === 'FAILED') {
        throw new Error(msgState.error || 'Pengiriman gagal di proses Master');
      }
    }
  }

  throw new Error('Batas waktu tunggu pengiriman pesan habis (Master sedang tidak aktif atau sibuk)');
}

/**
 * Keluar (Logout) penuh — hapus sesi, minta scan QR ulang
 */
async function logout() {
  if (!lockHeartbeatInterval) {
    addWaLog('info', '[WA-IPC] Mengirim perintah LOGOUT ke proses Master via SQLite...');
    savePendingCommand('logout');
    return;
  }

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
  if (!lockHeartbeatInterval) {
    const cmd = cleanSession ? 'force_reset' : 'reconnect';
    addWaLog('info', `[WA-IPC] Mengirim perintah ${cmd.toUpperCase()} ke proses Master via SQLite...`);
    savePendingCommand(cmd);
    return;
  }

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
      return { skipped: true, reason: 'Notifikasi WhatsApp dinonaktifkan di pengaturan.' };
    }

    if (!groupId) {
      addWaLog('warn', 'Grup ID tidak ditentukan untuk notifikasi WhatsApp.');
      return { error: 'Grup WhatsApp tujuan belum ditentukan.' };
    }

    const { getDb, getOverviewSummary } = require('../database');
    const db = getDb();
    
    // Ambil detail data upload
    const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!upload) {
      addWaLog('warn', `Upload ID ${uploadId} tidak ditemukan. Batal mengirim notifikasi.`);
      return { error: `Data Upload #${uploadId} tidak ditemukan di database.` };
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
    const sendResult = await sendDirectMessage(groupId, message);
    addWaLog('success', 'Notifikasi WhatsApp berhasil dikirim ke grup!');
    return {
      success: true,
      groupId,
      groupName: settings.whatsapp_group_name || 'Grup WhatsApp',
      messageId: sendResult?.key?.id
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    addWaLog('error', `Gagal mengirim notifikasi update WhatsApp: ${errorMsg}`);
    return { error: errorMsg };
  }
}

module.exports = {
  initialize,
  startSupervisor,
  getStatus,
  getGroups,
  getLogs,
  sendDirectMessage,
  sendUpdateNotification,
  logout,
  forceReset,
  hasValidSession
};

