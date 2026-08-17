const { getDb, getSettings, getLatestUpload, getOverviewSummary, getKecamatanStats, getPclStats, getPmlStats, getKorlapStats, getTrenHarian, getTopPerformers, getBottomPerformers, getAnomalyStats, getEarlyWarning } = require('../database');
const { getFirestore, isFirebaseActive } = require('./firebaseService');
const { dbSchemaDescription } = require('./dbSchema');
const { QUERY_HINTS } = require('./queryHints');
const { buildLiveContext } = require('./ai/contextBuilder');
const { Worker } = require('worker_threads');
const path = require('path');
const { spawn } = require('child_process');

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
//  CURL FETCH FALLBACK (Self-Healing for Dewaweb)
// ─────────────────────────────────────────────
function curlFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const body = options.body;

    const args = ['-s', '-i', '-X', method];

    // Normalize headers (supporting Headers class and plain objects)
    let headersObj = {};
    if (headers) {
      if (typeof headers.entries === 'function') {
        for (const [key, val] of headers.entries()) {
          headersObj[key] = val;
        }
      } else if (typeof headers.forEach === 'function') {
        headers.forEach((val, key) => {
          headersObj[key] = val;
        });
      } else {
        headersObj = headers;
      }
    }

    for (const [key, val] of Object.entries(headersObj)) {
      args.push('-H', `${key}: ${val}`);
    }

    let hasBody = false;
    let bodyBuffer = null;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        bodyBuffer = Buffer.from(body);
      } else if (Buffer.isBuffer(body)) {
        bodyBuffer = body;
      } else if (typeof body.toString === 'function') {
        bodyBuffer = Buffer.from(body.toString());
      }
      
      if (bodyBuffer && bodyBuffer.length > 0) {
        args.push('--data-binary', '@-');
        hasBody = true;
      }
    }

    args.push('--max-time', '30');
    args.push(url);

    const child = spawn('curl', args);
    const stdoutChunks = [];
    const stderrChunks = [];

    if (hasBody && bodyBuffer) {
      child.stdin.write(bodyBuffer);
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => { stdoutChunks.push(chunk); });
    child.stderr.on('data', (chunk) => { stderrChunks.push(chunk); });

    child.on('error', (err) => { reject(err); });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`curl exited with code ${code}: ${Buffer.concat(stderrChunks).toString()}`));
      }

      const raw = Buffer.concat(stdoutChunks);
      const doubleNewline = Buffer.from('\r\n\r\n');
      let headerEndIdx = raw.indexOf(doubleNewline);
      let delimiterLength = 4;
      
      if (headerEndIdx === -1) {
        headerEndIdx = raw.indexOf(Buffer.from('\n\n'));
        delimiterLength = 2;
      }

      let headerText = '';
      let bodyBufferResult = null;

      if (headerEndIdx !== -1) {
        headerText = raw.slice(0, headerEndIdx).toString();
        bodyBufferResult = raw.slice(headerEndIdx + delimiterLength);
      } else {
        bodyBufferResult = raw;
      }

      const headerLines = headerText.split(/\r?\n/);
      const statusLine = headerLines[0] || '';
      const statusMatch = statusLine.match(/HTTP\/[\d\.]+\s+(\d+)/i);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;

      const responseHeaders = new Map();
      for (let i = 1; i < headerLines.length; i++) {
        const line = headerLines[i];
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const name = line.slice(0, colonIdx).trim().toLowerCase();
          const value = line.slice(colonIdx + 1).trim();
          responseHeaders.set(name, value);
        }
      }

      const response = {
        status,
        ok: status >= 200 && status < 300,
        statusText: statusLine.slice(statusLine.indexOf(String(status)) + String(status).length).trim(),
        headers: {
          get: (name) => responseHeaders.get(String(name).toLowerCase()) || null,
          has: (name) => responseHeaders.has(String(name).toLowerCase())
        },
        text: () => Promise.resolve(bodyBufferResult.toString()),
        json: () => {
          const text = bodyBufferResult.toString();
          try {
            return Promise.resolve(JSON.parse(text));
          } catch (e) {
            return Promise.reject(new Error(`Failed to parse JSON: ${text.slice(0, 100)}`));
          }
        }
      };

      resolve(response);
    });
  });
}

async function checkNativeFetchConnectivity() {
  try {
    const res = await timeoutPromise(
      fetch('https://generativelanguage.googleapis.com/v1beta/models', { method: 'HEAD' }),
      2000,
      'Timeout'
    );
    log.info('Native fetch connectivity check: SUCCESS');
  } catch (err) {
    log.warn('Native fetch connectivity check failed:', err.message, '. Installing curl-based fetch fallback...');
    
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function(url, options) {
      try {
        return await curlFetch(url, options);
      } catch (curlErr) {
        log.error('curlFetch fallback error:', curlErr.message);
        return originalFetch(url, options);
      }
    };
  }
}

checkNativeFetchConnectivity();



// ─────────────────────────────────────────────
//  KONSTANTA
// ─────────────────────────────────────────────
// const SYSTEM_INSTRUCTION = dbSchemaDescription + "\n\nSelalu berikan respons dalam Bahasa Indonesia yang profesional, ramah, dan solutif. Gunakan tabel markdown jika menyajikan data numerik agar rapi dan mudah dibaca. Jika perlu, gunakan tool fetch_page_data untuk mengambil konteks internal dari rute aplikasi seperti /overview, /pcl, /pml, /kecamatan, /leaderboard, /performa-terendah, /early-warning, /deteksi-anomali, atau /subsls.";

const hintsText = Object.entries(QUERY_HINTS)
  .map(([key, h]) => `- **${key}**: ${h.description}\n  SQL:\n  \`\`\`sql\n  ${h.sql.trim()}\n  \`\`\``)
  .join('\n');

// SYSTEM_INSTRUCTION statis (fallback jika liveCtx tidak tersedia)
const SYSTEM_INSTRUCTION_STATIC = dbSchemaDescription + `

## Strategi Pengambilan Data — WAJIB DIIKUTI

### PRIORITAS 1: Gunakan fetch_page_data (SELALU coba ini dulu)
Halaman website sudah memiliki data yang dihitung dan diagregasi.
Gunakan fetch_page_data SEBELUM mencoba run_read_only_query untuk:
- Pertanyaan tentang progres, capaian, realisasi → /overview atau /kecamatan
- Pertanyaan tentang PCL → /pcl (tambah queryParams.name jika nama spesifik)
- Pertanyaan tentang PML → /pml
- Pertanyaan peringkat terbaik → /leaderboard
- Pertanyaan peringkat terendah → /performa-terendah
- Pertanyaan anomali atau kualitas data → /deteksi-anomali
- Pertanyaan early warning → /early-warning

#### Filtering & Sorting dengan fetch_page_data:
Anda dapat menyaring dan mengurutkan data secara langsung melalui parameter 'queryParams' saat memanggil 'fetch_page_data':
- **Filter**: Gunakan parameter penyaringan seperti 'kecamatan', 'desa', 'pcl', 'pml', atau 'korlap'.
- **Sorting**: Gunakan 'sortField' (misal: 'pct' untuk persentase FASIH, 'pct_muatan' untuk persentase muatan, 'selesai', 'total_subsls', 'target_fasih_total') dan 'sortOrder' ('asc' atau 'desc').
  Contoh: Untuk mencari PCL di kecamatan Sepaku dengan persentase FASIH terkecil, gunakan fetch_page_data('/pcl', { kecamatan: 'Sepaku', sortField: 'pct', sortOrder: 'asc' }).

### PRIORITAS 2: Gunakan run_read_only_query HANYA jika:
- fetch_page_data tidak memiliki data yang dibutuhkan
- Pertanyaan membutuhkan filter atau agregasi yang sangat spesifik yang tidak dapat dilakukan oleh fetch_page_data
- User meminta data lintas beberapa entitas sekaligus
- Untuk sorting dan filtering tingkat lanjut di database: tulis query SQL dengan klausa WHERE dan ORDER BY.

## Query Hints yang Tersedia
Gunakan template query di bawah ini sebagai dasar penulisan query SQL Anda jika menggunakan 'run_read_only_query'. Ganti parameter seperti ':uploadId', ':kecamatan', atau ':limit' dengan nilai riil sebelum menjalankan query:
${hintsText}

## Format Respons & Tampilan — WAJIB DIIKUTI
Untuk mempermudah pembacaan data, Anda harus memformat jawaban Anda dengan standar estetika premium berikut:
1. **Bahasa**: Selalu gunakan Bahasa Indonesia yang profesional, ramah, sopan, dan solutif.
2. **Gunakan Tabel Markdown**: Setiap kali Anda menyajikan data kuantitatif, daftar petugas (PCL/PML/Korlap), progres wilayah, perbandingan angka, atau peringkat (terbaik/terendah), Anda **WAJIB** menampilkannya dalam bentuk **Tabel Markdown** yang rapi dengan kolom yang jelas (misalnya: Nama, Wilayah, Target, Realisasi, Persentase).
3. **Penyajian Rekomendasi/Analisis**: Gunakan daftar berpoin (bulleted lists) atau daftar bernomor (numbered lists) untuk menyajikan temuan, langkah tindak lanjut, atau rekomendasi kinerja. Gunakan cetak tebal (**bold**) pada kata kunci penting agar mudah dipindai oleh mata (scannable).
4. **Ringkasan Singkat**: Sebelum menyajikan tabel data yang besar, berikan penjelasan/pengantar singkat (1-2 kalimat), dan akhiri dengan kesimpulan atau rekomendasi yang solutif.

### ATURAN PEMBATASAN & TAUTAN (TRUNCATION & LINKING):
- Jika data yang diterima dari tool memiliki penanda terpotong ('truncated'), Anda WAJIB memberitahukan kepada user secara sopan bahwa data dibatasi demi kenyamanan chat, lalu berikan link markdown ke halaman data lengkap website yang bersangkutan (misal: [Halaman PCL](/pcl), [Halaman PML](/pml), [Halaman Korlap](/korlap), [Halaman Kecamatan](/kecamatan), [Halaman SubSLS](/subsls), [Halaman Early Warning](/early-warning), [Halaman Deteksi Anomali](/deteksianomali), [Halaman Leaderboard](/leaderboard)).

### DILARANG:
- Jangan gunakan run_read_only_query untuk pertanyaan yang bisa dijawab fetch_page_data
- Jangan membuat estimasi atau mengarang angka jika tool gagal
`;

