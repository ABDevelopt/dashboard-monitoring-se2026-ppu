'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  toolRegistry.js
//  Mendefinisikan skema tool AI (Gemini/OpenAI format) dan mengelola eksekusi
//  tool call dengan cache terintegrasi.
// ─────────────────────────────────────────────────────────────────────────────

const { 
  getDb, 
  getSettings, 
  getLatestUpload, 
  getOverviewSummary, 
  getKecamatanStats, 
  getPclStats, 
  getPmlStats, 
  getKorlapStats, 
  getAnomalyStats, 
  getEarlyWarning,
  attachProgressPercentages 
} = require('../../database');
const { getFirestore, isFirebaseActive } = require('../firebaseService');
const cacheManager = require('./cacheManager');

// ─────────────────────────────────────────────
//  SQL VALIDATION & UTILS
// ─────────────────────────────────────────────
const SQL_FORBIDDEN = ['insert','update','delete','drop','alter','create','replace','truncate','grant','revoke','pragma','reindex'];
const QUERY_DEFAULT_LIMIT = 200;
const TOOL_RESULT_MAX_ROWS = 20;

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

function injectLimit(sql, limit = QUERY_DEFAULT_LIMIT) {
  if (/\blimit\b/i.test(sql)) return sql;
  return `${sql.trimEnd().replace(/;+$/, '')} LIMIT ${limit}`;
}

// ─────────────────────────────────────────────
//  ASYNC SQL QUERY EXECUTION
// ─────────────────────────────────────────────
async function executeQueryAsync(sql, params = {}) {
  const cleanSql = injectLimit(validateSql(sql));

  return new Promise((resolve, reject) => {
    // Timeout query setelah 10 detik
    const killTimer = setTimeout(() => {
      reject(new Error('Query timeout setelah 10s. Coba persempit hasil query Anda.'));
    }, 10000);

    setImmediate(() => {
      try {
        const db = getDb();
        try { db.pragma('journal_mode = WAL'); } catch (_) {}

        const stmt = db.prepare(cleanSql);
        // Bind parameters if provided, otherwise query all
        const rows = Object.keys(params).length > 0 ? stmt.all(params) : stmt.all();

        clearTimeout(killTimer);
        resolve(rows);
      } catch (err) {
        clearTimeout(killTimer);
        reject(err);
      }
    });
  });
}

// ─────────────────────────────────────────────
//  LEGACY COMPATIBILITY ROUTE HANDLER (FOR EXPRESS /agent/fetch_page_data)
// ─────────────────────────────────────────────
async function fetchPageDataCompat(route, queryParams = {}) {
  const normalizedRoute = String(route || '').trim().replace(/\/+$|\?.*$/, '').toLowerCase();
  const page = normalizedRoute === '' || normalizedRoute === '/' ? '/overview' : normalizedRoute;

  const upload = getLatestUpload();
  if (!upload) return { error: 'Belum ada data upload dalam sistem.' };

  const settings = getSettings();
  const db = getDb();

  switch (page) {
    case '/overview':
      return {
        route: '/overview',
        summary: getOverviewSummary(upload.id, settings),
        kecamatanStats: getKecamatanStats(upload.id, settings)
      };
    case '/pcl': {
      const stats = getPclStats(upload.id, settings);
      return { route: '/pcl', pclStats: stats };
    }
    case '/pml':
      return { route: '/pml', pmlStats: getPmlStats(upload.id, settings) };
    case '/korlap':
      return { route: '/korlap', korlapStats: getKorlapStats(upload.id, settings) };
    case '/kecamatan':
      return { route: '/kecamatan', kecamatanStats: getKecamatanStats(upload.id, settings) };
    case '/deteksi-anomali':
    case '/deteksianomali':
      return { route: '/deteksi-anomali', anomalyStats: getAnomalyStats(upload.id) };
    case '/early-warning':
    case '/earlywarning':
      return { route: '/early-warning', earlyWarning: getEarlyWarning(upload.id) };
    default:
      return { error: `Halaman ${page} tidak dikenal.` };
  }
}

