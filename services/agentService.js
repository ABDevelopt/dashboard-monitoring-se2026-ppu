'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  agentService.js
//  Fasad Backward Compatibility.
//  Mengalihkan ekspor lama ke arsitektur modular baru di bawah services/ai/.
// ─────────────────────────────────────────────────────────────────────────────

const orchestrator = require('./ai/orchestrator');

module.exports = {
  sendMessageToAgent: orchestrator.sendMessageToAgent,
  streamMessageToAgent: orchestrator.streamMessageToAgent,
  fetchPageData: orchestrator.fetchPageData
};