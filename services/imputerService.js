const { getDb } = require('../database');

/**
 * Menghapus seluruh record Imputasi Otomatis sintetis dari database
 */
function cleanupAllImputations(surveyId = 'se2026') {
  try {
    const db = getDb(surveyId);
    const rows = db.prepare("SELECT id FROM uploads WHERE filename LIKE '%Imputasi Otomatis%' OR filename LIKE '%Imputasi%'").all();
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      db.transaction(() => {
        db.prepare(`DELETE FROM progres WHERE upload_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM summary_cache WHERE upload_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM uploads WHERE id IN (${placeholders})`).run(...ids);
      })();
      console.log(`[Imputer] Berhasil membersihkan ${rows.length} record Imputasi Otomatis dari database.`);
    }
  } catch (err) {
    console.error('❌ Gagal membersihkan record imputasi:', err.message);
  }
}

/**
 * Fitur imputasi otomatis telah di-nonaktifkan secara total sesuai instruksi pengguna.
 */
function runAutoImputation(surveyId = 'se2026') {
  cleanupAllImputations(surveyId);
  return 0;
}

module.exports = {
  runAutoImputation,
  cleanupAllImputations
};
