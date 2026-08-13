/**
 * ============================================================================
 * DIAGNOSTIC TOOL: WHATSAPP INTEGRATION (SE2026 PPU)
 * ============================================================================
 * Menjalankan pemeriksaan komprehensif pada konfigurasi, database SQLite,
 * multi-process Passenger lock, jaringan DNS, serta simulasi live socket QR code.
 * 
 * Penggunaan di Terminal Dewaweb / Lokal:
 *   node scripts/diagnose_wa.js
 *   node scripts/diagnose_wa.js --live    (Untuk tes koneksi & print QR langsung di terminal)
 *   node scripts/diagnose_wa.js --reset   (Untuk membersihkan lock & sesi lama)
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const https = require('https');

// Paksa IPv4 First pada DNS resolution
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const db = require('../database');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
let qrcodeTerminal = null;
try {
  qrcodeTerminal = require('qrcode-terminal');
} catch (_) {}

const args = process.argv.slice(2);
const isLiveMode = args.includes('--live') || args.includes('-l');
const isResetMode = args.includes('--reset') || args.includes('-r');

async function runDiagnosis() {
  console.log('\n===============================================================');
  console.log('       🔍 DIAGNOSTIK INTEGRASI WHATSAPP SE2026 PPU             ');
  console.log('===============================================================');
  console.log(`⏰ Waktu Server : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA`);
  console.log(`💻 Node.js      : ${process.version} (${process.platform} ${process.arch})`);
  console.log(`🆔 Current PID  : ${process.pid}`);
  console.log('---------------------------------------------------------------\n');

  // 1. CEK SESI DI DISK
  console.log('📁 1. PEMERIKSAAN BERKAS SESI (.wwebjs_auth):');
  const authDir = path.join(__dirname, '../.wwebjs_auth/baileys-session');
  const credsFile = path.join(authDir, 'creds.json');
  
  if (isResetMode) {
    console.log('   🧹 Mode --reset aktif: Membersihkan sesi & lock lama...');
    try {
      if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
      db.releaseProcessLock('whatsapp_master', 0);
      db.setWhatsappState('status', 'DISCONNECTED');
      db.setWhatsappState('qr_code', '');
      db.setWhatsappState('user_info', null);
      console.log('   ✓ Sesi dan Master Lock berhasil direset bersih!');
    } catch (e) {
      console.log(`   ✗ Gagal reset: ${e.message}`);
    }
  }

  const sessionExists = fs.existsSync(authDir);
  const credsExists = fs.existsSync(credsFile);
  let credsSize = 0;
  if (credsExists) {
    credsSize = fs.statSync(credsFile).size;
  }

  console.log(`   - Direktori Auth     : ${authDir} [${sessionExists ? '✓ ADA' : '✗ BELUM ADA'}]`);
  console.log(`   - Kredensial (creds) : ${credsFile} [${credsExists ? `✓ ADA (${credsSize} bytes)` : '✗ BELUM ADA / PERLU SCAN QR'}]`);
  console.log(`   - Status Sesi        : ${credsSize > 10 ? '🟢 SUDAH LOGIN (Session Tersimpan)' : '🟡 BELUM LOGIN (Memerlukan QR Code)'}`);
  console.log('');

  // 2. CEK PROCESS LOCK (SQLite Multi-Process Passenger)
  console.log('🔒 2. STATUS MASTER PROCESS LOCK (SQLite process_locks):');
  const lock = db.getProcessLock('whatsapp_master');
  if (lock) {
    const now = Date.now();
    const ageMs = now - lock.heartbeat;
    const ageSec = (ageMs / 1000).toFixed(1);
    let isAlive = false;
    try {
      process.kill(lock.owner_pid, 0);
      isAlive = true;
    } catch (_) {
      isAlive = false;
    }

    console.log(`   - Master Owner PID   : ${lock.owner_pid}`);
    console.log(`   - Hostname           : ${lock.hostname || '-'}`);
    console.log(`   - Heartbeat Terakhir : ${ageSec} detik lalu`);
    console.log(`   - Status Proses OS   : ${isAlive ? '🟢 AKTIF (Proses benar-benar berjalan di OS)' : '🔴 MATI (Proses sudah mati di OS, siap diambil alih)'}`);
    console.log(`   - Evaluasi Lock      : ${ageMs < 15000 && isAlive ? '🔒 Lock Sedang Dipegang Master Aktif' : '🔓 Lock Kadaluarsa / Bebas'}`);
  } else {
    console.log('   - Status Lock        : 🟢 KOSONG (Belum ada proses yang mengunci, bebas dipakai)');
  }
  console.log('');

  // 3. CEK STATE SINKRONISASI (whatsapp_state)
  console.log('📊 3. DATA STATE TER-SINKRONISASI (SQLite whatsapp_state):');
  const sharedState = db.getAllWhatsappState();
  const statusStr = sharedState.status || 'DISCONNECTED';
  const qrStr = sharedState.qr_code || '';
  const userStr = sharedState.user_info ? JSON.stringify(sharedState.user_info) : '(Belum terhubung)';

  console.log(`   - Status Global      : [${statusStr}]`);
  console.log(`   - QR Code Terbit     : ${qrStr ? `✓ TERSEDIA (Data URI length: ${qrStr.length} chars)` : '✗ KOSONG / BELUM DITERBITKAN'}`);
  console.log(`   - User Terhubung     : ${userStr}`);
  console.log('');

  // 4. CEK LOG TERAKHIR DARI DATABASE
  console.log('📜 4. 5 LOG TERAKHIR DARI DATABASE:');
  const recentLogs = db.getWhatsappLogsDb(5);
  if (recentLogs.length > 0) {
    recentLogs.forEach(l => {
      console.log(`   [${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`);
    });
  } else {
    console.log('   (Belum ada log tercatat di SQLite)');
  }
  console.log('');

  // 5. CEK KONEKSI JARINGAN & DNS KE WHATSAPP SERVER
  console.log('🌐 5. PENGUJIAN JARINGAN & DNS (web.whatsapp.com):');
  try {
    const dnsPromise = new Promise((resolve, reject) => {
      dns.lookup('web.whatsapp.com', { family: 4 }, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });
    const dnsRes = await dnsPromise;
    console.log(`   - DNS Resolution     : ✓ Sukses! IP IPv4: ${dnsRes.address} (Family IPv${dnsRes.family})`);
  } catch (err) {
    console.log(`   - DNS Resolution     : ✗ Gagal: ${err.message}`);
  }

  try {
    const httpsPromise = new Promise((resolve) => {
      const req = https.get('https://web.whatsapp.com', { timeout: 5000 }, (res) => {
        resolve({ statusCode: res.statusCode });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout (5s)' }); });
    });
    const httpRes = await httpsPromise;
    if (httpRes.statusCode) {
      console.log(`   - HTTPS Reachability : ✓ Sukses! HTTP Status Code: ${httpRes.statusCode}`);
    } else {
      console.log(`   - HTTPS Reachability : ⚠️ Gangguan: ${httpRes.error}`);
    }
  } catch (err) {
    console.log(`   - HTTPS Reachability : ✗ Gagal: ${err.message}`);
  }
  console.log('');

  // 6. LIVE TEST BAILEYS SOCKET (Jika --live atau jika QR belum ada)
  if (isLiveMode) {
    console.log('⚡ 6. MENJALANKAN LIVE BAILEYS TEST (Menghubungi WebSocket WhatsApp):');
    console.log('   Menunggu respons dari WhatsApp Server (maksimal 30 detik)...');

    const tempAuthDir = path.join(__dirname, '../.wwebjs_auth/baileys-diag-temp');
    if (!fs.existsSync(tempAuthDir)) fs.mkdirSync(tempAuthDir, { recursive: true });
    
    const { state, saveCreds } = await useMultiFileAuthState(tempAuthDir);

    let version = [2, 3000, 1015901307];
    try {
      const v = await fetchLatestBaileysVersion();
      if (v?.version) version = v.version;
      console.log(`   -> Menggunakan Baileys Version: ${version.join('.')}`);
    } catch (_) {}

    const customAgent = new https.Agent({ keepAlive: true, family: 4 });

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      agent: customAgent
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n===============================================================');
        console.log('🎉 HASIL: QR CODE BERHASIL DIGENERATE DARI WHATSAPP SERVER!');
        console.log('===============================================================');
        console.log('Scan QR Code di bawah ini menggunakan WhatsApp HP Anda:');
        if (qrcodeTerminal) {
          qrcodeTerminal.generate(qr, { small: true });
        } else {
          console.log(`Raw QR String: ${qr.substring(0, 50)}...`);
        }
        console.log('---------------------------------------------------------------');
        console.log('💡 DIAGNOSA: Koneksi WebSocket server Dewaweb ke WhatsApp 100% NORMAL.');
        console.log('---------------------------------------------------------------\n');
        
        // Cleanup temp dir & exit
        setTimeout(() => {
          try { sock.end(undefined); } catch (_) {}
          try { fs.rmSync(tempAuthDir, { recursive: true, force: true }); } catch (_) {}
          process.exit(0);
        }, 15000);
      }

      if (connection === 'open') {
        console.log('🟢 HASIL: WhatsApp Berhasil Terhubung (Connection OPEN)!');
        setTimeout(() => {
          try { sock.end(undefined); } catch (_) {}
          try { fs.rmSync(tempAuthDir, { recursive: true, force: true }); } catch (_) {}
          process.exit(0);
        }, 3000);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`⚠️ WebSocket Closed. StatusCode: ${code}, Reason: ${lastDisconnect?.error?.message}`);
      }
    });

  } else {
    console.log('===============================================================');
    console.log('💡 PETUNJUK TINDAKAN:');
    console.log('===============================================================');
    console.log('1. Untuk melakukan tes pembuatan QR Code LANGSUNG di terminal ini:');
    console.log('   👉 node scripts/diagnose_wa.js --live\n');
    console.log('2. Untuk mereset paksa sesi & lock yang macet:');
    console.log('   👉 node scripts/diagnose_wa.js --reset\n');
    console.log('===============================================================\n');
    process.exit(0);
  }
}

runDiagnosis().catch(err => {
  console.error('Fatal Error saat menjalankan diagnosa:', err);
  process.exit(1);
});
