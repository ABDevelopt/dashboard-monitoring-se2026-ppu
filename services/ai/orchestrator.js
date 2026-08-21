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

// LOGGER


const LOG_LEVEL = process.env.AGENT_LOG_LEVEL || 'debug';
const log = {
  debug : (...a) => ['debug'].includes(LOG_LEVEL) && console.debug('[ORCH:DBG]', ...a),
  info  : (...a) => ['debug','info'].includes(LOG_LEVEL) && console.info ('[ORCH:INF]', ...a),
  warn  : (...a) => ['debug','info','warn'].includes(LOG_LEVEL) && console.warn ('[ORCH:WRN]', ...a),
  error : (...a) => ['debug','info','warn','error'].includes(LOG_LEVEL) && console.error('[ORCH:ERR]', ...a),
};

// ─────────────────────────────────────────────
//  SYSTEM INSTRUCTION COMPOSER
// ─────────────────────────────────────────────
const { dbSchemaDescription } = require('../dbSchema');
const { QUERY_HINTS } = require('../queryHints');

const hintsText = Object.entries(QUERY_HINTS)
  .map(([key, h]) => `- **${key}**: ${h.description}\n  SQL:\n  \`\`\`sql\n  ${h.sql.trim()}\n  \`\`\``)
  .join('\n');

