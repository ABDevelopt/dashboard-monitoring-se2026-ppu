const xlsx = require('xlsx');
const workbook = xlsx.readFile('rancangan-muatan-se2026-ppu.xlsx');
const sheet = workbook.Sheets['Sheet1'];
const rows = xlsx.utils.sheet_to_json(sheet);

let sumFasih = 0;
let sumMuatan = 0;
let sumWilkerstat = 0;

for (const row of rows) {
    const f = parseInt(row['TOTAL ASSIGNMENT FASIH'], 10) || 0;
    const m = parseInt(row['Total muatan assignment'], 10) || 0;
    const w = parseInt(row['Muatan wilkerstat'], 10) || 0;
    sumFasih += f;
    sumMuatan += m;
    sumWilkerstat += w;
}

console.log('SUM TOTAL ASSIGNMENT FASIH:', sumFasih);
console.log('SUM Total muatan assignment:', sumMuatan);
console.log('SUM Muatan wilkerstat:', sumWilkerstat);
