const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const https = require('https');

console.log('----------------------------------------------------');
console.log('🔍 SYSTEM DIAGNOSTIC TOOL FOR WHATSAPP (DEWAWEB)');
console.log('----------------------------------------------------');
console.log('Node Version:', process.version);
console.log('Platform:', process.platform, process.arch);
console.log('Current Time:', new Date().toISOString());

const authDir = path.join(__dirname, '.wwebjs_auth/baileys-session');
console.log('Auth Directory:', authDir);

try {
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
    console.log('✅ Auth directory created successfully.');
  } else {
    console.log('✅ Auth directory exists.');
  }
  const testFile = path.join(authDir, '.write_test');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('✅ Disk Write Access: OK');
} catch (e) {
  console.error('❌ Disk Write Access FAILED:', e.message);
}

const customAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  family: 4, // IPv4 murni
  timeout: 30000
});

async function runDiagnostic() {
  console.log('\n📡 Testing Outcoming Network & Version Fetch...');
  let version = [2, 3000, 1015901307];
  try {
    const fetchVersionWithTimeout = Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout (3s)')), 3000))
    ]);
    const fetched = await fetchVersionWithTimeout;
    if (fetched && fetched.version) {
      version = fetched.version;
      console.log('✅ Baileys Version Fetched:', version.join('.'));
    }
  } catch (err) {
    console.log('⚠️ Baileys Version Fetch Warning (Using Fallback):', err.message);
  }

  console.log('\n🚀 Initializing Baileys Socket Diagnostic Test...');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'info' }),
    browser: ['Windows', 'Chrome', '121.0.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
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

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n====================================================');
      console.log('🎉 SUCCESS! FRESH QR CODE RECEIVED FROM WHATSAPP SERVER:');
      console.log('====================================================');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('\n====================================================');
      console.log('🟢 SUCCESS! WHATSAPP CONNECTED:', sock.user);
      console.log('====================================================');
      process.exit(0);
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMsg = lastDisconnect?.error?.message || lastDisconnect?.error;
      console.log('\n❌ CONNECTION CLOSED Event:');
      console.log('StatusCode:', statusCode);
      console.log('Raw Error:', errorMsg);
    }
  });
}

runDiagnostic().catch(err => {
  console.error('❌ Fatal Diagnostic Catch Error:', err);
});