/**
 * Membangun system instruction lengkap dengan live context diinjeksikan di awal.
 * Dipanggil sekali per request dari streamMessageToAgent / sendMessageToAgent.
 * @param {string} [liveCtx=''] - Hasil dari buildLiveContext()
 * @returns {string}
 */
function buildSystemInstruction(liveCtx = '') {
  return dbSchemaDescription + liveCtx + SYSTEM_INSTRUCTION_STATIC.slice(dbSchemaDescription.length);
}

// Alias backward-compat: dipakai oleh streamSimulation dan fungsi lain yang tidak butuh live context
const SYSTEM_INSTRUCTION = SYSTEM_INSTRUCTION_STATIC;



const TOOL_DECLARATION = {
  name: "run_read_only_query",
  description: "Execute a read-only SELECT SQL query on the SQLite database to fetch data about survey monitoring.",
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
        description: "Optional parameters to filter and sort the returned data tables. Supported keys: 'kecamatan', 'desa', 'pcl', 'pml', 'korlap' (for filtering), 'sortField' (field to sort by, e.g. 'pct', 'pct_muatan', 'selesai', 'total_subsls', 'target_fasih_total'), and 'sortOrder' ('asc' or 'desc')."
      }
    },
    required: ["route"],
    additionalProperties: false
  }
};

const GEMINI_DEFAULT_MODEL        = 'gemini-2.5-flash';
const OPENAI_DEFAULT_MODEL        = 'gpt-5.5';
const OPENROUTER_DEFAULT_MODEL    = 'openrouter/free';
// Hirarki timeout wajib — JANGAN dibalik urutannya:
//
//   browser abort (60 000ms)              ← diset di agent.ejs
//     > server outer per-provider (18 000ms)   = AGENT_API_TIMEOUT_MS
//       > call pertama ke AI  (14 000ms)        = AGENT_API_QUICK_RESPONSE_MS
//       > call tool-result    (16 000ms)        = AGENT_API_TOOLRESULT_MS
//         > query SQLite      (10 000ms)        = DB_WORKER_TIMEOUT_MS
//
// SmartSwitch worst-case: MAX_SWITCH_TRIES × AGENT_API_TIMEOUT_MS
//   = 5 × 18s = 90s (browser timeout is 60s, but most errors fail instantly, so 5 is safe and guarantees fallback across providers)
// Server selalu habis sebelum browser abort → tidak ada ECONNRESET.
const AGENT_API_TIMEOUT_MS          = 18000; // outer server per-provider
const AGENT_API_QUICK_RESPONSE_MS   = 14000; // call PERTAMA ke AI
const AGENT_API_TOOLRESULT_MS       = 16000; // call KEDUA+ ke AI (setelah tool-result)
const DB_WORKER_TIMEOUT_MS          = 10000; // max query SQLite (harus < QUICK_RESPONSE_MS)
const TOOL_RESULT_MAX_ROWS          =    20; // batas baris tool-result yang dikirim ke model
const MAX_SWITCH_TRIES              =     5; // batas total percobaan SmartSwitch

const GEMINI_USER_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'];
const OPENAI_USER_MODELS = ['gpt-5.5'];
const OPENROUTER_USER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'qwen/qwen-2.5-72b-instruct',
  'meta-llama/llama-3.1-405b-instruct',
  'deepseek/deepseek-chat',
  'moonshotai/moonshot-v1-8k',
  'moonshotai/moonshot-v1-32k',
  'moonshotai/moonshot-v1-128k'
];
const LEGACY_GEMINI_MODELS = new Set([]);

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
  if (provider === 'openrouter') {
    const listStr = settings.openrouter_models_list || 'meta-llama/llama-3.3-70b-instruct:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
    const models = listStr.split(',').map(m => m.trim()).filter(Boolean);
    if (settings.openrouter_model) models.push(settings.openrouter_model);
    return Array.from(new Set(models));
  }
  if (provider === 'openai') {
    const listStr = settings.openai_models_list || 'gpt-5.5';
    const models = listStr.split(',').map(m => m.trim()).filter(Boolean);
    if (settings.openai_model) models.push(settings.openai_model);
    return Array.from(new Set(models));
  }
  // gemini
  const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.1-flash-lite, gemini-3.5-flash, gemini-2.5-pro';
  const models = listStr.split(',').map(m => m.trim()).filter(Boolean);
  if (settings.gemini_model) models.push(settings.gemini_model);
  return Array.from(new Set(models));
}

