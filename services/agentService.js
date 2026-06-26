const { getDb, getSettings, getLatestUpload, getOverviewSummary, getKecamatanStats, getPclStats, getPmlStats, getKorlapStats, getTrenHarian, getTopPerformers, getBottomPerformers, getAnomalyStats, getEarlyWarning } = require('../database');
const { dbSchemaDescription } = require('./dbSchema');
const { Worker } = require('worker_threads');
const path = require('path');

// ─────────────────────────────────────────────
//  LOGGER TERPUSAT
//  Semua log melalui sini agar mudah dimatikan
//  di production cukup ubah LOG_LEVEL = 'error'
// ─────────────────────────────────────────────
const LOG_LEVEL = process.env.AGENT_LOG_LEVEL || 'debug'; // 'debug' | 'info' | 'error' | 'none'

const log = {
  debug : (...a) => ['debug'].includes(LOG_LEVEL)                          && console.debug('[AGENT:DBG]', ...a),
  info  : (...a) => ['debug','info'].includes(LOG_LEVEL)                   && console.info ('[AGENT:INF]', ...a),
  warn  : (...a) => ['debug','info','warn'].includes(LOG_LEVEL)            && console.warn ('[AGENT:WRN]', ...a),
  error : (...a) => ['debug','info','warn','error'].includes(LOG_LEVEL)    && console.error('[AGENT:ERR]', ...a),
};

// ─────────────────────────────────────────────
//  KONSTANTA
// ─────────────────────────────────────────────
const SYSTEM_INSTRUCTION = dbSchemaDescription + "\n\nSelalu berikan respons dalam Bahasa Indonesia yang profesional, ramah, dan solutif. Gunakan tabel markdown jika menyajikan data numerik agar rapi dan mudah dibaca. Jika perlu, gunakan tool fetch_page_data untuk mengambil konteks internal dari rute aplikasi seperti /overview, /pcl, /pml, /kecamatan, /leaderboard, /performa-terendah, /early-warning, /deteksi-anomali, atau /subsls.";

const TOOL_DECLARATION = {
  name: "run_read_only_query",
  description: "Execute a read-only SELECT SQL query on the SQLite database to fetch data about SE2026 monitoring.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The SQLite query starting with SELECT. e.g. 'SELECT * FROM progres JOIN subsls_master ON ... LIMIT 5'"
      }
    },
    required: ["query"],
    additionalProperties: false
  }
};

const PAGE_DATA_TOOL_DECLARATION = {
  name: "fetch_page_data",
  description: "Fetch summarized internal data for a given website route such as /overview, /pcl, /pml, /kecamatan, /leaderboard, /performa-terendah, /early-warning, /deteksi-anomali, or /subsls.",
  parameters: {
    type: "object",
    properties: {
      route: {
        type: "string",
        description: "Internal route path such as /overview, /pcl, or /kecamatan."
      },
      queryParams: {
        type: "object",
        description: "Optional additional parameters to narrow the route data, e.g. name or filters."
      }
    },
    required: ["route"],
    additionalProperties: false
  }
};

const GEMINI_DEFAULT_MODEL        = 'gemini-2.5-flash';
const OPENAI_DEFAULT_MODEL        = 'gpt-5.5';
const AGENT_API_TIMEOUT_MS        = 10000; // outer server total
const AGENT_API_QUICK_RESPONSE_MS =  4000; // per satu API call
const DB_WORKER_TIMEOUT_MS        =  8000; // max query SQLite di worker

const GEMINI_USER_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'];
const OPENAI_USER_MODELS = ['gpt-5.5'];
const LEGACY_GEMINI_MODELS = new Set(['gemini-1.5-flash']);

// ─────────────────────────────────────────────
//  REQUEST DEDUPLICATION — per-provider mutex
// ─────────────────────────────────────────────
const _activeControllers = new Map();

function abortPreviousRequest(provider) {
  if (_activeControllers.has(provider)) {
    log.warn(`Membatalkan request ${provider} sebelumnya karena ada request baru masuk.`);
    try { _activeControllers.get(provider).abort(); } catch (_) {}
    _activeControllers.delete(provider);
  }
}

