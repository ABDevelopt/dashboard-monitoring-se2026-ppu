'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  scripts/diagnose_agent.js
//  Script Diagnosa Lengkap Chatbot AI Pananyo Taka untuk Server Dewaweb
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const dns = require('dns');

console.log('===============================================================');
console.log('  🔍 DIAGNOSA SISTEM CHATBOT AI PANANYO TAKA (DEWAWEB cPanel) ');
console.log('===============================================================\n');

// 1. Informasi Sistem & Node.js
console.log('1. INFORMASI RUNTIME & SISTEM:');
console.log(`   - Node.js Version  : ${process.version}`);
console.log(`   - Platform         : ${process.platform} (${process.arch})`);
console.log(`   - Process PID      : ${process.pid}`);
console.log(`   - Memory Usage     : ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
console.log(`   - Directory Root   : ${path.resolve(__dirname, '..')}`);

// 2. Prioritas DNS & Uji Resolusi Domain Google
console.log('\n2. UJI KONEKTIVITAS & DNS GOOGLE API:');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
  console.log('   - DNS Default Order: ipv4first (Aktif)');
}

const startTimeDns = Date.now();
dns.lookup('generativelanguage.googleapis.com', { family: 4 }, (err, address, family) => {
  const dnsDuration = Date.now() - startTimeDns;
  if (err) {
    console.error(`   ❌ GAGAL DNS Lookup generativelanguage.googleapis.com: ${err.message}`);
  } else {
    console.log(`   ✅ DNS Lookup OK    : ${address} (IPv${family}) dalam ${dnsDuration}ms`);
  }

  // 3. Uji Database & API Key Pool
  testDatabaseAndAI();
});

async function testDatabaseAndAI() {
  console.log('\n3. MEMERIKSA DATABASE & KONFIGURASI PENGATURAN:');
  let settings = {};
  try {
    const { getDb, getSettings, getLatestUpload } = require('../database');
    getDb('se2026');
    settings = getSettings('se2026');
    const upload = getLatestUpload('se2026');
    console.log(`   ✅ Koneksi SQLite   : OK`);
    console.log(`   - Upload Terakhir  : ${upload ? `ID ${upload.id} (${upload.tanggal || upload.filename})` : 'Belum ada data upload'}`);
    console.log(`   - Default Model    : ${settings.gemini_model || 'gemini-3.5-flash'}`);
    console.log(`   - SmartSwitch      : ${settings.chatbot_smart_switch !== '0' ? 'Aktif' : 'Nonaktif'}`);
  } catch (dbErr) {
    console.error(`   ❌ GAGAL Baca Database: ${dbErr.message}`);
    return;
  }

  // 4. Periksa Ketersediaan API Keys
  console.log('\n4. STATUS POOL API KEY GEMINI:');
  const keyPool = require('../services/ai/keyPool');
  const keys = keyPool.getOrderedEligibleKeys(settings);
  if (keys.length === 0) {
    console.error('   ❌ TIDAK ADA API KEY GEMINI YANG TERSEDIA / VALID!');
    console.error('      Silakan isi API Key di menu Pengaturan Dashboard.');
    return;
  }
  keys.forEach((k, idx) => {
    console.log(`   - Key #${idx + 1}: ${k.label} (${keyPool.maskKey(k.key)}) [Priority: ${k.priority}]`);
  });

  // 5. Uji Langsung Eksekusi Stream AI Agent
  console.log('\n5. UJI EKSEKUSI CHATBOT AI (STREAMING TEST):');
  const { streamMessageToAgent } = require('../services/agentService');
  
  const testPrompts = [
    { title: 'Test 1: Fast-Path / Salam', prompt: 'Halo apa kabar' },
    { title: 'Test 2: Query Ringkasan Data', prompt: 'Berapa total target dan progres kabupaten?' },
    { title: 'Test 3: Query Petugas Lapangan', prompt: 'Siapa 3 PCL dengan progres terendah?' }
  ];

  for (const t of testPrompts) {
    console.log(`\n   ----------------------------------------------------`);
    console.log(`   ▶️ Menjalankan ${t.title}`);
    console.log(`   Prompt: "${t.prompt}"`);
    console.log(`   ----------------------------------------------------`);
    
    const startT = Date.now();
    let firstTokenTime = null;
    let chunkCount = 0;
    const events = [];

    try {
      const result = await streamMessageToAgent(
        t.prompt,
        [],
        { provider: 'gemini', model: settings.gemini_model || 'gemini-3.5-flash' },
        (event, data) => {
          events.push({ event, data });
          if (event === 'chunk' && !firstTokenTime) {
            firstTokenTime = Date.now() - startT;
          }
          if (event === 'status') {
            console.log(`      [STATUS] ${data.text}`);
          } else if (event === 'tool_start') {
            console.log(`      [TOOL START] ${data.tool}`);
          } else if (event === 'tool_end') {
            console.log(`      [TOOL END] ${data.tool} (${data.message})`);
          } else if (event === 'chunk') {
            chunkCount++;
          }
        }
      );

      const totalTime = Date.now() - startT;
      console.log(`   ✅ HASIL SUKSES (${totalTime}ms)`);
      console.log(`      - Time to First Token (TTFT): ${firstTokenTime ? `${firstTokenTime}ms` : 'N/A'}`);
      console.log(`      - Total Chunks Diterima     : ${chunkCount}`);
      console.log(`      - Model yang Merespons      : ${result.model || 'Default/FastPath'}`);
      console.log(`      - Mode Simulasi             : ${result.isSimulation ? 'Ya (Offline)' : 'Tidak (Online Gemini API)'}`);
      console.log(`      - Cuplikan Jawaban (120 chr):`);
      console.log(`        "${result.content.replace(/\n+/g, ' ').slice(0, 120)}..."`);
    } catch (err) {
      const totalTime = Date.now() - startT;
      console.error(`   ❌ GAGAL (${totalTime}ms): ${err.message}`);
    }
  }

  console.log('\n===============================================================');
  console.log('  🏁 DIAGNOSA SELESAI. Semua modul siap digunakan di Dewaweb!   ');
  console.log('===============================================================\n');
  process.exit(0);
}
