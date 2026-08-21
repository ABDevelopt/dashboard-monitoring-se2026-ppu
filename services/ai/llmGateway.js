'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  llmGateway.js
//  Menyatukan API calls ke Gemini serta manajemen kegagalan otomatis (SmartSwitch).
// ─────────────────────────────────────────────────────────────────────────────

const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const { 
  GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash'
} = process.env;

const AGENT_API_TIMEOUT_MS          = 30000; 
const AGENT_API_QUICK_RESPONSE_MS   = 20000; 
const AGENT_API_TOOLRESULT_MS       = 30000; 
const MAX_SWITCH_TRIES              = 5;

const LEGACY_GEMINI_MODELS = new Set([
  'gemini-pro',
  'gemini-1.0-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash',
  'gemini-3-flash-preview'
]);
const _activeControllers = new Map();

// LOGGER — using Winston to ensure all AI logs are captured in log files
const _winstonLogger = require('../logger');
const log = {
  debug : (...a) => _winstonLogger.debug('[LLM_GW] ' + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
  info  : (...a) => _winstonLogger.info('[LLM_GW] '  + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
  warn  : (...a) => _winstonLogger.warn('[LLM_GW] '  + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
  error : (...a) => _winstonLogger.error('[LLM_GW] ' + a.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')),
};

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

function registerActiveRequest(provider = 'gemini') {
  const controller = new AbortController();
  _activeControllers.set(provider, controller);
  return controller;
}

function clearActiveRequest(provider = 'gemini') {
  _activeControllers.delete(provider);
}

function abortAllActive() {
  for (const [prov, ctrl] of _activeControllers.entries()) {
    log.warn(`[SmartSwitch] Abort active request: ${prov}`);
    try { ctrl.abort(); } catch (_) {}
  }
  _activeControllers.clear();
}

function getAllowedModels(provider, settings) {
  const listStr = settings.gemini_models_list || 'gemini-3.5-flash, gemini-2.5-flash, gemini-3.1-flash-lite, gemini-2.5-pro';
  const models = listStr.split(',').map(m => m.trim()).filter(Boolean);
  if (settings.gemini_model) models.push(settings.gemini_model);
  return Array.from(new Set(models));
}

function resolveAgentSelection(settings, options = {}) {
  const provider = 'gemini';
  const fallbackModel = settings.gemini_model || GEMINI_DEFAULT_MODEL;
  const allowedModels = getAllowedModels('gemini', settings);
  let model = allowedModels.includes(options.model) ? options.model : fallbackModel;
  if (LEGACY_GEMINI_MODELS.has(model)) model = GEMINI_DEFAULT_MODEL;
  return { provider, model };
}

// ─────────────────────────────────────────────
//  INDIVIDUAL LLM CALLERS (from agentService)
// ─────────────────────────────────────────────
const { runToolCall, TOOL_SCHEMAS, processJsonQueryResponse } = require('./toolRegistry');

/**
 * Format dan bersihkan riwayat obrolan secara ketat (strictly alternating user -> model).
 * Membatasi hingga 6 pesan terakhir (3 pasang giliran) dan meringkas isi pesan masa lalu
 * agar model 100% terfokus pada pesan terkini (recency focus).
 */
function formatGeminiHistory(chatHistory) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return [];

  const clean = [];
  let expectedRole = 'user';

  // Ambil maksimal 6 pesan terakhir (3 pasang dialog user-model)
  const recent = chatHistory.slice(-6);

  for (const msg of recent) {
    if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
    const role = msg.role === 'user' ? 'user' : 'model';

    if (role === expectedRole) {
      // Ringkas respons model masa lalu jika terlalu panjang agar tidak mengalihkan perhatian model dari pertanyaan saat ini
      let text = msg.content.trim();
      if (role === 'model' && text.length > 500) {
        text = text.slice(0, 500) + '...';
      }
      clean.push({
        role,
        parts: [{ text }]
      });
      expectedRole = role === 'user' ? 'model' : 'user';
    }
  }

  // Riwayat untuk startChat HARUS diakhiri dengan turn 'model',
  // sehingga pesan user saat ini (userMessage) menjadi giliran 'user' berikutnya secara alami.
  if (clean.length > 0 && clean[clean.length - 1].role === 'user') {
    clean.pop();
  }

  return clean;
}

/**
 * Ekstraksi function calls dari respons Gemini secara andal
 * baik via method response.functionCalls() maupun inspeksi langsung kandidat parts.
 */
function extractFunctionCalls(response) {
  if (!response?.response) return [];
  if (typeof response.response.functionCalls === 'function') {
    try {
      const fcs = response.response.functionCalls();
      if (Array.isArray(fcs) && fcs.length > 0) return fcs;
    } catch (_) {}
  }
  const parts = response.response.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p && p.functionCall).map(p => p.functionCall);
}

/**
 * Ekstraksi teks dari respons Gemini secara aman
 */
function extractResponseText(response) {
  if (!response?.response) return '';
  if (typeof response.response.text === 'function') {
    try {
      const t = response.response.text();
      if (t && typeof t === 'string') return t;
    } catch (_) {}
  }
  const parts = response.response.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p && p.text).map(p => p.text).join('\n');
}

async function generateWithRetry(model, payload, timeoutMs, label = 'Gemini API call') {
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      return await timeoutPromise(
        model.generateContent(payload),
        timeoutMs,
        `${label} timed out (${timeoutMs / 1000}s)`
      );
    } catch (err) {
      const errMsg = err.message || '';
      const isTransient = errMsg.includes('fetch failed') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT') || errMsg.includes('socket hang up') || errMsg.includes('EAI_AGAIN');
      if (attempt === 1 && isTransient) {
        log.warn(`[LLM_GW] Transient network hiccup (${errMsg}), retrying in 400ms (attempt ${attempt}/2)...`);
        await new Promise(r => setTimeout(r, 400));
        continue;
      }
      throw err;
    }
  }
}

