'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  orchestrator.js
//  Fasad utama / entry point untuk modul AI. Mengoordinasikan alur data:
//  - Pemuatan riwayat (MemoryManager)
//  - Pembangunan System Prompt Dinamis (ContextBuilder)
//  - Panggilan AI Gateway dengan SmartSwitch (LLMGateway)
//  - Pembersihan dan penyimpanan kembali riwayat
// ─────────────────────────────────────────────────────────────────────────────

const { getDb, getSettings, getLatestUpload } = require('../../database');
const contextBuilder = require('./contextBuilder');
const memoryManager = require('./memoryManager');
const toolRegistry = require('./toolRegistry');
const llmGateway = require('./llmGateway');
const fastPathHandler = require('./fastPathHandler');
const keyPool = require('./keyPool');

// LOGGER — using Winston to ensure all AI logs are captured in log files
const _winstonLogger = require('../logger');
const log = {
  debug : (...a) => _winstonLogger.debug('[ORCH] ' + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
  info  : (...a) => _winstonLogger.info('[ORCH] '  + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
  warn  : (...a) => _winstonLogger.warn('[ORCH] '  + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
  error : (...a) => _winstonLogger.error('[ORCH] ' + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
};

// ─────────────────────────────────────────────
//  SYSTEM INSTRUCTION COMPOSER (OPTIMIZED FOR SHARED HOSTING)
// ─────────────────────────────────────────────
const { dbSchemaDescription } = require('../dbSchema');

const COMPACT_QUERY_GUIDELINES = `
## Panduan Analisis & Query Khusus (WAJIB DIIKUTI)
- **Kinerja & Rangking Petugas (PCL/PML/Korlap)**:
  - UTAMAKAN tool \`get_petugas\` (role: 'pcl'|'pml'|'korlap', kecamatan: optional) untuk pertanyaan seperti siapa submit terbanyak, target tertinggi, progres terendah, dsb.
  - Jika query manual via \`query_data\`, gunakan tabel \`summary_cache\` (kolom: pcl, submitted_total, approved_total, draft_total, target_fasih_total) ATAU tabel \`progres\` yang di-\`LEFT JOIN subsls_master m ON progres.kode = m.kode\` (karena kolom \`progres.pcl_name\` sering NULL, nama resmi petugas ada di \`m.pcl\`).
- **Ringkasan & Wilayah**: Gunakan tool \`get_summary\` (parameter: kecamatan/desa jika ada) atau query ke \`summary_cache\`.
- **Anomali Lapangan**: Gunakan tool \`get_anomaly\` untuk anomali usaha ganda, tidak dapat ditemui, atau rejeksi PML.
- **Pertanyaan Multi-Kriteria (misal: Anomali + Petugas Tidak Aktif + Potensi Ganda)**:
  - JANGAN menggabungkan seluruh kriteria berbeda dalam satu klausa WHERE AND yang terlalu ketat sehingga menghasilkan 0 baris data.
  - Gunakan tool \`get_anomaly\` atau kueri terpisah untuk setiap indikator.
  - JANGAN PERNAH hanya menjawab "Data tidak ditemukan untuk kriteria pencarian tersebut." Jika salah satu kondisi bernilai 0 (misalnya: tidak ada petugas yang progresnya 0 karena semua 165 PCL aktif bergerak), jelaskan status positif tersebut, lalu tetap sajikan data temuan anomali dan potensi ganda yang ada di sistem secara komprehensif!
- **Rata-rata Penambahan Harian**: Gunakan \`query_data\` menghitung \`SUM(submitted_total + approved_total + rejected_total) / (SELECT COUNT(DISTINCT tanggal) FROM uploads)\` dari \`summary_cache\`.
- **Penambahan Harian Terakhir (Delta Sesi/Hari)**: Gunakan \`query_data\` membandingkan realisasi upload terbaru dengan upload sesi sebelumnya.
- **Detail SLS & Transaksi**: Gunakan \`query_data\` pada tabel \`progres\` JOIN \`subsls_master\` on kode.
`;

const SYSTEM_INSTRUCTION_STATIC = dbSchemaDescription + `

## ATURAN EMAS: FOKUS 100% PADA PERTANYAAN TERKINI (RECENCY FOCUS)
1. **Jawab HANYA Pertanyaan Terakhir**: Tanggapi secara eksklusif pertanyaan yang diajukan pada pesan pengguna saat ini. JANGAN PERNAH menjawab atau mengulang topik pertanyaan dari riwayat sebelumnya kecuali pengguna secara eksplisit meminta ("lanjutkan yang tadi", "bagaimana dengan dia?", dsb).
2. **Kesesuaian Pemanggilan Tool**: Saat memanggil tool/fungsi (\`get_summary\`, \`get_petugas\`, \`get_anomaly\`, \`query_data\`), pastikan parameter dan kueri 100% relevan dengan entitas pertanyaan saat ini.
3. **Hindari Greeting Berulang**: Jika ini adalah giliran tanya-jawab lanjutan, LANGSUNG berikan jawaban data, tabel, dan analisis tanpa kalimat perkenalan diri ulang.
4. **Efisiensi Pemanggilan Tool (1-Turn Fetch & Respond)**: Panggil fungsi/tool yang diperlukan secara tepat dan hemat (cukup 1 kali pemanggilan tool atau maksimal 2 tool terkait). Segera setelah data hasil tool diterima, LANGSUNG rangkum, analisis, dan sajikan jawaban lengkap kepada pengguna. JANGAN PERNAH memanggil tool berulang kali secara berantai tanpa henti.

## Strategi Pengambilan Data — WAJIB DIIKUTI

### PRIORITAS 1: Gunakan get_summary, get_petugas, atau get_anomaly
Kueri ini sudah memiliki data teragregasi super cepat di SQLite cache:
- Progres umum, capaian, dan total wilayah -> \`get_summary\`
- Detail kinerja PML, PCL, atau Korlap -> \`get_petugas\`
- Informasi anomali data lapangan -> \`get_anomaly\`

### PRIORITAS 2: Gunakan query_data
Gunakan SQL SELECT hanya jika data tidak tersedia di agregator ringkas.

${COMPACT_QUERY_GUIDELINES}

## Format Respons & Tampilan — WAJIB DIIKUTI
1. **Gaya Penulisan Formal & Minim Emoticon**: Gunakan Bahasa Indonesia yang formal, lugas, dan profesional (standar analitis resmi BPS). HINDARI PENGGUNAAN EMOTICON/EMOJI yang berlebihan. Jangan gunakan emoji pada judul, subjudul, awal kalimat, maupun bullet point agar laporan bersih, rapi, dan mudah dibaca.
2. **Tabel Teks Chat Maksimal 5 Baris**:
   - Tampilkan **HANYA maksimal 5 baris data terpenting/prioritas utama** pada tabel markdown di teks jawaban chat.
   - PENTING: Jangan menyertakan "LIMIT 5" pada query SQL di tool \`query_data\`. Ambil dataset lengkap (default LIMIT 200) agar pengguna dapat melihat seluruh data di halaman tabel lengkap! Pembatasan 5 baris hanya dilakukan oleh model saat menyusun teks jawaban chat.
   - Jika total data lebih dari 5, cantumkan 5 entitas prioritas dan informasikan bahwa daftar lengkap dapat dibuka melalui tombol Buka Tabel Lengkap.
3. **Penyajian Rekomendasi/Analisis**: Berikan analisis mendalam dan rekomendasi terarah dalam bentuk bullet list dengan cetak tebal pada kata kunci tanpa hiasan emoji.
4. **Ringkasan Singkat**: Berikan pengantar 1-2 kalimat dan akhiri dengan saran solutif.

## Tautan Navigasi Dashboard (Action Links)
Setiap jawaban yang memuat data statistik, petugas, atau wilayah diakhiri dengan bagian tautan navigasi dashboard menggunakan tautan Markdown resmi:

**Tautan Navigasi Dashboard:**
- Jika membahas Petugas PCL / Beban / Kinerja: \`[Lihat Detail Monitoring PCL](/pcl)\`
- Jika membahas Pengawas PML / Verifikasi Dokumen: \`[Lihat Detail Monitoring PML](/pml)\`
- Jika membahas Koordinator Lapangan: \`[Buka Monitoring Korlap](/korlap)\`
- Jika membahas Kecamatan / Desa: \`[Buka Rekap Progres Kecamatan](/kecamatan)\`
- Jika membahas Anomali / Ganda / Dokumen Reject: \`[Buka Deteksi Anomali Lapangan](/deteksi-anomali)\`
- Jika membahas Progres Lambat / Beban Berat / Evaluasi: \`[Buka Daftar Performa Terendah](/performa-terendah)\`
- Jika membahas Peringatan Dini Wilayah: \`[Buka Early Warning System](/early-warning)\`
- Jika membahas Prestasi / Top Kinerja: \`[Buka Leaderboard Petugas](/leaderboard)\`
- Jika membahas Wilayah SLS / SubSLS: \`[Buka Daftar Wilayah SLS & SubSLS](/subsls)\`
- Jika membahas Spasial / Sebaran Peta: \`[Buka Peta Sebaran Wilayah](/map)\`
- Jika membahas Unduh Data / Laporan: \`[Buka Halaman Unduh / Export](/export)\`
- Jika membahas Ringkasan Umum Kabupaten: \`[Buka Ringkasan Beranda](/)\`

Sertakan 2–4 tautan yang PALING RELEVAN dengan konteks pertanyaan dan jawaban di atas.
`;

function buildSystemInstruction(liveCtx = '') {
  return dbSchemaDescription + liveCtx + SYSTEM_INSTRUCTION_STATIC.slice(dbSchemaDescription.length);
}

// ─────────────────────────────────────────────
//  SIMULATION FALLBACK (SIMPLIFIED OFFLINE RUNNER)
// ─────────────────────────────────────────────
function runSimulation(userMessage, chatHistory) {
  const lowerMsg = userMessage.toLowerCase();
  const db = getDb();

  const latestUpload = db.prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 1').get();
  if (!latestUpload) {
    return {
      role: 'model',
      content: `Belum ada data upload di sistem. Silakan masuk ke menu **Upload Data** terlebih dahulu.\n\n**Tautan Navigasi Dashboard:**\n- [Buka Halaman Upload Data](/upload)`,
      isSimulation: true
    };
  }

  const uploadId = latestUpload.id;

  try {
    if (lowerMsg.includes('terendah') || lowerMsg.includes('rendah') || lowerMsg.includes('buruk') || lowerMsg.includes('beban') || lowerMsg.includes('bantu') || lowerMsg.includes('berat')) {
      let filterKec = '', kecLabel = 'Seluruh Wilayah';
      
      if      (lowerMsg.includes('sepaku'))   { filterKec = "AND LOWER(m.kecamatan) = 'sepaku'";  kecLabel = 'Kecamatan Sepaku'; }
      else if (lowerMsg.includes('penajam'))  { filterKec = "AND LOWER(m.kecamatan) = 'penajam'"; kecLabel = 'Kecamatan Penajam'; }
      else if (lowerMsg.includes('babulu'))   { filterKec = "AND LOWER(m.kecamatan) = 'babulu'";  kecLabel = 'Kecamatan Babulu'; }
      else if (lowerMsg.includes('waru'))     { filterKec = "AND LOWER(m.kecamatan) = 'waru'";    kecLabel = 'Kecamatan Waru'; }

      let filterKorlap = '';
      if (lowerMsg.includes('korlap')) {
        const korlapMatch = lowerMsg.match(/korlap\s+(\w+)/);
        if (korlapMatch && korlapMatch[1]) {
          filterKorlap = `AND LOWER(m.korlap) = '${korlapMatch[1].toLowerCase()}'`;
          kecLabel += ` (Korlap: ${korlapMatch[1]})`;
        }
      }

      const isHeavy = lowerMsg.includes('beban') || lowerMsg.includes('berat');
      const orderBy = isHeavy
        ? 'SUM(m.target_fasih) DESC, muatan_selesai ASC'
        : 'muatan_selesai ASC, total_muatan DESC';

      const rows = db.prepare(`
        SELECT m.pcl, MAX(m.pml) AS pml, MAX(m.kecamatan) AS kecamatan,
          SUM(m.muatan) AS total_muatan,
          SUM(m.target_fasih) AS target_fasih_total,
          SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) AS muatan_selesai,
          SUM(COALESCE(p.submitted_by_pcl,0)+COALESCE(p.approved,0)+COALESCE(p.rejected,0)) AS realisasi_fasih
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${filterKec} ${filterKorlap}
        GROUP BY m.pcl ORDER BY ${orderBy} LIMIT 5
      `).all(uploadId);

      if (rows.length === 0) {
        return {
          role: 'model',
          content: `Tidak ditemukan data petugas sensus untuk **${kecLabel}** pada data upload terbaru.\n\n**Tautan Navigasi Dashboard:**\n- [Lihat Detail Monitoring PCL](/pcl)\n- [Buka Rekap Progres Kecamatan](/kecamatan)`,
          isSimulation: true
        };
      }

      let content = `Berikut daftar 5 PCL ${isHeavy ? 'dengan beban target tertinggi yang memerlukan pendampingan' : 'dengan progres terendah'} untuk **${kecLabel}** (upload *${latestUpload.tanggal}*):\n\n`;
      content += `| Nama PCL | PML Pengawas | Kecamatan | Target FASIH | Realisasi | Capaian (%) |\n| :--- | :--- | :--- | :---: | :---: | :---: |\n`;
      rows.forEach(r => {
        const pct = r.target_fasih_total > 0 ? ((r.realisasi_fasih / r.target_fasih_total) * 100).toFixed(2) : (r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00');
        content += `| **${r.pcl}** | ${r.pml} | ${r.kecamatan} | ${r.target_fasih_total || r.total_muatan} | ${r.realisasi_fasih || r.muatan_selesai} | **${pct}%** |\n`;
      });
      content += `\n**Rekomendasi:** Prioritaskan pendampingan lapangan langsung oleh PML terhadap **${rows[0].pcl}** untuk menyelesaikan target SLS yang tersisa.\n\n**Tautan Navigasi Dashboard:**\n- [Lihat Detail Monitoring PCL](/pcl)\n- [Buka Daftar Performa Terendah](/performa-terendah)\n- [Lihat Detail Monitoring PML](/pml)\n`;
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('terbaik') || lowerMsg.includes('leaderboard')) {
      const rows = db.prepare(`
        SELECT m.pcl, MAX(m.pml) AS pml, MAX(m.kecamatan) AS kecamatan,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        GROUP BY m.pcl ORDER BY muatan_selesai DESC LIMIT 5
      `).all(uploadId);

      let content = `Berikut Top 5 PCL dengan Realisasi Tertinggi:\n\n`;
      content += `| No | PCL | PML | Kecamatan | Realisasi | Progres |\n| :---: | :--- | :--- | :--- | :--- | :--- |\n`;
      rows.forEach((r, i) => {
        const pct = r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${i+1} | ${r.pcl} | ${r.pml} | ${r.kecamatan} | ${r.muatan_selesai}/${r.total_muatan} | **${pct}%** |\n`;
      });
      content += `\n**Tautan Navigasi Dashboard:**\n- [Buka Leaderboard Petugas](/leaderboard)\n- [Lihat Detail Monitoring PCL](/pcl)\n`;
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('rerata') || lowerMsg.includes('rata-rata') || lowerMsg.includes('progres') || lowerMsg.includes('capaian')) {
      const totalSls       = db.prepare('SELECT COUNT(*) as n FROM subsls_master').get().n;
      const muatanTotal    = db.prepare('SELECT SUM(muatan) as n FROM subsls_master').get().n || 0;
      const muatanSelesai  = db.prepare(`SELECT SUM(COALESCE(p.usaha_ditemukan,0)+COALESCE(p.usaha_baru,0)+COALESCE(p.ditemukan,0)+COALESCE(p.keluarga_baru,0)) as n FROM progres p WHERE p.upload_id = ?`).get(uploadId).n || 0;
      const totalDone      = db.prepare(`SELECT COUNT(DISTINCT p.kode) as n FROM progres p JOIN subsls_master m ON p.kode=m.kode WHERE p.upload_id=? AND COALESCE(m.target_fasih,0)>0 AND (COALESCE(p.submitted_by_pcl,0)+COALESCE(p.approved,0)+COALESCE(p.rejected,0))>=m.target_fasih`).get(uploadId).n;
      const kecs = db.prepare(`
        SELECT m.kecamatan, COUNT(m.kode) AS total_subsls,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) AS muatan_selesai
        FROM subsls_master m LEFT JOIN progres p ON m.kode=p.kode AND p.upload_id=?
        GROUP BY m.kecamatan
      `).all(uploadId);

      const slsPct    = totalSls    > 0 ? ((totalDone    / totalSls)    * 100).toFixed(2) : '0.00';
      const muatanPct = muatanTotal > 0 ? ((muatanSelesai / muatanTotal) * 100).toFixed(2) : '0.00';

      let content = `Ringkasan Progres Lapangan:\n\n`;
      content += `- **Total SLS:** ${totalSls.toLocaleString('id-ID')} | Selesai: **${totalDone.toLocaleString('id-ID')} (${slsPct}%)**\n`;
      content += `- **Total Muatan:** ${muatanTotal.toLocaleString('id-ID')} | Realisasi: **${muatanSelesai.toLocaleString('id-ID')} (${muatanPct}%)**\n\n`;
      content += `### Capaian per Kecamatan:\n\n| Kecamatan | SLS | Target Muatan | Realisasi | % |\n| :--- | :---: | :---: | :---: | :---: |\n`;
      kecs.forEach(k => {
        const p = k.total_muatan > 0 ? ((k.muatan_selesai / k.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${k.kecamatan} | ${k.total_subsls} | ${k.total_muatan} | ${k.muatan_selesai} | **${p}%** |\n`;
      });
      content += `\n**Tautan Navigasi Dashboard:**\n- [Buka Rekap Progres Kecamatan](/kecamatan)\n- [Buka Ringkasan Beranda](/)\n`;
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('anomali') || lowerMsg.includes('ganda')) {
      const ganda  = db.prepare('SELECT SUM(usaha_ganda) as n FROM progres WHERE upload_id=?').get(uploadId).n || 0;
      const noMeet = db.prepare('SELECT SUM(tidak_dapat_ditemui) as n FROM progres WHERE upload_id=?').get(uploadId).n || 0;
      const reject = db.prepare('SELECT SUM(rejected) as n FROM progres WHERE upload_id=?').get(uploadId).n || 0;
      const top    = db.prepare(`
        SELECT m.pcl, m.pml, SUM(COALESCE(p.usaha_ganda,0)) AS ganda, SUM(COALESCE(p.rejected,0)) AS reject
        FROM subsls_master m JOIN progres p ON m.kode=p.kode AND p.upload_id=?
        GROUP BY m.pcl HAVING ganda>0 OR reject>0 ORDER BY (ganda+reject) DESC LIMIT 3
      `).all(uploadId);

      let content = `Rekap Temuan Anomali Data Lapangan:\n\n1. **Usaha Ganda:** **${ganda} kasus**\n2. **Tidak dapat ditemui:** **${noMeet} kasus**\n3. **Dokumen ditolak (Rejected):** **${reject} dokumen**\n\n`;
      if (top.length > 0) {
        content += `| PCL | PML | Ganda | Rejected |\n| :--- | :--- | :---: | :---: |\n`;
        top.forEach(r => content += `| ${r.pcl} | ${r.pml} | ${r.ganda} | ${r.reject} |\n`);
      }
      content += `\n**Tautan Navigasi Dashboard:**\n- [Buka Deteksi Anomali Lapangan](/deteksi-anomali)\n- [Buka Early Warning System](/early-warning)\n- [Lihat Detail Monitoring PML](/pml)\n`;
      return { role: 'model', content, isSimulation: true };
    }

    return {
      role: 'model',
      content: `Pencarian data dapat menggunakan kata kunci: **progres**, **terendah**, **terbaik**, atau **anomali**.\n\n**Tautan Navigasi Dashboard:**\n- [Buka Rekap Progres Kecamatan](/kecamatan)\n- [Lihat Detail Monitoring PCL](/pcl)\n- [Buka Ringkasan Beranda](/)\n\n*Konfigurasikan API Key untuk pertanyaan bebas.*`,
      isSimulation: true
    };
  } catch (err) {
    log.error('runSimulation DB error:', err.message);
    return { role: 'model', content: `Terjadi kendala saat membaca basis data: ${err.message}`, isSimulation: true };
  }
}

async function streamSimulation(userMessage, chatHistory, onEvent, abortSignal) {
  onEvent('status', { text: 'Menghubungkan ke basis data lokal...', step: 'simulation_query' });
  await new Promise(r => setTimeout(r, 150));

  const simResult = runSimulation(userMessage, chatHistory);
  const text = simResult.content || '';

  onEvent('status', { text: 'Merumuskan jawaban...', step: 'streaming' });

  const words = text.split(/(\s+)/);
  let batch = '';
  for (let i = 0; i < words.length; i++) {
    if (abortSignal?.aborted) break;
    batch += words[i];
    if (batch.length >= 10 || i === words.length - 1) {
      onEvent('chunk', { text: batch });
      batch = '';
      await new Promise(r => setTimeout(r, 20));
    }
  }

  return { role: 'model', content: text, isSimulation: true };
}

// ─────────────────────────────────────────────
//  FACADE FUNCTIONS: BACA/TULIS MEMORY & API CALL
// ─────────────────────────────────────────────
async function sendMessageToAgent(userMessage, chatHistory = [], options = {}, userId = null) {
  // 0. FAST-PATH: Tangani prompt generik (sapaan, testing, ucapan terima kasih) secara instan (0ms latency, hemat kuota)
  const fastPathText = fastPathHandler.getFastPathResponse(userMessage);
  if (fastPathText) {
    const result = { role: 'model', content: fastPathText, isSimulation: false, isFastPath: true };
    if (userId) {
      const saved = memoryManager.getChatHistory(userId);
      const merged = (saved.length > 0 && chatHistory.length === 0) ? saved : chatHistory;
      const updatedHistory = [...merged, { role: 'user', content: userMessage }, { role: 'model', content: fastPathText }];
      memoryManager.saveChatHistory(userId, updatedHistory);
    }
    return result;
  }

  const settings = getSettings();
  const liveCtx = contextBuilder.buildLiveContext('se2026');
  const dynInstruction = buildSystemInstruction(liveCtx);
  const initialSelection = llmGateway.resolveAgentSelection(settings, options);

  // Jika riwayat di database ada dan user id dikirim, sinkronkan
  let mergedHistory = chatHistory;
  if (userId) {
    const saved = memoryManager.getChatHistory(userId);
    if (saved.length > 0 && chatHistory.length === 0) {
      mergedHistory = saved;
    }
  }

  const tries = [{ provider: 'gemini', model: initialSelection.model }];

  if (settings.chatbot_smart_switch !== '0') {
    const listStr = settings.gemini_models_list || 'gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-3.7-flash, gemini-3.1-flash-lite, gemini-2.5-flash';
    for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
      if (tries.length >= 3) break; // Maksimal 3 kandidat model untuk menjaga responsivitas server
      tries.push({ provider: 'gemini', model: m });
    }
  }

  const uniqueTries = [];
  const seen = new Set();
  for (const t of tries) {
    const key = `${t.provider}:${t.model}`;
    if (!seen.has(key)) { seen.add(key); uniqueTries.push(t); }
  }

  let lastError = null;
  let finalResult = null;

  for (let i = 0; i < uniqueTries.length; i++) {
    const current = uniqueTries[i];
    const rawKeys = keyPool.getOrderedEligibleKeys(settings, current.model);
    const keysToTry = rawKeys.slice(0, 2); // Coba maksimal 2 key terbaik per model
    if (keysToTry.length === 0) continue;

    log.info(`[ORCH] Mencoba Model '${current.model}' dengan ${keysToTry.length} API Key tersedia...`);

    let success = false;
    for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
      const kItem = keysToTry[kIdx];
      llmGateway.abortAllActive();
      const serverController = llmGateway.registerActiveRequest('gemini');

      log.info(`[ORCH] -> Menjalankan ${kItem.label} (${keyPool.maskKey(kItem.key)}) pada model '${current.model}'...`);

      try {
        finalResult = await llmGateway.sendMessageToGemini(
          userMessage, mergedHistory, settings, current.model, serverController.signal, kItem.key, dynInstruction
        );
        keyPool.markSuccess(kItem.key);
        log.info(`[ORCH] -> Sukses dengan ${kItem.label} pada model '${current.model}'`);
        success = true;
        break;
      } catch (err) {
        lastError = err;
        const errMsg = err.message || '';
        log.warn(`[ORCH] -> Gagal pada ${kItem.label} (${current.model}): ${errMsg}. Mengutamakan rotasi ke API Key berikutnya...`);
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
          keyPool.markRateLimited(kItem.key, 120, errMsg, current.model);
        } else if (errMsg.includes('403') || errMsg.toLowerCase().includes('leaked') || errMsg.toLowerCase().includes('api_key_invalid') || errMsg.toLowerCase().includes('api key not valid')) {
          keyPool.markInvalid(kItem.key, errMsg);
        } else if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('timed out') || errMsg.includes('timeout')) {
          keyPool.markRateLimited(kItem.key, 15, errMsg, current.model);
        }
      } finally {
        llmGateway.clearActiveRequest('gemini');
      }
    }
    if (success) break;
  }

  if (!finalResult) {
    log.warn('Fallback to local simulation.');
    finalResult = runSimulation(userMessage, mergedHistory);
    const rawErr = lastError ? lastError.message : 'API key tidak terkonfigurasi';
    finalResult.content = `⚠️ **AI Provider Error:** ${rawErr}\n\n*Fallback ke simulasi lokal:*\n\n` + finalResult.content;
  }

  // Simpan riwayat chat ke SQLite jika user_id dikirim
  if (userId && finalResult) {
    const updatedHistory = [...mergedHistory, { role: 'user', content: userMessage }, { role: 'model', content: finalResult.content }];
    memoryManager.saveChatHistory(userId, updatedHistory);
  }

  return finalResult;
}

async function streamMessageToAgent(userMessage, chatHistory = [], options = {}, onEvent = () => {}, abortSignal = null, userId = null) {
  // 0. FAST-PATH: Tangani prompt generik secara instan dengan respons secepat kilat (0ms TTFT)
  const fastPathText = fastPathHandler.getFastPathResponse(userMessage);
  if (fastPathText) {
    onEvent('status', { text: 'Menghubungkan ke Pananyo Taka AI...', step: 'model_call' });
    const words = fastPathText.split(' ');
    for (let i = 0; i < words.length; i += 4) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
      const chunkText = words.slice(i, i + 4).join(' ') + (i + 4 < words.length ? ' ' : '');
      onEvent('chunk', { text: chunkText });
      await new Promise(r => setTimeout(r, 12));
    }
    const result = { role: 'model', content: fastPathText, isSimulation: false, isFastPath: true };
    if (userId) {
      const saved = memoryManager.getChatHistory(userId);
      const merged = (saved.length > 0 && chatHistory.length === 0) ? saved : chatHistory;
      const updatedHistory = [...merged, { role: 'user', content: userMessage }, { role: 'model', content: fastPathText }];
      memoryManager.saveChatHistory(userId, updatedHistory);
    }
    return result;
  }

  const settings = getSettings();
  const liveCtx = contextBuilder.buildLiveContext('se2026');
  const dynInstruction = buildSystemInstruction(liveCtx);
  const initialSelection = llmGateway.resolveAgentSelection(settings, options);

  let mergedHistory = chatHistory;
  if (userId) {
    const saved = memoryManager.getChatHistory(userId);
    if (saved.length > 0 && chatHistory.length === 0) {
      mergedHistory = saved;
    }
  }

  const tries = [{ provider: 'gemini', model: initialSelection.model }];

  if (settings.chatbot_smart_switch !== '0') {
    const listStr = settings.gemini_models_list || 'gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-3.7-flash, gemini-3.1-flash-lite, gemini-2.5-flash';
    for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
      if (tries.length >= 3) break; // Maksimal 3 kandidat model untuk streaming
      tries.push({ provider: 'gemini', model: m });
    }
  }

  const uniqueTries = [];

  const seen = new Set();
  for (const t of tries) {
    const key = `${t.provider}:${t.model}`;
    if (!seen.has(key)) { seen.add(key); uniqueTries.push(t); }
  }

  let lastError = null;
  let finalResult = null;

  for (let i = 0; i < uniqueTries.length; i++) {
    if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
    const current = uniqueTries[i];

    if (i > 0) {
      onEvent('status', { text: `Mengalihkan ke model cadangan (${current.model})...`, step: 'smart_switch' });
    }

    const rawKeys = keyPool.getOrderedEligibleKeys(settings, current.model);
    const keysToTry = rawKeys.slice(0, 2); // Coba maksimal 2 key terbaik per model
    if (keysToTry.length === 0) continue;

    log.info(`[ORCH:STREAM] Mencoba Model '${current.model}' dengan ${keysToTry.length} API Key...`);

    let success = false;
    for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
      const kItem = keysToTry[kIdx];
      if (kIdx > 0) {
        onEvent('status', {
          text: `Mengalihkan ke API Key ${kItem.label}...`,
          step: 'key_switch'
        });
      }
      log.info(`[ORCH:STREAM] -> Menjalankan ${kItem.label} (${keyPool.maskKey(kItem.key)}) pada model '${current.model}'...`);
      try {
        finalResult = await llmGateway.streamMessageToGemini(
          userMessage, mergedHistory, settings, current.model, abortSignal, kItem.key, onEvent, dynInstruction
        );
        keyPool.markSuccess(kItem.key);
        onEvent('done', { 
          reply: finalResult.content, 
          isSimulation: false, 
          role: 'model', 
          model: current.model,
          queryId: finalResult.queryId || null,
          rowCount: finalResult.rowCount || null
        });
        log.info(`[ORCH:STREAM] -> Sukses dengan ${kItem.label} pada model '${current.model}'`);
        success = true;
        break;
      } catch (err) {
        lastError = err;
        const errMsg = err.message || '';
        log.warn(`[ORCH:STREAM] -> Gagal pada ${kItem.label} (${current.model}): ${errMsg}. Mengutamakan rotasi ke API Key berikutnya...`);
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
          keyPool.markRateLimited(kItem.key, 120, errMsg, current.model);
        } else if (errMsg.includes('403') || errMsg.toLowerCase().includes('leaked') || errMsg.toLowerCase().includes('api_key_invalid') || errMsg.toLowerCase().includes('api key not valid')) {
          keyPool.markInvalid(kItem.key, errMsg);
        } else if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('timed out') || errMsg.includes('timeout')) {
          keyPool.markRateLimited(kItem.key, 15, errMsg, current.model);
        }
      }
    }
    if (success) break;
  }

  if (!finalResult) {
    finalResult = await streamSimulation(userMessage, mergedHistory, onEvent, abortSignal);
    let rawErr = lastError ? lastError.message : 'API key tidak terkonfigurasi';
    let friendlyErr = rawErr;
    if (rawErr.includes('429') || rawErr.includes('quota') || rawErr.toLowerCase().includes('rate limit')) {
      friendlyErr = 'Kuota permintaan harian API Gemini habis (429 Too Many Requests). Coba lagi besok atau gunakan API Key lain.';
    } else if (rawErr.includes('403') || rawErr.includes('leaked')) {
      friendlyErr = 'API Key Gemini tidak valid atau telah dicabut (403 Forbidden).';
    } else if (rawErr.includes('503') || rawErr.includes('Service Unavailable')) {
      friendlyErr = 'Server Gemini sedang kelebihan beban (503). Coba lagi nanti.';
    }

    finalResult.content = `⚠️ **AI Provider Error:** ${friendlyErr}\n\n*Fallback ke simulasi lokal:*\n\n` + finalResult.content;
    onEvent('done', { reply: finalResult.content, isSimulation: true, role: 'model' });
  }

  if (userId && finalResult) {
    const updatedHistory = [...mergedHistory, { role: 'user', content: userMessage }, { role: 'model', content: finalResult.content }];
    memoryManager.saveChatHistory(userId, updatedHistory);
  }

  return finalResult;
}

module.exports = {
  sendMessageToAgent,
  streamMessageToAgent,
  fetchPageData: toolRegistry.fetchPageDataCompat
};
