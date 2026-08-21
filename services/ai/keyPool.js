'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  keyPool.js
//  Manajer Pool & Rotasi Cerdas untuk Gemini API Key Utama & Cadangan (Backup).
//  Fitur:
//  - Pelacakan status kesehatan kunci (Healthy, Rate Limited/429, Invalid/403)
//  - Auto-Failover & Auto-Cooldown (menghindari request berulang ke key yang limit)
//  - Prioritas kunci yang aktif & auto-reset setelah masa cooldown berakhir
//  - Diagnostic test untuk verifikasi kelayakan seluruh API key secara real-time
// ─────────────────────────────────────────────────────────────────────────────

// Memory cache status kesehatan kunci
// Map<apiKey, { status: 'healthy'|'rate_limited'|'invalid', cooldownUntil: number, failCount: number, successCount: number, lastError: string }>
const keyStateCache = new Map();

/**
 * Masking API key untuk keamanan log/tampilan (e.g. AIzaSy...4x8d)
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 10) return '***';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

/**
 * Mendapatkan semua Gemini API Key yang terdaftar (Utama + Cadangan)
 * @param {object} settings
 * @returns {Array<{ key: string, label: string, isPrimary: boolean, index: number }>}
 */
function getAllGeminiKeys(settings = {}) {
  const keys = [];
  const seen = new Set();

  // 1. Primary Key
  const primary = (settings.gemini_api_key || '').trim();
  if (primary) {
    keys.push({ key: primary, label: 'Utama (Primary)', isPrimary: true, index: 0 });
    seen.add(primary);
  }

  // 2. Backup Keys
  let backups = [];
  if (settings.gemini_backup_api_keys) {
    try {
      const parsed = typeof settings.gemini_backup_api_keys === 'string'
        ? JSON.parse(settings.gemini_backup_api_keys)
        : settings.gemini_backup_api_keys;
      if (Array.isArray(parsed)) backups = parsed;
    } catch (_) {
      if (typeof settings.gemini_backup_api_keys === 'string') {
        backups = settings.gemini_backup_api_keys.split(',').map(k => k.trim());
      }
    }
  }

  backups.forEach((k, idx) => {
    const trimmed = (k || '').trim();
    if (trimmed && !seen.has(trimmed)) {
      keys.push({ key: trimmed, label: `Cadangan #${idx + 1}`, isPrimary: false, index: idx + 1 });
      seen.add(trimmed);
    }
  });

  // 3. Env Fallback jika belum terdaftar
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  if (envKey && !seen.has(envKey)) {
    keys.push({ key: envKey, label: 'Environment (ENV)', isPrimary: false, index: keys.length });
    seen.add(envKey);
  }

  return keys;
}

/**
 * Mendapatkan status kesehatan kunci
 */
function getKeyState(key) {
  const now = Date.now();
  let state = keyStateCache.get(key);
  if (!state) {
    state = { status: 'healthy', cooldownUntil: 0, failCount: 0, successCount: 0, lastError: '' };
    keyStateCache.set(key, state);
  }

  // Jika cooldown sudah lewat, pulihkan kembali ke healthy
  if (state.status === 'rate_limited' && now > state.cooldownUntil) {
    state.status = 'healthy';
    state.lastError = '';
  }

  return state;
}

/**
 * Mendapatkan daftar Gemini Keys yang diurutkan berdasarkan kesehatan & kesiapan.
 * Kunci sehat didahulukan; kunci yang terkena 429 ditaruh di antrean belakang.
 */
function getOrderedEligibleKeys(settings = {}) {
  const all = getAllGeminiKeys(settings);
  const now = Date.now();

  const healthy = [];
  const coolingDown = [];

  for (const item of all) {
    const state = getKeyState(item.key);
    if (state.status === 'invalid') {
      continue; // Lewati kunci yang dicabut/invalid permanen
    }
    if (state.status === 'rate_limited' && now < state.cooldownUntil) {
      coolingDown.push({ ...item, state, remainingCooldownSec: Math.ceil((state.cooldownUntil - now) / 1000) });
    } else {
      healthy.push({ ...item, state, remainingCooldownSec: 0 });
    }
  }

  // Urutkan yang coolingDown berdasarkan waktu tunggu terpendek
  coolingDown.sort((a, b) => a.remainingCooldownSec - b.remainingCooldownSec);

  return [...healthy, ...coolingDown];
}