// ─────────────────────────────────────────────
//  TOOL DEFINITIONS FOR LLM
// ─────────────────────────────────────────────
const TOOL_SCHEMAS = {
  // New clean structured tools
  query_data: {
    name: "query_data",
    description: "Execute a read-only SELECT SQL query on the SQLite database with optional binding parameters.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "The SQLite query starting with SELECT or WITH. e.g. 'SELECT pml, korlap FROM subsls_master WHERE kecamatan = :kec LIMIT 5'" },
        params: { type: "OBJECT", description: "Optional key-value object to bind query parameters." }
      },
      required: ["query"]
    }
  },
  get_summary: {
    name: "get_summary",
    description: "Get pre-computed summary aggregates from the summary_cache table directly.",
    parameters: {
      type: "OBJECT",
      properties: {
        uploadId: { type: "INTEGER", description: "The upload ID (always query latest from overview if not specified)." },
        kecamatan: { type: "STRING", description: "Optional kecamatan filter." },
        desa: { type: "STRING", description: "Optional desa filter." }
      },
      required: ["uploadId"]
    }
  },
  get_anomaly: {
    name: "get_anomaly",
    description: "Get performance anomalies or active warning logs for PML/PCL/Korlap.",
    parameters: {
      type: "OBJECT",
      properties: {
        uploadId: { type: "INTEGER", description: "The upload ID." },
        kecamatan: { type: "STRING", description: "Optional kecamatan filter." }
      },
      required: ["uploadId"]
    }
  },
  get_petugas: {
    name: "get_petugas",
    description: "Get progress stats for PCL (surveyors), PML (supervisors), or Korlap (coordinators).",
    parameters: {
      type: "OBJECT",
      properties: {
        uploadId: { type: "INTEGER", description: "The upload ID." },
        role: { type: "STRING", description: "Role name to fetch: 'pcl', 'pml', or 'korlap'." }
      },
      required: ["uploadId", "role"]
    }
  },
  // Legacy compatibility tools
  run_read_only_query: {
    name: "run_read_only_query",
    description: "Execute a read-only SELECT SQL query on the SQLite database.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "The SELECT SQL query." } },
      required: ["query"]
    }
  },
  fetch_page_data: {
    name: "fetch_page_data",
    description: "Fetch summarized internal data for a given website route like /overview, /pcl, /pml, /kecamatan, /early-warning, /deteksi-anomali.",
    parameters: {
      type: "OBJECT",
      properties: {
        route: { type: "STRING", description: "Internal route like /overview, /pcl, /kecamatan" },
        queryParams: { type: "OBJECT", description: "Optional filters (e.g. { kecamatan: 'Penajam' })" }
      },
      required: ["route"]
    }
  }
};

