'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  memoryManager.js
//  Mengelola penyimpanan dan pemuatan riwayat percakapan dari SQLite.
//  Memungkinkan sinkronisasi percakapan antar perangkat / refresh halaman.
// ─────────────────────────────────────────────────────────────────────────────

const { getDb } = require('../../database');
const _logger = require('../logger');

/**
 * Memuat riwayat obrolan untuk user tertentu.
 * @param {number|string} userId - ID Pengguna dari Express Session
 * @returns {Array<Object>} Array dari pesan [{role, content}]
 */
function getChatHistory(userId) {
  if (!userId) return [];
  try {
    const db = getDb('se2026');
    const row = db.prepare('SELECT history FROM agent_sessions WHERE user_id = ?').get(String(userId));
    if (row && row.history) {
      return JSON.parse(row.history);
    }
  } catch (err) {
    _logger.error(`[MemoryManager] Gagal mengambil riwayat chat untuk user ${userId}: ${err.message}`);
  }
  return [];
}

/**
 * Menyimpan riwayat obrolan penuh untuk user tertentu (dibatasi 20 pesan terakhir).
 * @param {number|string} userId - ID Pengguna
 * @param {Array<Object>} history - Array dari pesan
 */
function saveChatHistory(userId, history) {
  if (!userId || !Array.isArray(history)) return;
  try {
    const db = getDb('se2026');
    // Batasi hanya menyimpan 20 pesan terakhir demi efisiensi DB
    const cappedHistory = history.slice(-20);
    const jsonStr = JSON.stringify(cappedHistory);

    db.prepare(`
      INSERT OR REPLACE INTO agent_sessions (user_id, history, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(String(userId), jsonStr);
  } catch (err) {
    _logger.error(`[MemoryManager] Gagal menyimpan riwayat chat untuk user ${userId}: ${err.message}`);
  }
}

/**
 * Mengosongkan riwayat obrolan untuk user tertentu.
 * @param {number|string} userId
 */
function clearChatHistory(userId) {
  if (!userId) return;
  try {
    const db = getDb('se2026');
    db.prepare('DELETE FROM agent_sessions WHERE user_id = ?').run(String(userId));
  } catch (err) {
    _logger.error(`[MemoryManager] Gagal menghapus riwayat chat untuk user ${userId}: ${err.message}`);
  }
}

module.exports = {
  getChatHistory,
  saveChatHistory,
  clearChatHistory
};