const SYSTEM_INSTRUCTION_STATIC = dbSchemaDescription + `

## 🎯 ATURAN EMAS: FOKUS 100% PADA PERTANYAAN TERKINI (RECENCY FOCUS)
1. **Jawab HANYA Pertanyaan Terakhir**: Tanggapi secara eksklusif pertanyaan yang diajukan pada pesan pengguna saat ini. JANGAN PERNAH menjawab atau mengulang topik pertanyaan dari riwayat sebelumnya kecuali pengguna secara eksplisit meminta ("lanjutkan yang tadi", "bagaimana dengan dia?", dsb).
2. **Kesesuaian Pemanggilan Tool**: Saat memanggil tool/fungsi (\`get_summary\`, \`get_petugas\`, \`query_data\`), pastikan parameter dan kueri 100% relevan dengan entitas pertanyaan saat ini (misal: jika ditanya petugas, panggil data petugas; jika ditanya kecamatan, panggil data kecamatan).
3. **Hindari Greeting Berulang**: Jika ini adalah giliran tanya-jawab lanjutan (bukan sapaan 'halo/hai' pertama), LANGSUNG berikan jawaban data, tabel, dan analisis tanpa kalimat perkenalan diri ulang.
4. **Efisiensi Pemanggilan Tool (1-Turn Fetch & Respond)**: Panggil fungsi/tool yang diperlukan secara tepat dan hemat (cukup 1 kali pemanggilan tool atau maksimal 2 tool terkait). Segera setelah data hasil tool diterima, LANGSUNG rangkum, analisis, dan sajikan jawaban lengkap kepada pengguna. JANGAN PERNAH memanggil tool berulang kali secara berantai tanpa henti.

## Strategi Pengambilan Data — WAJIB DIIKUTI

### PRIORITAS 1: Gunakan get_summary atau get_petugas
Kueri ini sudah memiliki data teragregasi. Cobalah kueri get_summary/get_petugas sebelum query_data/run_read_only_query untuk:
- Progres umum, capaian, dan total wilayah -> get_summary
- Detail kinerja PML, PCL, atau Korlap -> get_petugas
- Informasi anomali data petugas -> get_anomaly

### PRIORITAS 2: Gunakan query_data atau run_read_only_query
Gunakan SQL SELECT hanya jika data tidak tersedia di agregator ringkas.

## Query Hints yang Tersedia
${hintsText}

## Format Respons & Tampilan — WAJIB DIIKUTI
1. **Bahasa**: Selalu gunakan Bahasa Indonesia yang profesional, ramah, sopan, dan solutif.
2. **Gunakan Tabel Markdown**: Data angka wajib diformat sebagai tabel markdown premium.
3. **Penyajian Rekomendasi/Analisis**: Bullet list dengan cetak tebal pada kata kunci.
4. **Ringkasan Singkat**: Berikan pengantar 1-2 kalimat dan akhiri dengan saran solutif.
5. **Tautan Navigasi Halaman (Action Links)**: Selalu sertakan 1-2 tautan Markdown relevan di akhir jawaban agar pengguna dapat langsung membuka dan mengeksplorasi data lengkap di halaman dashboard:
   - Progres Kecamatan / Desa: \`[📊 Buka Halaman Progres Kecamatan](/kecamatan)\`
   - Kinerja / Daftar Petugas PCL: \`[👥 Lihat Detail Monitoring PCL](/pcl)\`
   - Kinerja / Daftar Pengawas PML: \`[📋 Lihat Detail Monitoring PML](/pml)\`
   - Koordinator Lapangan: \`[👔 Buka Halaman Monitoring Korlap](/korlap)\`
   - Wilayah SLS & SubSLS: \`[🗺️ Buka Daftar SLS & SubSLS](/subsls)\`
   - Peta Sebaran Wilayah / Spasial: \`[📍 Buka Peta Sebaran Wilayah](/map)\`
   - Peringkat Kinerja / Top Performa: \`[🏆 Buka Leaderboard Petugas](/leaderboard)\`
   - Progres Lambat / Evaluasi: \`[⚠️ Buka Daftar Performa Terendah](/performa-terendah)\`
   - Anomali Data Lapangan: \`[🔍 Buka Deteksi Anomali](/deteksi-anomali)\`
   - Peringatan Dini Wilayah: \`[🚨 Buka Early Warning System](/early-warning)\`
   - Unduh Rekap Data: \`[📥 Buka Halaman Unduh / Export](/export)\`
   - Ringkasan Kabupaten: \`[🏠 Buka Ringkasan Beranda](/)\`
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
      content: `🤖 **Mode Simulasi (Preview)**\n\nBelum ada data upload di sistem. Silakan masuk ke menu **Upload Data** terlebih dahulu.`,
      isSimulation: true
    };
  }

  const uploadId = latestUpload.id;

  try {
    if (lowerMsg.includes('terendah') || lowerMsg.includes('rendah') || lowerMsg.includes('buruk')) {
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

      const rows = db.prepare(`
        SELECT m.pcl, MAX(m.pml) AS pml, MAX(m.kecamatan) AS kecamatan,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${filterKec} ${filterKorlap}
        GROUP BY m.pcl ORDER BY muatan_selesai ASC, total_muatan DESC LIMIT 3
      `).all(uploadId);

      if (rows.length === 0) {
        return {
          role: 'model',
          content: `🤖 **Mode Simulasi**\n\nTidak ditemukan data petugas sensus untuk **${kecLabel}** pada data upload terbaru.`,
          isSimulation: true
        };
      }

      let content = `🤖 **Mode Simulasi**\n\nBerikut 3 PCL capaian terendah di **${kecLabel}** (upload *${latestUpload.tanggal}*):\n\n`;
      content += `| Nama PCL | PML Pengawas | Kecamatan | Realisasi | Progres (%) |\n| :--- | :--- | :--- | :--- | :--- |\n`;
      rows.forEach(r => {
        const pct = r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${r.pcl} | ${r.pml} | ${r.kecamatan} | ${r.muatan_selesai} / ${r.total_muatan} | **${pct}%** |\n`;
      });
      content += `\n**Rekomendasi:** PML disarankan mendampingi **${rows[0].pcl}** secara langsung.\n`;
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

      let content = `🤖 **Mode Simulasi**\n\nTop 5 PCL Teraktif:\n\n`;
      content += `| # | PCL | PML | Kecamatan | Realisasi | Progres |\n| :---: | :--- | :--- | :--- | :--- | :--- |\n`;
      rows.forEach((r, i) => {
        const pct = r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| #${i+1} | ${r.pcl} | ${r.pml} | ${r.kecamatan} | ${r.muatan_selesai}/${r.total_muatan} | **${pct}%** |\n`;
      });
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

      let content = `🤖 **Mode Simulasi**\n\n`;
      content += `- **Total SLS:** ${totalSls.toLocaleString('id-ID')} | Selesai: **${totalDone.toLocaleString('id-ID')} (${slsPct}%)**\n`;
      content += `- **Total Muatan:** ${muatanTotal.toLocaleString('id-ID')} | Realisasi: **${muatanSelesai.toLocaleString('id-ID')} (${muatanPct}%)**\n\n`;
      content += `### Capaian per Kecamatan:\n\n| Kecamatan | SLS | Target Muatan | Realisasi | % |\n| :--- | :---: | :---: | :---: | :---: |\n`;
      kecs.forEach(k => {
        const p = k.total_muatan > 0 ? ((k.muatan_selesai / k.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${k.kecamatan} | ${k.total_subsls} | ${k.total_muatan} | ${k.muatan_selesai} | **${p}%** |\n`;
      });
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

      let content = `🤖 **Mode Simulasi**\n\n1. **Usaha Ganda:** **${ganda} kasus**\n2. **Tidak dapat ditemui:** **${noMeet}**\n3. **Dokumen ditolak:** **${reject}**\n\n`;
      if (top.length > 0) {
        content += `| PCL | PML | Ganda | Rejected |\n| :--- | :--- | :---: | :---: |\n`;
        top.forEach(r => content += `| ${r.pcl} | ${r.pml} | ${r.ganda} | ${r.reject} |\n`);
      }
      return { role: 'model', content, isSimulation: true };
    }

    return {
      role: 'model',
      content: `🤖 **Mode Simulasi**\n\nKata kunci yang didukung: **progres**, **terendah**, **terbaik**, **anomali**.\n\n*Konfigurasikan API Key untuk pertanyaan bebas.*`,
      isSimulation: true
    };
  } catch (err) {
    log.error('runSimulation DB error:', err.message);
    return { role: 'model', content: `🤖 **Mode Simulasi (Error DB)**\n\n${err.message}`, isSimulation: true };
  }
}

async function streamSimulation(userMessage, chatHistory, onEvent, abortSignal) {
  onEvent('status', { text: '⚙️ Menghubungkan ke basis data lokal...', step: 'simulation_query' });
  await new Promise(r => setTimeout(r, 150));

  const simResult = runSimulation(userMessage, chatHistory);
  const text = simResult.content || '';

  onEvent('status', { text: '✍️ Merumuskan jawaban...', step: 'streaming' });

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

  const tries = [{ provider: initialSelection.provider, model: initialSelection.model }];

  if (settings.chatbot_smart_switch === '1') {
    if (initialSelection.provider === 'gemini') {
      if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
        const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.5-flash';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'gemini', model: m });
        }
      }
      if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
        const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          if (m.includes(':free')) tries.push({ provider: 'openrouter', model: m });
        }
      }
      if (settings.openai_api_key && settings.openai_api_key.trim()) {
        const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openai', model: m });
        }
      }
    } else if (initialSelection.provider === 'openrouter') {
      if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
        const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openrouter', model: m });
        }
      }
      if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
        const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.5-flash';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'gemini', model: m });
        }
      }
      if (settings.openai_api_key && settings.openai_api_key.trim()) {
        const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openai', model: m });
        }
      }
    } else {
      if (settings.openai_api_key && settings.openai_api_key.trim()) {
        const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openai', model: m });
        }
      }
      if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
        const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.5-flash';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'gemini', model: m });
        }
      }
      if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
        const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          if (m.includes(':free')) tries.push({ provider: 'openrouter', model: m });
        }
      }
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

    if (current.provider === 'gemini') {
      const keysToTry = keyPool.getOrderedEligibleKeys(settings);
      if (keysToTry.length === 0) continue;

      let success = false;
      for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
        const kItem = keysToTry[kIdx];
        llmGateway.abortAllActive();
        const serverController = llmGateway.registerActiveRequest('gemini');

        try {
          finalResult = await llmGateway.sendMessageToGemini(
            userMessage, mergedHistory, settings, current.model, serverController.signal, kItem.key, dynInstruction
          );
          keyPool.markSuccess(kItem.key);
          success = true;
          break;
        } catch (err) {
          lastError = err;
          const errMsg = err.message || '';
          if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
            keyPool.markRateLimited(kItem.key, 180, errMsg);
          } else if (errMsg.includes('403') || errMsg.includes('400') || errMsg.toLowerCase().includes('leaked') || errMsg.toLowerCase().includes('api_key_invalid')) {
            keyPool.markInvalid(kItem.key, errMsg);
          }
        } finally {
          llmGateway.clearActiveRequest('gemini');
        }
      }
      if (success) break;
    } else {
      const apiKey = settings[`${current.provider}_api_key`] || '';
      if (!apiKey || !apiKey.trim()) continue;

      llmGateway.abortAllActive();
      const serverController = llmGateway.registerActiveRequest(current.provider);

      try {
        if (current.provider === 'openrouter') {
          finalResult = await llmGateway.sendMessageToOpenRouter(
            userMessage, mergedHistory, settings, current.model, serverController.signal, dynInstruction
          );
        } else {
          finalResult = await llmGateway.sendMessageToOpenAI(
            userMessage, mergedHistory, settings, current.model, serverController.signal, dynInstruction
          );
        }
        break;
      } catch (err) {
        lastError = err;
      } finally {
        llmGateway.clearActiveRequest(current.provider);
      }
    }
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

  const tries = [{ provider: initialSelection.provider, model: initialSelection.model }];

  if (settings.chatbot_smart_switch === '1') {
    if (initialSelection.provider === 'gemini') {
      if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
        const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.5-flash';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'gemini', model: m });
        }
      }
      if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
        const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          if (m.includes(':free')) tries.push({ provider: 'openrouter', model: m });
        }
      }
      if (settings.openai_api_key && settings.openai_api_key.trim()) {
        const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openai', model: m });
        }
      }
    } else if (initialSelection.provider === 'openrouter') {
      if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
        const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openrouter', model: m });
        }
      }
      if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
        const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.5-flash';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'gemini', model: m });
        }
      }
      if (settings.openai_api_key && settings.openai_api_key.trim()) {
        const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openai', model: m });
        }
      }
    } else {
      if (settings.openai_api_key && settings.openai_api_key.trim()) {
        const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'openai', model: m });
        }
      }
      if (settings.gemini_api_key && settings.gemini_api_key.trim()) {
        const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.5-flash';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          tries.push({ provider: 'gemini', model: m });
        }
      }
      if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
        const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
        for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
          if (tries.length >= llmGateway.MAX_SWITCH_TRIES) break;
          if (m.includes(':free')) tries.push({ provider: 'openrouter', model: m });
        }
      }
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
      onEvent('status', { text: '⚡ Mengoptimalkan ke jalur AI alternatif...', step: 'smart_switch' });
    }


    if (current.provider === 'gemini') {
      const keysToTry = keyPool.getOrderedEligibleKeys(settings);
      if (keysToTry.length === 0) continue;

      let success = false;
      for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
        const kItem = keysToTry[kIdx];
        if (kIdx > 0) {
          onEvent('status', {
            text: `🔑 Mengalihkan ke Gemini API Key ${kItem.label}...`,
            step: 'key_switch'
          });
        }
        try {
          finalResult = await llmGateway.streamMessageToGemini(
            userMessage, mergedHistory, settings, current.model, abortSignal, kItem.key, onEvent, dynInstruction
          );
          keyPool.markSuccess(kItem.key);
          onEvent('done', { reply: finalResult.content, isSimulation: false, role: 'model', model: current.model });
          success = true;
          break;
        } catch (err) {
          lastError = err;
          const errMsg = err.message || '';
          if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
            keyPool.markRateLimited(kItem.key, 180, errMsg);
          } else if (errMsg.includes('403') || errMsg.includes('400') || errMsg.toLowerCase().includes('leaked') || errMsg.toLowerCase().includes('api_key_invalid')) {
            keyPool.markInvalid(kItem.key, errMsg);
          }
        }
      }
      if (success) break;

    } else {
      const apiKey = settings[`${current.provider}_api_key`] || '';
      if (!apiKey || !apiKey.trim()) continue;

      try {
        if (current.provider === 'openrouter') {
          finalResult = await llmGateway.streamMessageToOpenRouter(
            userMessage, mergedHistory, settings, current.model, abortSignal, onEvent, dynInstruction
          );
        } else {
          finalResult = await llmGateway.streamMessageToOpenAI(
            userMessage, mergedHistory, settings, current.model, abortSignal, onEvent, dynInstruction
          );
        }
        onEvent('done', { reply: finalResult.content, isSimulation: false, role: 'model', model: current.model });
        break;
      } catch (err) {
        lastError = err;
      }
    }
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