function registerActiveRequest(provider) {
  const controller = new AbortController();
  _activeControllers.set(provider, controller);
  return controller;
}

function clearActiveRequest(provider) {
  _activeControllers.delete(provider);
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function getAllowedModels(provider, settings) {
  const configuredModel = provider === 'openai' ? settings.openai_model : settings.gemini_model;
  const baseModels = provider === 'openai' ? OPENAI_USER_MODELS : GEMINI_USER_MODELS;
  return Array.from(new Set([...baseModels, configuredModel].filter(Boolean)));
}

function resolveAgentSelection(settings, options = {}) {
  const selectedProvider = options.provider === 'openai' || options.provider === 'gemini'
    ? options.provider
    : settings.agent_provider;
  const provider = selectedProvider === 'openai' ? 'openai' : 'gemini';
  const fallbackModel = provider === 'openai'
    ? (settings.openai_model || OPENAI_DEFAULT_MODEL)
    : (settings.gemini_model || GEMINI_DEFAULT_MODEL);
  const allowedModels = getAllowedModels(provider, settings);
  let model = allowedModels.includes(options.model) ? options.model : fallbackModel;
  if (provider === 'gemini' && LEGACY_GEMINI_MODELS.has(model)) model = GEMINI_DEFAULT_MODEL;
  return { provider, model };
}

function timeoutPromise(promise, ms, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms))
  ]);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = AGENT_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  DATABASE — WORKER THREAD (non-blocking)
//
//  ROOT CAUSE #1 — Worker thread eval mode:
//  `worker_threads` dengan `eval: true` dan `require()` di dalam string
//  tidak bisa mengakses modul Node.js lokal (getDb) karena __dirname
//  di dalam eval worker adalah string kosong. Solusinya adalah meneruskan
//  instance db yang sudah terbuka via `workerData`, BUKAN require ulang.
//
//  Namun better-sqlite3 Database object tidak bisa di-clone/serialize
//  lintas thread (tidak transferable). Solusi terbaik tanpa file worker
//  terpisah adalah menjalankan query LANGSUNG dengan better-sqlite3 sync
//  tapi dibungkus setImmediate agar tidak blokir tick saat ini, atau
//  menggunakan run-in-executor pattern via Promise + setImmediate.
//
//  ROOT CAUSE #2 — better-sqlite3 tidak thread-safe:
//  Membuka koneksi baru di worker thread ke file SQLite yang sama
//  bisa menyebabkan SQLITE_BUSY / database locked jika WAL mode tidak aktif.
//
//  SOLUSI FINAL:
//  Jalankan query sync di main thread tapi di dalam `setImmediate` callback
//  agar tidak memblokir response HTTP yang sedang di-await. Ini cukup untuk
//  query <100ms. Untuk query berat, aktifkan WAL mode di database.js:
//    db.pragma('journal_mode = WAL');
// ─────────────────────────────────────────────────────────────────────────

const SQL_FORBIDDEN = ['insert','update','delete','drop','alter','create','replace','truncate','grant','revoke','pragma','reindex'];

function validateSql(sql) {
  const cleanSql = sql.trim();
  if (!/^select\s/i.test(cleanSql)) {
    throw new Error('Security Alert: Only SELECT queries are permitted.');
  }
  const tokens = cleanSql.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const cleanToken = token.replace(/[^a-z_]/g, '');
    if (SQL_FORBIDDEN.includes(cleanToken)) {
      throw new Error(`Security Alert: Forbidden keyword "${token}" detected in query.`);
    }
  }
  return cleanSql;
}

/**
 * executeQueryAsync — non-blocking via setImmediate.
 *
 * Membungkus query synchronous better-sqlite3 ke dalam Promise+setImmediate
 * sehingga event loop Node.js tidak diblokir pada tick saat ini.
 * Query tetap berjalan di main thread (aman untuk better-sqlite3),
 * namun dijalankan di idle tick berikutnya.
 *
 * Untuk query yang benar-benar berat (>500ms), aktifkan WAL mode
 * dan pertimbangkan worker-thread dengan file .js terpisah.
 */
