const express = require('express');
const router  = express.Router();
const { sendMessageToAgent } = require('../services/agentService');
const { getSettings } = require('../database');

// Auth Middleware for Agent chatbot (allows Admin and Korlap accounts only)
function requireLogin(req, res, next) {
  if (req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'korlap')) {
    return next();
  }
  
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path === '/chat') {
    return res.status(403).json({ error: 'Akses ditolak. Hanya akun Admin dan Korlap yang dapat mengakses Asisten AI.' });
  }
  
  req.flash('error', 'Akses ditolak. Hanya akun Admin dan Korlap yang dapat mengakses Asisten AI.');
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
    : ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'];
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
    : ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-r1:free', 'qwen/qwen-2.5-coder-32b-instruct:free'];
  if (settings.openrouter_model && !openrouterModels.includes(settings.openrouter_model)) {
    openrouterModels.push(settings.openrouter_model);
  }

  res.render('agent', {
    title              : 'Asisten AI Chat',
    activePage         : 'agent',
    hasKey,
    provider,
    selectedGeminiModel: settings.gemini_model || 'gemini-2.5-flash',
    selectedOpenAIModel: settings.openai_model || 'gpt-5.5',
    selectedOpenRouterModel: settings.openrouter_model || 'meta-llama/llama-3.3-70b-instruct:free',
    geminiModels,
    openaiModels,
    openrouterModels,
    hasGeminiKey       : geminiEnabled,
    hasOpenAIKey       : openaiEnabled,
    hasOpenRouterKey   : openrouterEnabled
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /chat — endpoint utama AI agent
// ─────────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  // ── Validasi input ───────────────────────────────────────────
  const { message, history, provider, model } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }

  // Batasi panjang pesan agar tidak membebani context window / token API
  if (message.length > 2000) {
    return res.status(400).json({ error: 'Pesan terlalu panjang. Maksimum 2000 karakter.' });
  }

  // Validasi history: harus array, masing-masing { role, content }
  const safeHistory = Array.isArray(history)
    ? history
        .filter(h => h && typeof h.role === 'string' && typeof h.content === 'string')
        .slice(-20) // batas maksimum history yang dikirim client
    : [];

  // Validasi provider & model (whitelist)
  const ALLOWED_PROVIDERS = ['gemini', 'openai', 'openrouter'];
  const safeProvider = ALLOWED_PROVIDERS.includes(provider) ? provider : undefined;

  // ── Eksekusi ─────────────────────────────────────────────────
  const startTime = Date.now();

  try {
    const result = await sendMessageToAgent(
      message.trim(),
      safeHistory,
      { provider: safeProvider, model }
    );

    const duration = Date.now() - startTime;
    console.info(`[AGENT:ROUTE] OK — ${safeProvider || 'auto'}/${model || 'default'} — ${duration}ms — sim:${result.isSimulation}`);

    return res.json({
      reply       : result.content,
      isSimulation: result.isSimulation,
      role        : result.role,
      // field debug — hanya tampil jika NODE_ENV !== 'production'
      ...(process.env.NODE_ENV !== 'production' && { _durationMs: duration })
    });

  } catch (err) {
    const errorObj = err || new Error('Unknown error');
    const errMsg = errorObj.message || 'Unknown error';
    const errStack = errorObj.stack || '';
    const duration = Date.now() - startTime;

    // ── Klasifikasi error ─────────────────────────────────────
    //  Jenis error menentukan status HTTP dan pesan ke client.
    //  Di production semua detail internal disembunyikan.
    const isTimeout  = /timed out|timeout|abort/i.test(errMsg);
    const isApiAuth  = /api key|unauthorized|authentication|invalid_api_key/i.test(errMsg);
    const isRateLimit = /rate.?limit|quota|429/i.test(errMsg);

    console.error(
      `[AGENT:ROUTE] ERROR — ${safeProvider || 'auto'} — ${duration}ms —`,
      errMsg,
      isTimeout ? '[TIMEOUT]' : isApiAuth ? '[AUTH]' : isRateLimit ? '[RATE_LIMIT]' : '[UNKNOWN]'
    );

    // Stack trace hanya di log server, TIDAK dikirim ke client
    if (errStack) console.error('[AGENT:ROUTE] Stack:', errStack);

    // Status HTTP yang tepat per jenis error
    const httpStatus = isTimeout   ? 504
                     : isApiAuth   ? 502
                     : isRateLimit ? 429
                     : 500;

    // Pesan human-readable untuk ditampilkan di UI
    const userMessage = isTimeout
      ? 'Server AI tidak merespons dalam waktu yang ditentukan. Silakan coba lagi.'
      : isApiAuth
      ? 'API Key tidak valid atau tidak memiliki izin. Periksa konfigurasi di Pengaturan.'
      : isRateLimit
      ? 'Batas permintaan API tercapai. Tunggu sebentar lalu coba lagi.'
      : 'Terjadi kesalahan internal saat memproses permintaan AI.';

    return res.status(httpStatus).json({
      error      : userMessage,
      // Detail teknis hanya di non-production untuk memudahkan debug
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

module.exports = router;