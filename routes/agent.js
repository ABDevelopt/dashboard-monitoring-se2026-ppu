const express = require('express');
const router = express.Router();
const { sendMessageToAgent } = require('../services/agentService');
const { getSettings } = require('../database');

router.get('/', (req, res) => {
  const settings = getSettings();
  const hasKey = settings.gemini_api_key && settings.gemini_api_key.trim() !== '';
  res.render('agent', {
    title: 'Asisten AI Chat',
    activePage: 'agent',
    hasKey: hasKey
  });
});

router.post('/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  }

  try {
    const result = await sendMessageToAgent(message, history || []);
    res.json({
      reply: result.content,
      isSimulation: result.isSimulation
    });
  } catch (err) {
    console.error("Agent Route Chat Error:", err);
    res.status(500).json({ error: 'Gagal memproses pesan AI: ' + err.message });
  }
});

module.exports = router;

