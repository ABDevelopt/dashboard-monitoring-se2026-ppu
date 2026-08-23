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
  attachProgressPercentages,
  saveAgentQuery
} = require('../../database');
const { getFirestore, isFirebaseActive } = require('../firebaseService');
const cacheManager = require('./cacheManager');
const _logger = require('../logger');

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

  switch (page) {
    case '/overview':
      return {
        route: '/overview',
        summary: getOverviewSummary(upload.id, settings),
        earlyWarning: getEarlyWarning(upload.id, settings),
        timestamp: upload.tanggal
      };
    case '/pcl':
      return {
        route: '/pcl',
        pclList: getPclStats(upload.id, settings),
        summary: getOverviewSummary(upload.id, settings)
      };
    case '/pml':
      return {
        route: '/pml',
        pmlList: getPmlStats(upload.id, settings)
      };
    case '/korlap':
      return {
        route: '/korlap',
        korlapList: getKorlapStats(upload.id, settings)
      };
    case '/kecamatan':
      return {
        route: '/kecamatan',
        kecamatanList: getKecamatanStats(upload.id, settings)
      };
    case '/early-warning':
      return {
        route: '/early-warning',
        warningData: getEarlyWarning(upload.id, settings)
      };
    case '/deteksi-anomali':
      return {
        route: '/deteksi-anomali',
        anomalies: getAnomalyStats(upload.id)
      };
    default:
      return {
        route: page,
        summary: getOverviewSummary(upload.id, settings)
      };
  }
}