function resolveAgentSelection(settings, options = {}) {
  const selectedProvider = options.provider === 'openai' || options.provider === 'gemini' || options.provider === 'openrouter'
    ? options.provider
    : settings.agent_provider;
  const provider = selectedProvider === 'openai' ? 'openai' : selectedProvider === 'openrouter' ? 'openrouter' : 'gemini';
  const fallbackModel = provider === 'openai'
    ? (settings.openai_model || OPENAI_DEFAULT_MODEL)
    : provider === 'openrouter'
    ? (settings.openrouter_model || OPENROUTER_DEFAULT_MODEL)
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
  if (!/^(select|with)\s/i.test(cleanSql)) {
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

// FIX #5 — executeQueryAsync: setImmediate BUKAN solusi non-blocking.
// setImmediate hanya defer 1 tick; query JOIN berat tetap memblokir event loop
// selama durasi query → semua HTTP request lain tertahan → halaman beku.
//
// Solusi berlapis:
//   1. WAL mode: aktifkan di getDb() agar reader tidak blokir writer.
//      Tambahkan di database.js: db.pragma('journal_mode = WAL');
//   2. LIMIT wajib: inject LIMIT jika query belum punya, cegah full-scan.
//   3. killTimer: batalkan jika melewati DB_WORKER_TIMEOUT_MS.
//
// Catatan: better-sqlite3 memang synchronous by design dan tidak bisa
// dijalankan di worker_threads tanpa membuka koneksi baru (risiko SQLITE_BUSY).
// Solusi terbaik jangka panjang adalah migrasi ke better-sqlite3-multiple-ciphers
// atau @databases/sqlite yang mendukung async. Untuk sekarang, WAL + LIMIT
// adalah mitigation paling aman tanpa refactor besar.

const QUERY_DEFAULT_LIMIT = 200; // baris maksimum jika query tidak ada LIMIT sendiri

function injectLimit(sql, limit = QUERY_DEFAULT_LIMIT) {
  // Jika query sudah punya LIMIT, biarkan
  if (/\blimit\s+\d+/i.test(sql)) return sql;
  return `${sql.trimEnd().replace(/;+$/, '')} LIMIT ${limit}`;
}

async function executeQueryFromFirestore(sql) {
  if (!isFirebaseActive()) return null;
  const db = getFirestore();
  if (!db) return null;

  try {
    const lower = sql.toLowerCase();
    let colName = null;
    if (lower.includes('subsls_master')) colName = 'subsls_master';
    else if (lower.includes('pcl') || lower.includes('pcl_summary')) colName = 'pcl_summary';
    else if (lower.includes('pml') || lower.includes('pml_summary')) colName = 'pml_summary';
    else if (lower.includes('kecamatan') || lower.includes('kecamatan_summary')) colName = 'kecamatan_summary';
    else if (lower.includes('overview') || lower.includes('summary')) colName = 'overview_summary';
    else if (lower.includes('early') || lower.includes('warning')) colName = 'early_warning';
    else if (lower.includes('anomali') || lower.includes('deteksi_anomali')) colName = 'deteksi_anomali';

    if (colName) {
      const snap = await db.collection(colName).limit(50).get();
      if (!snap.empty) {
        const docs = snap.docs.map(d => d.data());
        log.info(`[AGENT] Executed query against Cloud Firestore collection '${colName}' (${docs.length} documents)`);
        return docs;
      }
    }
  } catch (e) {
    log.warn('[AGENT:FIREBASE] Firestore SQL query fallback to SQLite:', e.message);
  }
  return null;
}

async function executeQueryAsync(sql) {
  let cleanSql;
  try {
    cleanSql = injectLimit(validateSql(sql));
  } catch (err) {
    throw err;
  }

  // 1. Try reading from Cloud Firestore collection first
  const fsRows = await executeQueryFromFirestore(cleanSql);
  if (fsRows && fsRows.length > 0) {
    return fsRows;
  }

  // 2. Fallback to local SQLite if Firestore is unavailable or collection empty
  return new Promise((resolve, reject) => {

    // killTimer: jika query melebihi batas waktu, reject segera.
    // Node.js akan tetap menyelesaikan query di background, tapi
    // result-nya sudah tidak dihiraukan — tidak ada memory leak karena
    // better-sqlite3 bekerja synchronously dalam satu call stack.
    const killTimer = setTimeout(() => {
      log.error('executeQueryAsync TIMEOUT:', cleanSql.slice(0, 120));
      reject(new Error(
        `Query timeout setelah ${DB_WORKER_TIMEOUT_MS / 1000}s. ` +
        `Coba tambahkan WHERE/LIMIT untuk mempersempit hasil.`
      ));
    }, DB_WORKER_TIMEOUT_MS);

    // setImmediate tetap dipakai untuk defer dari tick saat ini,
    // sehingga response HTTP yang sedang antri bisa diproses dulu
    // sebelum query berat dimulai.
    setImmediate(() => {
      // Jika killTimer sudah meletus, jangan lanjutkan
      try {
        const db = getDb();

        // Aktifkan WAL jika belum — aman dipanggil berulang kali
        try { db.pragma('journal_mode = WAL'); } catch (_) {}

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
//  fetchPageData (Firestore First -> SQLite Fallback)
// ─────────────────────────────────────────────
async function fetchPageDataFromFirestore(page, queryParams = {}) {
  if (!isFirebaseActive()) return null;
  const db = getFirestore();
  if (!db) return null;

  try {
    switch (page) {
      case '/overview': {
        const overviewDoc = await db.collection('overview_summary').doc('current').get();
        const kecSnap = await db.collection('kecamatan_summary').get();
        const kecStats = kecSnap.docs.map(doc => doc.data());
        if (overviewDoc.exists) {
          return {
            route: '/overview',
            dataSource: 'Cloud Firestore',
            summary: overviewDoc.data(),
            kecamatanStats: kecStats
          };
        }
        break;
      }
      case '/earlywarning':
      case '/early-warning': {
        const ewDoc = await db.collection('early_warning').doc('current').get();
        if (ewDoc.exists) {
          return {
            route: '/early-warning',
            dataSource: 'Cloud Firestore',
            earlyWarning: ewDoc.data()
          };
        }
        break;
      }
      case '/deteksi-anomali':
      case '/deteksianomali': {
        const anomalyDoc = await db.collection('deteksi_anomali').doc('current').get();
        if (anomalyDoc.exists) {
          return {
            route: '/deteksi-anomali',
            dataSource: 'Cloud Firestore',
            anomalies: anomalyDoc.data()
          };
        }
        break;
      }
      case '/pcl': {
        const pclSnap = await db.collection('pcl_summary').get();
        if (!pclSnap.empty) {
          let pclStats = pclSnap.docs.map(doc => doc.data());
          if (queryParams.pcl || queryParams.name) {
            const filterName = (queryParams.pcl || queryParams.name).toLowerCase();
            pclStats = pclStats.filter(p => (p.nama_pcl || p.pcl || '').toLowerCase().includes(filterName));
          }
          return {
            route: '/pcl',
            dataSource: 'Cloud Firestore',
            pclStats
          };
        }
        break;
      }
      case '/kecamatan': {
        const kecSnap = await db.collection('kecamatan_summary').get();
        if (!kecSnap.empty) {
          return {
            route: '/kecamatan',
            dataSource: 'Cloud Firestore',
            kecamatanStats: kecSnap.docs.map(doc => doc.data())
          };
        }
        break;
      }
    }
  } catch (err) {
    log.warn('[AGENT:FIREBASE] Firestore read fallback to SQLite:', err.message);
  }
  return null;
}

async function fetchPageData(route, queryParams = {}) {
  const normalizedRoute = String(route || '').trim().replace(/\/+$|\?.*$/, '').toLowerCase();
  const page = normalizedRoute === '' || normalizedRoute === '/' ? '/overview' : normalizedRoute;

  log.debug('fetchPageData:', page, queryParams);

  // 1. Check Cloud Firestore first
  const fsResult = await fetchPageDataFromFirestore(page, queryParams);
  if (fsResult) {
    log.info(`[AGENT] Data successfully fetched from Cloud Firestore for route: ${page}`);
    return fsResult;
  }

  // 2. Fallback to local SQLite if Firestore is disabled or missing documents
  const upload = getLatestUpload();
  if (!upload) return { error: 'Belum ada data upload dalam sistem.' };

  const db = getDb();
  let rawResult;

  switch (page) {
    case '/overview':
      rawResult = { 
        route: '/overview', 
        summary: getOverviewSummary(upload.id), 
        kecamatanStats: getKecamatanStats(upload.id), 
        tren: getTrenHarian() 
      };
      break;
      
    case '/pcl': {
      const filterPcl = queryParams.pcl || queryParams.name || '';
      const filterKec = queryParams.kec || queryParams.kecamatan || '';
      const filterKorlap = queryParams.korlap || '';
      const filterPml = queryParams.pml || '';
      
      let pclStats = [];
      let detailSubsls = [];
      
      let where = 'WHERE upload_id = ?';
      const params = [upload.id];
      if (filterKec) { where += ' AND LOWER(kecamatan) = ?'; params.push(filterKec.toLowerCase()); }
      if (filterKorlap) { where += ' AND korlap = ?'; params.push(filterKorlap); }
      if (filterPml) { where += ' AND pml = ?'; params.push(filterPml); }

      pclStats = db.prepare(`
        SELECT 
          pcl, pml, korlap, kecamatan,
          SUM(total_sls) AS total_subsls,
          SUM(selesai) AS selesai,
          SUM(total_muatan) AS total_muatan,
          SUM(muatan_selesai) AS muatan_selesai,
          SUM(usaha_total) AS usaha_total,
          SUM(keluarga_total) AS keluarga_total,
          SUM(draft_total) AS draft_total,
          SUM(submitted_total) AS submitted_total,
          SUM(approved_total) AS approved_total,
          SUM(rejected_total) AS rejected_total,
          SUM(target_fasih_total) AS target_fasih_total
        FROM summary_cache
        ${where}
        GROUP BY pcl, pml, korlap, kecamatan
        ORDER BY selesai ASC
      `).all(...params);

      if (queryParams.limit) {
        pclStats = pclStats.slice(0, parseInt(queryParams.limit, 10));
      }

      if (filterPcl) {
        detailSubsls = db.prepare(`
          SELECT 
            m.kode, m.kecamatan, m.desa, m.nama_sls,
            m.korlap, m.pml, m.pcl, m.muatan,
            m.target_fasih AS target_fasih_awal,
            COALESCE(p.draft, 0) AS draft,
            COALESCE(p.submitted_by_pcl, 0) AS submitted_by_pcl,
            COALESCE(p.approved, 0) AS approved,
            COALESCE(p.rejected, 0) AS rejected,
            COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) AS usaha_total,
            COALESCE(p.ditemukan + p.keluarga_baru, 0) AS keluarga_total
          FROM subsls_master m
          LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
          WHERE m.pcl = ?
          ORDER BY m.kecamatan, m.desa, m.kode
        `).all(upload.id, filterPcl);
      }

      rawResult = { route: '/pcl', pclStats, detailSubsls, filterPcl, filterKec, filterKorlap, filterPml };
      break;
    }

    case '/pml': {
      const filterPml = queryParams.pml || queryParams.name || '';
      let pmlStats = getPmlStats(upload.id);
      let detailPcl = [];

      if (queryParams.limit) {
        pmlStats = pmlStats.slice(0, parseInt(queryParams.limit, 10));
      }

      if (filterPml) {
        detailPcl = db.prepare(`
          SELECT 
            pcl, pml, korlap, kecamatan,
            SUM(total_sls) AS total_subsls,
            SUM(selesai) AS selesai,
            SUM(total_muatan) AS total_muatan,
            SUM(usaha_total) AS usaha_total,
            SUM(keluarga_total) AS keluarga_total
          FROM summary_cache
          WHERE upload_id = ? AND pml = ?
          GROUP BY pcl, kecamatan
          ORDER BY selesai ASC
        `).all(upload.id, filterPml);
      }

      rawResult = { route: '/pml', pmlStats, detailPcl, filterPml };
      break;
    }

    case '/korlap': {
      const filterKorlap = queryParams.korlap || queryParams.name || '';
      let korlapStats = getKorlapStats(upload.id);
      let detailData = [];

      if (queryParams.limit) {
        korlapStats = korlapStats.slice(0, parseInt(queryParams.limit, 10));
      }

      if (filterKorlap) {
        detailData = db.prepare(`
          SELECT 
            pml, korlap,
            COUNT(DISTINCT pcl) AS jumlah_pcl,
            SUM(total_sls) AS total_subsls,
            SUM(selesai) AS selesai,
            SUM(total_muatan) AS total_muatan,
            SUM(usaha_total) AS usaha_total,
            SUM(keluarga_total) AS keluarga_total
          FROM summary_cache
          WHERE upload_id = ? AND korlap = ?
          GROUP BY pml
          ORDER BY selesai ASC
        `).all(upload.id, filterKorlap);
      }

      rawResult = { route: '/korlap', korlapStats, detailData, filterKorlap };
      break;
    }

    case '/kecamatan':
      rawResult = { route: '/kecamatan', kecamatanStats: getKecamatanStats(upload.id) };
      break;
    case '/leaderboard':
      rawResult = { route: '/leaderboard', topPerformers: getTopPerformers(upload.id) };
      break;
    case '/performa-terendah':
      rawResult = { route: '/performa-terendah', bottomPerformers: getBottomPerformers(upload.id, queryParams) };
      break;
    case '/early-warning':
      rawResult = { route: '/early-warning', earlyWarning: getEarlyWarning(upload.id, queryParams) };
      break;
    case '/deteksi-anomali':
      rawResult = { route: '/deteksi-anomali', anomalyStats: getAnomalyStats(upload.id, queryParams) };
      break;
    case '/subsls': {
      const cond = [];
      const params = [upload.id];
      
      const filterKec = queryParams.kecamatan || queryParams.kec || '';
      const filterDesa = queryParams.desa || queryParams.kelurahan || '';
      const filterPcl = queryParams.pcl || queryParams.nama_pcl || '';
      const filterPml = queryParams.pml || queryParams.nama_pml || '';
      const filterKorlap = queryParams.korlap || '';
      const filterName = queryParams.name || queryParams.nama_sls || '';

      if (filterKec) { cond.push('m.kecamatan = ?'); params.push(filterKec); }
      if (filterDesa) { cond.push('m.desa = ?'); params.push(filterDesa); }
      if (filterPcl) { cond.push('m.pcl = ?'); params.push(filterPcl); }
      if (filterPml) { cond.push('m.pml = ?'); params.push(filterPml); }
      if (filterKorlap) { cond.push('m.korlap = ?'); params.push(filterKorlap); }
      if (filterName) { cond.push('m.nama_sls LIKE ?'); params.push(`%${filterName}%`); }

      const where = cond.length ? 'AND ' + cond.join(' AND ') : '';
      
      const sql = `
        SELECT 
          m.kode, m.kecamatan, m.desa, m.nama_sls,
          m.korlap, m.pml, m.pcl, m.muatan,
          COALESCE(p.draft, 0) AS draft,
          COALESCE(p.submitted_by_pcl, 0) AS submitted,
          COALESCE(p.approved, 0) AS approved,
          COALESCE(p.rejected, 0) AS rejected,
          CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 
               THEN 0 
               ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) 
          END AS target_fasih_total
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${where}
      `;

      const rows = db.prepare(sql).all(...params);
      rows.forEach(decorateRowWithPct);

      const sortField = queryParams.sortField || 'pct';
      const sortOrder = queryParams.sortOrder || 'desc';
      sortDataArray(rows, sortField, sortOrder);

      rawResult = {
        route: '/subsls',
        subslsStats: rows
      };
      break;
    }
    case '/map':
      rawResult = { route: '/map', totalSls: db.prepare('SELECT COUNT(*) as n FROM subsls_master').get().n };
      break;
    default:
      rawResult = { error: `Rute tidak dikenali: ${route}` };
      break;
  }

  // Helper function to decorate row with percentage calculations
  function decorateRowWithPct(row) {
    if (!row || typeof row !== 'object') return;

    // FASIH percentage calculation
    if ('target_fasih_total' in row || 'target_fasih' in row) {
      const targetFasih = row.target_fasih_total !== undefined ? row.target_fasih_total : row.target_fasih;
      const submitted = row.submitted_total !== undefined ? row.submitted_total : (row.submitted_by_pcl || 0);
      const approved = row.approved_total !== undefined ? row.approved_total : (row.approved || 0);
      const rejected = row.rejected_total !== undefined ? row.rejected_total : (row.rejected || 0);

      const realisasiFasih = (submitted || 0) + (approved || 0) + (rejected || 0);
      row.pct = targetFasih > 0 
        ? parseFloat((100 * realisasiFasih / targetFasih).toFixed(2)) 
        : 0.0;
    }
    
    // Muatan percentage calculation
    if ('total_muatan' in row || 'muatan' in row) {
      const totalMuatan = row.total_muatan !== undefined ? row.total_muatan : row.muatan;
      const muatanSelesai = row.muatan_selesai !== undefined ? row.muatan_selesai : (row.usaha_total || 0);
      row.pct_muatan = totalMuatan > 0 
        ? parseFloat((100 * muatanSelesai / totalMuatan).toFixed(2)) 
        : 0.0;
    }
  }

  // Helper function to sort arrays of objects
  function sortDataArray(array, sortField, sortOrder = 'asc') {
    if (!Array.isArray(array) || !sortField) return array;
    const order = String(sortOrder).toLowerCase() === 'desc' ? -1 : 1;
    return array.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined || valA === null) valA = 0;
      if (valB === undefined || valB === null) valB = 0;

      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        return (numA - numB) * order;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      if (strA < strB) return -1 * order;
      if (strA > strB) return 1 * order;
      return 0;
    });
  }

  // Recursive post-processor to decorate, filter, sort and limit
  function postProcessResult(obj, qParams) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      // First, decorate all rows in the array
      obj.forEach(decorateRowWithPct);

      // Apply filtering
      const filterKeys = ['kecamatan', 'desa', 'pcl', 'pml', 'korlap'];
      let filteredArray = [...obj];
      for (const key of filterKeys) {
        const filterVal = qParams[key] || qParams[key.toLowerCase()];
        if (filterVal) {
          filteredArray = filteredArray.filter(row => {
            const rowVal = row[key];
            if (rowVal === undefined || rowVal === null) return false;
            return String(rowVal).toLowerCase().includes(String(filterVal).toLowerCase());
          });
        }
      }

      // Apply sorting
      const sortField = qParams.sortField || qParams.sort || qParams.orderBy || qParams.order;
      const sortOrder = qParams.sortOrder || qParams.dir || 'asc';
      if (sortField) {
        filteredArray = sortDataArray(filteredArray, sortField, sortOrder);
      }

      // Apply limit
      if (qParams.limit) {
        const lim = parseInt(qParams.limit, 10);
        if (!isNaN(lim)) {
          filteredArray = filteredArray.slice(0, lim);
        }
      }

      // Recursively process items
      return filteredArray.map(item => postProcessResult(item, qParams));
    }

    // Process nested object properties
    const newObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = postProcessResult(obj[key], qParams);
      }
    }
    return newObj;
  }

  return postProcessResult(rawResult, queryParams);
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
      
      // Match kecamatan name if any
      if      (lowerMsg.includes('sepaku'))   { filterKec = "AND LOWER(m.kecamatan) = 'sepaku'";  kecLabel = 'Kecamatan Sepaku'; }
      else if (lowerMsg.includes('penajam'))  { filterKec = "AND LOWER(m.kecamatan) = 'penajam'"; kecLabel = 'Kecamatan Penajam'; }
      else if (lowerMsg.includes('babulu'))   { filterKec = "AND LOWER(m.kecamatan) = 'babulu'";  kecLabel = 'Kecamatan Babulu'; }
      else if (lowerMsg.includes('waru'))     { filterKec = "AND LOWER(m.kecamatan) = 'waru'";    kecLabel = 'Kecamatan Waru'; }

      // Match korlap name if any (e.g. 'baihaqi')
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
//  FIX #6 — capPageDataResult
//  Memangkas array-array besar di dalam hasil fetchPageData sebelum
//  dikirim ke model. Ini mencegah context window overflow dan mencegah
//  JSON.stringify dari objek besar yang memblokir event loop.
// ─────────────────────────────────────────────────────────────────────────
const PAGE_DATA_MAX_ROWS = 20; // sama dengan TOOL_RESULT_MAX_ROWS

function getPageLinkForLabel(label) {
  const lbl = String(label || '').toLowerCase();
  if (lbl.includes('pcl')) return '/pcl';
  if (lbl.includes('pml')) return '/pml';
  if (lbl.includes('korlap')) return '/korlap';
  if (lbl.includes('kecamatan')) return '/kecamatan';
  if (lbl.includes('earlywarning') || lbl.includes('early_warning') || lbl.includes('early-warning')) return '/early-warning';
  if (lbl.includes('anomaly') || lbl.includes('anomali')) return '/deteksianomali';
  if (lbl.includes('topperformers') || lbl.includes('leaderboard')) return '/leaderboard';
  if (lbl.includes('bottomperformers') || lbl.includes('performaterendah') || lbl.includes('performa-terendah')) return '/performa-terendah';
  if (lbl.includes('subsls')) return '/subsls';
  return null;
}

function capArray(arr, label) {
  if (!Array.isArray(arr) || arr.length <= PAGE_DATA_MAX_ROWS) return { data: arr };
  const link = getPageLinkForLabel(label);
  const linkMsg = link ? ` Silakan kunjungi [Halaman ${label.replace('Stats', '')} Lengkap](${link}) untuk melihat seluruh data.` : '';
  return {
    data: arr.slice(0, PAGE_DATA_MAX_ROWS),
    truncated: `PERINGATAN: Hanya ${PAGE_DATA_MAX_ROWS} dari ${arr.length} baris ditampilkan untuk ${label}.${linkMsg} ` +
               `Gunakan queryParams.limit atau queryParams.name untuk mempersempit data.`
  };
}

function capPageDataResult(result) {
  if (!result || typeof result !== 'object') return result;

  const out = { ...result };

  // Field-field yang bisa besar — periksa dan cap masing-masing
  const arrayFields = [
    'pclStats', 'pmlStats', 'korlapStats', 'kecamatanStats',
    'topPerformers', 'bottomPerformers', 'earlyWarning',
    'anomalyStats', 'detailSubsls', 'detailPcl', 'detailData', 'tren', 'subslsStats'
  ];

  for (const field of arrayFields) {
    if (Array.isArray(out[field])) {
      const capped = capArray(out[field], field);
      out[field] = capped.data;
      if (capped.truncated) out[`${field}_truncated`] = capped.truncated;
    }
  }

  // summary bisa berisi sub-array dari getOverviewSummary
  if (out.summary && typeof out.summary === 'object') {
    for (const [k, v] of Object.entries(out.summary)) {
      if (Array.isArray(v) && v.length > PAGE_DATA_MAX_ROWS) {
        const capped = capArray(v, `summary.${k}`);
        out.summary = { ...out.summary, [k]: capped.data };
        if (capped.truncated) out[`summary_${k}_truncated`] = capped.truncated;
      }
    }
  }

  return out;
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

      // Batasi baris yang dikirim ke model agar payload tidak terlalu besar.
      // Baris berlebih menyebabkan call ke-2 Gemini timeout karena context window besar.
      const totalRows = data.length;
      const truncated = totalRows > TOOL_RESULT_MAX_ROWS;
      const rows      = truncated ? data.slice(0, TOOL_RESULT_MAX_ROWS) : data;

      return {
        status   : 'success',
        rowCount : totalRows,
        returned : rows.length,
        truncated: truncated
          ? (() => {
              const sqlLower = sql.toLowerCase();
              let suggestLink = '';
              if (sqlLower.includes('pcl')) suggestLink = ' Silakan kunjungi [Halaman PCL Lengkap](/pcl) untuk melihat seluruh data.';
              else if (sqlLower.includes('pml')) suggestLink = ' Silakan kunjungi [Halaman PML Lengkap](/pml) untuk melihat seluruh data.';
              else if (sqlLower.includes('korlap')) suggestLink = ' Silakan kunjungi [Halaman Korlap Lengkap](/korlap) untuk melihat seluruh data.';
              else if (sqlLower.includes('kecamatan')) suggestLink = ' Silakan kunjungi [Halaman Kecamatan Lengkap](/kecamatan) untuk melihat seluruh data.';
              else if (sqlLower.includes('progres') || sqlLower.includes('subsls')) suggestLink = ' Silakan kunjungi [Halaman SubSLS Lengkap](/subsls) untuk melihat seluruh data.';
              return `PERINGATAN: Hanya ${rows.length} dari ${totalRows} baris ditampilkan.${suggestLink} Gunakan WHERE/LIMIT untuk mempersempit hasil, atau minta agregasi (COUNT/SUM/GROUP BY) agar data lebih ringkas.`;
            })()
          : undefined,
        data: rows
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
      const routeVal = args.route || args.path || args.endpoint || '';
      const result = await fetchPageData(routeVal, args.queryParams || {});
      log.debug('fetchPageData selesai:', routeVal);

      // FIX #6 — Batasi ukuran payload sebelum dikirim ke model.
      // fetchPageData bisa mengembalikan ratusan baris (pclStats, pmlStats, dsb).
      // JSON.stringify dari payload besar: (a) blokir event loop, (b) overflow
      // context window model → API error atau respons terpotong.
      const capped = capPageDataResult(result);
      return { status: 'success', ...capped };
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
//  ENTRY POINT & SMART SWITCH
// ─────────────────────────────────────────────
function isQuotaOrRateLimitError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return /http\s+\d+|rate.limit|quota|billing|credit|exhausted|demand|limit|time.?out|timed.?out|aborted/i.test(msg);
}

function getApiKeyForProvider(provider, settings) {
  const key = provider === 'openai' ? settings.openai_api_key : provider === 'openrouter' ? settings.openrouter_api_key : settings.gemini_api_key;
  return key && key.trim() ? key.trim() : null;
}

async function executeSingleProviderCall(provider, model, userMessage, chatHistory, settings, signal, customApiKey, systemInstruction = SYSTEM_INSTRUCTION) {
  const task = provider === 'openai'
    ? sendMessageToOpenAI(userMessage, chatHistory, settings, model, signal, systemInstruction)
    : provider === 'openrouter'
    ? sendMessageToOpenRouter(userMessage, chatHistory, settings, model, signal, systemInstruction)
    : sendMessageToGemini(userMessage, chatHistory, settings, model, signal, customApiKey, systemInstruction);

  return await timeoutPromise(task, AGENT_API_TIMEOUT_MS, `${provider} request timed out.`);
}

async function sendMessageToAgent(userMessage, chatHistory = [], options = {}) {
  const settings = getSettings();
  const liveCtx = buildLiveContext('se2026');
  const dynInstruction = buildSystemInstruction(liveCtx);
  const initialSelection = resolveAgentSelection(settings, options);
  
  const tries = [{ provider: initialSelection.provider, model: initialSelection.model }];
  
  if (settings.chatbot_smart_switch === '1') {
    // FIX #1 — Bangun tries[] dengan batas MAX_SWITCH_TRIES.
    // Urutan fallback: provider utama → OpenRouter free → Gemini → OpenAI paid.
    // Kita BERHENTI mengisi tries begitu sudah mencapai MAX_SWITCH_TRIES entri
    // agar total waktu tunggu terkendali (MAX_SWITCH_TRIES × AGENT_API_TIMEOUT_MS).

    // 1. OpenRouter free models (cost=0, prioritas sebagai fallback cepat)
    if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
      const listStr = settings.openrouter_models_list || 'meta-llama/llama-3.3-70b-instruct:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
      for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (tries.length >= MAX_SWITCH_TRIES) break;
        if (m.includes(':free')) tries.push({ provider: 'openrouter', model: m });
      }
    }
    // 2. Gemini models
    if (settings.gemini_api_key && settings.gemini_api_key.trim() && tries.length < MAX_SWITCH_TRIES) {
      const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.1-flash-lite, gemini-3.5-flash, gemini-2.5-pro';
      for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (tries.length >= MAX_SWITCH_TRIES) break;
        tries.push({ provider: 'gemini', model: m });
      }
    }
    // 3. OpenAI models (paid — hanya jika slot masih ada)
    if (settings.openai_api_key && settings.openai_api_key.trim() && tries.length < MAX_SWITCH_TRIES) {
      const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
      for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (tries.length >= MAX_SWITCH_TRIES) break;
        tries.push({ provider: 'openai', model: m });
      }
    }
  }

  // Deduplicate — tetap dipertahankan sebagai safety net
  const uniqueTries = [];
  const seen = new Set();
  for (const t of tries) {
    const key = `${t.provider}:${t.model}`;
    if (!seen.has(key)) { seen.add(key); uniqueTries.push(t); }
  }

  log.info(`[SmartSwitch] Urutan percobaan (${uniqueTries.length}):`, uniqueTries.map(t => `${t.provider}/${t.model}`).join(' → '));

  // FIX #2 — Batalkan SEMUA request aktif di semua provider sebelum iterasi baru.
  // Versi lama hanya abort provider yang sama, sehingga saat switch dari gemini
  // ke openrouter, controller gemini tetap hidup dan keduanya jalan paralel.
  function abortAllActive() {
    for (const [prov, ctrl] of _activeControllers.entries()) {
      log.warn(`[SmartSwitch] Abort request aktif: ${prov}`);
      try { ctrl.abort(); } catch (_) {}
    }
    _activeControllers.clear();
  }

  let lastError = null;
  
  for (let i = 0; i < uniqueTries.length; i++) {
    const current = uniqueTries[i];
    
    if (current.provider === 'gemini') {
      let keysToTry = [settings.gemini_api_key];
      try {
        const backups = JSON.parse(settings.gemini_backup_api_keys || '[]');
        if (Array.isArray(backups)) {
          keysToTry = keysToTry.concat(backups);
        }
      } catch (e) {}
      keysToTry = keysToTry.map(k => k ? k.trim() : '').filter(Boolean);
      keysToTry = [...new Set(keysToTry)];

      if (keysToTry.length === 0) {
        log.warn(`[SmartSwitch] Skip gemini/${current.model}: tidak ada API key`);
        continue;
      }

      let success = false;
      let result = null;
      for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
        const activeKey = keysToTry[kIdx];
        log.info(`[SmartSwitch] Mencoba Gemini Key (${kIdx + 1}/${keysToTry.length}) dengan model ${current.model}`);
        
        abortAllActive();
        const serverController = registerActiveRequest('gemini');
        try {
          result = await executeSingleProviderCall(
            'gemini', current.model, userMessage, chatHistory, settings, serverController.signal, activeKey, dynInstruction
          );
          
          if (i > 0 || kIdx > 0) {
            log.info(`[SmartSwitch] Fallback aktif: Gemini Key #${kIdx}, model: gemini/${current.model}`);
          }
          success = true;
          break;
        } catch (err) {
          lastError = err;
          log.error(`[SmartSwitch] Gemini Key #${kIdx} Gagal:`, err.message);
        } finally {
          clearActiveRequest('gemini');
        }
      }
      
      if (success) {
        return result;
      }
      
      if (settings.chatbot_smart_switch !== '1') {
        break;
      }
      log.warn(`[SmartSwitch] Semua key Gemini gagal. Mencoba provider berikutnya...`);
    } else {
      const apiKey = getApiKeyForProvider(current.provider, settings);
      
      if (!apiKey) {
        log.warn(`[SmartSwitch] Skip ${current.provider}/${current.model}: tidak ada API key`);
        continue;
      }
      
      log.info(`[SmartSwitch] Mencoba (${i + 1}/${uniqueTries.length}): ${current.provider} (${current.model})`);
      
      abortAllActive();
      const serverController = registerActiveRequest(current.provider);
      
      try {
        const result = await executeSingleProviderCall(
          current.provider, current.model, userMessage, chatHistory, settings, serverController.signal, null, dynInstruction
        );
        
        if (i > 0) {
          log.info(`[SmartSwitch] Dialihkan dari ${initialSelection.provider}/${initialSelection.model} ke ${current.provider}/${current.model}`);
        }
        
        return result;
      } catch (err) {
        lastError = err;
        log.error(`[SmartSwitch] Gagal pada ${current.provider}/${current.model}:`, err.message);
        
        if (settings.chatbot_smart_switch !== '1') {
          break;
        }
        
        log.warn(`[SmartSwitch] Mencoba berikutnya...`);
      } finally {
        clearActiveRequest(current.provider);
      }
    }
  }

  log.info('Semua provider/model gagal — fallback ke simulasi.');
  const sim = runSimulation(userMessage, chatHistory);
  const errMsg = lastError ? lastError.message : 'API key tidak terkonfigurasi';
  sim.content = `⚠️ **AI Provider Error:** ${errMsg}\n\n*Fallback ke simulasi lokal:*\n\n` + sim.content;
  return sim;
}