async function sendMessageToGemini(userMessage, chatHistory, settings, selectedModel, abortSignal, customApiKey, systemInstruction) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const apiKey = customApiKey || settings.gemini_api_key;
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = LEGACY_GEMINI_MODELS.has(selectedModel) ? GEMINI_DEFAULT_MODEL : (selectedModel || GEMINI_DEFAULT_MODEL);

    log.debug('Gemini model:', geminiModel);

    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemInstruction,
      tools: [{ functionDeclarations: Object.values(TOOL_SCHEMAS) }]
    });

    const formattedHistory = formatGeminiHistory(chatHistory);
    const contents = [
      ...formattedHistory,
      { role: 'user', parts: [{ text: userMessage }] }
    ];

    let loopCount = 0;
    const MAX_LOOPS = 3;
    let finalCandidate = null;
    let lastExecutedToolResult = null;

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
      const timeoutMs = loopCount > 0 ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;

      const resp = await generateWithRetry(
        model,
        { contents },
        timeoutMs,
        `Gemini API call`
      );

      const candidate = resp.response.candidates?.[0];
      if (!candidate?.content) throw new Error('Gemini tidak mengembalikan respons valid.');

      finalCandidate = candidate;
      const parts = candidate.content.parts || [];
      const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);

      if (functionCalls.length === 0) {
        break;
      }

      loopCount++;
      log.info(`Gemini tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCalls.map(f => f.name).join(', ')}`);
      contents.push(candidate.content);

      const toolResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          lastExecutedToolResult = { name: fc.name, args: fc.args, result };
          return {
            functionResponse: {
              name: fc.name,
              response: {
                name: fc.name,
                content: result
              }
            }
          };
        })
      );

      // Google Gemini v1beta REST API mewajibkan role 'user' untuk functionResponse
      contents.push({
        role: 'user',
        parts: toolResponses
      });
    }

    let rawText = '';
    if (finalCandidate?.content?.parts) {
      rawText = finalCandidate.content.parts.filter(p => p.text).map(p => p.text).join('\n');
    }

    // Jika respons akhir masih berupa functionCall atau kosong, paksa satu kali inferensi teks tanpa tools
    if (!rawText.trim() && lastExecutedToolResult) {
      try {
        const textModel = genAI.getGenerativeModel({
          model: geminiModel,
          systemInstruction: systemInstruction
        });
        const forceTextResp = await timeoutPromise(
          textModel.generateContent({ contents }),
          AGENT_API_TOOLRESULT_MS,
          'Gemini force text timeout'
        );
        const forceCand = forceTextResp.response.candidates?.[0];
        if (forceCand?.content?.parts) {
          rawText = forceCand.content.parts.filter(p => p.text).map(p => p.text).join('\n');
        }
      } catch (err) {
        log.warn('[LLM_GW] Force text generation fallback failed:', err.message);
      }
    }

    // Jika tetap kosong namun ada baris data hasil tool kueri, format otomatis ke tabel Markdown
    if (!rawText.trim() && lastExecutedToolResult?.result?.data) {
      const { formatToolRowsToMarkdown } = require('./toolRegistry');
      rawText = formatToolRowsToMarkdown(lastExecutedToolResult.name, lastExecutedToolResult.args, lastExecutedToolResult.result.data);
    }

    if (!rawText.trim()) {
      rawText = 'Data tidak ditemukan untuk kriteria pencarian tersebut.';
    }

    return {
      role: 'model',
      content: processJsonQueryResponse(rawText),
      isSimulation: false
    };

  } catch (error) {
    log.error('sendMessageToGemini error:', error.message);
    throw error;
  }
}