/**
 * Tandai API key sebagai Rate Limited (429 / Quota Exceeded)
 */
function markRateLimited(key, delaySeconds = 180, errorMsg = '') {
  if (!key) return;
  const state = getKeyState(key);
  state.status = 'rate_limited';
  state.cooldownUntil = Date.now() + (Math.max(delaySeconds, 60) * 1000);
  state.failCount += 1;
  state.lastError = errorMsg || '429 Too Many Requests (Quota Exceeded)';
  keyStateCache.set(key, state);
}

/**
 * Tandai API key sebagai Invalid (403 / Leaked / Revoked)
 */
function markInvalid(key, errorMsg = '') {
  if (!key) return;
  const state = getKeyState(key);
  state.status = 'invalid';
  state.cooldownUntil = Infinity;
  state.failCount += 1;
  state.lastError = errorMsg || '403 Forbidden / Invalid API Key';
  keyStateCache.set(key, state);
}

/**
 * Tandai API key berhasil dipakai (Reset status)
 */
function markSuccess(key) {
  if (!key) return;
  const state = getKeyState(key);
  state.status = 'healthy';
  state.cooldownUntil = 0;
  state.failCount = 0;
  state.successCount += 1;
  state.lastError = '';
  keyStateCache.set(key, state);
}

const https = require('https');
const dns = require('dns');
const logger = require('../logger');

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

/**
 * Menguji satu API Key secara langsung ke Google Gemini API (dengan proteksi IPv4 dan timeout)
 */
