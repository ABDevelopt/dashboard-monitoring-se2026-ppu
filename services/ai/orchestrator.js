'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  orchestrator.js
//  Fasad utama / entry point untuk modul AI. Mengoordinasikan alur data:
//  - Pemuatan riwayat (MemoryManager)
//  - Pembangunan System Prompt Dinamis (ContextBuilder)
//  - Panggilan AI Gateway dengan SmartSwitch (LLMGateway)
//  - Pembersihan dan penyimpanan kembali riwayat
// ─────────────────────────────────────────────────────────────────────────────

const { getDb, getSettings, getLatestUpload, getOverviewSummary, getKecamatanStats, updateAgentQueryAnalysis } = require('../../database');
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

### ATURAN MUTLAK: Penanganan Negasi & Pengecualian (Exclusion Rules)
Jika pertanyaan pengguna memuat kata negasi/pengecualian seperti:
- "selain ...", "bukan ...", "kecuali ...", "di luar ...", "tanpa ...", "tidak termasuk ...", "non-...", "minus ..."

Maka entitas tersebut WAJIB dijadikan filter PENGEQUALIAN (NOT LIKE / NOT IN / !=), JANGAN PERNAH dijadikan filter inklusif (LIKE / IN / =)!

1. **Pengecualian Wilayah / Kecamatan / Desa / SLS**:
   - "selain kecamatan Sepaku" -> \`WHERE LOWER(m.kecamatan) NOT LIKE '%sepaku%'\` (atau \`NOT IN ('Sepaku')\`)
   - "bukan di Penajam dan Babulu" -> \`WHERE LOWER(m.kecamatan) NOT IN ('penajam', 'babulu')\`
   - "di luar desa Girimukti" -> \`WHERE LOWER(m.desa) NOT LIKE '%girimukti%'\`
   - "selain SLS KIPP" / "non-KIPP" -> \`WHERE m.nama_sls NOT LIKE '%KIPP%' AND m.pcl NOT IN (SELECT DISTINCT pcl FROM subsls_master WHERE nama_sls = 'KIPP IKN' AND pcl IS NOT NULL AND pcl != '')\`
2. **Pengecualian Petugas (PCL / PML / Korlap)**:
   - "petugas terbaik selain [Nama PCL]" -> \`WHERE LOWER(m.pcl) NOT LIKE '%[nama]%'\`
   - "kinerja PML di luar [Nama PML]" -> \`WHERE LOWER(m.pml) NOT LIKE '%[nama]%'\`
   - "rekap selain tim Korlap [Nama Korlap]" -> \`WHERE LOWER(m.korlap) NOT LIKE '%[nama]%'\`
3. **Pengecualian Status / Nilai Data**:
   - "dokumen selain approved" -> \`WHERE COALESCE(p.approved, 0) = 0\` atau fokus pada \`p.submitted_by_pcl + p.draft + p.rejected\`
   - "petugas dengan progres bukan 0 (selain yang 0)" -> \`HAVING realisasi > 0\`
   - "data tanpa anomali / non-anomali" -> \`WHERE COALESCE(p.usaha_ganda,0) = 0 AND COALESCE(p.rejected,0) = 0\`

### ATURAN MUTLAK: Pemisahan Data FASIH vs MUATAN
1. **Pertanyaan FASIH / Assignment FASIH / Dokumen FASIH / Progres 100% FASIH**:
   - Jika pertanyaan menyebut "FASIH", "assignment", "dokumen", "progres assignment", atau "selesai 100%":
     - Kolom Target: \`m.target_fasih\` / \`SUM(m.target_fasih)\` (atau \`target_fasih_total\` di \`summary_cache\`).
     - Kolom Realisasi: \`SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0))\` (atau \`submitted_total + approved_total + rejected_total\`).
     - Persentase Capaian (%): \`ROUND(CAST(SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS FLOAT) / NULLIF(SUM(m.target_fasih), 0) * 100, 2)\`.
     - Kriteria Selesai 100%: \`HAVING SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) >= SUM(m.target_fasih)\`.
     - **DILARANG KERAS MENGGUNAKAN KOLOM MUATAN / TOTAL_MUATAN / MUATAN_SELESAI / USAHA_DITEMUKAN** ketika pertanyaan menanyakan FASIH / Dokumen / Assignment!
2. **Pertanyaan MUATAN / Beban Muatan / Usaha / Keluarga (KHUSUS SENSUS EKONOMI 2026)**:
   - Fitur Muatan, Target Muatan, dan Beban Usaha/Keluarga HANYA berlaku pada kegiatan Sensus Ekonomi 2026. Untuk kegiatan survei lain (seperti Sakernas), konsep muatan/usaha TIDAK ADA, seluruh metrik murni adalah Assignment Dokumen FASIH.
   - Kolom Target: \`m.muatan\` / \`SUM(m.muatan)\` (atau \`total_muatan\` di \`summary_cache\`).
   - Kolom Realisasi: \`SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0) + COALESCE(p.ditemukan+p.keluarga_baru,0))\` (atau \`muatan_selesai\` di \`summary_cache\`).

- **Query Petugas Selesai 100% Progres FASIH (Termasuk / Selain KIPP)**:
  - Gunakan query berikut:
    \`\`\`sql
    SELECT 
      m.pcl AS "Nama Petugas",
      MAX(m.kecamatan) AS "Kecamatan",
      SUM(m.target_fasih) AS "Target FASIH",
      SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS "Realisasi Dokumen",
      ROUND(CAST(SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS FLOAT) / NULLIF(SUM(m.target_fasih), 0) * 100, 2) AS "Persentase FASIH (%)"
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = (SELECT id FROM uploads ORDER BY id DESC LIMIT 1)
    WHERE m.pcl IS NOT NULL AND m.pcl != ''
      [AND m.nama_sls NOT LIKE '%KIPP%' AND m.pcl NOT IN (SELECT DISTINCT pcl FROM subsls_master WHERE nama_sls LIKE '%KIPP%' AND pcl IS NOT NULL AND pcl != '')]
    GROUP BY m.pcl
    HAVING SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) >= SUM(m.target_fasih)
    ORDER BY "Persentase FASIH (%)" DESC
    \`\`\`
- **Kinerja & Rangking Petugas (PCL/PML/Korlap)**:
  - UTAMAKAN tool \`get_petugas\` (role: 'pcl'|'pml'|'korlap', kecamatan: optional) untuk pertanyaan seperti siapa submit terbanyak, target tertinggi, progres terendah, dsb.
  - Jika query manual via \`query_data\`, gunakan tabel \`summary_cache\` (kolom: pcl, submitted_total, approved_total, draft_total, target_fasih_total) ATAU tabel \`progres\` yang di-\`LEFT JOIN subsls_master m ON progres.kode = m.kode\` (karena kolom \`progres.pcl_name\` sering NULL, nama resmi petugas ada di \`m.pcl\`).
- **Petugas Terbaik dari Assignment FASIH & Muatan**:
  - Kolom assignment FASIH adalah \`m.target_fasih\` / \`SUM(m.target_fasih)\`.
  - Realisasi FASIH adalah \`SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0))\`.
  - Target muatan adalah \`m.muatan\` / \`SUM(m.muatan)\`.
  - Realisasi muatan adalah \`SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0) + COALESCE(p.ditemukan+p.keluarga_baru,0))\`.
  - Gunakan \`query_data\` pada tabel \`subsls_master m LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ? GROUP BY m.pcl ORDER BY SUM(m.target_fasih) DESC, SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0)) DESC, SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) DESC\` (atau GROUP BY m.pml untuk PML).
- **Rata-rata Penambahan Harian per Petugas (PCL/PML/Korlap)**:
  - Jika pertanyaan menanyakan *"Siapa petugas dengan rata-rata penambahan harian terbanyak / tertinggi..."*:
    - WAJIB gunakan query yang mengelompokkan data per petugas (\`GROUP BY m.pcl\`), BUKAN mengueri tabel \`uploads\`!
    - Formula SQL:
      \`\`\`sql
      SELECT 
        m.pcl AS "Nama Petugas",
        MAX(m.pml) AS "PML Pengawas",
        MAX(m.kecamatan) AS "Kecamatan",
        SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS "Total Dokumen Selesai",
        ROUND(CAST(SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS FLOAT) / (SELECT COUNT(DISTINCT tanggal) FROM uploads WHERE tanggal IS NOT NULL), 2) AS "Rata-rata Harian (Dok/Hari)",
        SUM(m.target_fasih) AS "Target FASIH"
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = (SELECT id FROM uploads ORDER BY id DESC LIMIT 1)
      WHERE [terapkan filter/pengecualian jika ada]
      GROUP BY m.pcl
      ORDER BY "Rata-rata Harian (Dok/Hari)" DESC
      \`\`\`
- **Rata-rata Penambahan Harian Kabupaten / Wilayah (Umum)**:
  - Gunakan \`query_data\` menghitung \`SUM(submitted_total + approved_total + rejected_total) / (SELECT COUNT(DISTINCT tanggal) FROM uploads)\` dari \`summary_cache\`.
- **Penambahan Harian Terakhir (Delta Sesi/Hari)**: Gunakan \`query_data\` membandingkan realisasi upload terbaru dengan upload sesi sebelumnya.
- **Ringkasan & Wilayah**: Gunakan tool \`get_summary\` (parameter: kecamatan/desa jika ada) atau query ke \`summary_cache\`.
- **Anomali Lapangan**: Gunakan tool \`get_anomaly\` untuk anomali usaha ganda, tidak dapat ditemui, atau rejeksi PML.
- **Pertanyaan Multi-Kriteria (misal: Anomali + Petugas Tidak Aktif + Potensi Ganda)**:
  - JANGAN menggabungkan seluruh kriteria berbeda dalam satu klausa WHERE AND yang terlalu ketat sehingga menghasilkan 0 baris data.
  - Gunakan tool \`get_anomaly\` atau kueri terpisah untuk setiap indikator.
  - JANGAN PERNAH hanya menjawab "Data tidak ditemukan untuk kriteria pencarian tersebut." Jika salah satu kondisi bernilai 0 (misalnya: tidak ada petugas yang progresnya 0 karena semua 165 PCL aktif bergerak), jelaskan status positif tersebut, lalu tetap sajikan data temuan anomali dan potensi ganda yang ada di sistem secara komprehensif!
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
- Jika membahas Tren Harian / Rata-rata Harian: \`[Buka Tren Progres Harian](/harian)\`
- Jika membahas Wilayah SLS / SubSLS: \`[Buka Daftar Wilayah SLS & SubSLS](/subsls)\`
- Jika membahas Spasial / Sebaran Peta: \`[Buka Peta Sebaran Wilayah](/map)\`
- Jika membahas Unduh Data / Laporan: \`[Buka Halaman Unduh / Export](/export)\`
- Jika membahas Ringkasan Umum Kabupaten: \`[Buka Ringkasan Beranda](/)\`

Sertakan 2–4 tautan yang PALING RELEVAN dengan konteks pertanyaan dan jawaban di atas.
`;

