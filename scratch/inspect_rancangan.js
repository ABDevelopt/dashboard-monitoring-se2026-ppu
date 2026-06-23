const xlsx = require('xlsx');
const workbook = xlsx.readFile('rancangan-muatan-se2026-ppu.xlsx');
console.log('Sheets:', workbook.SheetNames);
const sheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('data pencacahan')) || workbook.SheetNames[0];
console.log('Using sheet:', sheetName);
const sheet = workbook.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
if (rows.length > 0) {
    console.log('Headers (row 0):', rows[0]);
    console.log('Headers (row 1):', rows[1]);
    console.log('Headers (row 2):', rows[2]);
}
