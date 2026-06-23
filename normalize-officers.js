const Database = require('better-sqlite3');
const path = require('path');

// Connect to SQLite database in the project data folder
const dbPath = path.join(__dirname, 'data', 'se2026.db');
const db = new Database(dbPath);

const pclsToNormalize = [
  { key: "afna rowita", standard: "Afna Rowita" },
  { key: "dwi khusnul idhiah", standard: "Dwi Khusnul Idhiah" },
  { key: "eko wahyudi", standard: "Eko Wahyudi" },
  { key: "elza putri fadrizah", standard: "Elza Putri Fadrizah" },
  { key: "fajar", standard: "Fajar" },
  { key: "nurjanah", standard: "Nurjanah" },
  { key: "nanda alfiah", standard: "Nanda Alfiah" },
  { key: "nur azizah", standard: "Nur Azizah" },
  { key: "nur syifa azizah", standard: "Nur Syifa Azizah" },
  { key: "purwanti", standard: "Purwanti" },
  { key: "siti fatimah", standard: "Siti Fatimah" }
];

const pmlsToNormalize = [
  { key: "abdul basir", standard: "Abdul Basir" },
  { key: "hartini", standard: "Hartini" },
  { key: "ismail", standard: "Ismail" },
  { key: "mujiono", standard: "Mujiono" },
  { key: "pipu rini astuti", standard: "Pipu Rini Astuti" },
  { key: "ruth", standard: "Ruth" }
];

// Perform updates inside a transaction
const runMigration = db.transaction(() => {
  console.log('--- Normalizing PCL names ---');
  pclsToNormalize.forEach(({ key, standard }) => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM subsls_master WHERE LOWER(TRIM(pcl)) = ?").get(key).count;
    if (count > 0) {
      const info = db.prepare("UPDATE subsls_master SET pcl = ? WHERE LOWER(TRIM(pcl)) = ?").run(standard, key);
      console.log(`PCL: "${key}" -> Standardized to "${standard}" (${info.changes} rows updated)`);
    } else {
      console.log(`PCL: "${key}" -> No matching rows found.`);
    }
  });

  console.log('\n--- Normalizing PML names ---');
  pmlsToNormalize.forEach(({ key, standard }) => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM subsls_master WHERE LOWER(TRIM(pml)) = ?").get(key).count;
    if (count > 0) {
      const info = db.prepare("UPDATE subsls_master SET pml = ? WHERE LOWER(TRIM(pml)) = ?").run(standard, key);
      console.log(`PML: "${key}" -> Standardized to "${standard}" (${info.changes} rows updated)`);
    } else {
      console.log(`PML: "${key}" -> No matching rows found.`);
    }
  });
});

try {
  runMigration();
  console.log('\n✅ Database normalization completed successfully!');
} catch (error) {
  console.error('❌ Migration failed:', error);
} finally {
  db.close();
}
