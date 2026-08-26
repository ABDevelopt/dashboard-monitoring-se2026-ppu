const express = require('express');
const router  = express.Router();
const { sendMessageToAgent, streamMessageToAgent } = require('../services/agentService');
const { getSettings, getAgentQueryById, executeAgentQueryById, getLatestUpload } = require('../database');
const logger = require('../services/logger');

// Middleware untuk membatasi endpoint sensitif internal log hanya untuk Admin
function requireAdminOnly(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Akses ditolak. Hanya administrator yang dapat mengakses log sistem.' });
}

// ─────────────────────────────────────────────────────────────────
//  GET / — render halaman agent
// ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const settings = getSettings();
  const geminiEnabled = !!(settings.gemini_api_key && settings.gemini_api_key.trim());
  const provider = 'gemini';
  const hasKey = geminiEnabled;

  const geminiModels = settings.gemini_models_list
    ? settings.gemini_models_list.split(',').map(m => m.trim()).filter(Boolean)
    : ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  if (settings.gemini_model && !geminiModels.includes(settings.gemini_model)) {
    geminiModels.push(settings.gemini_model);
  }

  res.render('agent', {
    title              : 'Asisten AI Chat',
    activePage         : 'agent',
    hasKey,
    provider           : 'gemini',
    selectedGeminiModel: settings.gemini_model || 'gemini-3.5-flash',
    geminiModels,
    hasGeminiKey       : geminiEnabled
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /table — Render Halaman Tabel Lengkap Hasil Query AI
// ─────────────────────────────────────────────────────────────────
router.get('/table', (req, res) => {
  const queryId = req.query.id || req.query.qid || '';
  if (!queryId) {
    req.flash('error', 'ID Kueri tidak valid.');
    return res.redirect('/agent');
  }

  const queryRecord = getAgentQueryById(queryId);
  if (!queryRecord) {
    req.flash('error', 'Riwayat kueri data tidak ditemukan atau sudah kadaluarsa.');
    return res.redirect('/agent');
  }

  const executionResult = executeAgentQueryById(queryId);
  const rows = executionResult.rows || [];
  const latestUpload = getLatestUpload();

  res.render('agent-table', {
    title: 'Eksplorasi Data Tabel AI',
    activePage: 'agent-table',
    queryId,
    query: queryRecord,
    rows,
    latestUpload,
    error: executionResult.error || null
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/query-data/:id — API JSON data kueri lengkap
// ─────────────────────────────────────────────────────────────────
router.get('/api/query-data/:id', (req, res) => {
  const queryId = req.params.id;
  const executionResult = executeAgentQueryById(queryId);
  if (executionResult.error) {
    return res.status(404).json({ success: false, error: executionResult.error });
  }
  res.json({
    success: true,
    query: executionResult.query,
    totalRows: executionResult.rows.length,
    rows: executionResult.rows
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /export-query/:id — Export data kueri ke Excel (.xlsx) / CSV
// ─────────────────────────────────────────────────────────────────
router.get('/export-query/:id', (req, res) => {
  try {
    const queryId = req.params.id;
    const format = (req.query.format || 'xlsx').toLowerCase();
    const executionResult = executeAgentQueryById(queryId);
    
    if (executionResult.error || !executionResult.rows || executionResult.rows.length === 0) {
      req.flash('error', executionResult.error || 'Data kueri kosong.');
      return res.redirect(`/agent/table?id=${queryId}`);
    }

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(executionResult.rows);
    XLSX.utils.book_append_sheet(wb, ws, "Hasil Kueri AI");

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `data_kueri_ai_${queryId}_${dateStr}`;

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    } else {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buf);
    }
  } catch (err) {
    logger.error(`[AGENT:EXPORT] Export query error: ${err.message}`);
    res.status(500).send(`Gagal melakukan export: ${err.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /chat/stream — SSE Streaming endpoint
// ─────────────────────────────────────────────────────────────────
router.post('/chat/stream', async (req, res) => {
  const { message, history, provider, model } = req.body;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-No-Buffer', '1');
  res.setHeader('Content-Encoding', 'none');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': ' + ' '.repeat(2048) + '\n\n');
  if (typeof res.flush === 'function') res.flush();

  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  if (!message || typeof message !== 'string' || !message.trim()) {
    sendEvent('error', { error: 'Pesan tidak boleh kosong.' });
    return res.end();
  }

  if (message.length > 2000) {
    sendEvent('error', { error: 'Pesan terlalu panjang. Maksimum 2000 karakter.' });
    return res.end();
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter(h => h && typeof h.role === 'string' && typeof h.content === 'string')
        .slice(-20)
    : [];

  const safeProvider = 'gemini';

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  const startTime = Date.now();

  // Heartbeat keep-alive (setiap 5 detik kirim komentar SSE ': ping\n\n')
  // untuk mencegah proxy LiteSpeed/Nginx/Cloudflare di Dewaweb memutus koneksi idle
  const heartbeatTimer = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeatTimer);
      return;
    }
    try {
      res.write(': ping\n\n');
      if (typeof res.flush === 'function') res.flush();
    } catch (_) {
      clearInterval(heartbeatTimer);
    }
  }, 5000);

  try {
    sendEvent('status', { text: 'Menyiapkan asisten...', step: 'init' });
    
    // Melewatkan user ID (atau ID sesi guest) untuk memori session di SQLite
    const userId = req.session?.user?.id ? String(req.session.user.id) : (req.sessionID ? `guest_${req.sessionID}` : null);

    await streamMessageToAgent(
      message.trim(),
      safeHistory,
      { provider: safeProvider, model, surveyId: res.locals.activeSurvey || 'se2026' },
      sendEvent,
      controller.signal,
      userId
    );
    const duration = Date.now() - startTime;
    logger.info(`[AGENT:STREAM] OK — ${safeProvider || 'auto'}/${model || 'default'} — ${duration}ms`);
    res.end();
  } catch (err) {
    const duration = Date.now() - startTime;
    const errMsg = err?.message || 'Unknown error';
    logger.error(`[AGENT:STREAM] ERROR — ${safeProvider || 'auto'} — ${duration}ms — ${errMsg}`);
    
    if (!res.writableEnded) {
      sendEvent('error', { error: errMsg });
      res.end();
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /chat — endpoint fallback (non-streaming)
// ─────────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { message, history, provider, model } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Pesan terlalu panjang. Maksimum 2000 karakter.' });
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter(h => h && typeof h.role === 'string' && typeof h.content === 'string')
        .slice(-20)
    : [];

  const ALLOWED_PROVIDERS = ['gemini'];
  const safeProvider = 'gemini';
  const startTime = Date.now();

  try {
    const userId = req.session?.user?.id ? String(req.session.user.id) : (req.sessionID ? `guest_${req.sessionID}` : null);
    const result = await sendMessageToAgent(
      message.trim(),
      safeHistory,
      { provider: safeProvider, model, surveyId: res.locals.activeSurvey || 'se2026' },
      userId
    );

    const duration = Date.now() - startTime;
    logger.info(`[AGENT:ROUTE] OK — ${safeProvider || 'auto'}/${model || 'default'} — ${duration}ms — sim:${result.isSimulation}`);

    return res.json({
      reply       : result.content,
      isSimulation: result.isSimulation,
      role        : result.role,
      ...(process.env.NODE_ENV !== 'production' && { _durationMs: duration })
    });

  } catch (err) {
    const errorObj = err || new Error('Unknown error');
    const errMsg = errorObj.message || 'Unknown error';
    const errStack = errorObj.stack || '';
    const duration = Date.now() - startTime;

    const isTimeout  = /timed out|timeout|abort/i.test(errMsg);
    const isApiAuth  = /api key|unauthorized|authentication|invalid_api_key/i.test(errMsg);
    const isRateLimit = /rate.?limit|quota|429/i.test(errMsg);

    logger.error(
      `[AGENT:ROUTE] ERROR — ${safeProvider || 'auto'} — ${duration}ms — ${errMsg} ${isTimeout ? '[TIMEOUT]' : isApiAuth ? '[AUTH]' : isRateLimit ? '[RATE_LIMIT]' : '[UNKNOWN]'}`
    );

    if (errStack) logger.error('[AGENT:ROUTE] Stack: ' + errStack);

    const httpStatus = isTimeout   ? 504
                     : isApiAuth   ? 502
                     : isRateLimit ? 429
                     : 500;

    const userMessage = isTimeout
      ? 'Server AI tidak merespons dalam waktu yang ditentukan. Silakan coba lagi.'
      : isApiAuth
      ? 'API Key tidak valid atau tidak memiliki izin. Periksa konfigurasi di Pengaturan.'
      : isRateLimit
      ? 'Batas permintaan API tercapai. Tunggu sebentar lalu coba lagi.'
      : 'Terjadi kesalahan internal saat memproses permintaan AI.';

    return res.status(httpStatus).json({
      error      : userMessage,
      ...(process.env.NODE_ENV !== 'production' && {
        _debug: {
          originalMessage: errMsg,
          durationMs     : duration,
          type           : isTimeout ? 'TIMEOUT' : isApiAuth ? 'AUTH' : isRateLimit ? 'RATE_LIMIT' : 'UNKNOWN'
        }
      })
    });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /history — Ambil riwayat chat persisten dari SQLite
// ─────────────────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const userId = req.session?.user?.id ? String(req.session.user.id) : (req.sessionID ? `guest_${req.sessionID}` : null);
  if (!userId) {
    return res.json({ history: [] });
  }
  const memoryManager = require('../services/ai/memoryManager');
  const history = memoryManager.getChatHistory(userId);
  return res.json({ history });
});

// ─────────────────────────────────────────────────────────────────
//  GET /logs — Ambil log sistem chatbot terkini (Admin Only)
// ─────────────────────────────────────────────────────────────────
router.get('/logs', requireAdminOnly, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '../logs/combined.log');
    
    if (!fs.existsSync(logFile)) {
      return res.json({ success: true, logs: [] });
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split(/\r?\n/).filter(l => l && l.trim());
    const lastLines = lines.slice(-400); // Ambil 400 baris log terakhir

    const parsedLogs = lastLines.map(line => {
      const trimmed = line.trim();
      try {
        const obj = JSON.parse(trimmed);
        return {
          timestamp: obj.timestamp || '',
          level: (obj.level || 'info').toLowerCase(),
          message: typeof obj.message === 'string' ? obj.message : JSON.stringify(obj.message),
          stack: obj.stack || null
        };
      } catch (_) {
        // Parse format teks biasa: [YYYY-MM-DD HH:mm:ss] level: message
        const match = trimmed.match(/^\[(.*?)\]\s*([a-zA-Z]+):\s*(.*)$/);
        if (match) {
          return { timestamp: match[1], level: match[2].toLowerCase(), message: match[3], stack: null };
        }
        return { message: trimmed, level: 'info', timestamp: '', stack: null };
      }
    });

    res.json({ success: true, logs: parsedLogs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /logs/clear — Bersihkan file log sistem (Admin Only)
// ─────────────────────────────────────────────────────────────────
router.post('/logs/clear', requireAdminOnly, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(__dirname, '../logs');
    
    ['combined.log', 'errors.log'].forEach(f => {
      const p = path.join(logDir, f);
      if (fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
    });

    res.json({ success: true, message: 'Log sistem berhasil dibersihkan.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;