function buildSystemInstruction(liveCtx = '', surveyId = 'se2026') {
  const { getSurveyConfigById } = require('../surveyRegistry');
  const cfg = getSurveyConfigById(surveyId) || {};
  const surveyName = cfg.name || 'Sensus/Survei PPU';
  const officerRole = cfg.officerRole || 'PCL';
  const unitName = cfg.unitName || 'dokumen';
  const isCensus = cfg.category === 'sensus';
  const enabledPages = Array.isArray(cfg.enabledPages) ? cfg.enabledPages : [];

  let dynamicActionLinks = '\n\n## Tautan Navigasi Dashboard (Action Links)\nSetiap jawaban yang memuat data statistik, petugas, atau wilayah diakhiri dengan 2–4 tautan navigasi dashboard yang relevan:\n\n**Tautan Navigasi Dashboard:**\n';
  if (enabledPages.includes('pcl')) dynamicActionLinks += `- Jika membahas Petugas ${officerRole} / Beban / Kinerja: \`[Lihat Detail Monitoring ${officerRole}](/pcl)\`\n`;
  if (enabledPages.includes('pml')) dynamicActionLinks += `- Jika membahas Pengawas PML / Verifikasi Dokumen: \`[Lihat Detail Monitoring PML](/pml)\`\n`;
  if (enabledPages.includes('korlap') && cfg.hasKorlap) dynamicActionLinks += `- Jika membahas Koordinator Lapangan: \`[Buka Monitoring Korlap](/korlap)\`\n`;
  if (enabledPages.includes('kecamatan')) dynamicActionLinks += `- Jika membahas Kecamatan / Desa: \`[Buka Rekap Progres Kecamatan](/kecamatan)\`\n`;
  if (enabledPages.includes('deteksi-anomali')) dynamicActionLinks += `- Jika membahas Anomali / Ganda / Dokumen Reject: \`[Buka Deteksi Anomali Lapangan](/deteksi-anomali)\`\n`;
  if (enabledPages.includes('performa')) dynamicActionLinks += `- Jika membahas Progres Lambat / Beban Berat / Evaluasi: \`[Buka Daftar Performa Terendah](/performa-terendah)\`\n`;
  if (enabledPages.includes('earlywarning')) dynamicActionLinks += `- Jika membahas Peringatan Dini Wilayah: \`[Buka Early Warning System](/early-warning)\`\n`;
  if (enabledPages.includes('leaderboard')) dynamicActionLinks += `- Jika membahas Prestasi / Top Kinerja: \`[Buka Leaderboard Petugas](/leaderboard)\`\n`;
  if (enabledPages.includes('harian')) dynamicActionLinks += `- Jika membahas Tren Harian / Rata-rata Harian: \`[Buka Tren Progres Harian](/harian)\`\n`;
  if (enabledPages.includes('subsls')) dynamicActionLinks += `- Jika membahas Wilayah ${isCensus ? 'SLS / SubSLS' : 'Blok Sensus / SLS'}: \`[Buka Daftar Wilayah](/subsls)\`\n`;
  if (enabledPages.includes('map')) dynamicActionLinks += `- Jika membahas Spasial / Sebaran Peta: \`[Buka Peta Sebaran Wilayah](/map)\`\n`;
  if (enabledPages.includes('export')) dynamicActionLinks += `- Jika membahas Unduh Data / Laporan: \`[Buka Halaman Unduh / Export](/export)\`\n`;
  dynamicActionLinks += `- Jika membahas Ringkasan Umum Kabupaten: \`[Buka Ringkasan Beranda](/)\`\n`;

  const surveyDirectives = `
## Karakteristik Khusus Kegiatan: ${surveyName}
- **Kategori Kegiatan**: ${cfg.categoryLabel || (isCensus ? 'Sensus Lengkap' : 'Survei Sampel')}
- **Metodologi**: ${cfg.coverageDesc || (isCensus ? 'Sensus Lengkap (Cakupan 100%)' : 'Hanya SLS/Blok Sensus Sampel Terpilih')}
- **Unit Observasi / Pengukuran**: **${unitName}**
- **Sebutan Petugas Lapangan**: Petugas Pendata/Pencacah disebut **${officerRole}**, Pengawas Lapangan disebut **PML**${cfg.hasKorlap ? ', Koordinator Lapangan disebut **Korlap**' : ''}.
- **Interpretasi Kolom Target & Realisasi**:
  - Kolom \`target_fasih\` mengukur target **${unitName}**.
  - Kolom \`submitted_by_pcl + approved + rejected\` mengukur realisasi **${unitName}** yang telah selesai didata/disubmit oleh ${officerRole}.
  ${!cfg.showUsahaColumns ? '- Kegiatan ini BUKAN sensus usaha/ekonomi, jadi JANGAN gunakan istilah "unit usaha" atau "sektor ekonomi", melainkan fokus pada ' + unitName + '.' : ''}
`;

  return dbSchemaDescription + surveyDirectives + liveCtx + SYSTEM_INSTRUCTION_STATIC.slice(dbSchemaDescription.length) + dynamicActionLinks;
}

