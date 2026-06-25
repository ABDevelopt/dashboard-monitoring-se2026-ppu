const express = require('express');
const router = express.Router();
const { sendMessageToAgent } = require('../services/agentService');
const { getSettings } = require('../database');

router.get('/', (req, res) => {
  const settings = getSettings();
  const openaiEnabled = !!(settings.openai_api_key && settings.openai_api_key.trim());
  const provider = settings.agent_provider === 'openai' || openaiEnabled ? 'openai' : 'gemini';
  const selectedKey = provider === 'openai' ? settings.openai_api_key : settings.gemini_api_key;
  const hasKey = selectedKey && selectedKey.trim() !== '';
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
    title: 'Asisten AI Chat',
    activePage: 'agent',
    hasKey,
    provider,
    selectedGeminiModel: settings.gemini_model || 'gemini-2.5-flash',
    selectedOpenAIModel: settings.openai_model || 'gpt-5.5',
    geminiModels,
    openaiModels,
    hasGeminiKey: !!(settings.gemini_api_key && settings.gemini_api_key.trim()),
    hasOpenAIKey: !!(settings.openai_api_key && settings.openai_api_key.trim())
  });
});

router.post('/chat', async (req, res) => {
  const { message, history, provider, model } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  }

  try {
    const result = await sendMessageToAgent(message, history || [], { provider, model });
    res.json({
      reply: result.content,
      isSimulation: result.isSimulation,
      role: result.role
    });
  } catch (err) {
    console.error("Agent Route Chat Error:", err);
    res.status(500).json({ error: 'Gagal memproses pesan AI: ' + err.message });
  }
});

module.exports = router;