// ─────────────────────────────────────────────
//  TOOL RUNNER WITH CACHE INTEGRATION (5 MINS TTL)
// ─────────────────────────────────────────────
async function runToolCall(toolCall) {
  const { name, args } = toolCall;
  const cacheKey = cacheManager.generateKey(name, args);

  // 1. Check cache first
  const cachedVal = cacheManager.get(cacheKey);
  if (cachedVal) {
    console.info(`[TOOL_REGISTRY] Cache HIT for tool '${name}'`);
    return cachedVal;
  }

  console.info(`[TOOL_REGISTRY] Cache MISS for tool '${name}' - executing...`);
  let result;

  try {
    switch (name) {
      case 'query_data':
      case 'run_read_only_query': {
        const query = args.query || '';
        const params = args.params || {};
        const rows = await executeQueryAsync(query, params);
        const total = rows.length;
        const truncated = total > TOOL_RESULT_MAX_ROWS;
        const finalRows = truncated ? rows.slice(0, TOOL_RESULT_MAX_ROWS) : rows;

        result = {
          status: 'success',
          rowCount: total,
          returned: finalRows.length,
          truncated,
          data: finalRows,
          message: total === 0 ? 'Tidak ada baris data yang cocok dengan kueri ini. Periksa filter kode (16 digit/LIKE) atau kondisi WHERE.' : undefined
        };
        break;
      }


      case 'get_summary': {
        const db = getDb();
        const uploadId = args.uploadId;
        const kec = args.kecamatan;
        const desa = args.desa;
        let query = 'SELECT * FROM summary_cache WHERE upload_id = ?';
        const params = [uploadId];
        if (kec) {
          query += ' AND LOWER(kecamatan) = LOWER(?)';
          params.push(kec);
        }
        if (desa) {
          query += ' AND LOWER(desa) = LOWER(?)';
          params.push(desa);
        }
        query += ' LIMIT 50';

        const rows = db.prepare(query).all(...params);
        result = { status: 'success', data: rows };
        break;
      }

      case 'get_anomaly': {
        const uploadId = args.uploadId;
        const anomalies = getAnomalyStats(uploadId);
        result = { status: 'success', anomalyCount: anomalies.length, data: anomalies.slice(0, 20) };
        break;
      }

      case 'get_petugas': {
        const uploadId = args.uploadId;
        const role = String(args.role).toLowerCase();
        const settings = getSettings();
        let data;
        if (role === 'pcl') data = getPclStats(uploadId, settings);
        else if (role === 'pml') data = getPmlStats(uploadId, settings);
        else if (role === 'korlap') data = getKorlapStats(uploadId, settings);
        else throw new Error(`Role petugas '${role}' tidak dikenal.`);

        result = { status: 'success', role, data: data.slice(0, 20) };
        break;
      }

      case 'fetch_page_data': {
        const route = args.route || '';
        const queryParams = args.queryParams || {};
        const data = await fetchPageDataCompat(route, queryParams);
        result = { status: 'success', ...data };
        break;
      }

      default:
        throw new Error(`Tool name '${name}' tidak terdaftar.`);
    }

    // Save to cache (default TTL 5 minutes)
    cacheManager.set(cacheKey, result);
    return result;

  } catch (err) {
    console.error(`[TOOL_REGISTRY] Error executing tool '${name}':`, err.message);
    return {
      status: 'error',
      message: err.message,
      instruction: 'Laporkan error ini ke user secara transparan. Jangan mengarang data.'
    };
  }
}

function formatToolRowsToMarkdown(toolName, args, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return `🤖 **Hasil Pencarian Data**\n\nTidak ditemukan data untuk parameter tersebut.`;
  }

  const colMap = {
    pcl: 'Nama PCL',
    pml: 'PML Pengawas',
    korlap: 'Korlap',
    kecamatan: 'Kecamatan',
    desa: 'Desa',
    nama_sls: 'Nama SLS',
    kode: 'Kode SLS',
    realisasi_fasih: 'Realisasi FASIH',
    target_fasih: 'Target FASIH',
    draft: 'Draft',
    submitted: 'Submitted',
    approved: 'Approved',
    rejected: 'Rejected',
    pct_fasih: '% FASIH',
    pct_muatan: '% Muatan',
    muatan_selesai: 'Realisasi Muatan',
    target_muatan: 'Target Muatan',
    total_muatan: 'Target Muatan',
    usaha_ganda: 'Usaha Ganda',
    total_sls: 'Total SLS',
    start_date: 'Tanggal Mulai',
    end_date: 'Tanggal Selesai',
    elapsed_days: 'Durasi Lapangan (Hari)',
    total_realisasi_fasih: 'Total Realisasi FASIH',
    jumlah_pcl_aktif: 'Jumlah PCL Aktif',
    jumlah_pcl_punya_target: 'PCL Ber-target',
    avg_daily_per_pcl: 'Rata-Rata Progres Harian (Dok/PCL/Hari)',
    avg_daily: 'Rata-Rata Harian'
  };

  const keys = Object.keys(rows[0]);
  const headers = keys.map(k => {
    const lk = k.toLowerCase();
    return colMap[lk] || colMap[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  });

  let markdown = `Berikut ringkasan data hasil analisis:\n\n`;

  if (rows.length === 1 && keys.length <= 8) {
    const row = rows[0];
    markdown += `📊 **Indikator Kinerja Utama:**\n`;
    keys.forEach(k => {
      const label = colMap[k.toLowerCase()] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      let val = row[k];
      if (val === null || val === undefined) val = '-';
      else if (typeof val === 'number') val = val.toLocaleString('id-ID');
      markdown += `- **${label}:** ${val}\n`;
    });
    markdown += `\n`;
  }

  markdown += `| # | ${headers.join(' | ')} |\n`;
  markdown += `| :---: | ${keys.map(() => ':---').join(' | ')} |\n`;

  rows.forEach((r, idx) => {
    const rowVals = keys.map(k => {
      let val = r[k];
      if (val === null || val === undefined) return '-';
      if (typeof k === 'string' && (k.toLowerCase().startsWith('pct_') || k.toLowerCase().includes('percent'))) return `**${val}%**`;
      if (typeof val === 'number') return val.toLocaleString('id-ID');
      return String(val);
    });
    markdown += `| ${idx + 1} | ${rowVals.join(' | ')} |\n`;
  });

  const avgKey = keys.find(k => k.toLowerCase().includes('avg'));
  if (avgKey) {
    const avgVal = rows[0][avgKey];
    if (avgVal) {
      markdown += `\n📌 **Rekomendasi / Analisis:** Rata-rata pencapaian PCL sebesar **${avgVal} dokumen per hari per petugas**. Tingkatkan pengawasan lapangan untuk wilayah dengan progres di bawah rata-rata.`;
    }
  }

  return markdown;
}