// ─────────────────────────────────────────────
//  SIMULATION FALLBACK (SIMPLIFIED OFFLINE RUNNER)
// ─────────────────────────────────────────────
function runSimulation(userMessage, chatHistory, surveyId = 'se2026') {
  const lowerMsg = userMessage.toLowerCase();
  const db = getDb(surveyId);

  const latestUpload = getLatestUpload(surveyId);
  if (!latestUpload) {
    return {
      role: 'model',
      content: `Belum ada data upload di sistem untuk survei ini. Silakan masuk ke menu **Upload Data** terlebih dahulu.\n\n**Tautan Navigasi Dashboard:**\n- [Buka Halaman Upload Data](/upload)`,
      isSimulation: true
    };
  }

  const uploadId = latestUpload.id;
  const settings = getSettings(surveyId);
  const { getSurveyConfigById } = require('../surveyRegistry');
  const surveyConfig = getSurveyConfigById(surveyId) || {};
  const officerRole = surveyConfig.officerRole || 'PCL';
  const unitName = surveyConfig.unitName || 'dokumen';
  const surveyName = surveyConfig.name || 'Sensus/Survei PPU';
  const isCensus = surveyConfig.category === 'sensus';
  const enabledPages = Array.isArray(surveyConfig.enabledPages) ? surveyConfig.enabledPages : [];

  function getActionLinks() {
    let links = '\n\n**Tautan Navigasi Dashboard:**\n- [Buka Ringkasan Beranda](/)';
    if (enabledPages.includes('kecamatan')) links += '\n- [Buka Rekap Progres Kecamatan](/kecamatan)';
    if (enabledPages.includes('pcl')) links += `\n- [Lihat Detail Monitoring ${officerRole}](/pcl)`;
    if (enabledPages.includes('pml')) links += '\n- [Lihat Detail Monitoring PML](/pml)';
    if (enabledPages.includes('deteksi-anomali')) links += '\n- [Buka Deteksi Anomali Lapangan](/deteksi-anomali)';
    if (enabledPages.includes('leaderboard')) links += '\n- [Buka Leaderboard Petugas](/leaderboard)';
    if (enabledPages.includes('harian')) links += '\n- [Buka Tren Progres Harian](/harian)';
    return links;
  }

  try {
    // 1. Executive Summary Progres Kegiatan / Wilayah
    if (
      lowerMsg.includes('ringkasan') || 
      lowerMsg.includes('progres') || 
      lowerMsg.includes('capaian') || 
      lowerMsg.includes('perkembangan') || 
      lowerMsg.includes('saat ini') || 
      lowerMsg.includes('kabupaten') || 
      lowerMsg.includes('sakernas') || 
      lowerMsg.includes('rekap')
    ) {
      const summary = getOverviewSummary(uploadId, settings, surveyId);
      const kecStats = getKecamatanStats(uploadId, settings, surveyId);

      const pctFasih = (summary.fasih_pct != null ? summary.fasih_pct : summary.pct) || 0;
      const targetFasih = summary.target_fasih_total || summary.target_static_total || summary.total_muatan || 0;
      const realFasih = (summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0);
      const sisaTarget = Math.max(0, targetFasih - realFasih);
      const sisaPct = targetFasih > 0 ? ((sisaTarget / targetFasih) * 100).toFixed(2) : 0;
      const slsSelesai = summary.selesai || 0;
      const slsTotal = summary.total || 0;
      const slsPct = slsTotal > 0 ? ((slsSelesai / slsTotal) * 100).toFixed(2) : 0;

      let content = `Berikut adalah ringkasan progres pelaksanaan **${surveyName}** di Kabupaten Penajam Paser Utara berdasarkan data mutakhir (*${latestUpload.tanggal}*):\n\n`;

      content += `### 1. Capaian Utama ${isCensus ? 'Listing/Pendataan' : 'Pendataan ' + unitName}\n`;
      content += `* **Target ${unitName}**: **${targetFasih.toLocaleString('id-ID')} ${unitName}**${!isCensus ? ` (dari total ${slsTotal} Blok Sensus/SLS terpilih)` : ''}.\n`;
      content += `* **Realisasi Terdata**: **${realFasih.toLocaleString('id-ID')} ${unitName}** atau sebesar **${pctFasih.toFixed(2)}%**.\n`;
      content += `* **Sisa Target**: **${sisaTarget.toLocaleString('id-ID')} ${unitName}** (${sisaPct}%) yang masih perlu diselesaikan.\n`;
      content += `* **${isCensus ? 'SLS' : 'Blok Sensus'} Selesai 100%**: **${slsSelesai} dari ${slsTotal} wilayah** (${slsPct}%).\n\n`;

      content += `### 2. Status Verifikasi Dokumen\n`;
      content += `* **Approved (Disetujui PML)**: **${(summary.approved_total || 0).toLocaleString('id-ID')} dokumen** (${targetFasih > 0 ? (((summary.approved_total || 0) / targetFasih) * 100).toFixed(2) : 0}%).\n`;
      content += `* **Submitted (Menunggu Review PML)**: **${(summary.submitted_total || 0).toLocaleString('id-ID')} dokumen**.\n`;
      content += `* **Rejected (Perbaikan Petugas)**: **${(summary.rejected_total || 0).toLocaleString('id-ID')} dokumen**.\n`;
      content += `* **Draft**: **${(summary.draft_total || 0).toLocaleString('id-ID')} dokumen**.\n\n`;

      content += `### 3. Kinerja Petugas Lapangan\n`;
      content += `* **${officerRole} Aktif**: **${summary.active_pcl || 0} orang** dari total **${summary.total_pcl || 0} ${officerRole}** (${summary.total_pcl > 0 ? (((summary.active_pcl || 0) / summary.total_pcl) * 100).toFixed(0) : 100}% aktif bergerak).\n`;
      content += `* **PML Pengawas**: **${summary.total_pml || 0} orang**.\n`;
      content += `* **Rata-rata Terdata**: **${(summary.avg_didata_per_pcl || 0).toLocaleString('id-ID')} ${unitName} per ${officerRole}**.\n\n`;

      if (Array.isArray(kecStats) && kecStats.length > 0) {
        content += `### 4. Capaian per Kecamatan di Kabupaten PPU\n\n`;
        content += `| Kecamatan | Target ${unitName} | Realisasi | % Capaian | Approved PML | Selesai |\n| :--- | :---: | :---: | :---: | :---: | :---: |\n`;
        kecStats.forEach(k => {
          const kTarget = k.target_fasih_total || k.target_static_total || k.total_muatan || 0;
          const kReal = k.fasih_real_total != null ? k.fasih_real_total : k.muatan_selesai || 0;
          const kPct = (k.fasih_pct != null ? k.fasih_pct : k.pct) || 0;
          const kApp = k.approved_total || 0;
          content += `| **${k.kecamatan}** | ${kTarget.toLocaleString('id-ID')} | ${kReal.toLocaleString('id-ID')} | **${kPct.toFixed(2)}%** | ${kApp.toLocaleString('id-ID')} | ${k.selesai} / ${k.total_subsls} |\n`;
        });
        content += '\n';
      }

      content += `### Rekomendasi & Evaluasi Lapangan:\n`;
      if (summary.submitted_total > 0) {
        content += `1. **Pemeriksaan PML**: Dorong PML untuk mempercepat approval terhadap **${summary.submitted_total} dokumen submitted** yang menunggu verifikasi.\n`;
      }
      if (summary.rejected_total > 0) {
        content += `2. **Perbaikan Dokumen Rejected**: Segera koordinasikan perbaikan terhadap **${summary.rejected_total} dokumen rejected** agar tidak menjadi beban di akhir periode.\n`;
      }
      if (sisaTarget > 0) {
        content += `3. **Penyelesaian Sisa Target**: Prioritaskan penyisiran lapangan untuk menyelesaikan **${sisaTarget} ${unitName} tersisa**.\n`;
      }
      content += `4. **Pengawasan Kualitas**: Pastikan seluruh SOP metodologi dan konsistensi isian terverifikasi dengan baik.\n`;

      content += getActionLinks();

      return { role: 'model', content, isSimulation: true };
    }

    const isExcludeKipp = (lowerMsg.includes('selain') || lowerMsg.includes('bukan') || lowerMsg.includes('non') || lowerMsg.includes('luar') || lowerMsg.includes('tanpa') || lowerMsg.includes('kecuali')) && lowerMsg.includes('kipp');
    const kippFilter = isExcludeKipp ? "AND m.nama_sls NOT LIKE '%KIPP%' AND m.pcl NOT IN (SELECT DISTINCT pcl FROM subsls_master WHERE nama_sls = 'KIPP IKN' AND pcl IS NOT NULL AND pcl != '')" : "";
    const kippLabel = isExcludeKipp ? " (Selain Petugas SLS KIPP)" : "";

    let filterKec = '', kecLabel = '';
    const kecsList = ['sepaku', 'penajam', 'babulu', 'waru'];
    for (const kec of kecsList) {
      if (lowerMsg.includes(kec)) {
        const isExclude = (lowerMsg.includes('selain ' + kec) || lowerMsg.includes('bukan ' + kec) || lowerMsg.includes('kecuali ' + kec) || lowerMsg.includes('di luar ' + kec) || lowerMsg.includes('tanpa ' + kec) || lowerMsg.includes('non ' + kec) || lowerMsg.includes('non-' + kec));
        if (isExclude) {
          filterKec += ` AND LOWER(m.kecamatan) != '${kec}'`;
          kecLabel += ` (Selain Kecamatan ${kec.charAt(0).toUpperCase() + kec.slice(1)})`;
        } else if (!filterKec.includes(`= '${kec}'`)) {
          filterKec = ` AND LOWER(m.kecamatan) = '${kec}'`;
          kecLabel = ` (Kecamatan ${kec.charAt(0).toUpperCase() + kec.slice(1)})`;
        }
      }
    }

    if (lowerMsg.includes('terendah') || lowerMsg.includes('rendah') || lowerMsg.includes('buruk') || lowerMsg.includes('beban') || lowerMsg.includes('bantu') || lowerMsg.includes('berat')) {
      let filterKorlap = '';
      if (lowerMsg.includes('korlap')) {
        const korlapMatch = lowerMsg.match(/korlap\s+(\w+)/);
        if (korlapMatch && korlapMatch[1]) {
          const kName = korlapMatch[1].toLowerCase();
          const isExcludeKorlap = lowerMsg.includes('selain korlap') || lowerMsg.includes('bukan korlap') || lowerMsg.includes('kecuali korlap');
          if (isExcludeKorlap) {
            filterKorlap = `AND LOWER(m.korlap) != '${kName}'`;
            kecLabel += ` (Selain Korlap: ${korlapMatch[1]})`;
          } else {
            filterKorlap = `AND LOWER(m.korlap) = '${kName}'`;
            kecLabel += ` (Korlap: ${korlapMatch[1]})`;
          }
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
        WHERE 1=1 ${filterKec} ${filterKorlap} ${kippFilter}
        GROUP BY m.pcl ORDER BY ${orderBy} LIMIT 5
      `).all(uploadId);

      if (rows.length === 0) {
        return {
          role: 'model',
          content: `Tidak ditemukan data petugas untuk **${kecLabel || 'Seluruh Wilayah'}** pada data upload terbaru.${getActionLinks()}`,
          isSimulation: true
        };
      }

      let content = `Berikut daftar 5 ${officerRole} ${isHeavy ? 'dengan beban target tertinggi yang memerlukan pendampingan' : 'dengan progres terendah'} untuk **${kecLabel || 'Seluruh Wilayah'}** (upload *${latestUpload.tanggal}*):\n\n`;
      content += `| Nama ${officerRole} | PML Pengawas | Kecamatan | Target | Realisasi | Capaian (%) |\n| :--- | :--- | :--- | :---: | :---: | :---: |\n`;
      rows.forEach(r => {
        const pct = r.target_fasih_total > 0 ? ((r.realisasi_fasih / r.target_fasih_total) * 100).toFixed(2) : (r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00');
        content += `| **${r.pcl}** | ${r.pml} | ${r.kecamatan} | ${r.target_fasih_total || r.total_muatan} | ${r.realisasi_fasih || r.muatan_selesai} | **${pct}%** |\n`;
      });
      content += `\n**Rekomendasi:** Prioritaskan pendampingan lapangan langsung oleh PML terhadap **${rows[0].pcl}** untuk menyelesaikan target yang tersisa.${getActionLinks()}`;
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('harian') && (lowerMsg.includes('rata') || lowerMsg.includes('rerata') || lowerMsg.includes('penambahan')) && (lowerMsg.includes('petugas') || lowerMsg.includes('pcl') || lowerMsg.includes('ppl') || lowerMsg.includes('siapa') || lowerMsg.includes('terbanyak') || lowerMsg.includes('tertinggi'))) {
      const daysCount = db.prepare('SELECT COUNT(DISTINCT tanggal) as days FROM uploads WHERE tanggal IS NOT NULL').get()?.days || 1;
      const rows = db.prepare(`
        SELECT m.pcl, MAX(m.pml) AS pml, MAX(m.kecamatan) AS kecamatan,
          SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS realisasi,
          ROUND(CAST(SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0) + COALESCE(p.rejected,0)) AS FLOAT) / ${daysCount}, 2) AS rata_rata_harian,
          SUM(m.target_fasih) AS target_fasih
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${kippFilter} ${filterKec}
        GROUP BY m.pcl ORDER BY rata_rata_harian DESC LIMIT 5
      `).all(uploadId);

      let content = `Berikut daftar 5 Petugas (${officerRole}) dengan Rata-rata Penambahan Harian Terbanyak (berdasarkan ${daysCount} hari pendataan)${kippLabel}${kecLabel}:\n\n`;
      content += `| No | Nama ${officerRole} | PML Pengawas | Kecamatan | Total Selesai | Rata-rata Harian | Target |\n| :---: | :--- | :--- | :--- | :---: | :---: | :---: |\n`;
      rows.forEach((r, i) => {
        content += `| ${i+1} | **${r.pcl}** | ${r.pml} | ${r.kecamatan} | ${r.realisasi?.toLocaleString('id-ID') || 0} | **${r.rata_rata_harian?.toLocaleString('id-ID')} dok/hari** | ${r.target_fasih?.toLocaleString('id-ID') || 0} |\n`;
      });
      content += `\n### Analisis Produktivitas Harian:\n`;
      content += `* **Peringkat Teratas**: **${rows[0]?.pcl || '-'}** memimpin dengan rata-rata penambahan harian sebesar **${rows[0]?.rata_rata_harian || 0} dokumen/hari**.\n`;
      content += `* Petugas di atas menunjukkan ritme kerja konsisten dan produktivitas tinggi dalam menyelesaikan dokumen secara berkelanjutan.\n`;
      content += getActionLinks();
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('terbaik') || lowerMsg.includes('leaderboard') || lowerMsg.includes('ranking') || lowerMsg.includes('performa') || lowerMsg.includes('tertinggi') || lowerMsg.includes('top')) {
      const rows = db.prepare(`
        SELECT m.pcl, MAX(m.pml) AS pml, MAX(m.kecamatan) AS kecamatan,
          SUM(m.target_fasih) AS target_fasih,
          SUM(COALESCE(p.submitted_by_pcl,0) + COALESCE(p.approved,0)) AS realisasi_fasih,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${kippFilter} ${filterKec}
        GROUP BY m.pcl ORDER BY target_fasih DESC, realisasi_fasih DESC, muatan_selesai DESC LIMIT 5
      `).all(uploadId);

      let content = `Berikut daftar 5 Petugas (${officerRole}) Terbaik berdasarkan Capaian Dokumen${kippLabel}${kecLabel}:\n\n`;
      if (isCensus) {
        content += `| No | Nama ${officerRole} | PML Pengawas | Kecamatan | Target | Realisasi | Target Muatan | Realisasi Muatan |\n| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: |\n`;
        rows.forEach((r, i) => {
          content += `| ${i+1} | **${r.pcl}** | ${r.pml} | ${r.kecamatan} | ${r.target_fasih || 0} | **${r.realisasi_fasih || 0}** | ${r.total_muatan || 0} | **${r.muatan_selesai || 0}** |\n`;
        });
      } else {
        content += `| No | Nama ${officerRole} | PML Pengawas | Kecamatan | Target ${unitName} | Realisasi | % Capaian |\n| :---: | :--- | :--- | :--- | :---: | :---: | :---: |\n`;
        rows.forEach((r, i) => {
          const tVal = r.target_fasih || 0;
          const rVal = r.realisasi_fasih || 0;
          const pVal = tVal > 0 ? ((rVal / tVal) * 100).toFixed(1) + '%' : '0.0%';
          content += `| ${i+1} | **${r.pcl}** | ${r.pml} | ${r.kecamatan} | ${tVal} | **${rVal}** | **${pVal}** |\n`;
        });
      }
      content += `\n### Analisis & Rekomendasi:\n`;
      content += `* **Peringkat Teratas**: **${rows[0]?.pcl || '-'}** (${rows[0]?.kecamatan || '-'}) memegang target tertinggi sebesar **${rows[0]?.target_fasih || 0} dokumen** dengan realisasi **${rows[0]?.realisasi_fasih || 0} dokumen** terverifikasi/submit.\n`;
      content += `* **Efisiensi Lapangan**: Seluruh petugas pada daftar di atas aktif menyelesaikan sinkronisasi dokumen lapangan.\n`;
      content += getActionLinks();
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('anomali') || lowerMsg.includes('ganda')) {
      const ganda  = db.prepare('SELECT SUM(usaha_ganda) as n FROM progres WHERE upload_id=?').get(uploadId)?.n || 0;
      const noMeet = db.prepare('SELECT SUM(tidak_dapat_ditemui) as n FROM progres WHERE upload_id=?').get(uploadId)?.n || 0;
      const reject = db.prepare('SELECT SUM(rejected) as n FROM progres WHERE upload_id=?').get(uploadId)?.n || 0;
      const top    = db.prepare(`
        SELECT m.pcl, m.pml, SUM(COALESCE(p.usaha_ganda,0)) AS ganda, SUM(COALESCE(p.rejected,0)) AS reject
        FROM subsls_master m JOIN progres p ON m.kode=p.kode AND p.upload_id=?
        GROUP BY m.pcl HAVING ganda>0 OR reject>0 ORDER BY (ganda+reject) DESC LIMIT 3
      `).all(uploadId);

      let content = `Rekap Temuan Anomali Data Lapangan:\n\n1. **Data Ganda:** **${ganda} kasus**\n2. **Tidak dapat ditemui:** **${noMeet} kasus**\n3. **Dokumen ditolak (Rejected):** **${reject} dokumen**\n\n`;
      if (top.length > 0) {
        content += `| ${officerRole} | PML | Ganda | Rejected |\n| :--- | :--- | :---: | :---: |\n`;
        top.forEach(r => content += `| ${r.pcl} | ${r.pml} | ${r.ganda} | ${r.reject} |\n`);
      }
      content += getActionLinks();
      return { role: 'model', content, isSimulation: true };
    }

    return {
      role: 'model',
      content: `Pencarian data dapat menggunakan kata kunci: **ringkasan progres**, **kinerja petugas**, **terendah**, **terbaik**, atau **anomali** data.${getActionLinks()}\n\n*Konfigurasikan API Key untuk analisis mendalam tanpa batas.*`,
      isSimulation: true
    };
  } catch (err) {
    log.error('runSimulation DB error:', err.message);
    return { role: 'model', content: `Terjadi kendala saat membaca basis data: ${err.message}`, isSimulation: true };
  }
}

