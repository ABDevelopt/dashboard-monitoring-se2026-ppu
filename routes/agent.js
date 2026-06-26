const express = require('express');
const router  = express.Router();
const { sendMessageToAgent } = require('../services/agentService');
const { getSettings } = require('../database');

// ─────────────────────────────────────────────────────────────────
//  GET / — render halaman agent
// ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const settings     = getSettings();
  const openaiEnabled = !!(settings.openai_api_key && settings.openai_api_key.trim());
  const provider      = settings.agent_provider === 'openai' || openaiEnabled ? 'openai' : 'gemini';
  const selectedKey   = provider === 'openai' ? settings.openai_api_key : settings.gemini_api_key;
  const hasKey        = !!(selectedKey && selectedKey.trim());

  const geminiModels = Array.from(new Set([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    settings.gemini_model
  ].filter(Boolean)));

  const openaiModels = Array.from(new Set([
    'gpt-5.5',
    settings.openai_model
  ].filter(Boolean)));

  res.render('agent', {
    title              : 'Asisten AI Chat',
    activePage         : 'agent',
    hasKey,
    provider,
    selectedGeminiModel: settings.gemini_model || 'gemini-2.5-flash',
    selectedOpenAIModel: settings.openai_model || 'gpt-5.5',
    geminiModels,
    openaiModels,
    hasGeminiKey       : !!(settings.gemini_api_key && settings.gemini_api_key.trim()),
    hasOpenAIKey       : !!(settings.openai_api_key && settings.openai_api_key.trim())
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
  const ALLOWED_PROVIDERS = ['gemini', 'openai'];
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
    const duration = Date.now() - startTime;

    // ── Klasifikasi error ─────────────────────────────────────
    //  Jenis error menentukan status HTTP dan pesan ke client.
    //  Di production semua detail internal disembunyikan.
    const isTimeout  = /timed out|timeout|abort/i.test(err.message);
    const isApiAuth  = /api key|unauthorized|authentication|invalid_api_key/i.test(err.message);
    const isRateLimit = /rate.?limit|quota|429/i.test(err.message);

    console.error(
      `[AGENT:ROUTE] ERROR — ${safeProvider || 'auto'} — ${duration}ms —`,
      err.message,
      isTimeout ? '[TIMEOUT]' : isApiAuth ? '[AUTH]' : isRateLimit ? '[RATE_LIMIT]' : '[UNKNOWN]'
    );

    // Stack trace hanya di log server, TIDAK dikirim ke client
    if (err.stack) console.error('[AGENT:ROUTE] Stack:', err.stack);

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
          originalMessage: err.message,
          durationMs     : duration,
          type           : isTimeout ? 'TIMEOUT' : isApiAuth ? 'AUTH' : isRateLimit ? 'RATE_LIMIT' : 'UNKNOWN'
        }
      })
    });
  }
});

module.exports = router;