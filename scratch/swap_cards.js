const fs = require('fs');
const file = 'views/overview.ejs';
let lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

let block1StartIdx = lines.findIndex(l => l.includes('<!-- Progres Realisasi Pencacahan Muatan (Perhatian Utama) -->'));
let block2StartIdx = lines.findIndex(l => l.includes('<!-- Progres Realisasi & Rincian Status Assignment FASIH -->'));
let block2EndIdx = lines.findIndex(l => l.includes('<!-- TREN HARIAN (Full Width) -->'));

if (block1StartIdx === -1 || block2StartIdx === -1 || block2EndIdx === -1) {
    console.error('Could not find boundaries.');
    process.exit(1);
}

// block 2 ends 2 lines before block2EndIdx (because of empty lines and closing div)
// Let's trace it back. The div at line 254 closes the container.
// So block2 is from block2StartIdx to block2EndIdx - 4.
// Let's just find the closing </div> of block2 by looking backwards from block2EndIdx.
let b2End = block2EndIdx - 1;
while(b2End > block2StartIdx && !lines[b2End].includes('</div>')) {
    b2End--;
}
// Actually, it's safer to just move the array elements.
// The blocks are contiguous:
// block1: block1StartIdx to block2StartIdx - 1
// block2: block2StartIdx to b2End (the last </div>)

let block1 = lines.slice(block1StartIdx, block2StartIdx);
let block2 = lines.slice(block2StartIdx, b2End + 1);

// remove the star icon from block1
block1 = block1.map(line => line.replace('<i class="bi bi-star-fill text-cyan" style="font-size: 12px; vertical-align: middle; margin-right: 4px;"></i> ', ''));

// Reconstruct
let newLines = [
    ...lines.slice(0, block1StartIdx),
    ...block2,
    ...block1,
    ...lines.slice(b2End + 1)
];

fs.writeFileSync(file, newLines.join('\n'), 'utf8');
console.log('Swapped successfully!');