function executeQueryAsync(sql) {
  return new Promise((resolve, reject) => {
    let cleanSql;
    try {
      cleanSql = validateSql(sql);
    } catch (err) {
      return reject(err);
    }

    const killTimer = setTimeout(() => {
      reject(new Error(`Query timeout setelah ${DB_WORKER_TIMEOUT_MS / 1000}s: ${cleanSql.slice(0, 80)}...`));
    }, DB_WORKER_TIMEOUT_MS);

    setImmediate(() => {
      try {
        const db = getDb();
        const rows = db.prepare(cleanSql).all();
        clearTimeout(killTimer);
        log.debug(`Query OK (${rows.length} baris): ${cleanSql.slice(0, 100)}`);
        resolve(rows);
      } catch (err) {
        clearTimeout(killTimer);
        log.error('executeQueryAsync error:', err.message, '| SQL:', cleanSql.slice(0, 200));
        reject(err);
      }
    });
  });
}

// Sinkron — hanya untuk runSimulation (tidak ada API call di sini)
function executeQuerySync(sql) {
  const cleanSql = validateSql(sql);
  const db = getDb();
  return db.prepare(cleanSql).all();
}

// ─────────────────────────────────────────────
//  fetchPageData
// ─────────────────────────────────────────────
function fetchPageData(route, queryParams = {}) {
  const upload = getLatestUpload();
  if (!upload) return { error: 'Belum ada data upload dalam sistem.' };

  const normalizedRoute = String(route || '').trim().replace(/\/+$|\?.*$/, '').toLowerCase();
  const page = normalizedRoute === '' || normalizedRoute === '/' ? '/overview' : normalizedRoute;

  log.debug('fetchPageData:', page, queryParams);

  switch (page) {
    case '/overview':
      return { route: '/overview', summary: getOverviewSummary(upload.id), kecamatanStats: getKecamatanStats(upload.id), tren: getTrenHarian() };
    case '/pcl':
      return { route: '/pcl', pclStats: getPclStats(upload.id) };
    case '/pml':
      return { route: '/pml', pmlStats: getPmlStats(upload.id) };
    case '/kecamatan':
      return { route: '/kecamatan', kecamatanStats: getKecamatanStats(upload.id) };
    case '/leaderboard':
      return { route: '/leaderboard', topPerformers: getTopPerformers(upload.id) };
    case '/performa-terendah':
      return { route: '/performa-terendah', bottomPerformers: getBottomPerformers(upload.id) };
    case '/early-warning':
      return { route: '/early-warning', earlyWarning: getEarlyWarning(upload.id, queryParams) };
    case '/deteksi-anomali':
      return { route: '/deteksi-anomali', anomalyStats: getAnomalyStats(upload.id, queryParams) };
    case '/subsls':
      return { route: '/subsls', pclStats: getPclStats(upload.id), pmlStats: getPmlStats(upload.id), kecamatanStats: getKecamatanStats(upload.id) };
    default:
      return { error: `Rute tidak dikenali: ${route}` };
  }
}

