// migrate.js
require('dotenv').config();
const { getDb } = require('./database');
const logger = require('./services/logger');

try {
  logger.info('🔄 Memulai proses migrasi/update database...');
  
  // getDb() automatically invokes runMigrations() internally
  const db = getDb();
  
  logger.info('✅ Selesai! Seluruh migrasi database berhasil diterapkan.');
  
  // Close the database connection cleanly
  db.close();
  process.exit(0);
} catch (err) {
  logger.error('❌ Gagal menjalankan migrasi database:', err);
  process.exit(1);
}
