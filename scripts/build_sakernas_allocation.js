const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const VERCEL_OUTPUT_DIR = 'C:/Users/ajian/vercel-agent-browser/output';
const PROJECT_ROOT = path.join(__dirname, '..');

// 1. Load official officer emails lookup
const petugasEmailJsonPath = path.join(PROJECT_ROOT, 'data/petugas_email.json');
const rawPetugasList = JSON.parse(fs.readFileSync(petugasEmailJsonPath, 'utf8'));
const officerLookup = new Map();
for (const p of rawPetugasList) {
  const em = (p.Email || '').toLowerCase().trim();
  if (em) {
    officerLookup.set(em, {
      nama: String(p['Nama Lengkap'] || p.nama_lengkap || '').trim(),
      sobatId: String(p['Sobat ID'] || p.sobat_id || '').trim(),
      gender: String(p['Jenis Kelamin'] || p.jenis_kelamin || '').trim()
    });
  }
}

// PML official names mapping
const pmlNames = {
  'tyas.hapsari@bps.go.id': { nama: 'Tyas Hapsari', sobatId: '64090001' },
  'faliq.ridho@bps.go.id': { nama: 'Faliq Ridho', sobatId: '64090002' },
  'sudarman-pppk@bps.go.id': { nama: 'Sudarman', sobatId: '64090003' },
  'lili.riduan@bps.go.id': { nama: 'Lili Riduan', sobatId: '64090004' },
  'nova.harahap@bps.go.id': { nama: 'Nova Harahap', sobatId: '64090005' },
  'aisyah.khoirunnisa@bps.go.id': { nama: 'Aisyah Khoirunnisa', sobatId: '64090006' },
  'yamin.muhamad@bps.go.id': { nama: 'Muhamad Yamin', sobatId: '64090007' },
  's.karim@bps.go.id': { nama: 'Syahrul Karim', sobatId: '64090008' },
  'mega.fitria@bps.go.id': { nama: 'Mega Fitria', sobatId: '64090009' },
  'fitri.handayani@bps.go.id': { nama: 'Fitri Handayani', sobatId: '64090010' },
  'asrani-pppk@bps.go.id': { nama: 'Asrani', sobatId: '64090011' },
  'khuzaini@bps.go.id': { nama: 'Khuzaini', sobatId: '64090012' },
  'zahrakhairunnisa@bps.go.id': { nama: 'Zahra Khairunnisa', sobatId: '64090013' },
  '6409.zella@dummy.sobat.id': { nama: 'Zella', sobatId: '64090014' },
  'nabila.paramita@bps.go.id': { nama: 'Nabila Paramita', sobatId: '64090015' },
  'dhofirur.romadhon@bps.go.id': { nama: 'Dhofirur Romadhon', sobatId: '64090016' },
  'baihaqi.syah@bps.go.id': { nama: 'Baihaqi Syah', sobatId: '64090017' }
};

for (const [em, val] of Object.entries(pmlNames)) {
  officerLookup.set(em, { nama: val.nama, sobatId: val.sobatId, gender: 'Lk' });
}

// 2. Reference master wilayah from se2026.db
const seDb = new Database(path.join(PROJECT_ROOT, 'data/se2026.db'));
const getWilayahStmt = seDb.prepare('SELECT kode, kode_kec, kecamatan, desa, nama_sls FROM subsls_master WHERE kode = ?');

// 3. Source JSON files from vercel-agent-browser output
const pmuSourcePath = path.join(VERCEL_OUTPUT_DIR, 'rekap_petugas_wilayah__sakernas_agustus_2026_pemutakhiran_20260816_084522.json');
const pdtSourcePath = path.join(VERCEL_OUTPUT_DIR, 'rekap_petugas_wilayah_sakernas_ags_2026_pendataan_20260816_084658.json');

const pmuRaw = JSON.parse(fs.readFileSync(pmuSourcePath, 'utf8'));
const pdtRaw = JSON.parse(fs.readFileSync(pdtSourcePath, 'utf8'));