async function streamMessageToGemini(userMessage, chatHistory, settings, selectedModel, abortSignal, customApiKey, onEvent, systemInstruction) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const apiKey = customApiKey || settings.gemini_api_key;
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = LEGACY_GEMINI_MODELS.has(selectedModel) ? GEMINI_DEFAULT_MODEL : (selectedModel || GEMINI_DEFAULT_MODEL);

    log.debug('[STREAM:GEMINI] Model:', geminiModel);

    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemInstruction,
      tools: [{ functionDeclarations: Object.values(TOOL_SCHEMAS) }]
    });

    const formattedHistory = formatGeminiHistory(chatHistory);
    const contents = [
      ...formattedHistory,
      { role: 'user', parts: [{ text: userMessage }] }
    ];

    let loopCount = 0;
    const MAX_LOOPS = 3;
    let finalCandidate = null;
    let lastExecutedToolResult = null;

    while (loopCount <= MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

      onEvent('status', {
        text: loopCount === 0 ? 'Menghubungkan ke Pananyo Taka AI...' : 'Menganalisis hasil data...',
        step: 'model_call'
      });

      const timeoutMs = loopCount > 0 ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
      const resp = await generateWithRetry(
        model,
        { contents },
        timeoutMs,
        `Gemini API call`
      );

      const candidate = resp.response.candidates?.[0];
      if (!candidate?.content) throw new Error('Gemini tidak mengembalikan respons valid.');

      finalCandidate = candidate;
      const parts = candidate.content.parts || [];
      const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);

      if (functionCalls.length === 0 || loopCount === MAX_LOOPS) {
        break;
      }

      loopCount++;
      log.info(`[STREAM:GEMINI] Tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCalls.map(f => f.name).join(', ')}`);

      for (const fc of functionCalls) {
        onEvent('tool_start', { tool: fc.name, args: fc.args, message: `⚙️ Menjalankan alat bantu ${fc.name}...` });
      }

      contents.push(candidate.content);

      const toolResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          lastExecutedToolResult = { name: fc.name, args: fc.args, result };
          onEvent('tool_end', { tool: fc.name, message: `✅ Selesai mengambil data` });
          return {
            functionResponse: {
              name: fc.name,
              response: {
                name: fc.name,
                content: result
              }
            }
          };
        })
      );

      onEvent('status', { text: '✍️ Merumuskan jawaban...', step: 'writing' });

      // Google Gemini v1beta REST API mewajibkan role 'user' untuk functionResponse
      contents.push({
        role: 'user',
        parts: toolResponses
      });
    }

    let rawText = '';
    if (finalCandidate?.content?.parts) {
      rawText = finalCandidate.content.parts.filter(p => p.text).map(p => p.text).join('\n');
    }

    // Jika respons akhir masih berupa functionCall atau kosong, paksa satu kali inferensi teks tanpa tools
    if (!rawText.trim() && lastExecutedToolResult) {
      try {
        const textModel = genAI.getGenerativeModel({
          model: geminiModel,
          systemInstruction: systemInstruction
        });
        const forceTextResp = await timeoutPromise(
          textModel.generateContent({ contents }),
          AGENT_API_TOOLRESULT_MS,
          'Gemini force text timeout'
        );
        const forceCand = forceTextResp.response.candidates?.[0];
        if (forceCand?.content?.parts) {
          rawText = forceCand.content.parts.filter(p => p.text).map(p => p.text).join('\n');
        }
      } catch (err) {
        log.warn('[LLM_GW] Force text generation fallback failed:', err.message);
      }
    }

    // Jika tetap kosong namun ada baris data hasil tool kueri, format otomatis ke tabel Markdown
    if (!rawText.trim() && lastExecutedToolResult?.result?.data) {
      const { formatToolRowsToMarkdown } = require('./toolRegistry');
      rawText = formatToolRowsToMarkdown(lastExecutedToolResult.name, lastExecutedToolResult.args, lastExecutedToolResult.result.data);
    }

    if (!rawText.trim()) {
      rawText = 'Data tidak ditemukan untuk kriteria pencarian tersebut.';
    }

    const processedText = processJsonQueryResponse(rawText);

    // Stream text progressively to frontend for smooth, instant typing effect
    const words = processedText.split(' ');
    const chunkSize = 4;
    for (let i = 0; i < words.length; i += chunkSize) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
      const chunk = words.slice(i, i + chunkSize).join(' ') + (i + chunkSize < words.length ? ' ' : '');
      onEvent('chunk', { text: chunk });
      await new Promise(r => setTimeout(r, 12));
    }

    return { role: 'model', content: processedText, isSimulation: false };

  } catch (error) {
    log.error('streamMessageToGemini error:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  timeoutPromise,
  fetchWithTimeout,
  registerActiveRequest,
  clearActiveRequest,
  abortAllActive,
  resolveAgentSelection,
  sendMessageToGemini,
  streamMessageToGemini,
  MAX_SWITCH_TRIES
};

