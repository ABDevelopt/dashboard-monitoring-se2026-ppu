/**
 * Baileys Diagnostic Script
 * Menjalankan koneksi WhatsApp via WebSocket murni tanpa Chromium.
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

console.log('=== WA BAILEYS DIAGNOSTIC SCRIPT ===');
console.log('Time:', new Date().toISOString());
console.log('Initializing Baileys Socket...');

async function startDiag() {
  // Gunakan auth folder khusus untuk testing baileys
  const authDir = path.join(__dirname, './.wwebjs_auth/baileys-test-session');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Kita handle manual untuk generate QR data
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\nSUCCESS: QR Code received!');
      console.log('Scan QR di terminal di bawah ini:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startDiag();
      }
    } else if (connection === 'open') {
      console.log('SUCCESS: WhatsApp Connection Opened!');
      process.exit(0);
    }
  });
}

startDiag().catch(err => {
  console.error('ERROR running Baileys Diag:', err);
});