// ─────────────────────────────────────────────────────────────────────────
//  GEMINI
//
//  ROOT CAUSE #4 — functionCalls() bisa throw jika response finish_reason
//  bukan STOP (misalnya SAFETY atau MAX_TOKENS). Perlu dicek sebelum akses.
// ─────────────────────────────────────────────────────────────────────────
async function sendMessageToGemini(userMessage, chatHistory, settings, selectedModel, abortSignal, customApiKey, systemInstruction = SYSTEM_INSTRUCTION) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const apiKey = customApiKey || settings.gemini_api_key;
    const genAI       = new GoogleGenerativeAI(apiKey);
    const geminiModel = LEGACY_GEMINI_MODELS.has(selectedModel) ? GEMINI_DEFAULT_MODEL : (selectedModel || GEMINI_DEFAULT_MODEL);

    log.debug('Gemini model:', geminiModel);

    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemInstruction,
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

    // Gemini startChat history MUST start with a 'user' role message.
    // If the first message in the sliced history is 'model', discard it.
    if (formattedHistory.length > 0 && formattedHistory[0].role === 'model') {
      formattedHistory.shift();
    }

    const chat = model.startChat({ history: formattedHistory });

    async function callGemini(payload, isToolResult = false) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
      const timeoutMs = isToolResult ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
      log.debug(`Gemini sendMessage… (timeout: ${timeoutMs / 1000}s, isToolResult: ${isToolResult})`);
      const resp = await timeoutPromise(chat.sendMessage(payload), timeoutMs, `Gemini API call timed out (${timeoutMs / 1000}s)`);
      log.debug('Gemini response finish_reason:', resp.response.candidates?.[0]?.finishReason);
      return resp;
    }

    let response    = await callGemini(userMessage, false);
    let loopCount   = 0;
    const MAX_LOOPS = 5;

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

      response = await callGemini(toolResponses, true);
    }

    if (loopCount >= MAX_LOOPS) {
      log.warn('Batas tool-call loop tercapai, memaksa generate teks akhir.');
    }

    let finalText;
    try {
      finalText = response.response.text();
    } catch (textErr) {
      log.error('Gemini response.text() error:', textErr.message);
    }

    if (!finalText || !finalText.trim()) {
      // ROOT CAUSE #4 FIX — ekstrak teks manual jika .text() throw atau kosong
      finalText = response.response.candidates
        ?.flatMap(c => c.content?.parts || [])
        ?.map(p => p.text || '')
        ?.join('\n')
        ?.trim();
    }

    if (!finalText || !finalText.trim()) {
      finalText = 'Model tidak mengembalikan teks. Periksa finish_reason di log server.';
    }

    log.info('Gemini selesai — panjang respons:', finalText.length, 'karakter');
    return { role: 'model', content: finalText, isSimulation: false };

  } catch (error) {
    log.error('sendMessageToGemini error:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────
//  OPENAI
// ─────────────────────────────────────────────
async function sendMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction = SYSTEM_INSTRUCTION) {
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
    let response = await createOpenAIResponse(apiKey, { model, instructions: systemInstruction, input, tools, tool_choice: 'auto' });

    let loopCount   = 0;
    const MAX_LOOPS = 5;

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
        model, instructions: systemInstruction,
        previous_response_id: response.id,
        input: outputs, tools, tool_choice: 'auto'
      });
    }

    const finalText = extractOpenAIText(response);
    log.info('OpenAI selesai — panjang respons:', finalText.length, 'karakter');
    return { role: 'model', content: finalText, isSimulation: false };

  } catch (error) {
    log.error('sendMessageToOpenAI error:', error.message);
    throw error;
  }
}

