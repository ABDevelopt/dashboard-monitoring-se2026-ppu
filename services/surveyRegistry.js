/**
 * SurveyRegistry Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer abstraksi untuk membaca konfigurasi survei/sensus.
 *
 * STRATEGI (direvisi 20260820):
 *   1. Sumber utama: config/surveys.json — satu-satunya sumber otoritatif
 *      untuk daftar semua survei. Tidak bergantung pada DB manapun.
 *   2. Opsional override: tabel `surveys_registry` di masing-masing DB survei
 *      dapat digunakan untuk override config survei itu sendiri saja.
 *      Dibaca per-survei via getDb(surveyId) — tidak ada cross-DB dependency.
 *
 * PRINSIP DESAIN:
 *   - Setiap survei berdiri sendiri (isolated DB). Tidak ada "master DB".
 *   - se2026.db, sakernas-pemutakhiran.db, sakernas-pendataan.db adalah peers.
 *   - surveys.json adalah config file statis yang dikelola developer/admin sistem.
 *
 * Dengan ini, routes/surveys.js TIDAK perlu diubah sama sekali —
 * semua digantikan secara transparan oleh service ini.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ─── Sumber utama: surveys.json ───────────────────────────────────────────────
let _jsonFallback = null;
function getJsonFallback() {
  if (!_jsonFallback) {
    try {
      // Invalidate require cache agar perubahan surveys.json langsung terdeteksi
      const cfgPath = require.resolve('../config/surveys.json');
      delete require.cache[cfgPath];
      _jsonFallback = require('../config/surveys.json');
    } catch (_) {
      _jsonFallback = {};
    }
  }
  return _jsonFallback;
}

/**
 * Buka koneksi readonly ke DB survei tertentu (bukan se2026 secara khusus).
 * Masing-masing DB survei berdiri sendiri.
 * @param {string} surveyId
 * @returns {Database|null}
 */
function openSurveyDbReadonly(surveyId) {
  try {
    const dbPath = path.join(__dirname, '..', 'data', `${surveyId}.db`);
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: true, timeout: 5000 });
  } catch (_) {
    return null;
  }
}

/**
 * Baca config override dari tabel surveys_registry di DB survei tertentu.
 * Hanya untuk survei itu sendiri — tidak cross-DB.
 * Mengembalikan null jika tabel belum ada atau data tidak ditemukan.
 * @param {string} surveyId
 * @returns {Object|null}
 */
function getSurveyConfigFromOwnDb(surveyId) {
  const db = openSurveyDbReadonly(surveyId);
  if (!db) return null;

  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='surveys_registry'")
      .get();

    if (!tableExists) {
      db.close();
      return null;
    }

    const row = db.prepare(`
      SELECT r.*, t.theme_name, t.theme_color, t.theme_secondary, t.theme_rgb,
             t.theme_icon, t.theme_gradient, t.theme_glow, t.category_icon, t.category_badge,
             c.unit_name, c.route_prefix, c.show_usaha_columns, c.show_muatan_usaha, c.enabled_pages
      FROM surveys_registry r
      LEFT JOIN survey_themes t ON t.survey_id = r.id
      LEFT JOIN survey_collection_config c ON c.survey_id = r.id
      WHERE r.id = ? AND r.is_active = 1
      LIMIT 1
    `).get(surveyId);

    db.close();
    if (!row) return null;

    return row;
  } catch (_) {
    try { db.close(); } catch (__) {}
    return null;
  }
}

/**
 * Konversi satu baris dari surveys_registry ke format kompatibel surveys.json.
 * @param {Object} row — baris dari DB
 * @param {Object} jsonCfg — config dasar dari surveys.json (sebagai base)
 * @returns {Object}
 */
function rowToConfig(row, jsonCfg) {
  return {
    ...jsonCfg,
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    tagline: row.tagline,
    category: row.category,
    categoryLabel: row.category_label,
    categoryBadge: row.category_badge,
    categoryIcon: row.category_icon,
    coverageDesc: row.coverage_desc,
    themePack: row.theme_name,
    theme: (function () {
      if (jsonCfg && jsonCfg.theme) return jsonCfg.theme;
      const tn = (row.theme_name || '').toLowerCase();
      if (tn.includes('emerald')) return 'emerald';
      if (tn.includes('sapphire') || tn.includes('blue')) return 'blue';
      if (tn.includes('cyan')) return 'cyan';
      if (tn.includes('purple')) return 'purple';
      return 'orange';
    })(),
    themeColor: row.theme_color,
    themeSecondary: row.theme_secondary,
    themeRgb: row.theme_rgb,
    themeGradient: row.theme_gradient,
    themeGlow: row.theme_glow,
    themeIcon: row.theme_icon,
    unitName: row.unit_name,
    showUsahaColumns: row.show_usaha_columns === 1,
    showMuatanUsaha: row.show_muatan_usaha === 1,
    officerRole: jsonCfg.officerRole || (row.id.startsWith('sakernas') ? 'PPL' : 'PCL'),
    officerFullRole: jsonCfg.officerFullRole || (row.id.startsWith('sakernas') ? 'Petugas Pendataan Lapangan' : 'Petugas Cacah Lapangan'),
    hasKorlap: jsonCfg.hasKorlap !== undefined ? jsonCfg.hasKorlap : !row.id.startsWith('sakernas'),
    enabledPages: row.enabled_pages ? JSON.parse(row.enabled_pages) : (jsonCfg.enabledPages || []),
  };
}

/**
 * Sumber tunggal konfigurasi semua survei.
 *
 * Sumber utama adalah surveys.json.
 * Untuk setiap survei, jika DB-nya sudah ada dan memiliki surveys_registry,
 * data dari DB digunakan sebagai override (per-survei, tidak cross-DB).
 *
 * @returns {Object} — config survei keyed by survey id
 */
function getSurveysConfig() {
  const jsonConfig = getJsonFallback();
  const result = {};

  for (const [surveyId, jsonCfg] of Object.entries(jsonConfig)) {
    // Coba ambil override dari DB survei itu sendiri
    const dbRow = getSurveyConfigFromOwnDb(surveyId);
    if (dbRow) {
      result[surveyId] = rowToConfig(dbRow, jsonCfg);
    } else {
      // Fallback ke surveys.json murni
      result[surveyId] = { ...jsonCfg, id: surveyId };
    }
  }

  return result;
}

/**
 * Ambil config satu survei berdasarkan ID.
 * Membaca dari DB survei itu sendiri terlebih dahulu (per-survei),
 * lalu fallback ke surveys.json. Tidak bergantung pada DB survei lain.
 *
 * @param {string} surveyId
 * @returns {Object|null}
 */
function getSurveyById(surveyId) {
  if (!surveyId) return null;
  const jsonCfg = getJsonFallback()[surveyId] || {};

  // Coba baca dari DB survei sendiri
  const dbRow = getSurveyConfigFromOwnDb(surveyId);
  if (dbRow) {
    return rowToConfig(dbRow, jsonCfg);
  }

  // Fallback ke surveys.json
  if (Object.keys(jsonCfg).length > 0) {
    return { ...jsonCfg, id: surveyId };
  }

  return null;
}

/**
 * Invalidate JSON cache. Dipanggil jika surveys.json diupdate saat runtime.
 */
function invalidateCache() {
  _jsonFallback = null;
}

module.exports = {
  getSurveysConfig,
  getSurveyById,
  invalidateCache,
};
