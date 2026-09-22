const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fasihSyncService = require('../services/fasihSyncService');

async function main() {
  console.log('====================================================');
  console.log('⚡ FASIH-SM Automated Cloud Sync Runner');
  console.log(`Waktu Eksekusi: ${new Date().toLocaleString('id-ID')}`);
  console.log('====================================================');

  try {
    const conn = await fasihSyncService.checkConnection();
    if (!conn.ok) {
      console.error(`❌ Koneksi ke FASIH API gagal: ${conn.error}`);
      process.exit(1);
    }
    console.log(`✅ Server Cloud Online (Latensi: ${conn.latencyMs} ms)`);

    const result = await fasihSyncService.syncFromFasih({
      surveyId: 'se2026',
      skipIfUnchanged: true,
      triggerWa: process.env.FASIH_AUTO_SYNC_WA === 'true'
    });

    if (result.skipped) {
      console.log(`ℹ️ Data untuk tanggal ${result.date} sudah mutakhir.`);
      console.log('Tidak ada rekaman baru yang perlu ditambahkan (status deduplikasi).');
    } else {
      console.log(`🎉 Berhasil menyinkronkan data baru!`);
      console.log(`- Upload ID: #${result.uploadId}`);
      console.log(`- Tanggal Data: ${result.date}`);
      console.log(`- Total SLS Disinkronkan: ${result.totalSls} SLS`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Terjadi kesalahan saat sinkronisasi:', err.message);
    process.exit(1);
  }
}

main();
