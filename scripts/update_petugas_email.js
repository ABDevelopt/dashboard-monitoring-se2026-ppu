const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '../data/petugas_email.json');
const csvPath = path.join(__dirname, '../data/petugas_email.csv');

const rawJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const existingEmails = new Set(rawJson.map(p => (p.Email || '').toLowerCase().trim()));

const pmlList = [
  { Email: 'tyas.hapsari@bps.go.id', 'Nama Lengkap': 'Tyas Hapsari', 'Sobat ID': '64090001', 'Jenis Kelamin': 'Pr' },
  { Email: 'faliq.ridho@bps.go.id', 'Nama Lengkap': 'Faliq Ridho', 'Sobat ID': '64090002', 'Jenis Kelamin': 'Lk' },
  { Email: 'sudarman-pppk@bps.go.id', 'Nama Lengkap': 'Sudarman', 'Sobat ID': '64090003', 'Jenis Kelamin': 'Lk' },
  { Email: 'lili.riduan@bps.go.id', 'Nama Lengkap': 'Lili Riduan', 'Sobat ID': '64090004', 'Jenis Kelamin': 'Lk' },
  { Email: 'nova.harahap@bps.go.id', 'Nama Lengkap': 'Nova Harahap', 'Sobat ID': '64090005', 'Jenis Kelamin': 'Pr' },
  { Email: 'aisyah.khoirunnisa@bps.go.id', 'Nama Lengkap': 'Aisyah Khoirunnisa', 'Sobat ID': '64090006', 'Jenis Kelamin': 'Pr' },
  { Email: 'yamin.muhamad@bps.go.id', 'Nama Lengkap': 'Muhamad Yamin', 'Sobat ID': '64090007', 'Jenis Kelamin': 'Lk' },
  { Email: 's.karim@bps.go.id', 'Nama Lengkap': 'Syahrul Karim', 'Sobat ID': '64090008', 'Jenis Kelamin': 'Lk' },
  { Email: 'mega.fitria@bps.go.id', 'Nama Lengkap': 'Mega Fitria', 'Sobat ID': '64090009', 'Jenis Kelamin': 'Pr' },
  { Email: 'fitri.handayani@bps.go.id', 'Nama Lengkap': 'Fitri Handayani', 'Sobat ID': '64090010', 'Jenis Kelamin': 'Pr' },
  { Email: 'asrani-pppk@bps.go.id', 'Nama Lengkap': 'Asrani', 'Sobat ID': '64090011', 'Jenis Kelamin': 'Lk' },
  { Email: 'khuzaini@bps.go.id', 'Nama Lengkap': 'Khuzaini', 'Sobat ID': '64090012', 'Jenis Kelamin': 'Lk' },
  { Email: 'zahrakhairunnisa@bps.go.id', 'Nama Lengkap': 'Zahra Khairunnisa', 'Sobat ID': '64090013', 'Jenis Kelamin': 'Pr' },
  { Email: '6409.zella@dummy.sobat.id', 'Nama Lengkap': 'Zella', 'Sobat ID': '64090014', 'Jenis Kelamin': 'Pr' },
  { Email: 'nabila.paramita@bps.go.id', 'Nama Lengkap': 'Nabila Paramita', 'Sobat ID': '64090015', 'Jenis Kelamin': 'Pr' },
  { Email: 'dhofirur.romadhon@bps.go.id', 'Nama Lengkap': 'Dhofirur Romadhon', 'Sobat ID': '64090016', 'Jenis Kelamin': 'Lk' },
  { Email: 'baihaqi.syah@bps.go.id', 'Nama Lengkap': 'Baihaqi Syah', 'Sobat ID': '64090017', 'Jenis Kelamin': 'Lk' }
];

let added = 0;
const csvLinesToAdd = [];
for (const pml of pmlList) {
  if (!existingEmails.has(pml.Email.toLowerCase())) {
    const item = {
      'Kode Prov': 64,
      'Kode Kab': 9,
      'Nama Kab': 'PENAJAM PASER UTARA',
      'Sobat ID': pml['Sobat ID'],
      'Email': pml.Email,
      'Nama Lengkap': pml['Nama Lengkap'],
      'Jenis Kelamin': pml['Jenis Kelamin']
    };
    rawJson.push(item);
    csvLinesToAdd.push(`64,9,PENAJAM PASER UTARA,${pml['Sobat ID']},${pml.Email},${pml['Nama Lengkap']},${pml['Jenis Kelamin']}`);
    added++;
  }
}

if (added > 0) {
  fs.writeFileSync(jsonPath, JSON.stringify(rawJson, null, 2), 'utf8');
  if (fs.existsSync(csvPath)) {
    fs.appendFileSync(csvPath, '\n' + csvLinesToAdd.join('\n'), 'utf8');
  }
  console.log(`Successfully added ${added} PML officers to petugas_email database.`);
} else {
  console.log('All PML officers already present in petugas_email.');
}

// Ensure shared.db ref_petugas table contains all PMLs as well
try {
  const Database = require('better-sqlite3');
  const sharedDbPath = path.join(__dirname, '../data/shared.db');
  if (fs.existsSync(sharedDbPath)) {
    const dbShared = new Database(sharedDbPath);
    const insStmt = dbShared.prepare(`
      INSERT INTO ref_petugas (sobat_id, nama_lengkap, email, jenis_kelamin, kode_prov, kode_kab, nama_kab)
      VALUES (?, ?, ?, ?, 64, 9, 'PENAJAM PASER UTARA')
      ON CONFLICT(email) DO UPDATE SET
        sobat_id = COALESCE(excluded.sobat_id, ref_petugas.sobat_id),
        nama_lengkap = excluded.nama_lengkap,
        jenis_kelamin = COALESCE(excluded.jenis_kelamin, ref_petugas.jenis_kelamin)
    `);
    dbShared.transaction(() => {
      for (const pml of pmlList) {
        insStmt.run(pml['Sobat ID'], pml['Nama Lengkap'], pml.Email.toLowerCase().trim(), pml['Jenis Kelamin'] || null);
      }
    })();
    dbShared.close();
    console.log('Successfully synced PML officers to shared.db ref_petugas table.');
  }
} catch (err) {
  console.error('Error syncing to shared.db:', err.message);
}

// Trigger resync to all master tables
try {
  const { resyncPetugasEmailsToMaster } = require('../database');
  resyncPetugasEmailsToMaster();
  console.log('Successfully triggered resyncPetugasEmailsToMaster().');
} catch (err) {
  console.error('Error in resyncPetugasEmailsToMaster:', err.message);
}