function buildAllocationRecords(rawJson, surveyType) {
  const pmlMap = new Map();
  const pplMap = new Map();
  const regionCounts = new Map();

  for (const entry of rawJson) {
    const role = entry.role;
    const email = entry.officer.split(' ')[0].toLowerCase().trim();

    for (const reg of entry.regions) {
      const kode = reg.code.padStart(16, '0');
      let count = 0;
      for (const st of reg.statuses) {
        count += parseInt(st.count || 0, 10);
      }

      if (role === 'PML') {
        pmlMap.set(kode, email);
      } else if (role === 'PPL') {
        pplMap.set(kode, email);
        regionCounts.set(kode, count);
      }
    }
  }

  // Get all unique codes sorted
  const allCodes = Array.from(new Set([...pmlMap.keys(), ...pplMap.keys()])).sort();
  console.log(`[${surveyType}] Total unique Blok Sensus codes: ${allCodes.length}`);

  const rows = [];
  for (const kode of allCodes) {
    const wInfo = getWilayahStmt.get(kode) || {
      kode_kec: kode.substring(6, 8),
      kecamatan: 'Penajam Paser Utara',
      desa: 'Desa ' + kode.substring(8, 10),
      nama_sls: 'RT ' + kode.substring(10, 14)
    };

    const pmlEmail = pmlMap.get(kode) || null;
    const pplEmail = pplMap.get(kode) || null;

    const pmlOfficer = pmlEmail && officerLookup.has(pmlEmail) ? officerLookup.get(pmlEmail) : null;
    const pplOfficer = pplEmail && officerLookup.has(pplEmail) ? officerLookup.get(pplEmail) : null;

    const pmlNama = pmlOfficer ? pmlOfficer.nama : (pmlEmail ? pmlEmail.split('@')[0] : 'PML Belum Dialokasikan');
    const pclNama = pplOfficer ? pplOfficer.nama : (pplEmail ? pplEmail.split('@')[0] : 'PPL Belum Dialokasikan');

    const pmlSobat = pmlOfficer ? pmlOfficer.sobatId : null;
    const pclSobat = pplOfficer ? pplOfficer.sobatId : null;

    // Target calculation:
    // Pemutakhiran: muatan keluarga from listing (actual count)
    // Pendataan: target sample rumah tangga (10 per BS, or actual count if specified)
    const targetCount = regionCounts.get(kode) || (surveyType === 'pemutakhiran' ? 0 : 10);
    const muatan = targetCount;
    const targetFasih = targetCount;

    rows.push({
      kode,
      kode_kec: wInfo.kode_kec,
      kecamatan: wInfo.kecamatan,
      desa: wInfo.desa,
      nama_sls: wInfo.nama_sls,
      korlap: 'Lainnya',
      pml: pmlNama,
      pcl: pclNama,
      muatan,
      target_fasih: targetFasih,
      pcl_email: pplEmail,
      pcl_sobat_id: pclSobat,
      pml_email: pmlEmail,
      pml_sobat_id: pmlSobat
    });
  }

  return rows;
}

const pmuAllocation = buildAllocationRecords(pmuRaw, 'pemutakhiran');
const pdtAllocation = buildAllocationRecords(pdtRaw, 'pendataan');

console.log('\n=== PEMUTAKHIRAN SAMPLE RECORD ===');
console.log(pmuAllocation[0]);
console.log('Total Pemutakhiran Muatan:', pmuAllocation.reduce((a, b) => a + b.muatan, 0));

console.log('\n=== PENDATAAN SAMPLE RECORD ===');
console.log(pdtAllocation[0]);
console.log('Total Pendataan Muatan:', pdtAllocation.reduce((a, b) => a + b.muatan, 0));

module.exports = {
  buildAllocationRecords,
  pmuAllocation,
  pdtAllocation,
  officerLookup
};