async function streamSimulation(userMessage, chatHistory, onEvent, abortSignal, surveyId = 'se2026') {
  onEvent('status', { text: 'Menghubungkan ke basis data lokal...', step: 'simulation_query' });
  await new Promise(r => setTimeout(r, 150));

  const simResult = runSimulation(userMessage, chatHistory, surveyId);
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
  const currentSurveyId = (options && options.surveyId) || resolveSurveyId();

  // 0. FAST-PATH: Tangani prompt generik (sapaan, testing, ucapan terima kasih) secara instan (0ms latency, hemat kuota)
  const fastPathText = fastPathHandler.getFastPathResponse(userMessage, currentSurveyId);
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

  const settings = getSettings(currentSurveyId);
  const liveCtx = contextBuilder.buildLiveContext(currentSurveyId);
  const dynInstruction = buildSystemInstruction(liveCtx, currentSurveyId);
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
          userMessage, mergedHistory, settings, current.model, serverController.signal, kItem.key, dynInstruction, { surveyId: currentSurveyId }
        );
        keyPool.markSuccess(kItem.key);
        if (finalResult.queryId && finalResult.content) {
          updateAgentQueryAnalysis(finalResult.queryId, finalResult.content);
        }
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
    finalResult = runSimulation(userMessage, mergedHistory, currentSurveyId);
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
  const currentSurveyId = (options && options.surveyId) || resolveSurveyId();

  // 0. FAST-PATH: Tangani prompt generik secara instan dengan respons secepat kilat (0ms TTFT)
  const fastPathText = fastPathHandler.getFastPathResponse(userMessage, currentSurveyId);
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

  const settings = getSettings(currentSurveyId);
  const liveCtx = contextBuilder.buildLiveContext(currentSurveyId);
  const dynInstruction = buildSystemInstruction(liveCtx, currentSurveyId);
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
          userMessage, mergedHistory, settings, current.model, abortSignal, kItem.key, onEvent, dynInstruction, { surveyId: currentSurveyId }
        );
        keyPool.markSuccess(kItem.key);
        if (finalResult.queryId && finalResult.content) {
          updateAgentQueryAnalysis(finalResult.queryId, finalResult.content);
        }
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
    finalResult = await streamSimulation(userMessage, mergedHistory, onEvent, abortSignal, currentSurveyId);
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
  runSimulation,
  streamSimulation,
  fetchPageData: toolRegistry.fetchPageDataCompat
};
