/**
 * SurveyRegistry Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer abstraksi untuk membaca konfigurasi survei/sensus.
 *
 * STRATEGI:
 *   1. Coba baca dari tabel `surveys_registry` di DB master (se2026.db).
 *   2. Jika tabel belum ada / kosong, fallback ke config/surveys.json (backward-compat).
 *
 * Dengan ini, routes/surveys.js TIDAK perlu diubah sama sekali —
 * semua digantikan secara transparan oleh service ini.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Jalur database master (tidak bergantung pada surveyContext)
const MASTER_DB_PATH = path.join(__dirname, '..', 'data', 'se2026.db');

// Fallback: konfigurasi statis dari JSON
let _jsonFallback = null;
function getJsonFallback() {
  if (!_jsonFallback) {
    try {
      _jsonFallback = require('../config/surveys.json');
    } catch (_) {
      _jsonFallback = {};
    }
  }
  return _jsonFallback;
}

/**
 * Mendapatkan koneksi ke database master.
 * Tidak memanggil runMigrations() agar tidak circular — tabel di-ensure
 * oleh migrasi database.js secara normal.
 */
function getMasterDb() {
  try {
    const db = new Database(MASTER_DB_PATH, { readonly: true, timeout: 5000 });
    return db;
  } catch (_) {
    return null;
  }
}

/**
 * Ambil semua survei dari tabel surveys_registry (urutan sort_order ASC).
 * Kembalikan array objek yang kompatibel dengan format surveys.json.
 * @returns {Object} — Object keyed by survey id, value berisi config survei
 */
function getAllSurveysFromDb() {
  const db = getMasterDb();
  if (!db) return null;

  try {
    // Cek apakah tabel surveys_registry sudah ada
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='surveys_registry'")
      .get();

    if (!tableExists) {
      db.close();
      return null;
    }

    const rows = db
      .prepare(`
        SELECT r.*, t.theme_name, t.theme_color, t.theme_secondary, t.theme_rgb,
               t.theme_icon, t.theme_gradient, t.theme_glow, t.category_icon, t.category_badge,
               c.unit_name, c.route_prefix, c.show_usaha_columns, c.show_muatan_usaha, c.enabled_pages
        FROM surveys_registry r
        LEFT JOIN survey_themes t ON t.survey_id = r.id
        LEFT JOIN survey_collection_config c ON c.survey_id = r.id
        WHERE r.is_active = 1
        ORDER BY r.sort_order ASC, r.id ASC
      `)
      .all();

    db.close();

    if (!rows || rows.length === 0) return null;

    // Konversi ke format yang identik dengan surveys.json
    const result = {};
    rows.forEach(row => {
      const jsonCfg = getJsonFallback()[row.id] || {};
      result[row.id] = {
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
        theme: (function() {
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
    });

    return result;

  } catch (err) {
    // Jika DB terbuka tapi query gagal, tutup dan fallback
    try { db.close(); } catch (_) {}
    return null;
  }
}

/**
 * Sumber tunggal konfigurasi survei.
 * Otomatis fallback ke surveys.json jika DB belum ada/belum ter-migrasi.
 * @returns {Object} — config survei
 */
function getSurveysConfig() {
  const fromDb = getAllSurveysFromDb();
  if (fromDb && Object.keys(fromDb).length > 0) {
    return fromDb;
  }
  return getJsonFallback();
}

/**
 * Ambil satu survei berdasarkan ID.
 * @param {string} surveyId
 * @returns {Object|null}
 */
function getSurveyById(surveyId) {
  const all = getSurveysConfig();
  return all[surveyId] || null;
}

module.exports = {
  getSurveysConfig,
  getSurveyById,
};