function formatQueryHintToMarkdown(queryName, params, rows) {
  if (!rows || rows.length === 0) {
    return `🤖 **Hasil Pencarian Data**\n\nTidak ditemukan data untuk parameter: \`${JSON.stringify(params || {})}\`.`;
  }

  return formatToolRowsToMarkdown(queryName, params, rows);
}

function processJsonQueryResponse(text) {
  if (typeof text !== 'string' || !text.trim()) return text;

  const trimmed = text.trim();
  let jsonObj = null;

  try {
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      jsonObj = JSON.parse(trimmed);
    } else {
      const match = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || trimmed.match(/(\{[\s\S]*?"query_name"[\s\S]*?\})/);
      if (match && match[1]) {
        jsonObj = JSON.parse(match[1]);
      }
    }
  } catch (_) {}

  if (!jsonObj || typeof jsonObj !== 'object') return text;

  const queryName = jsonObj.query_name || jsonObj.queryName;
  const toolName = jsonObj.tool || jsonObj.name;
  const rawParams = jsonObj.params || jsonObj.args || {};

  const { QUERY_HINTS } = require('../queryHints');

  if (queryName && QUERY_HINTS[queryName]) {
    try {
      const hint = QUERY_HINTS[queryName];
      const latestUpload = getLatestUpload();
      const db = getDb();

      const params = {
        uploadId: rawParams.uploadId || (latestUpload ? latestUpload.id : 1),
        kecamatan: rawParams.kecamatan || null,
        desa: rawParams.desa || null,
        pml: rawParams.pml || null,
        pcl: rawParams.pcl || null,
        korlap: rawParams.korlap || null,
        kode: rawParams.kode || null,
        nama_sls: rawParams.nama_sls ? `%${rawParams.nama_sls}%` : null,
        limit: rawParams.limit || 20
      };

      const stmt = db.prepare(hint.sql);
      const rows = stmt.all(params);
      return formatQueryHintToMarkdown(queryName, rawParams, rows);
    } catch (err) {
      console.error(`[TOOL_REGISTRY] Error processing query hint '${queryName}':`, err.message);
    }
  } else if (toolName === 'query_data' || toolName === 'run_read_only_query') {
    try {
      const query = rawParams.query || jsonObj.query;
      if (query) {
        const db = getDb();
        const rows = db.prepare(validateSql(query)).all(rawParams.params || {});
        return formatQueryHintToMarkdown('custom_query', rawParams, rows);
      }
    } catch (err) {
      console.error(`[TOOL_REGISTRY] Error executing json query_data:`, err.message);
    }
  }

  return text;
}

module.exports = {
  TOOL_SCHEMAS,
  runToolCall,
  fetchPageDataCompat,
  processJsonQueryResponse,
  formatToolRowsToMarkdown
};
