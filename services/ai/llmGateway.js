'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  llmGateway.js
//  Menyatukan API calls ke Gemini, OpenAI, OpenRouter serta manajemen kegagalan
//  otomatis (SmartSwitch).
// ─────────────────────────────────────────────────────────────────────────────

const { 
  GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash',
  OPENAI_DEFAULT_MODEL = 'gpt-5.5',
  OPENROUTER_DEFAULT_MODEL = 'openrouter/free'
} = process.env;

const AGENT_API_TIMEOUT_MS          = 18000; 
const AGENT_API_QUICK_RESPONSE_MS   = 14000; 
const AGENT_API_TOOLRESULT_MS       = 16000; 
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

// ─────────────────────────────────────────────
//  INDIVIDUAL LLM CALLERS (from agentService)
// ─────────────────────────────────────────────
const { runToolCall, TOOL_SCHEMAS, processJsonQueryResponse } = require('./toolRegistry');

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

    const formattedHistory = chatHistory.slice(-10).map(msg => ({
      role : msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    if (formattedHistory.length > 0 && formattedHistory[0].role === 'model') {
      formattedHistory.shift();
    }

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
    const MAX_LOOPS = 5;

    while (loopCount < MAX_LOOPS) {
      if (abortSignal?.aborted) throw new Error('Request dibatalkan saat loop tool-call.');

      const candidate = response.response.candidates?.[0];
      const finishReason = candidate?.finishReason;

      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
        throw new Error(`Gemini dihentikan secara tidak wajar (Alasan: ${finishReason}).`);
      }

      const functionCalls = response.response.functionCalls || [];
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

    let finalText = '';
    try {
      finalText = response.response.text();
    } catch (_) {
      finalText = response.response.candidates
        ?.flatMap(c => c.content?.parts || [])
        ?.map(p => p.text || '')
        ?.join('\n')
        ?.trim();
    }

    if (!finalText || !finalText.trim()) {
      finalText = 'Model tidak mengembalikan teks.';
    }

    finalText = processJsonQueryResponse(finalText);
    return { role: 'model', content: finalText, isSimulation: false };

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

      if (!streamResult?.stream) {
        try {
          await streamResult.response;
        } catch (apiErr) {
          throw apiErr;
        }
        throw new Error('Gemini API tidak mengembalikan stream.');
      }

      for await (const chunk of streamResult.stream) {
        if (abortSignal?.aborted) throw new Error('Request dibatalkan.');

        let fcs = null;
        try { fcs = chunk.functionCalls(); } catch (_) {}

        if (fcs && fcs.length > 0) {
          functionCallsInTurn.push(...fcs);
        }

        let chunkText = '';
        try { chunkText = chunk.text(); } catch (_) {}

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
        onEvent('tool_start', { tool: fc.name, args: fc.args, message: `⚙️ Menjalankan alat bantu ${fc.name}...` });
      }

      const toolResponses = await Promise.all(
        functionCallsInTurn.map(async (fc) => {
          const result = await runToolCall({ name: fc.name, args: fc.args });
          onEvent('tool_end', { tool: fc.name, message: `✅ Selesai mengambil data` });
          return { functionResponse: { name: fc.name, response: result } };
        })
      );

      onEvent('status', { text: '✍️ Merumuskan jawaban...', step: 'writing' });
      currentPayload = toolResponses;
    }

    if (!fullAccumulatedText.trim()) {
      fullAccumulatedText = 'Model tidak mengembalikan teks jawaban.';
    }

    const processedText = processJsonQueryResponse(fullAccumulatedText);
    if (processedText !== fullAccumulatedText) {
      onEvent('chunk', { text: processedText });
      fullAccumulatedText = processedText;
    }

    return { role: 'model', content: fullAccumulatedText, isSimulation: false };

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
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
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
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if ((c.type === 'output_text' || c.type === 'text') && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim() || 'Model tidak mengembalikan teks.';
}

async function sendMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction) {
  const apiKey = settings.openai_api_key;
  const model  = selectedModel || settings.openai_model || OPENAI_DEFAULT_MODEL;
  const input  = [
    ...chatHistory.slice(-10).map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
    { role: 'user', content: userMessage }
  ];
  const tools = Object.values(TOOL_SCHEMAS).map(t => ({ type: 'function', function: t }));

  try {
    let response = await createOpenAIResponse(apiKey, { model, instructions: systemInstruction, input, tools, tool_choice: 'auto' });
    let loopCount = 0;
    const MAX_LOOPS = 5;

    while (loopCount < MAX_LOOPS) {
      const functionCalls = (response.output || []).filter(item => item.type === 'function_call');
      if (functionCalls.length === 0) break;

      loopCount++;
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

    const text = processJsonQueryResponse(extractOpenAIText(response));
    return { role: 'model', content: text, isSimulation: false };
  } catch (error) {
    log.error('sendMessageToOpenAI error:', error.message);
    throw error;
  }
}

async function streamMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, onEvent, systemInstruction) {
  onEvent('status', { text: 'Menghubungkan ke OpenAI...', step: 'model_call' });
  const result = await sendMessageToOpenAI(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction);
  onEvent('chunk', { text: result.content });
  return result;
}

async function sendMessageToOpenRouter(userMessage, chatHistory, settings, selectedModel, abortSignal, systemInstruction) {
  const apiKey = settings.openrouter_api_key;
  const model = selectedModel || settings.openrouter_model || OPENROUTER_DEFAULT_MODEL;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...chatHistory.slice(-10).map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
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
  onEvent('status', { text: 'Menghubungkan ke OpenRouter...', step: 'model_call' });
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