async function createOpenAIResponse(apiKey, payload) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch tidak tersedia. Gunakan Node.js 18+ atau tambahkan node-fetch.');
  }
  const timeoutMs = payload.previous_response_id ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
  log.debug('OpenAI API call, timeout:', timeoutMs, 'ms, previous_id:', payload.previous_response_id || '-');

  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method : 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload)
  }, timeoutMs);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || '';
    const fullMsg = `[HTTP ${response.status}] ${msg}`.trim();
    log.error('OpenAI HTTP error:', response.status, fullMsg, JSON.stringify(data).slice(0, 300));
    throw new Error(fullMsg);
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

async function sendMessageToOpenRouter(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction = SYSTEM_INSTRUCTION) {
  const apiKey = settings.openrouter_api_key;
  const model = selectedModel || settings.openrouter_model || OPENROUTER_DEFAULT_MODEL;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...chatHistory.slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];

  // FIX #4 — Model OpenRouter :free (llama, deepseek via :free tier) sering
  // tidak mendukung tool/function calling dan mengembalikan choices:[] atau
  // choices[0].message = null ketika menerima tool declarations.
  // Solusi: jangan kirim tools untuk model :free — biarkan model menjawab
  // berdasarkan SYSTEM_INSTRUCTION + konteks saja (sudah ada dbSchemaDescription).
  const modelSupportsTool = !model.includes(':free');
  log.debug(`OpenRouter model: ${model} | tool-call support: ${modelSupportsTool}`);

  const tools = modelSupportsTool ? [
    {
      type: 'function',
      function: {
        name: TOOL_DECLARATION.name,
        description: TOOL_DECLARATION.description,
        parameters: TOOL_DECLARATION.parameters
      }
    },
    {
      type: 'function',
      function: {
        name: PAGE_DATA_TOOL_DECLARATION.name,
        description: PAGE_DATA_TOOL_DECLARATION.description,
        parameters: PAGE_DATA_TOOL_DECLARATION.parameters
      }
    }
  ] : undefined; // FIX #4 — tidak kirim tools ke model :free

  let loopCount = 0;
  const MAX_LOOPS = 5; // Allow fallback parser to scan all models' text JSON outputs

  try {
    if (abortSignal?.aborted) throw new Error('Request dibatalkan sebelum dikirim ke OpenRouter.');

    log.debug('OpenRouter request pertama...');

    const payload = { model, messages };
    if (tools) payload.tools = tools;

    let response = await callOpenRouterAPI(apiKey, payload, false);

    // FIX #4 — Validasi choices sebelum akses apapun
    if (!response.choices || response.choices.length === 0) {
      // Cek apakah ada error dari OpenRouter (misal model overloaded)
      const orError = response.error?.message || response.message;
      if (orError) throw new Error(`OpenRouter: ${orError}`);
      throw new Error('OpenRouter mengembalikan choices kosong. Model mungkin tidak tersedia atau tidak kompatibel.');
    }

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan saat loop tool-call OpenRouter.');

      loopCount++;
      const choice = response.choices?.[0];
      // FIX #4 — guard: choice atau message bisa null pada beberapa model
      if (!choice || !choice.message) {
        log.warn('OpenRouter: choice atau message null di iterasi tool-call', loopCount);
        break;
      }

      const assistantMessage = choice.message;
      const toolCalls = assistantMessage?.tool_calls;

      // --- TEXT JSON TOOL CALL FALLBACK PARSER ---
      let isTextToolCall = false;
      const parsedTextTools = [];

      if ((!toolCalls || toolCalls.length === 0) && assistantMessage.content) {
        const jsonStrings = extractJSONObjects(assistantMessage.content);
        
        for (const jsonStr of jsonStrings) {
          try {
            const sanitizedStr = sanitizeJSONString(jsonStr);
            const parsed = JSON.parse(sanitizedStr);

            // 1. Support {"tool_calls": [...]}
            if (parsed && parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
              for (const tc of parsed.tool_calls) {
                let toolName = tc.name || tc.function?.name || tc.tool || tc.action;
                let tcArgs = tc.arguments || tc.args || tc.function?.arguments || tc.function?.args || {};

                if (typeof tcArgs === 'string') {
                  try {
                    tcArgs = JSON.parse(tcArgs);
                  } catch (_) {}
                }

                if (!toolName) {
                  const routeVal = tcArgs.route || tcArgs.endpoint || tcArgs.page_path || tcArgs.page_route || tcArgs.page || tcArgs.path || tcArgs.url;
                  const queryVal = tcArgs.query || tcArgs.sql || tcArgs.params?.query || tcArgs.params?.sql;
                  if (routeVal) {
                    toolName = 'fetch_page_data';
                  } else if (queryVal) {
                    toolName = 'run_read_only_query';
                  }
                }

                if (toolName === 'run_read_only_query' || toolName === 'fetch_page_data') {
                  let args = {};
                  if (toolName === 'run_read_only_query') {
                    const queryVal = tcArgs.query || tcArgs.sql || tcArgs.params?.query || tcArgs.params?.sql || '';
                    args = { query: typeof queryVal === 'string' ? queryVal : JSON.stringify(queryVal) };
                  } else if (toolName === 'fetch_page_data') {
                    const routeVal = tcArgs.route || tcArgs.endpoint || tcArgs.page_path || tcArgs.page_route || tcArgs.page || tcArgs.path || tcArgs.url || '';
                    const qParams = tcArgs.queryParams || tcArgs.params?.queryParams || tcArgs.arguments?.queryParams || tcArgs.params || {};
                    args = { route: routeVal, queryParams: typeof qParams === 'object' ? qParams : {} };
                  }
                  parsedTextTools.push({ name: toolName, args });
                }
              }
              continue;
            }

            // 2. Support array of tool calls directly: [...]
            if (Array.isArray(parsed)) {
              for (const tc of parsed) {
                let toolName = tc.name || tc.function?.name || tc.tool || tc.action;
                let tcArgs = tc.arguments || tc.args || tc.function?.arguments || tc.function?.args || {};

                if (typeof tcArgs === 'string') {
                  try {
                    tcArgs = JSON.parse(tcArgs);
                  } catch (_) {}
                }

                if (!toolName) {
                  const routeVal = tcArgs.route || tcArgs.endpoint || tcArgs.page_path || tcArgs.page_route || tcArgs.page || tcArgs.path || tcArgs.url;
                  const queryVal = tcArgs.query || tcArgs.sql || tcArgs.params?.query || tcArgs.params?.sql;
                  if (routeVal) {
                    toolName = 'fetch_page_data';
                  } else if (queryVal) {
                    toolName = 'run_read_only_query';
                  }
                }

                if (toolName === 'run_read_only_query' || toolName === 'fetch_page_data') {
                  let args = {};
                  if (toolName === 'run_read_only_query') {
                    const queryVal = tcArgs.query || tcArgs.sql || tcArgs.params?.query || tcArgs.params?.sql || '';
                    args = { query: typeof queryVal === 'string' ? queryVal : JSON.stringify(queryVal) };
                  } else if (toolName === 'fetch_page_data') {
                    const routeVal = tcArgs.route || tcArgs.endpoint || tcArgs.page_path || tcArgs.page_route || tcArgs.page || tcArgs.path || tcArgs.url || '';
                    const qParams = tcArgs.queryParams || tcArgs.params?.queryParams || tcArgs.arguments?.queryParams || tcArgs.params || {};
                    args = { route: routeVal, queryParams: typeof qParams === 'object' ? qParams : {} };
                  }
                  parsedTextTools.push({ name: toolName, args });
                }
              }
              continue;
            }

            // 3. Support single tool call object directly: { "tool": "...", "args": ... }
            let toolName = parsed.tool || parsed.name || parsed.function || parsed.action;
            
            // Implicit tool detection
            if (!toolName) {
              const routeVal = parsed.route || parsed.endpoint || parsed.page_path || parsed.page_route || parsed.page || parsed.path || parsed.url;
              const queryVal = parsed.query || parsed.sql || parsed.params?.query || parsed.params?.sql || parsed.arguments?.query || parsed.arguments?.sql;
              
              if (routeVal) {
                toolName = 'fetch_page_data';
              } else if (queryVal) {
                toolName = 'run_read_only_query';
              }
            }

            if (toolName === 'run_read_only_query' || toolName === 'fetch_page_data') {
              let args = {};
              if (toolName === 'run_read_only_query') {
                const queryVal = parsed.query || parsed.sql || parsed.params?.query || parsed.params?.sql || parsed.arguments?.query || parsed.arguments?.sql || parsed.arguments || parsed.params || '';
                args = { query: typeof queryVal === 'string' ? queryVal : JSON.stringify(queryVal) };
              } else if (toolName === 'fetch_page_data') {
                const routeVal = parsed.route || parsed.endpoint || parsed.page_path || parsed.page_route || parsed.page || parsed.path || parsed.url || '';
                const qParams = parsed.queryParams || parsed.params?.queryParams || parsed.arguments?.queryParams || parsed.params || {};
                args = { route: routeVal, queryParams: typeof qParams === 'object' ? qParams : {} };
              }
              parsedTextTools.push({ name: toolName, args });
            }
          } catch (e) {
            log.error('[JSON Fallback] Brace matching but failed to parse extracted JSON:', e.message);
            log.error('[JSON Fallback] Extracted JSON string was:', JSON.stringify(jsonStr));
          }
        }
      }

      if (parsedTextTools.length > 0) {
        isTextToolCall = true;
        log.info(`[JSON Fallback] Loop ${loopCount}/${MAX_LOOPS}: executing ${parsedTextTools.length} text-based tool calls`);
        
        // Push original assistant response text to history
        messages.push({ role: 'assistant', content: assistantMessage.content });

        // Run all tools sequentially and aggregate results
        const results = [];
        for (const t of parsedTextTools) {
          const result = await runToolCall(t);
          results.push({ tool: t, result });
        }

        // Push aggregated tool outputs to history
        const summary = results.map(r => 
          `[SISTEM] Hasil eksekusi tool ${r.tool.name} dengan parameter ${JSON.stringify(r.tool.args)}:\n${JSON.stringify(r.result)}`
        ).join('\n\n');

        messages.push({
          role: 'user',
          content: summary
        });

        const nextPayload = { model, messages };
        if (tools) nextPayload.tools = tools;
        response = await callOpenRouterAPI(apiKey, nextPayload, true);
        if (!response.choices || response.choices.length === 0) {
          log.warn('OpenRouter: choices kosong setelah text tool-call', loopCount);
          break;
        }
        continue;
      }

      if (!toolCalls && !isTextToolCall) break;
      if (toolCalls && toolCalls.length === 0 && !isTextToolCall) break;

      log.info(`OpenRouter tool-call loop ${loopCount}/${MAX_LOOPS}: ${toolCalls.map(f => f.function.name).join(', ')}`);

      messages.push(assistantMessage);

      const toolOutputs = await Promise.all(toolCalls.map(async call => {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
        const result = await runToolCall({ name: call.function.name, args });
        return {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result)
        };
      }));

      messages.push(...toolOutputs);

      const nextPayload = { model, messages };
      if (tools) nextPayload.tools = tools;
      response = await callOpenRouterAPI(apiKey, nextPayload, true);

      // FIX #4 — Validasi choices juga di iterasi berikutnya
      if (!response.choices || response.choices.length === 0) {
        log.warn('OpenRouter: choices kosong pada iterasi tool-call', loopCount);
        break;
      }
    }

    const choice = response.choices?.[0];
    // FIX #4 — Ekstrak teks dengan fallback berlapis
    const finalText =
      choice?.message?.content ||
      choice?.text ||
      (response.choices || []).map(c => c?.message?.content || c?.text || '').filter(Boolean).join('\n') ||
      'Model tidak mengembalikan teks. Coba gunakan model lain atau ulangi pertanyaan.';

    if (!choice?.message?.content) {
      log.warn('OpenRouter: finalText fallback digunakan. choice:', JSON.stringify(choice).slice(0, 200));
    }

    log.info('OpenRouter selesai — panjang respons:', finalText.length, 'karakter');
    return { role: 'model', content: finalText, isSimulation: false };

  } catch (error) {
    log.error('sendMessageToOpenRouter error:', error.message);
    throw error;
  }
}

