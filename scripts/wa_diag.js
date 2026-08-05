const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

// Cek env var atau path default chrome portable
const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/home/bpsppuco/chrome-portable/chrome-linux64/chrome';

console.log('=== WA DIAGNOSTIC SCRIPT ===');
console.log('Time:', new Date().toISOString());
console.log('Using executablePath:', execPath);
console.log('File exists:', fs.existsSync(execPath));

if (fs.existsSync(execPath)) {
  try {
    const stats = fs.statSync(execPath);
    console.log('File size:', stats.size, 'bytes');
    console.log('File permissions:', stats.mode.toString(8));
  } catch (e) {
    console.error('Error reading file stats:', e.message);
  }
}

// Aktifkan debug log dari puppeteer/whatsapp-web.js
process.env.DEBUG = 'puppeteer:*';

console.log('\n--- Initializing test Puppeteer launch ---');

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'se2026-monitoring-test',
    dataPath: path.join(__dirname, './.wwebjs_auth')
  }),
  // Gunakan cache local bawaan (jangan remote wa-version yang bisa diblokir network hosting)
  webVersionCache: {
    type: 'local'
  },
  puppeteer: {
    headless: true,
    executablePath: execPath,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--single-process', // Coba aktifkan kembali di script diagnosa ini
      '--disable-software-rasterizer',
      '--disable-features=dbus',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('SUCCESS: QR Code event fired! Data:', qr.substring(0, 30) + '...');
  process.exit(0);
});

client.on('ready', () => {
  console.log('SUCCESS: Client is ready!');
  process.exit(0);
});

client.on('auth_failure', (msg) => {
  console.error('FAILED: Auth failure:', msg);
  process.exit(1);
});

setTimeout(() => {
  console.log('TIMEOUT: 30 seconds reached, closing client.');
  client.destroy().then(() => process.exit(1));
}, 30000);

console.log('Starting client initialization...');
client.initialize().catch(err => {
  console.error('ERROR: Client initialization failed!');
  console.error(err);
  process.exit(1);
});
