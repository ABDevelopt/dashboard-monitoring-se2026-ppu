const fs = require('fs');
const path = require('path');

const authDir = path.join(__dirname, '.wwebjs_auth/baileys-session');

if (!fs.existsSync(authDir)) {
  console.log(`Direktori session WhatsApp tidak ditemukan di: ${authDir}`);
  console.log('Pastikan WhatsApp sudah pernah diinisialisasi.');
  process.exit(1);
}

try {
  const files = fs.readdirSync(authDir);
  let clearedCount = 0;
  
  files.forEach(file => {
    // KEEPS creds.json (login state) but deletes session/prekey files
    if (file !== 'creds.json') {
      const filePath = path.join(authDir, file);
      fs.rmSync(filePath, { recursive: true, force: true });
      clearedCount++;
    }
  });
  
  console.log('==================================================');
  console.log('   PEMBERSIHAN SESSION WHATSAPP (BAD MAC SOLVER)  ');
  console.log('==================================================');
  console.log(`✔ Berhasil membersihkan ${clearedCount} file session sementara.`);
  console.log('✔ File utama login ("creds.json") tetap dipertahankan.');
  console.log('\nLangkah berikutnya:');
  console.log('1. Jalankan kembali aplikasi menggunakan "npm run dev" atau "node server.js".');
  console.log('2. Baileys akan otomatis membuat session enkripsi baru yang sinkron saat menerima pesan baru.');
  console.log('3. Anda TIDAK perlu melakukan scan QR code ulang.');
  console.log('==================================================');
} catch (error) {
  console.error('Gagal membersihkan file session:', error);
}
