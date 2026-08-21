'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  fastPathHandler.js
//  Penanganan instan untuk prompt generik (sapaan, testing, terima kasih, bantuan)
//  Menghemat waktu, token API, kuota, dan memberikan respons seketika (0ms TTFT).
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_KEYWORDS = [
  'progres', 'progress', 'sls', 'subsls', 'fasih', 'muatan', 'usaha', 'keluarga',
  'petugas', 'pcl', 'pml', 'korlap', 'kecamatan', 'desa', 'kelurahan',
  'penajam', 'waru', 'babulu', 'sepaku', 'anomali', 'stagnan', 'target',
  'dokumen', 'draft', 'submit', 'submitted', 'approve', 'approved', 'reject',
  'rejected', 'harian', 'laju', 'kecepatan', 'cuaca', 'selesai', 'belum',
  'tertinggi', 'terendah', 'terbanyak', 'tercepat', 'peringkat', 'ranking',
  'sisa', 'beban', 'kode', 'nama', 'binaan', 'rekap', 'tabel', 'grafik'
];

/**
 * Memeriksa apakah pesan pengguna adalah prompt generik (sapaan, cek koneksi, dll)
 * @param {string} userMessage 
 * @returns {string|null} Teks respons instan jika cocok, atau null jika perlu diteruskan ke AI.
 */
function getFastPathResponse(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;

  const raw = userMessage.trim();
  // Normalisasi: lowercase, hapus tanda baca umum di awal/akhir
  const clean = raw
    .toLowerCase()
    .replace(/^[!?.,:;\s\-_#]+|[!?.,:;\s\-_#]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return null;

  // Jika mengandung kata kunci domain sensus/survei, JANGAN bypass ke fast-path
  const words = clean.split(' ');
  const hasDomainKeyword = words.some(w => DOMAIN_KEYWORDS.includes(w));
  if (hasDomainKeyword) return null;

  // 1. Sapaan & Salam (Greetings)
  const GREETING_EXACT = [
    'halo', 'hai', 'helo', 'hello', 'hi', 'hei', 'hey', 'p', 'ping',
    'halo bot', 'halo min', 'halo ai', 'halo pananyo', 'halo admin',
    'hai bot', 'hai ai', 'hai pananyo', 'hi bot', 'hi ai',
    'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
    'assalamualaikum', "assalamu'alaikum", 'assalamu alaikum',
    'sampurasun', 'kulonuwun', 'permisi', 'pagi', 'siang', 'sore', 'malam'
  ];

  const TEST_EXACT = [
    'tes', 'test', 'testing', 'cek', 'tes 123', 'test 123', 'tes123', 'test123',
    '123', '1 2 3', 'cek mic', 'cek tes', 'halo tes', 'tes bot', 'test bot',
    'cek sistem', 'tes doang', 'hanya tes', 'coba'
  ];

  const THANKS_EXACT = [
    'terima kasih', 'terimakasih', 'makasih', 'makasi', 'matur nuwun', 'suksema',
    'thanks', 'thank you', 'tq', 'thx', 'ty',
    'mantap', 'siip', 'sip', 'oke', 'ok', 'keren', 'bagus', 'siap', 'siap makasih',
    'good', 'good job', 'nice', 'oke terima kasih', 'ok makasih', 'sip makasih'
  ];

  const HELP_EXACT = [
    'siapa kamu', 'kamu siapa', 'siapakah kamu', 'apa itu pananyo taka',
    'kamu bisa apa', 'bisa apa', 'bisa apa saja', 'kamu bisa apa saja', 'fitur apa saja',
    'help', 'bantuan', 'menu', 'panduan', 'cara pakai', 'fungsi bot', 'fitur'
  ];

  const isGreeting = GREETING_EXACT.includes(clean) || 
    /^(halo|hai|helo|hi|hei|hey|p|ping|pagi|siang|sore|malam|assalamu'?alaikum)\b/.test(clean) && clean.split(' ').length <= 4;


  if (isGreeting) {
    return `Halo! 👋 Saya **Pananyo Taka AI**, asisten cerdas pemantauan sensus dan survei BPS Kabupaten Penajam Paser Utara.

Ada yang bisa saya bantu terkait progres data lapangan, evaluasi petugas, atau analisis wilayah?

💡 **Contoh pertanyaan yang bisa Anda ajukan:**
* 📊 *"Bagaimana ringkasan progres sensus di Kabupaten PPU saat ini?"*
* 👥 *"Siapa petugas dengan rata-rata penambahan harian terbanyak?"*
* 🏆 *"Kecamatan mana yang memiliki persentase capaian FASIH tertinggi?"*
* ⚠️ *"Apakah ada petugas yang stagnan pada upload data terbaru?"*`;
  }

  // 2. Health-Check / Test / Ping
  const isTest = TEST_EXACT.includes(clean) ||
    /^(tes|test|testing|cek|ping|123)\b/.test(clean) && clean.split(' ').length <= 4;

  if (isTest) {
    return `✅ **Sistem Aktif & Terhubung!**

Layanan **Pananyo Taka AI** dan basis data pemantauan Kabupaten Penajam Paser Utara berjalan dengan normal dan siap melayani Anda.

Silakan ketik pertanyaan Anda seputar progres sensus/survei, kinerja petugas, atau analisis data wilayah.`;
  }

  // 3. Ucapan Terima Kasih & Konfirmasi (Gratitude / Acknowledgment)
  const isThanks = THANKS_EXACT.includes(clean) ||
    /^(terima\s*kasih|makasih|makasi|thanks|thank\s*you|mantap|siip|sip|oke|ok)\b/.test(clean) && clean.split(' ').length <= 4;

  if (isThanks) {
    return `Sama-sama! Senang bisa membantu Anda. 🙏

Jika masih ada data, peringkat petugas, atau analisis wilayah lain yang ingin diperiksa, silakan tanyakan kapan saja!`;
  }

  // 4. Identitas, Kemampuan & Bantuan (Identity / Capabilities / Help)
  const isHelp = HELP_EXACT.includes(clean) ||
    clean.includes('bisa apa') || clean.includes('siapa kamu') || clean.includes('kamu siapa') ||
    clean.includes('apa fungsi') || clean.includes('apa fitur') || clean === 'help' || clean === 'bantuan';

  if (isHelp) {
    return `Saya adalah **Pananyo Taka AI**, asisten pemantauan data sensus dan survei resmi BPS Kabupaten Penajam Paser Utara.

### 🚀 Kemampuan Utama Saya:
1. 📊 **Ringkasan Agregat Wilayah**: Menampilkan capaian FASIH & Muatan se-Kabupaten, per Kecamatan, per Desa, hingga detail SubSLS.
2. 👥 **Kinerja Petugas (PCL/PML/Korlap)**: Peringkat capaian, analisis laju penambahan harian ($$\\text{Realisasi}/\\text{Hari}$$), beban kerja, dan estimasi waktu penyelesaian.
3. ⚠️ **Deteksi Anomali & Early Warning**: Mendeteksi usaha ganda, tingkat keluarga/usaha tidak ditemukan, kematian tinggi, serta petugas stagnan.
4. 🌦️ **Tren Waktu & Korelasi Cuaca**: Menganalisis pergerakan status dokumen harian serta pengaruh kondisi cuaca lapangan.
5. 🔎 **Pencarian Spesifik**: Pencarian instan data berdasarkan 16-digit kode SLS atau nama petugas.

Ketik pertanyaan Anda secara bebas, dan saya akan langsung menganalisis datanya untuk Anda!`;
  }


  return null;
}

module.exports = {
  getFastPathResponse
};
