const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'se2026.db');

console.log('Mengisi data historis cuaca pada database:', DB_PATH);

try {
  const db = new Database(DB_PATH);

  // Buat tabel jika belum ada
  db.exec(`
    CREATE TABLE IF NOT EXISTS weather_history (
      tanggal TEXT PRIMARY KEY,
      temp REAL,
      code INTEGER,
      humidity INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const startDate = new Date('2026-06-15');
  const endDate = new Date('2026-07-08');

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO weather_history (tanggal, temp, code, humidity)
    VALUES (?, ?, ?, ?)
  `);

  // Distribusi kode cuaca:
  // 0: Cerah, 2: Cerah Berawan, 3: Berawan, 61: Hujan Ringan, 80: Hujan
  const codes = [2, 2, 3, 61, 2, 80, 2, 3, 0, 2, 61, 2, 3, 2, 80, 2, 0, 2, 3, 61, 2, 2, 0, 2];

  let count = 0;
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d);
    const code = codes[count % codes.length];
    
    let temp = 30 + Math.random() * 3; // 30 - 33
    let humidity = 75 + Math.round(Math.random() * 15); // 75 - 90
    
    if (code === 80 || code === 61) {
      temp = 26 + Math.random() * 3; // Lebih sejuk saat hujan
      humidity = 85 + Math.round(Math.random() * 10);
    }
    
    insertStmt.run(dateStr, Math.round(temp * 10) / 10, code, humidity);
    count++;
  }

  console.log(`Berhasil mengisi ${count} baris data cuaca historis.`);
  db.close();
} catch (err) {
  console.error('Gagal memperbarui database:', err.message);
}
