const db = require('better-sqlite3')('data/se2026.db');
const res1 = db.prepare('SELECT SUM(target_fasih) as sum FROM subsls_master').get();
console.log('Original Target FASIH Sum:', res1.sum);

const lastUpload = db.prepare('SELECT id FROM uploads ORDER BY id DESC LIMIT 1').get();
if (lastUpload) {
    const res2 = db.prepare(`
        SELECT SUM(CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 
                 THEN 0 
                 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) 
            END) AS n
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    `).get(lastUpload.id);
    console.log('Dynamic Target FASIH Sum:', res2.n);
    
    const res3 = db.prepare(`SELECT SUM(usaha_baru) as ub, SUM(keluarga_baru) as kb, SUM(usaha_tutup) as ut, SUM(tidak_ditemukan) as td FROM progres WHERE upload_id = ?`).get(lastUpload.id);
    console.log('Stats:', res3);
}
