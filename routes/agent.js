const express = require('express');
const router  = express.Router();
const { sendMessageToAgent, streamMessageToAgent } = require('../services/agentService');
const { getSettings } = require('../database');

// Auth Middleware for Agent chatbot (allows any authenticated accounts)
function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path === '/chat' || req.path === '/chat/stream') {
    return res.status(401).json({ error: 'Akses ditolak. Silakan login terlebih dahulu untuk mengakses Asisten AI.' });
  }
  
  req.flash('error', 'Silakan login terlebih dahulu untuk mengakses Asisten AI.');
  res.redirect('/login');
}

router.use(requireLogin);

// ─────────────────────────────────────────────────────────────────
//  GET / — render halaman agent
// ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
const settings = getSettings();
  const geminiEnabled = !!(settings.gemini_api_key && settings.gemini_api_key.trim());
  const openaiEnabled = !!(settings.openai_api_key && settings.openai_api_key.trim());
  const openrouterEnabled = !!(settings.openrouter_api_key && settings.openrouter_api_key.trim());

  let provider = settings.agent_provider || 'gemini';
  if (provider === 'openai' && !openaiEnabled) {
    provider = openrouterEnabled ? 'openrouter' : 'gemini';
  } else if (provider === 'openrouter' && !openrouterEnabled) {
    provider = openaiEnabled ? 'openai' : 'gemini';
  } else if (provider === 'gemini' && !geminiEnabled) {
    provider = openrouterEnabled ? 'openrouter' : (openaiEnabled ? 'openai' : 'gemini');
  }

  const selectedKey = provider === 'openai'
    ? settings.openai_api_key
    : provider === 'openrouter'
    ? settings.openrouter_api_key
    : settings.gemini_api_key;
  const hasKey = !!(selectedKey && selectedKey.trim());

  const geminiModels = settings.gemini_models_list
    ? settings.gemini_models_list.split(',').map(m => m.trim()).filter(Boolean)
    : ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro'];
  if (settings.gemini_model && !geminiModels.includes(settings.gemini_model)) {
    geminiModels.push(settings.gemini_model);
  }

  const openaiModels = settings.openai_models_list
    ? settings.openai_models_list.split(',').map(m => m.trim()).filter(Boolean)
    : ['gpt-5.5'];
  if (settings.openai_model && !openaiModels.includes(settings.openai_model)) {
    openaiModels.push(settings.openai_model);
  }

  const openrouterModels = settings.openrouter_models_list
    ? settings.openrouter_models_list.split(',').map(m => m.trim()).filter(Boolean)
    : ['openrouter/free', 'openrouter/owl-alpha', 'meta-llama/llama-3.3-70b-instruct:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'];
  if (settings.openrouter_model && !openrouterModels.includes(settings.openrouter_model)) {
    openrouterModels.push(settings.openrouter_model);
  }

  res.render('agent', {
    title              : 'Asisten AI Chat',
    activePage         : 'agent',
    hasKey,
    provider,
    selectedGeminiModel: settings.gemini_model || 'gemini-3.5-flash',
    selectedOpenAIModel: settings.openai_model || 'gpt-5.5',
    selectedOpenRouterModel: settings.openrouter_model || 'openrouter/free',
    geminiModels,
    openaiModels,
    openrouterModels,
    hasGeminiKey       : geminiEnabled,
    hasOpenAIKey       : openaiEnabled,
    hasOpenRouterKey   : openrouterEnabled
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /chat/stream — SSE Streaming endpoint
// ─────────────────────────────────────────────────────────────────
router.post('/chat/stream', async (req, res) => {
  const { message, history, provider, model } = req.body;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

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

  const ALLOWED_PROVIDERS = ['gemini', 'openai', 'openrouter'];
  const safeProvider = ALLOWED_PROVIDERS.includes(provider) ? provider : undefined;

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  const startTime = Date.now();

  try {
    sendEvent('status', { text: 'Menyiapkan asisten...', step: 'init' });
    
    // Melewatkan req.session.user.id untuk memori session di SQLite
    const userId = req.session?.user?.id || null;

    await streamMessageToAgent(
      message.trim(),
      safeHistory,
      { provider: safeProvider, model },
      sendEvent,
      controller.signal,
      userId
    );
    const duration = Date.now() - startTime;
    console.info(`[AGENT:STREAM] OK — ${safeProvider || 'auto'}/${model || 'default'} — ${duration}ms`);
    res.end();
  } catch (err) {
    const duration = Date.now() - startTime;
    const errMsg = err?.message || 'Unknown error';
    console.error(`[AGENT:STREAM] ERROR — ${safeProvider || 'auto'} — ${duration}ms —`, errMsg);
    
    if (!res.writableEnded) {
      sendEvent('error', { error: errMsg });
      res.end();
    }
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

  const ALLOWED_PROVIDERS = ['gemini', 'openai', 'openrouter'];
  const safeProvider = ALLOWED_PROVIDERS.includes(provider) ? provider : undefined;
  const startTime = Date.now();

  try {
    const userId = req.session?.user?.id || null;
    const result = await sendMessageToAgent(
      message.trim(),
      safeHistory,
      { provider: safeProvider, model },
      userId
    );

    const duration = Date.now() - startTime;
    console.info(`[AGENT:ROUTE] OK — ${safeProvider || 'auto'}/${model || 'default'} — ${duration}ms — sim:${result.isSimulation}`);

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

    console.error(
      `[AGENT:ROUTE] ERROR — ${safeProvider || 'auto'} — ${duration}ms —`,
      errMsg,
      isTimeout ? '[TIMEOUT]' : isApiAuth ? '[AUTH]' : isRateLimit ? '[RATE_LIMIT]' : '[UNKNOWN]'
    );

    if (errStack) console.error('[AGENT:ROUTE] Stack:', errStack);

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
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Sesi Anda tidak valid.' });
  }
  const memoryManager = require('../services/ai/memoryManager');
  const history = memoryManager.getChatHistory(userId);
  return res.json({ history });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /history — Bersihkan riwayat chat persisten
// ─────────────────────────────────────────────────────────────────
router.delete('/history', (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Sesi Anda tidak valid.' });
  }
  const memoryManager = require('../services/ai/memoryManager');
  memoryManager.clearChatHistory(userId);
  return res.json({ success: true, message: 'Riwayat percakapan berhasil dibersihkan.' });
});

module.exports = router;