// ─────────────────────────────────────────────
//  SIMULATION FALLBACK
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
      if      (lowerMsg.includes('sepaku'))   { filterKec = "AND m.kecamatan = 'SEPAKU'";  kecLabel = 'Kecamatan Sepaku'; }
      else if (lowerMsg.includes('penajam'))  { filterKec = "AND m.kecamatan = 'PENAJAM'"; kecLabel = 'Kecamatan Penajam'; }
      else if (lowerMsg.includes('babulu'))   { filterKec = "AND m.kecamatan = 'BABULU'";  kecLabel = 'Kecamatan Babulu'; }
      else if (lowerMsg.includes('waru'))     { filterKec = "AND m.kecamatan = 'WARU'";    kecLabel = 'Kecamatan Waru'; }

      const rows = db.prepare(`
        SELECT m.pcl, MAX(m.pml) AS pml, MAX(m.kecamatan) AS kecamatan,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru,0)+COALESCE(p.ditemukan+p.keluarga_baru,0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${filterKec}
        GROUP BY m.pcl ORDER BY muatan_selesai ASC, total_muatan DESC LIMIT 3
      `).all(uploadId);

      let content = `🤖 **Mode Simulasi**\n\nBerikut 3 PCL capaian terendah di **${kecLabel}** (upload *${latestUpload.tanggal}*):\n\n`;
      content += `| Nama PCL | PML Pengawas | Kecamatan | Realisasi | Progres (%) |\n| :--- | :--- | :--- | :--- | :--- |\n`;
      rows.forEach(r => {
        const pct = r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${r.pcl} | ${r.pml} | ${r.kecamatan} | ${r.muatan_selesai} / ${r.total_muatan} | **${pct}%** |\n`;
      });
      if (rows.length > 0) content += `\n**Rekomendasi:** PML disarankan mendampingi **${rows[0].pcl}** secara langsung.\n`;
      content += `\n*Tip: Konfigurasikan API Key untuk analisis bebas dengan bahasa alami.*`;
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

// ─────────────────────────────────────────────────────────────────────────
//  TOOL-CALL EXECUTOR — dipakai oleh Gemini & OpenAI
//
//  ROOT CAUSE #3 — Error query ditelan diam-diam.
//  Sebelumnya: catch(err) → queryResult = { status:'error', message }
//  Lalu dikirim ke model → model "melihat" error dan memilih fallback ke
//  pengetahuan umumnya (menghasilkan angka fiktif seperti 3.374/114.387).
//
//  Solusi: kirim error secara eksplisit dengan instruksi agar model
//  MELAPORKAN error ke user, bukan memilih data alternatif sendiri.
// ─────────────────────────────────────────────────────────────────────────
async function runToolCall(functionCall) {
  const { name, args } = functionCall;
  log.debug('Tool call:', name, JSON.stringify(args).slice(0, 150));

  if (name === TOOL_DECLARATION.name) {
    const sql = args.query || '';
    log.info('SQL yang diminta model:', sql);

    try {
      const data = await executeQueryAsync(sql);
      log.info(`SQL selesai: ${data.length} baris dikembalikan.`);
      return {
        status : 'success',
        rowCount: data.length,
        data
      };
    } catch (err) {
      // ROOT CAUSE #3 FIX — jangan sembunyikan error dari model.
      // Sertakan instruksi eksplisit agar model tidak mengarang data.
      log.error('SQL error pada tool call:', err.message, '| SQL:', sql);
      return {
        status : 'error',
        message: err.message,
        sql,
        instruction: 'PENTING: Jangan gunakan data estimasi atau data dari pengetahuan umum. Laporkan error ini kepada user secara transparan dan minta mereka cek konfigurasi database atau coba query yang berbeda.'
      };
    }
  }

  if (name === PAGE_DATA_TOOL_DECLARATION.name) {
    try {
      const result = fetchPageData(args.route, args.queryParams || {});
      log.debug('fetchPageData selesai:', args.route);
      return { status: 'success', ...result };
    } catch (err) {
      log.error('fetchPageData error:', err.message);
      return {
        status : 'error',
        message: err.message,
        instruction: 'PENTING: Laporkan error ini ke user. Jangan gunakan data estimasi.'
      };
    }
  }

  return { status: 'error', message: `Fungsi tidak dikenal: ${name}` };
}

// ─────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────
async function sendMessageToAgent(userMessage, chatHistory = [], options = {}) {
  const settings = getSettings();
  const { provider, model } = resolveAgentSelection(settings, options);
  const apiKey = provider === 'openai' ? settings.openai_api_key : settings.gemini_api_key;

  log.info(`sendMessageToAgent — provider:${provider} model:${model} msg:"${userMessage.slice(0,60)}"`);

  if (!apiKey || apiKey.trim() === '') {
    log.info('Tidak ada API key — fallback ke simulasi.');
    return runSimulation(userMessage, chatHistory);
  }

  abortPreviousRequest(provider);
  const serverController = registerActiveRequest(provider);

  try {
    const task = provider === 'openai'
      ? sendMessageToOpenAI(userMessage, chatHistory, settings, model, serverController.signal)
      : sendMessageToGemini(userMessage, chatHistory, settings, model, serverController.signal);

    return await timeoutPromise(task, AGENT_API_TIMEOUT_MS, `${provider} request timed out.`)
      .catch(err => {
        log.error(`Outer timeout/error (${provider}):`, err.message);
        const sim = runSimulation(userMessage, chatHistory);
        sim.content = `⚠️ **Timeout:** ${err.message}\n\n` + sim.content;
        return sim;
      });
  } finally {
    clearActiveRequest(provider);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  GEMINI
//
//  ROOT CAUSE #4 — functionCalls() bisa throw jika response finish_reason
//  bukan STOP (misalnya SAFETY atau MAX_TOKENS). Perlu dicek sebelum akses.
// ─────────────────────────────────────────────────────────────────────────
async function sendMessageToGemini(userMessage, chatHistory, settings, selectedModel, abortSignal) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI       = new GoogleGenerativeAI(settings.gemini_api_key);
    const geminiModel = LEGACY_GEMINI_MODELS.has(selectedModel) ? GEMINI_DEFAULT_MODEL : (selectedModel || GEMINI_DEFAULT_MODEL);

    log.debug('Gemini model:', geminiModel);

    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{
        functionDeclarations: [
          {
            name: TOOL_DECLARATION.name,
            description: TOOL_DECLARATION.description,
            parameters: {
              type: "OBJECT",
              properties: { query: { type: "STRING", description: TOOL_DECLARATION.parameters.properties.query.description } },
              required: ["query"]
            }
          },
          {
            name: PAGE_DATA_TOOL_DECLARATION.name,
            description: PAGE_DATA_TOOL_DECLARATION.description,
            parameters: {
              type: "OBJECT",
              properties: {
                route:       { type: "STRING", description: PAGE_DATA_TOOL_DECLARATION.parameters.properties.route.description },
                queryParams: { type: "OBJECT", description: PAGE_DATA_TOOL_DECLARATION.parameters.properties.queryParams.description }
              },
              required: ["route"]
            }
          }
        ]
      }]
    });

    const formattedHistory = chatHistory.slice(-10).map(msg => ({
      role : msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chat = model.startChat({ history: formattedHistory });

    async function callGemini(payload) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
      log.debug('Gemini sendMessage…');
      const resp = await timeoutPromise(chat.sendMessage(payload), AGENT_API_QUICK_RESPONSE_MS, 'Gemini API call timed out');
      log.debug('Gemini response finish_reason:', resp.response.candidates?.[0]?.finishReason);
      return resp;
    }

    let response    = await callGemini(userMessage);
    let loopCount   = 0;
    const MAX_LOOPS = 2;

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan saat loop tool-call.');

      // ROOT CAUSE #4 FIX — tangkap kandidat finish_reason sebelum akses functionCalls
      const candidate   = response.response.candidates?.[0];
      const finishReason = candidate?.finishReason;

      if (finishReason && !['STOP', 'TOOL_USE', 'FUNCTION_CALL', 'MAX_TOKENS', undefined, null].includes(finishReason)) {
        log.warn('Gemini finish_reason tidak normal:', finishReason);
        // Masih coba ambil teks, tapi log peringatan
      }

      let functionCalls;
      try {
        functionCalls = response.response.functionCalls();
      } catch (fcErr) {
        // functionCalls() throw jika finish_reason bukan STOP/TOOL_USE
        log.warn('functionCalls() throw:', fcErr.message, '— dianggap tidak ada tool call.');
        functionCalls = null;
      }

      if (!functionCalls || functionCalls.length === 0) break;

      loopCount++;
      log.info(`Tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCalls.map(f => f.name).join(', ')}`);

      // Proses SEMUA function calls dalam satu turn (bukan hanya [0])
      const toolResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          return { functionResponse: { name: fc.name, response: result } };
        })
      );

      response = await callGemini(toolResponses);
    }

    if (loopCount >= MAX_LOOPS) {
      log.warn('Batas tool-call loop tercapai, memaksa generate teks akhir.');
    }

    let finalText;
    try {
      finalText = response.response.text();
    } catch (textErr) {
      log.error('Gemini response.text() error:', textErr.message);
      // ROOT CAUSE #4 FIX — ekstrak teks manual jika .text() throw
      finalText = response.response.candidates
        ?.flatMap(c => c.content?.parts || [])
        ?.map(p => p.text || '')
        ?.join('\n')
        ?.trim()
        || 'Model tidak mengembalikan teks. Periksa finish_reason di log server.';
    }

    log.info('Gemini selesai — panjang respons:', finalText.length, 'karakter');
    return { role: 'model', content: finalText, isSimulation: false };

  } catch (error) {
    log.error('sendMessageToGemini error:', error.message);
    const sim = runSimulation(userMessage, chatHistory);
    sim.content = `⚠️ **Gemini Error:** ${error.message}\n\n*Fallback ke simulasi:*\n\n` + sim.content;
    return sim;
  }
}

// ─────────────────────────────────────────────
//  OPENAI
// ─────────────────────────────────────────────
async function sendMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal) {
  const apiKey = settings.openai_api_key;
  const model  = selectedModel || settings.openai_model || OPENAI_DEFAULT_MODEL;
  const input  = [
    ...chatHistory.slice(-10).map(msg => ({
      role   : msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];
  const tools = [
    { type: 'function', name: TOOL_DECLARATION.name,          description: TOOL_DECLARATION.description,          parameters: TOOL_DECLARATION.parameters },
    { type: 'function', name: PAGE_DATA_TOOL_DECLARATION.name, description: PAGE_DATA_TOOL_DECLARATION.description, parameters: PAGE_DATA_TOOL_DECLARATION.parameters }
  ];

  try {
    if (abortSignal?.aborted) throw new Error('Request dibatalkan sebelum dikirim ke OpenAI.');

    log.debug('OpenAI request pertama…');
    let response = await createOpenAIResponse(apiKey, { model, instructions: SYSTEM_INSTRUCTION, input, tools, tool_choice: 'auto' });

    let loopCount   = 0;
    const MAX_LOOPS = 2;

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan saat loop tool-call OpenAI.');

      const functionCalls = (response.output || []).filter(item => item.type === 'function_call');
      if (functionCalls.length === 0) break;

      loopCount++;
      log.info(`OpenAI tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCalls.map(f => f.name).join(', ')}`);

      const outputs = await Promise.all(functionCalls.map(async call => {
        let args = {};
        try { args = JSON.parse(call.arguments || '{}'); } catch (_) {}
        const result = await runToolCall({ name: call.name, args });
        return { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) };
      }));

      response = await createOpenAIResponse(apiKey, {
        model, instructions: SYSTEM_INSTRUCTION,
        previous_response_id: response.id,
        input: outputs, tools, tool_choice: 'auto'
      });
    }

    const finalText = extractOpenAIText(response);
    log.info('OpenAI selesai — panjang respons:', finalText.length, 'karakter');
    return { role: 'model', content: finalText, isSimulation: false };

  } catch (error) {
    log.error('sendMessageToOpenAI error:', error.message);
    const sim    = runSimulation(userMessage, chatHistory);
    const isAbort = error.name === 'AbortError' || /aborted|timeout/i.test(error.message || '');
    sim.content  = `⚠️ **OpenAI ${isAbort ? 'Timeout' : 'Error'}:** ${error.message}\n\n*Fallback ke simulasi:*\n\n` + sim.content;
    return sim;
  }
}

async function createOpenAIResponse(apiKey, payload) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch tidak tersedia. Gunakan Node.js 18+ atau tambahkan node-fetch.');
  }
  const timeoutMs = payload.previous_response_id ? AGENT_API_TIMEOUT_MS : AGENT_API_QUICK_RESPONSE_MS;
  log.debug('OpenAI API call, timeout:', timeoutMs, 'ms, previous_id:', payload.previous_response_id || '-');

  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method : 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload)
  }, timeoutMs);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || `HTTP ${response.status}`;
    // Log body lengkap untuk debug rate-limit / auth error
    log.error('OpenAI HTTP error:', response.status, msg, JSON.stringify(data).slice(0, 300));
    throw new Error(msg);
  }
  return data;
}

function extractOpenAIText(response) {
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if ((c.type === 'output_text' || c.type === 'text') && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim() || 'Model tidak mengembalikan teks jawaban.';
}

module.exports = { sendMessageToAgent };