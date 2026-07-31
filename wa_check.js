const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('===================================================');
console.log('   DEWAWEB WHATSAPP CLIENT DIAGNOSTIC TOOL       ');
console.log('===================================================');
console.log('Waktu Cek (UTC) :', new Date().toISOString());
console.log('Platform/OS     :', process.platform, process.arch);
console.log('Node.js Version :', process.version);
console.log('Directory Root  :', __dirname);
console.log('---------------------------------------------------\n');

// 1. Cek Environment Variables
console.log('1. MEMERIKSA ENVIRONMENT VARIABLES:');
console.log('   PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH || '(Tidak disetel)');
console.log('   CHROME_PATH              :', process.env.CHROME_PATH || '(Tidak disetel)');
console.log('');

// 2. Deteksi Kandidat File Executable Chrome
console.log('2. MENCARI LOKASI CHROMIUM/CHROME PORTABLE:');
const candidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/home/bpsppuco/chrome-portable/chrome-linux64/chrome',
  '/home/bpsppu/chrome-portable/chrome-linux64/chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

let foundPath = null;
candidates.forEach(p => {
  if (!p) return;
  const exists = fs.existsSync(p);
  console.log(`   - [${exists ? '✓ FOUND' : '✗ MISSING'}] ${p}`);
  if (exists && !foundPath) {
    foundPath = p;
  }
});

if (foundPath) {
  console.log(`\n   -> Executable terpilih: ${foundPath}`);
  try {
    const stats = fs.statSync(foundPath);
    console.log(`   -> Ukuran File: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`   -> Hak Akses  : ${stats.mode.toString(8)} (Harus berupa executable, e.g., 755/777)`);
  } catch (e) {
    console.error('   -> Gagal membaca informasi file:', e.message);
  }
} else {
  console.log('\n   -> [WARNING] Tidak menemukan executable Chrome di path di atas.');
}
console.log('');

// 3. Cek Proses Zombie Chrome yang Berjalan di Latar Belakang (RAM Limit Warning)
console.log('3. MEMERIKSA ZOMBIE PROCESS (CHROME/PUPPETEER):');
try {
  const psOutput = execSync('ps aux | grep -E "chrome|chromium" | grep -v grep', { encoding: 'utf8' }).trim();
  if (psOutput) {
    const lines = psOutput.split('\n');
    console.log(`   -> [WARNING] Terdeteksi ${lines.length} proses Chrome berjalan:`);
    lines.slice(0, 5).forEach(l => console.log('      ' + l.substring(0, 100) + '...'));
    if (lines.length > 5) console.log(`      ... dan ${lines.length - 5} proses lainnya.`);
    console.log('\n   💡 TIPS: Jika stuck, Anda dapat membersihkan proses ini dengan perintah:');
    console.log('      pkill -f chrome   ATAU   killall chrome');
  } else {
    console.log('   ✓ Bersih. Tidak ada proses Chrome zombie yang sedang menggantung.');
  }
} catch (e) {
  console.log('   ✓ Bersih. Tidak ada proses Chrome yang terdeteksi.');
}
console.log('');

// 4. Simulasi Launch Puppeteer untuk Mendeteksi Missing Shared Libraries (.so)
console.log('4. MENCOBA MENJALANKAN (LAUNCH) PUPPETEER:');
if (!foundPath) {
  console.log('   ✗ Gagal test launch: Tidak ada executable Chrome/Chromium.');
  finishDiag();
} else {
  try {
    const puppeteer = require('puppeteer-core');
    console.log('   -> Memulai test launch browser...');
    puppeteer.launch({
      executablePath: foundPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    }).then(async (browser) => {
      console.log('   ✓ SUCCESS: Puppeteer berhasil meluncurkan Chrome portable!');
      await browser.close();
      console.log('   ✓ SUCCESS: Test browser ditutup dengan sukses.');
      finishDiag();
    }).catch(err => {
      console.log('   ✗ FAILED: Browser crash saat diluncurkan.');
      console.log('\n   === ERROR DETAIL ===');
      console.error(err.message);
      if (err.message.includes('error while loading shared libraries')) {
        console.log('\n   💡 PENYEBAB: Ada dependensi OS Linux (shared library) yang kurang di Dewaweb.');
        console.log('   Hubungi Support Dewaweb untuk menginstal dependensi Chromium di server.');
      }
      console.log('====================');
      finishDiag();
    });
  } catch (e) {
    console.log('   ✗ FAILED: Modul puppeteer-core tidak ditemukan atau gagal diload.');
    console.error(e.message);
    finishDiag();
  }
}

function finishDiag() {
  console.log('\n===================================================');
  console.log('               DIAGNOSTIC SELESAI                  ');
  console.log('===================================================');
}
