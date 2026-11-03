#!/usr/bin/env node
/**
 * scripts/cron_daily_sync.js
 * Script sinkronisasi harian otomatis untuk dijalankan via cPanel Cron Job atau terminal
 * Jadwal Rekomendasi: 0 6 * * * (Setiap hari pukul 06:00 WITA / WIB)
 */
require('dotenv').config();
const fasihSyncService = require('../services/fasihSyncService');

async function run() {
  const start = Date.now();
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' });
  console.log(`[${timestamp} WITA] [CRON-DAILY] Memulai sinkronisasi harian seluruh kegiatan survei...`);

  try {
    const result = await fasihSyncService.syncAllSurveysProgress({
      forceRefresh: true,
      skipIfUnchanged: false
    });

    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[CRON-DAILY] ✅ Selesai dalam ${elapsedSec}s | Berhasil: ${result.synced || 0} | Lewat: ${result.skipped || 0} | Gagal: ${result.failed || 0}`);
    process.exit(0);
  } catch (err) {
    console.error(`[CRON-DAILY] ❌ FATAL ERROR: ${err.message}`);
    process.exit(1);
  }
}

run();
