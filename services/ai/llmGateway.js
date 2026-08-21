'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  llmGateway.js
//  Menyatukan API calls ke Gemini, OpenAI, OpenRouter serta manajemen kegagalan
//  otomatis (SmartSwitch).
// ─────────────────────────────────────────────────────────────────────────────

const { 
  GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash',
  OPENAI_DEFAULT_MODEL = 'gpt-5.5',
  OPENROUTER_DEFAULT_MODEL = 'openrouter/free'
} = process.env;

const AGENT_API_TIMEOUT_MS          = 30000; 
const AGENT_API_QUICK_RESPONSE_MS   = 20000; 
const AGENT_API_TOOLRESULT_MS       = 30000; 
const MAX_SWITCH_TRIES              = 5;


const LEGACY_GEMINI_MODELS = new Set([]);
const _activeControllers = new Map();

// LOGGER
const LOG_LEVEL = process.env.AGENT_LOG_LEVEL || 'debug';
const log = {
  debug : (...a) => ['debug'].includes(LOG_LEVEL) && console.debug('[LLM_GW:DBG]', ...a),
  info  : (...a) => ['debug','info'].includes(LOG_LEVEL) && console.info ('[LLM_GW:INF]', ...a),
  warn  : (...a) => ['debug','info','warn'].includes(LOG_LEVEL) && console.warn ('[LLM_GW:WRN]', ...a),
  error : (...a) => ['debug','info','warn','error'].includes(LOG_LEVEL) && console.error('[LLM_GW:ERR]', ...a),
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

function registerActiveRequest(provider) {
  const controller = new AbortController();
  _activeControllers.set(provider, controller);
  return controller;
}

function clearActiveRequest(provider) {
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
  if (provider === 'openrouter') {
    const listStr = settings.openrouter_models_list || 'nvidia/nemotron-3-ultra-550b-a55b:free, deepseek/deepseek-r1:free, qwen/qwen-2.5-coder-32b-instruct:free';
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
  const listStr = settings.gemini_models_list || 'gemini-3.5-flash, gemini-3.1-flash-lite';
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
    const chat = model.startChat({ history: formattedHistory });

    async function callGemini(payload, isToolResult = false) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');
      const timeoutMs = isToolResult ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
      log.debug(`Gemini sendMessage… (timeout: ${timeoutMs / 1000}s)`);
      const resp = await timeoutPromise(chat.sendMessage(payload), timeoutMs, `Gemini API call timed out (${timeoutMs / 1000}s)`);
      return resp;
    }

    let response = await callGemini(userMessage, false);
    let loopCount = 0;
    const MAX_LOOPS = 3;

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan saat loop tool-call.');

      const candidate = response.response.candidates?.[0];
      const finishReason = candidate?.finishReason;

      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
        throw new Error(`Gemini dihentikan secara tidak wajar (Alasan: ${finishReason}).`);
      }

      const functionCalls = extractFunctionCalls(response);
      if (functionCalls.length === 0) break;

      loopCount++;
      log.info(`Gemini tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCalls.map(f => f.name).join(', ')}`);

      const toolResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          return { functionResponse: { name: fc.name, response: result } };
        })
      );

      response = await callGemini(toolResponses, true);
    }

    let rawText = extractResponseText(response);

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
    const chat = model.startChat({ history: formattedHistory });

    let currentPayload = userMessage;
    let loopCount = 0;
    const MAX_LOOPS = 3;
    let response = null;

    while (loopCount <= MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

      onEvent('status', {
        text: loopCount === 0 ? 'Menghubungkan ke Pananyo Taka AI...' : 'Menganalisis hasil data...',
        step: 'model_call'
      });

      const timeoutMs = loopCount > 0 ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
      response = await timeoutPromise(
        chat.sendMessage(currentPayload),
        timeoutMs,
        `Gemini API timed out (${timeoutMs / 1000}s)`
      );

      const candidate = response.response.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
        throw new Error(`Gemini dihentikan secara tidak wajar (Alasan: ${finishReason}).`);
      }

      const functionCalls = extractFunctionCalls(response);
      if (functionCalls.length === 0 || loopCount === MAX_LOOPS) {
        break;
      }

      loopCount++;
      log.info(`[STREAM:GEMINI] Tool-call loop ${loopCount}/${MAX_LOOPS}: ${functionCalls.map(f => f.name).join(', ')}`);

      for (const fc of functionCalls) {
        onEvent('tool_start', { tool: fc.name, args: fc.args, message: `⚙️ Menjalankan alat bantu ${fc.name}...` });
      }

      const toolResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          onEvent('tool_end', { tool: fc.name, message: `✅ Selesai mengambil data` });
          return { functionResponse: { name: fc.name, response: result } };
        })
      );

      onEvent('status', { text: '✍️ Merumuskan jawaban...', step: 'writing' });
      currentPayload = toolResponses;
    }

    let rawText = extractResponseText(response);

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
//  OPENAI & OPENROUTER STUBS (SIMPLIFIED BACKEND CALLERS)
// ─────────────────────────────────────────────
async function createOpenAIResponse(apiKey, payload) {
  const timeoutMs = payload.previous_response_id ? AGENT_API_TOOLRESULT_MS : AGENT_API_QUICK_RESPONSE_MS;
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method : 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload)
  }, timeoutMs);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }
  return data;
}

function extractOpenAIText(response) {
  if (response.choices?.[0]?.message?.content) return response.choices[0].message.content;
  return 'Model tidak mengembalikan teks.';
}