function testSingleGeminiKey(key, model = 'gemini-3.5-flash') {
  if (!key || typeof key !== 'string') {
    return Promise.resolve({
      valid: false,
      status: 'invalid',
      message: 'API Key kosong atau format tidak valid'
    });
  }

  const trimmed = key.trim();
  const masked = maskKey(trimmed);
  const startTime = Date.now();

  logger.info(`[KEY_POOL:DIAG] Memulai pengujian key ${masked} ke Google API (IPv4 mode)...`);

  return new Promise((resolve) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}`;
    
    const req = https.get(url, {
      family: 4, // Paksa koneksi via IPv4 untuk mencegah ETIMEDOUT di shared hosting Dewaweb
      timeout: 12000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Monitoring-SE2026-PPU/2.5.0'
      }
    }, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        const latencyMs = Date.now() - startTime;
        try {
          const parsed = JSON.parse(rawData);
          if (res.statusCode === 200) {
            const modelsCount = Array.isArray(parsed.models) ? parsed.models.length : 0;
            markSuccess(trimmed);
            logger.info(`[KEY_POOL:DIAG] Key ${masked} SUKSES (200 OK, ${modelsCount} models, ${latencyMs}ms)`);
            resolve({
              valid: true,
              status: 'healthy',
              statusCode: 200,
              message: `Aktif & Terhubung ke Google API (${modelsCount} model tersedia)`,
              latencyMs
            });
          } else if (res.statusCode === 429) {
            const errMsg = parsed.error?.message || 'Rate Limit';
            markRateLimited(trimmed, 180, errMsg);
            logger.warn(`[KEY_POOL:DIAG] Key ${masked} RATE LIMITED (429, ${latencyMs}ms): ${errMsg}`);
            resolve({
              valid: false,
              status: 'rate_limited',
              statusCode: 429,
              message: 'Batas kuota terlampaui (429 Rate Limit)',
              latencyMs,
              errorDetail: errMsg
            });
          } else if (res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 403) {
            const errMsg = parsed.error?.message || `HTTP ${res.statusCode}`;
            markInvalid(trimmed, errMsg);
            logger.warn(`[KEY_POOL:DIAG] Key ${masked} INVALID (${res.statusCode}, ${latencyMs}ms): ${errMsg}`);
            resolve({
              valid: false,
              status: 'invalid',
              statusCode: res.statusCode,
              message: `API Key tidak valid atau salah format (${res.statusCode})`,
              latencyMs,
              errorDetail: errMsg
            });
          } else {
            const errMsg = parsed.error?.message || `HTTP ${res.statusCode}`;
            logger.error(`[KEY_POOL:DIAG] Key ${masked} ERROR (${res.statusCode}, ${latencyMs}ms): ${errMsg}`);
            resolve({
              valid: false,
              status: 'error',
              statusCode: res.statusCode,
              message: `Error (${res.statusCode}): ${errMsg}`,
              latencyMs,
              errorDetail: errMsg
            });
          }
        } catch (parseErr) {
          logger.error(`[KEY_POOL:DIAG] Key ${masked} PARSE ERROR: ${parseErr.message}`);
          resolve({
            valid: false,
            status: 'error',
            statusCode: res.statusCode,
            message: `Gagal membaca respon server (${res.statusCode})`,
            latencyMs,
            errorDetail: rawData.slice(0, 150)
          });
        }
      });
    });

    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime;
      const codeStr = err.code ? ` (${err.code})` : '';
      logger.error(`[KEY_POOL:DIAG] Key ${masked} NETWORK ERROR: ${err.message}${codeStr}`);
      resolve({
        valid: false,
        status: 'network_error',
        message: `Koneksi gagal ke server Google: ${err.message}${codeStr}`,
        latencyMs,
        errorDetail: err.stack || err.message
      });
    });

    req.on('timeout', () => {
      const latencyMs = Date.now() - startTime;
      req.destroy();
      logger.error(`[KEY_POOL:DIAG] Key ${masked} TIMEOUT (>12s) via IPv4`);
      resolve({
        valid: false,
        status: 'network_error',
        message: 'Koneksi Timeout (>12s) ke generativelanguage.googleapis.com',
        latencyMs,
        errorDetail: 'Socket connect timeout on port 443'
      });
    });
  });
}

/**
 * Menguji semua API Key Gemini yang terdaftar (Utama & Cadangan)
 */
async function testAllGeminiKeys(settings = {}) {
  const allKeys = getAllGeminiKeys(settings);
  const model = settings.gemini_model || 'gemini-3.5-flash';

  const results = await Promise.all(
    allKeys.map(async (item) => {
      const res = await testSingleGeminiKey(item.key, model);
      return {
        label: item.label,
        isPrimary: item.isPrimary,
        index: item.index,
        maskedKey: maskKey(item.key),
        ...res
      };
    })
  );

  const healthyCount = results.filter(r => r.valid).length;
  const allRateLimited = results.length > 1 && results.every(r => r.statusCode === 429);

  let advice = null;
  if (allRateLimited) {
    advice = 'Semua API key mengalami batas kuota 429 secara bersamaan. Kemungkinan seluruh key dibuat di dalam Project Google Cloud yang sama. Untuk mendapatkan kuota cadangan yang independen, buat API Key di Project Google Cloud yang Baru atau gunakan Akun Google/Gmail yang berbeda di Google AI Studio.';
  } else if (results.length > 0 && healthyCount === 0) {
    advice = 'Tidak ada API Key yang dapat digunakan saat ini. Silakan periksa kembali API Key atau tambahkan OpenRouter API Key sebagai cadangan otomatis.';
  }

  return {
    total: results.length,
    healthyCount,
    allHealthy: healthyCount === results.length && results.length > 0,
    allRateLimited,
    advice,
    modelUsed: model,
    keys: results
  };
}


module.exports = {
  maskKey,
  getAllGeminiKeys,
  getOrderedEligibleKeys,
  getKeyState,
  markRateLimited,
  markInvalid,
  markSuccess,
  testSingleGeminiKey,
  testAllGeminiKeys
};
