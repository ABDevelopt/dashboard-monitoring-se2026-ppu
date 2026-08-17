'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  cacheManager.js
//  Menyediakan cache in-memory untuk hasil tool call (terutama SQL query)
//  dengan masa aktif (TTL) 5 menit.
// ─────────────────────────────────────────────────────────────────────────────

const cache = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 menit

/**
 * Menyimpan data ke dalam cache.
 * @param {string} key - Kunci unik cache
 * @param {any} value - Nilai yang disimpan
 * @param {number} [ttlMs=300000] - Time-to-live dalam milidetik (default 5 menit)
 */
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return;
  const expiresAt = Date.now() + ttlMs;
  cache.set(key, { value, expiresAt });
}

/**
 * Mengambil data dari cache. Mengembalikan null jika cache miss atau kedaluwarsa.
 * @param {string} key - Kunci unik cache
 * @returns {any|null}
 */
function get(key) {
  if (!key) return null;
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    cache.delete(key); // Hapus jika sudah kedaluwarsa
    return null;
  }
  return item.value;
}

/**
 * Menghapus kunci tertentu dari cache.
 * @param {string} key
 */
function del(key) {
  cache.delete(key);
}

/**
 * Membersihkan seluruh isi cache.
 */
function clear() {
  cache.clear();
}

/**
 * Helper untuk men-generate cache key yang unik.
 * @param {string} category - Kategori (misal: 'sql', 'pcl_stats')
 * @param {any} params - Parameter query/request
 * @returns {string}
 */
function generateKey(category, params) {
  return `${category}:${JSON.stringify(params)}`;
}

module.exports = {
  set,
  get,
  del,
  clear,
  generateKey
};