async function callOpenRouterAPI(apiKey, payload, isToolResult = false) {
  const timeoutMs = isToolResult ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
  log.debug('OpenRouter API call, timeout:', timeoutMs, 'ms, model:', payload.model);

  const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Survey Monitoring BPS PPU',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, timeoutMs);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || '';
    const fullMsg = `[HTTP ${response.status}] ${msg}`.trim();
    log.error('OpenRouter HTTP error:', response.status, fullMsg, JSON.stringify(data).slice(0, 300));
    throw new Error(fullMsg);
  }
  return data;
}

function extractJSONObjects(text) {
  const objects = [];
  let braceCount = 0;
  let startIndex = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (char === '\\') {
        escape = !escape;
      } else if (char === '"' && !escape) {
        inString = false;
      } else {
        escape = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      escape = false;
      continue;
    }

    if (char === '{') {
      if (braceCount === 0) {
        startIndex = i;
      }
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0 && startIndex !== -1) {
        objects.push(text.substring(startIndex, i + 1));
        startIndex = -1;
      }
    }
  }
  return objects;
}

function sanitizeJSONString(str) {
  let cleaned = str.trim();
  
  // Fix common trailing parentheses typos like "})]" or "})}"
  cleaned = cleaned.replace(/\}\s*\)\s*\]/g, '}]');
  cleaned = cleaned.replace(/\}\s*\)\s*\}/g, '}}');
  cleaned = cleaned.replace(/\]\s*\)\s*\}/g, ']}');
  cleaned = cleaned.replace(/\)\s*\]/g, ']');
  cleaned = cleaned.replace(/\)\s*\}/g, '}');

  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────