// ─────────────────────────────────────────────
//  TOOL DEFINITIONS FOR LLM
// ─────────────────────────────────────────────
const TOOL_SCHEMAS = {
  query_data: {
    name: "query_data",
    description: "Run custom read-only SELECT SQL queries against the local SQLite database. Use for aggregate stats, counts, filtering, rankings, and trends.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "The SELECT SQL query string to run." },
        params: { type: "OBJECT", description: "Optional named bind parameters object (e.g. { kec: 'Sepaku' })." }
      },
      required: ["query"]
    }
  },
  get_summary: {
    name: "get_summary",
    description: "Get cached summary statistics for an upload, optionally filtered by kecamatan or desa.",
    parameters: {
      type: "OBJECT",
      properties: {
        uploadId: { type: "INTEGER", description: "The upload ID (use latest upload ID if available)." },
        kecamatan: { type: "STRING", description: "Optional kecamatan name." },
        desa: { type: "STRING", description: "Optional desa name." }
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
    description: "Get progress stats for PCL (surveyors), PML (supervisors), or Korlap (coordinators). Supports optional filtering by kecamatan.",
    parameters: {
      type: "OBJECT",
      properties: {
        uploadId: { type: "INTEGER", description: "The upload ID." },
        role: { type: "STRING", description: "Role name to fetch: 'pcl', 'pml', or 'korlap'." },
        kecamatan: { type: "STRING", description: "Optional kecamatan name filter (e.g. 'Sepaku', 'Penajam', 'Babulu', 'Waru')." }
      },
      required: ["uploadId", "role"]
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
    _logger.info(`[TOOL_REGISTRY] Cache HIT for tool '${name}'`);
    return cachedVal;
  }

  _logger.info(`[TOOL_REGISTRY] Cache MISS for tool '${name}' - executing...`);
  let result;

  try {
    switch (name) {
      case 'query_data': {
        const query = args.query || '';
        const params = args.params || {};
        const rows = await executeQueryAsync(query, params);
        const total = rows.length;
        const truncated = total > TOOL_RESULT_MAX_ROWS;
        const finalRows = truncated ? rows.slice(0, TOOL_RESULT_MAX_ROWS) : rows;

        const queryId = 'q_' + Math.random().toString(36).substring(2, 9);
        saveAgentQuery({
          id: queryId,
          toolName: name,
          querySql: query,
          queryParams: params,
          columnsJson: Object.keys(rows[0] || {}),
          rowCount: total
        });

        result = {
          status: 'success',
          queryId,
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

        const fullRows = db.prepare(query).all(...params);
        const queryId = 'q_' + Math.random().toString(36).substring(2, 9);
        saveAgentQuery({
          id: queryId,
          toolName: 'get_summary',
          querySql: query,
          queryParams: params,
          columnsJson: Object.keys(fullRows[0] || {}),
          rowCount: fullRows.length
        });

        result = { status: 'success', queryId, rowCount: fullRows.length, data: fullRows.slice(0, 20) };
        break;
      }

      case 'get_anomaly': {
        const uploadId = args.uploadId;
        const anomalies = getAnomalyStats(uploadId);
        const queryId = 'q_' + Math.random().toString(36).substring(2, 9);
        const anomalySql = `
          SELECT 
            p.kode AS "Kode SubSLS",
            m.nama_sls AS "Nama SLS",
            m.desa AS "Desa",
            m.kecamatan AS "Kecamatan",
            COALESCE(p.pcl_name, m.pcl) AS "Nama PCL",
            m.pml AS "PML Pengawas",
            COALESCE(p.usaha_ganda, 0) AS "Usaha Ganda",
            COALESCE(p.tidak_dapat_ditemui, 0) AS "Tidak Ditemui",
            COALESCE(p.rejected, 0) AS "Rejected",
            COALESCE(p.approved, 0) AS "Approved"
          FROM progres p
          JOIN subsls_master m ON p.kode = m.kode
          WHERE p.upload_id = ${uploadId || '(SELECT id FROM uploads ORDER BY id DESC LIMIT 1)'}
            AND (COALESCE(p.usaha_ganda, 0) > 0 OR COALESCE(p.rejected, 0) > 0 OR COALESCE(p.tidak_dapat_ditemui, 0) > 0)
          ORDER BY (COALESCE(p.usaha_ganda, 0) + COALESCE(p.rejected, 0) + COALESCE(p.tidak_dapat_ditemui, 0)) DESC
        `.trim();

        saveAgentQuery({
          id: queryId,
          toolName: 'get_anomaly',
          querySql: anomalySql,
          queryParams: {},
          columnsJson: Object.keys(anomalies[0] || {}),
          rowCount: anomalies.length
        });

        result = { status: 'success', queryId, anomalyCount: anomalies.length, data: anomalies.slice(0, 20) };
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

        const queryId = 'q_' + Math.random().toString(36).substring(2, 9);
        const kecWhere = args.kecamatan ? `AND LOWER(m.kecamatan) LIKE LOWER('%${args.kecamatan.replace(/'/g, "''")}%')` : '';
        const petugasSql = `
          SELECT 
            COALESCE(p.pcl_name, m.pcl) AS "Nama PCL",
            MAX(m.pml) AS "PML Pengawas",
            MAX(m.korlap) AS "Korlap",
            MAX(m.kecamatan) AS "Kecamatan",
            COUNT(DISTINCT p.kode) AS "Total SubSLS",
            SUM(COALESCE(p.sls_selesai, 0)) AS "SLS Selesai",
            SUM(COALESCE(m.muatan, 0)) AS "Target Muatan",
            SUM(COALESCE(p.usaha_ditemukan+p.usaha_baru, 0) + COALESCE(p.ditemukan+p.keluarga_baru, 0)) AS "Realisasi Muatan",
            SUM(COALESCE(p.draft, 0)) AS "Draft",
            SUM(COALESCE(p.submitted_by_pcl, 0)) AS "Submitted",
            SUM(COALESCE(p.approved, 0)) AS "Approved",
            SUM(COALESCE(p.rejected, 0)) AS "Rejected",
            SUM(COALESCE(m.target_fasih, 0)) AS "Target FASIH"
          FROM progres p
          LEFT JOIN subsls_master m ON p.kode = m.kode
          WHERE p.upload_id = ${uploadId || '(SELECT id FROM uploads ORDER BY id DESC LIMIT 1)'} ${kecWhere}
          GROUP BY COALESCE(p.pcl_email, m.pcl_email, m.pcl), COALESCE(p.pcl_name, m.pcl)
          ORDER BY "Approved" DESC, "Target FASIH" DESC
        `.trim();

        saveAgentQuery({
          id: queryId,
          toolName: 'get_petugas',
          querySql: petugasSql,
          queryParams: {},
          columnsJson: Object.keys(data[0] || {}),
          rowCount: data.length
        });

        result = { status: 'success', queryId, role, count: data.length, data: data.slice(0, 20) };
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
    _logger.error(`[TOOL_REGISTRY] Error executing tool '${name}': ${err.message}`);
    return {
      status: 'error',
      message: err.message,
      instruction: 'Laporkan error ini ke user secara transparan. Jangan mengarang data.'
    };
  }
}

function formatToolRowsToMarkdown(toolName, args, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return `**Hasil Pencarian Data**\n\nTidak ditemukan data untuk parameter tersebut.`;
  }

  const topRows = rows.slice(0, 5); // Maksimal 5 baris data

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

  const keys = Object.keys(topRows[0]);
  const headers = keys.map(k => {
    const lk = k.toLowerCase();
    return colMap[lk] || colMap[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  });

  let markdown = `Berikut ringkasan data hasil analisis:\n\n`;

  if (topRows.length === 1 && keys.length <= 8) {
    const row = topRows[0];
    markdown += `**Indikator Kinerja Utama:**\n`;
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

  topRows.forEach((r, idx) => {
    const rowVals = keys.map(k => {
      let val = r[k];
      if (val === null || val === undefined) return '-';
      if (typeof k === 'string' && (k.toLowerCase().startsWith('pct_') || k.toLowerCase().includes('percent'))) return `**${val}%**`;
      if (typeof val === 'number') return val.toLocaleString('id-ID');
      return String(val);
    });
    markdown += `| ${idx + 1} | ${rowVals.join(' | ')} |\n`;
  });

  if (rows.length > 5) {
    markdown += `\n*Menampilkan 5 data prioritas utama dari total ${rows.length} entitas. Data lengkap dapat diakses pada menu monitoring terkait.*\n`;
  }

  const avgKey = keys.find(k => k.toLowerCase().includes('avg'));
  if (avgKey) {
    const avgVal = topRows[0][avgKey];
    if (avgVal) {
      markdown += `\n**Rekomendasi / Analisis:** Rata-rata pencapaian PCL sebesar **${avgVal} dokumen per hari per petugas**. Tingkatkan pengawasan lapangan untuk wilayah dengan progres di bawah rata-rata.`;
    }
  }

  return markdown;
}

function formatQueryHintToMarkdown(queryName, params, rows) {
  if (!rows || rows.length === 0) {
    return `**Hasil Pencarian Data**\n\nTidak ditemukan data untuk parameter: \`${JSON.stringify(params || {})}\`.`;
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
      _logger.error(`[TOOL_REGISTRY] Error processing query hint '${queryName}': ${err.message}`);
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
      _logger.error(`[TOOL_REGISTRY] Error executing json query_data: ${err.message}`);
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