async function sendMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction) {
  const apiKey = settings.openai_api_key;
  const model = selectedModel || settings.openai_model || OPENAI_DEFAULT_MODEL;

  const cleanHist = formatGeminiHistory(chatHistory);
  const messages = [
    { role: 'system', content: systemInstruction },
    ...cleanHist.map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.parts[0].text })),
    { role: 'user', content: userMessage }
  ];

  const tools = Object.values(TOOL_SCHEMAS).map(t => ({ type: 'function', function: t }));

  try {
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let finalContent = '';
    let lastBackupOutput = '';

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

      const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages, tools })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const choiceMessage = data.choices?.[0]?.message;
      if (!choiceMessage) throw new Error('OpenAI tidak mengembalikan pesan.');

      const toolCalls = choiceMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        finalContent = choiceMessage.content || '';
        break;
      }

      loopCount++;
      log.info(`[OPENAI] Executing tool call loop ${loopCount}/${MAX_LOOPS}: ${toolCalls.map(t => t.function?.name).join(', ')}`);

      messages.push(choiceMessage);

      let backupFormattedOutput = '';
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
        const res = await runToolCall({ name: tc.function.name, args });

        if (res && res.status === 'success' && Array.isArray(res.data) && res.data.length > 0) {
          const { formatToolRowsToMarkdown } = require('./toolRegistry');
          backupFormattedOutput += formatToolRowsToMarkdown(tc.function.name, args, res.data) + '\n\n';
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id || tc.function.name,
          content: JSON.stringify(res)
        });
      }

      if (backupFormattedOutput && !lastBackupOutput) {
        lastBackupOutput = backupFormattedOutput.trim();
      }
    }

    if (!finalContent || !finalContent.trim() || finalContent === 'Model tidak mengembalikan teks.') {
      if (lastBackupOutput) {
        finalContent = lastBackupOutput;
      } else {
        finalContent = 'Model tidak mengembalikan teks.';
      }
    }

    finalContent = processJsonQueryResponse(finalContent);
    return { role: 'model', content: finalContent, isSimulation: false };
  } catch (error) {
    log.error('sendMessageToOpenAI error:', error.message);
    throw error;
  }
}

async function streamMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, onEvent, systemInstruction) {
  onEvent('status', { text: '🔍 Memproses analisis data...', step: 'model_call' });
  const result = await sendMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction);
  onEvent('chunk', { text: result.content });
  return result;
}

async function sendMessageToOpenRouter(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction) {
  const apiKey = settings.openrouter_api_key;
  const model = selectedModel || settings.openrouter_model || OPENROUTER_DEFAULT_MODEL;

  const cleanHist = formatGeminiHistory(chatHistory);
  const messages = [
    { role: 'system', content: systemInstruction },
    ...cleanHist.map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.parts[0].text })),
    { role: 'user', content: userMessage }
  ];

  const tools = Object.values(TOOL_SCHEMAS).map(t => ({ type: 'function', function: t }));

  try {
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let finalContent = '';
    let includeTools = true;
    let lastBackupOutput = '';

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

      const payload = { model, messages };
      if (includeTools) payload.tools = tools;

      let resp = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      let data = await resp.json();

      if (!resp.ok && includeTools && data?.error?.message && (data.error.message.includes('tools') || data.error.message.includes('function') || data.error.message.includes('support'))) {
        log.warn(`[OPENROUTER] Model '${model}' does not support tools parameter. Retrying without tools...`);
        includeTools = false;
        delete payload.tools;
        resp = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        data = await resp.json();
      }

      if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);

      const choiceMessage = data.choices?.[0]?.message;
      if (!choiceMessage) throw new Error('OpenRouter tidak mengembalikan pesan.');

      const toolCalls = choiceMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        finalContent = choiceMessage.content || '';
        break;
      }

      loopCount++;
      log.info(`[OPENROUTER] Executing tool call loop ${loopCount}/${MAX_LOOPS}: ${toolCalls.map(t => t.function?.name).join(', ')}`);

      messages.push(choiceMessage);

      let backupFormattedOutput = '';
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
        const res = await runToolCall({ name: tc.function.name, args });

        if (res && res.status === 'success' && Array.isArray(res.data) && res.data.length > 0) {
          const { formatToolRowsToMarkdown } = require('./toolRegistry');
          backupFormattedOutput += formatToolRowsToMarkdown(tc.function.name, args, res.data) + '\n\n';
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id || tc.function.name,
          content: JSON.stringify(res)
        });
      }

      if (backupFormattedOutput && !lastBackupOutput) {
        lastBackupOutput = backupFormattedOutput.trim();
      }
    }

    if (!finalContent || !finalContent.trim() || finalContent === 'Model tidak mengembalikan teks.') {
      if (lastBackupOutput) {
        finalContent = lastBackupOutput;
      } else {
        finalContent = 'Model tidak mengembalikan teks.';
      }
    }

    finalContent = processJsonQueryResponse(finalContent);
    return { role: 'model', content: finalContent, isSimulation: false };

  } catch (err) {
    log.error('OpenRouter error:', err.message);
    throw err;
  }
}

async function streamMessageToOpenRouter(userMessage, chatHistory, settings, selectedModel, abortSignal, onEvent, systemInstruction) {
  onEvent('status', { text: '🔍 Memproses analisis data...', step: 'model_call' });
  const result = await sendMessageToOpenRouter(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction);
  onEvent('chunk', { text: result.content });
  return result;
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
  sendMessageToOpenAI,
  streamMessageToOpenAI,
  sendMessageToOpenRouter,
  streamMessageToOpenRouter,
  MAX_SWITCH_TRIES
};