//  STREAMING IMPLEMENTATIONS (SSE-READY)
// ─────────────────────────────────────────────────────────────────────────

async function streamMessageToGemini(userMessage, chatHistory, settings, selectedModel, abortSignal, customApiKey, onEvent, systemInstruction = SYSTEM_INSTRUCTION) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const apiKey = customApiKey || settings.gemini_api_key;
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = LEGACY_GEMINI_MODELS.has(selectedModel) ? GEMINI_DEFAULT_MODEL : (selectedModel || GEMINI_DEFAULT_MODEL);

    log.debug('[STREAM:GEMINI] Model:', geminiModel);

    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemInstruction,
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
                route: { type: "STRING", description: PAGE_DATA_TOOL_DECLARATION.parameters.properties.route.description },
                queryParams: { type: "OBJECT", description: PAGE_DATA_TOOL_DECLARATION.parameters.properties.queryParams.description }
              },
              required: ["route"]
            }
          }
        ]
      }]
    });

    const formattedHistory = chatHistory.slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    if (formattedHistory.length > 0 && formattedHistory[0].role === 'model') {
      formattedHistory.shift();
    }

    const chat = model.startChat({ history: formattedHistory });

    let currentPayload = userMessage;
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let fullAccumulatedText = '';

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

      onEvent('status', {
        text: loopCount === 0 ? 'Menghubungkan ke Pananyo Taka AI...' : 'Menganalisis hasil data...',
        step: 'model_call'
      });

      const streamResult = await chat.sendMessageStream(currentPayload);
      let functionCallsInTurn = [];

      // Guard: SDK v0.24.1 returns {stream: undefined} on HTTP errors (429, 403)
      // instead of throwing. Detect this and surface the real error from .response.
      if (!streamResult?.stream) {
        try {
          await streamResult.response; // This will throw the real API error
        } catch (apiErr) {
          throw apiErr; // Re-throw so SmartSwitch handles it
        }
        throw new Error('Gemini API tidak mengembalikan stream. Coba lagi.');
      }

      for await (const chunk of streamResult.stream) {
        if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

        let fcs = null;
        try {
          fcs = chunk.functionCalls();
        } catch (_) {}

        if (fcs && fcs.length > 0) {
          functionCallsInTurn.push(...fcs);
        }

        let chunkText = '';
        try {
          chunkText = chunk.text();
        } catch (_) {}

        if (chunkText) {
          fullAccumulatedText += chunkText;
          onEvent('chunk', { text: chunkText });
        }
      }

      if (functionCallsInTurn.length === 0) {
        if (!fullAccumulatedText) {
          try {
            const resp = await streamResult.response;
            const t = resp.text();
            if (t) {
              fullAccumulatedText = t;
              onEvent('chunk', { text: t });
            }
          } catch (_) {}
        }
        break;
      }

      loopCount++;
      log.info(`[STREAM:GEMINI] Tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCallsInTurn.map(f => f.name).join(', ')}`);

      for (const fc of functionCallsInTurn) {
        const toolMsg = fc.name === 'fetch_page_data'
          ? `📊 Membaca data ${fc.args?.route || 'halaman'}...`
          : `⚙️ Menjalankan kueri database...`;
        onEvent('tool_start', { tool: fc.name, args: fc.args, message: toolMsg });
      }

      const toolResponses = await Promise.all(
        functionCallsInTurn.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          const rowInfo = result.rowCount !== undefined ? ` (${result.rowCount} baris)` : '';
          onEvent('tool_end', { tool: fc.name, message: `✅ Selesai mengambil data${rowInfo}` });
          return { functionResponse: { name: fc.name, response: result } };
        })
      );

      onEvent('status', { text: '✍️ Merumuskan jawaban...', step: 'writing' });
      currentPayload = toolResponses;
    }

    if (!fullAccumulatedText.trim()) {
      fullAccumulatedText = 'Model tidak mengembalikan teks jawaban.';
      onEvent('chunk', { text: fullAccumulatedText });
    }

    return { role: 'model', content: fullAccumulatedText, isSimulation: false };

  } catch (error) {
    log.error('streamMessageToGemini error:', error.message);
    throw error;
  }
}

async function streamMessageToOpenRouter(userMessage, chatHistory, settings, selectedModel, abortSignal, onEvent, systemInstruction = SYSTEM_INSTRUCTION) {
  const apiKey = settings.openrouter_api_key;
  const model = selectedModel || settings.openrouter_model || OPENROUTER_DEFAULT_MODEL;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...chatHistory.slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];

  const modelSupportsTool = !model.includes(':free');
  const tools = modelSupportsTool ? [
    {
      type: 'function',
      function: {
        name: TOOL_DECLARATION.name,
        description: TOOL_DECLARATION.description,
        parameters: TOOL_DECLARATION.parameters
      }
    },
    {
      type: 'function',
      function: {
        name: PAGE_DATA_TOOL_DECLARATION.name,
        description: PAGE_DATA_TOOL_DECLARATION.description,
        parameters: PAGE_DATA_TOOL_DECLARATION.parameters
      }
    }
  ] : undefined;

  onEvent('status', { text: `Menghubungkan ke OpenRouter (${model})...`, step: 'model_call' });

  let loopCount = 0;
  const MAX_LOOPS = 5;
  let fullAccumulatedText = '';

  while (loopCount < MAX_LOOPS) {
    if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

    const payload = { model, messages, stream: true };
    if (tools) payload.tools = tools;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Survey Monitoring BPS PPU',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      throw new Error(`[HTTP ${resp.status}] ${errJson?.error?.message || resp.statusText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let toolCallsMap = {};
    let turnText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);
          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (delta?.content) {
            turnText += delta.content;
            fullAccumulatedText += delta.content;
            onEvent('chunk', { text: delta.content });
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap[idx]) {
                toolCallsMap[idx] = { id: tc.id || `tc_${idx}`, name: '', arguments: '' };
              }
              if (tc.id) toolCallsMap[idx].id = tc.id;
              if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
            }
          }
        } catch (_) {}
      }
    }

    const toolCallsList = Object.values(toolCallsMap).filter(t => t.name);
    if (toolCallsList.length === 0) {
      // Check if text JSON fallback tool calling is present
      if (turnText) {
        const jsonStrings = extractJSONObjects(turnText);
        const parsedTextTools = [];
        for (const jsonStr of jsonStrings) {
          try {
            const parsed = JSON.parse(sanitizeJSONString(jsonStr));
            let toolName = parsed.tool || parsed.name || parsed.function || parsed.action;
            if (!toolName) {
              if (parsed.route || parsed.endpoint || parsed.page) toolName = 'fetch_page_data';
              else if (parsed.query || parsed.sql) toolName = 'run_read_only_query';
            }
            if (toolName === 'run_read_only_query' || toolName === 'fetch_page_data') {
              let args = {};
              if (toolName === 'run_read_only_query') args = { query: parsed.query || parsed.sql || '' };
              else if (toolName === 'fetch_page_data') args = { route: parsed.route || '', queryParams: parsed.queryParams || {} };
              parsedTextTools.push({ name: toolName, args });
            }
          } catch (_) {}
        }
        if (parsedTextTools.length > 0) {
          loopCount++;
          messages.push({ role: 'assistant', content: turnText });
          const results = [];
          for (const t of parsedTextTools) {
            onEvent('tool_start', { tool: t.name, args: t.args, message: `📊 Membaca data ${t.args?.route || 'query'}...` });
            const result = await runToolCall(t);
            onEvent('tool_end', { tool: t.name, message: `✅ Selesai membaca data` });
            results.push({ tool: t, result });
          }
          const summary = results.map(r => `[SISTEM] Hasil eksekusi tool ${r.tool.name}:\n${JSON.stringify(r.result)}`).join('\n\n');
          messages.push({ role: 'user', content: summary });
          continue;
        }
      }
      break;
    }

    loopCount++;
    messages.push({
      role: 'assistant',
      content: turnText || null,
      tool_calls: toolCallsList.map(t => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.arguments }
      }))
    });

    for (const t of toolCallsList) {
      let args = {};
      try { args = JSON.parse(t.arguments || '{}'); } catch (_) {}
      const desc = t.name === 'fetch_page_data' ? `📊 Membaca data ${args.route || ''}...` : '⚙️ Menjalankan kueri...';
      onEvent('tool_start', { tool: t.name, args, message: desc });
      const result = await runToolCall({ name: t.name, args });
      onEvent('tool_end', { tool: t.name, message: '✅ Selesai membaca data' });
      messages.push({
        role: 'tool',
        tool_call_id: t.id,
        name: t.name,
        content: JSON.stringify(result)
      });
    }
  }

  return { role: 'model', content: fullAccumulatedText, isSimulation: false };
}

