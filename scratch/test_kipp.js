const { getDb } = require('d:/SE2026/monitoring-se2026-ppu/database');
const db = getDb();
const rows = db.prepare(`SELECT DISTINCT kecamatan, desa FROM subsls_master WHERE desa LIKE '%KIPP%' OR nama_sls LIKE '%KIPP%'`).all();
console.log('KIPP Matches:', rows);