async function streamMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, onEvent, systemInstruction = SYSTEM_INSTRUCTION) {
  const apiKey = settings.openai_api_key;
  const model = selectedModel || settings.openai_model || OPENAI_DEFAULT_MODEL;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...chatHistory.slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];

  const tools = [
    {
      type: 'function',
      function: {
        name: TOOL_DECLARATION.name,
        description: TOOL_DECLARATION.description,
        parameters: TOOL_DECLARATION.parameters
      }
    },
    {
      type: 'function',
      function: {
        name: PAGE_DATA_TOOL_DECLARATION.name,
        description: PAGE_DATA_TOOL_DECLARATION.description,
        parameters: PAGE_DATA_TOOL_DECLARATION.parameters
      }
    }
  ];

  onEvent('status', { text: `Menghubungkan ke OpenAI (${model})...`, step: 'model_call' });

  let loopCount = 0;
  const MAX_LOOPS = 5;
  let fullAccumulatedText = '';

  while (loopCount < MAX_LOOPS) {
    if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

    const payload = { model, messages, tools, tool_choice: 'auto', stream: true };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      throw new Error(`[HTTP ${resp.status}] ${errJson?.error?.message || resp.statusText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let toolCallsMap = {};
    let turnText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);
          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (delta?.content) {
            turnText += delta.content;
            fullAccumulatedText += delta.content;
            onEvent('chunk', { text: delta.content });
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap[idx]) {
                toolCallsMap[idx] = { id: tc.id || `tc_${idx}`, name: '', arguments: '' };
              }
              if (tc.id) toolCallsMap[idx].id = tc.id;
              if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
            }
          }
        } catch (_) {}
      }
    }

    const toolCallsList = Object.values(toolCallsMap).filter(t => t.name);
    if (toolCallsList.length === 0) break;

    loopCount++;
    messages.push({
      role: 'assistant',
      content: turnText || null,
      tool_calls: toolCallsList.map(t => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.arguments }
      }))
    });

    for (const t of toolCallsList) {
      let args = {};
      try { args = JSON.parse(t.arguments || '{}'); } catch (_) {}
      const desc = t.name === 'fetch_page_data' ? `📊 Membaca data ${args.route || ''}...` : '⚙️ Menjalankan kueri...';
      onEvent('tool_start', { tool: t.name, args, message: desc });
      const result = await runToolCall({ name: t.name, args });
      onEvent('tool_end', { tool: t.name, message: '✅ Selesai membaca data' });
      messages.push({
        role: 'tool',
        tool_call_id: t.id,
        name: t.name,
        content: JSON.stringify(result)
      });
    }
  }

  return { role: 'model', content: fullAccumulatedText, isSimulation: false };
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

async function streamMessageToAgent(userMessage, chatHistory = [], options = {}, onEvent = () => {}, abortSignal = null) {
  const settings = getSettings();
  const liveCtx = buildLiveContext('se2026');
  const dynInstruction = buildSystemInstruction(liveCtx);
  const initialSelection = resolveAgentSelection(settings, options);

  const tries = [{ provider: initialSelection.provider, model: initialSelection.model }];

  if (settings.chatbot_smart_switch === '1') {
    if (settings.openrouter_api_key && settings.openrouter_api_key.trim()) {
      const listStr = settings.openrouter_models_list || 'meta-llama/llama-3.3-70b-instruct:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
      for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (tries.length >= MAX_SWITCH_TRIES) break;
        if (m.includes(':free')) tries.push({ provider: 'openrouter', model: m });
      }
    }
    if (settings.gemini_api_key && settings.gemini_api_key.trim() && tries.length < MAX_SWITCH_TRIES) {
      const listStr = settings.gemini_models_list || 'gemini-2.5-flash, gemini-3.1-flash-lite, gemini-3.5-flash, gemini-2.5-pro';
      for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (tries.length >= MAX_SWITCH_TRIES) break;
        tries.push({ provider: 'gemini', model: m });
      }
    }
    if (settings.openai_api_key && settings.openai_api_key.trim() && tries.length < MAX_SWITCH_TRIES) {
      const listStr = settings.openai_models_list || 'gpt-5.5, gpt-4o';
      for (const m of listStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (tries.length >= MAX_SWITCH_TRIES) break;
        tries.push({ provider: 'openai', model: m });
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

  for (let i = 0; i < uniqueTries.length; i++) {
    if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
    const current = uniqueTries[i];

    if (i > 0) {
      onEvent('status', { text: `Mengalihkan ke ${current.provider} (${current.model})...`, step: 'smart_switch' });
    }

    if (current.provider === 'gemini') {
      let keysToTry = [settings.gemini_api_key];
      try {
        const backups = JSON.parse(settings.gemini_backup_api_keys || '[]');
        if (Array.isArray(backups)) keysToTry = keysToTry.concat(backups);
      } catch (_) {}
      keysToTry = keysToTry.map(k => k ? k.trim() : '').filter(Boolean);
      keysToTry = [...new Set(keysToTry)];

      if (keysToTry.length === 0) continue;

      for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
        const activeKey = keysToTry[kIdx];
        try {
          const result = await streamMessageToGemini(
            userMessage, chatHistory, settings, current.model, abortSignal, activeKey, onEvent, dynInstruction
          );
          onEvent('done', { reply: result.content, isSimulation: false, role: 'model', model: current.model });
          return result;
        } catch (err) {
          lastError = err;
          log.error(`[STREAM:GEMINI] Key #${kIdx} gagal:`, err.message);
        }
      }

      if (settings.chatbot_smart_switch !== '1') break;
    } else if (current.provider === 'openrouter') {
      const apiKey = settings.openrouter_api_key;
      if (!apiKey || !apiKey.trim()) continue;

      try {
        const result = await streamMessageToOpenRouter(
          userMessage, chatHistory, settings, current.model, abortSignal, onEvent, dynInstruction
        );
        onEvent('done', { reply: result.content, isSimulation: false, role: 'model', model: current.model });
        return result;
      } catch (err) {
        lastError = err;
        log.error(`[STREAM:OPENROUTER] ${current.model} gagal:`, err.message);
        if (settings.chatbot_smart_switch !== '1') break;
      }
    } else if (current.provider === 'openai') {
      const apiKey = settings.openai_api_key;
      if (!apiKey || !apiKey.trim()) continue;

      try {
        const result = await streamMessageToOpenAI(
          userMessage, chatHistory, settings, current.model, abortSignal, onEvent, dynInstruction
        );
        onEvent('done', { reply: result.content, isSimulation: false, role: 'model', model: current.model });
        return result;
      } catch (err) {
        lastError = err;
        log.error(`[STREAM:OPENAI] ${current.model} gagal:`, err.message);
        if (settings.chatbot_smart_switch !== '1') break;
      }
    }
  }

  log.info('[STREAM] Semua provider gagal, fallback ke streamSimulation...');
  const sim = await streamSimulation(userMessage, chatHistory, onEvent, abortSignal);

  // Translate technical errors into user-friendly messages
  let rawErr = lastError ? lastError.message : 'API key tidak terkonfigurasi';
  let friendlyErr = rawErr;
  if (rawErr.includes('429') || rawErr.includes('quota') || rawErr.toLowerCase().includes('rate limit')) {
    friendlyErr = 'Kuota permintaan harian API Gemini habis (429 Too Many Requests). Coba lagi besok atau gunakan API Key lain.';
  } else if (rawErr.includes('403') || rawErr.includes('leaked') || rawErr.includes('API key')) {
    friendlyErr = 'API Key Gemini tidak valid atau telah dicabut (403 Forbidden). Periksa pengaturan API Key Anda.';
  } else if (rawErr.includes('pipeThrough') || rawErr.includes('undefined')) {
    friendlyErr = 'Terjadi kesalahan saat menerima streaming dari Gemini. Kemungkinan karena kuota habis atau jaringan tidak stabil.';
  } else if (rawErr.includes('503') || rawErr.includes('Service Unavailable')) {
    friendlyErr = 'Server Gemini sedang kelebihan beban (503). Coba lagi dalam beberapa saat.';
  } else if (rawErr.includes('timed out') || rawErr.includes('timeout')) {
    friendlyErr = 'Koneksi ke Gemini melebihi batas waktu. Coba lagi atau periksa koneksi internet Anda.';
  }

  sim.content = `⚠️ **AI Provider Error:** ${friendlyErr}\n\n*Fallback ke simulasi lokal:*\n\n` + sim.content;
  onEvent('done', { reply: sim.content, isSimulation: true, role: 'model' });
  return sim;
}

module.exports = { sendMessageToAgent, streamMessageToAgent, fetchPageData };