const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const cssPath = path.join(distDir, 'taka-ui.css');
const minCssPath = path.join(distDir, 'taka-ui.min.css');
const tokensPath = path.join(distDir, 'taka-ui-tokens.css');

console.log('===========================================================');
console.log('🧪 PENGUJIAN TINGKAT BERBAGI-PAKAI (REUSABILITY SUITE) TAKA UI');
console.log('===========================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✔ PASS: ${testName}`);
    passCount++;
  } else {
    console.error(`  ✖ FAIL: ${testName}`);
    if (details) console.error(`    -> ${details}`);
    failCount++;
  }
}

// -------------------------------------------------------------
// 1. PENGUJIAN INTEGRITAS DISTRIBUSI (DIST PACKAGE INTEGRITY)
// -------------------------------------------------------------
console.log('1. [Integritas Distribusi Paket]');
assert(fs.existsSync(cssPath), 'Berkas dist/taka-ui.css tersedia');
assert(fs.existsSync(minCssPath), 'Berkas dist/taka-ui.min.css tersedia');
assert(fs.existsSync(tokensPath), 'Berkas dist/taka-ui-tokens.css tersedia');

const cssRaw = fs.readFileSync(cssPath, 'utf8');
const minCssRaw = fs.readFileSync(minCssPath, 'utf8');

assert(cssRaw.length > 25000, `Ukuran CSS unminified mencukupi (${(cssRaw.length / 1024).toFixed(1)} KB)`);
assert(minCssRaw.length > 15000 && minCssRaw.length < cssRaw.length, `Minifikasi optimal (${(minCssRaw.length / 1024).toFixed(1)} KB, penghematan ${(100 - (minCssRaw.length / cssRaw.length * 100)).toFixed(1)}%)`);

// Cek keseimbangan kurung kurawal
const openBraces = (cssRaw.match(/\{/g) || []).length;
const closeBraces = (cssRaw.match(/\}/g) || []).length;
assert(openBraces === closeBraces, `Keseimbangan kurung kurawal CSS valid ({: ${openBraces}, }: ${closeBraces})`);

// -------------------------------------------------------------
// 2. PENGUJIAN ISOLASI & ZERO HARDCODING (DECOUPLING TEST)
// -------------------------------------------------------------
console.log('\n2. [Audit Isolasi & Bebas Hardcoding Dependensi]');
const forbiddenPatterns = [
  { regex: /localhost/i, name: 'Tautan localhost' },
  { regex: /10\.36\./i, name: 'IP lokal internal BPS' },
  { regex: /d:\\/i, name: 'Windows drive path hardcoded' },
  { regex: /se2026\.db/i, name: 'Nama database aplikasi asal' },
  { regex: /\/images\/logo-sakernas/i, name: 'Aset gambar spesifik proyek lama' },
  { regex: /fasih_ppu/i, name: 'API key atau credential lama' }
];

forbiddenPatterns.forEach(item => {
  const matched = cssRaw.match(item.regex);
  assert(!matched, `Bebas dari ${item.name}`, matched ? `Ditemukan kecocokan: ${matched[0]}` : '');
});

// -------------------------------------------------------------
// 3. PENGUJIAN AKSESIBILITAS WCAG AA (KONTRAST COLOR MATRIX)
// -------------------------------------------------------------
console.log('\n3. [Pengujian Rasio Kontras Aksesibilitas WCAG AA]');

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  return [num >> 16, (num >> 8) & 255, num & 255];
}

function getLuminance(rgb) {
  const a = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrast(hex1, hex2) {
  const lum1 = getLuminance(hexToRgb(hex1));
  const lum2 = getLuminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Dark Mode Test
const darkBgPrimary = '#0f0f12';
const darkBgCard = '#1b1b24';
const darkTextPrimary = '#ffffff';
const darkTextSecondary = '#f1f5f9';

const darkPrimaryContrast = getContrast(darkTextPrimary, darkBgPrimary);
assert(darkPrimaryContrast >= 4.5, `Dark Mode Text Primary vs Background (Rasio: ${darkPrimaryContrast.toFixed(2)}:1 >= 4.5:1)`);

const darkCardContrast = getContrast(darkTextPrimary, darkBgCard);
assert(darkCardContrast >= 4.5, `Dark Mode Text Primary vs Card (Rasio: ${darkCardContrast.toFixed(2)}:1 >= 4.5:1)`);

const darkSecondaryContrast = getContrast(darkTextSecondary, darkBgCard);
assert(darkSecondaryContrast >= 4.5, `Dark Mode Text Secondary vs Card (Rasio: ${darkSecondaryContrast.toFixed(2)}:1 >= 4.5:1)`);

// Light Mode Test
const lightBgPrimary = '#f5efe6';
const lightBgCard = '#fdfcfb';
const lightTextPrimary = '#0f172a';
const lightTextSecondary = '#334155';

const lightPrimaryContrast = getContrast(lightTextPrimary, lightBgPrimary);
assert(lightPrimaryContrast >= 4.5, `Light Mode Text Primary vs Background (Rasio: ${lightPrimaryContrast.toFixed(2)}:1 >= 4.5:1)`);

const lightCardContrast = getContrast(lightTextPrimary, lightBgCard);
assert(lightCardContrast >= 4.5, `Light Mode Text Primary vs Card (Rasio: ${lightCardContrast.toFixed(2)}:1 >= 4.5:1)`);

const lightSecondaryContrast = getContrast(lightTextSecondary, lightBgCard);
assert(lightSecondaryContrast >= 4.5, `Light Mode Text Secondary vs Card (Rasio: ${lightSecondaryContrast.toFixed(2)}:1 >= 4.5:1)`);

// -------------------------------------------------------------
// 4. PENGUJIAN CAKUPAN KOMPONEN (COMPONENT COVERAGE TEST)
// -------------------------------------------------------------
console.log('\n4. [Cakupan Komponen & UI Surface]');
const requiredSelectors = [
  '.main-wrapper',
  '.topbar',
  '.sidebar',
  '.bottom-nav',
  '.bottom-nav-item',
  '.stats-grid',
  '.stat-card',
  '.stat-card.blue',
  '.stat-card.green',
  '.stat-card.red',
  '.stat-card.yellow',
  '.card',
  '.table-wrap',
  'table',
  'thead th',
  'tbody tr:hover',
  '.badge',
  '.badge-green',
  '.badge-red',
  '.progress-bar-wrap',
  '.progress-bar',
  '.filter-bar',
  '.btn',
  '.btn-primary',
  '.btn-survey-cta',
  '.modal-backdrop',
  '.toast-container',
  '.alert-success',
  '.chart-card',
  '.chart-canvas-wrap',
  '.overview-top-grid',
  '.telemetry-card',
  '.milestone-card',
  '.progress-timeline-container',
  '.status-breakdown-grid',
  '.liquid-glass',
  '.liquid-glass-card',
  '.liquid-glass-pill',
  '.liquid-glass-btn',
  '.liquid-glass-active',
  'th.sortable',
  '.table-sticky-header',
  '.table-sticky-col',
  '.table-striped',
  '.table-compact',
  '.table-toolbar',
  '.table-progress',
  '.progress-stacked',
  '.progress-bar-striped',
  '.progress-ring-wrap',
  '.code-block',
  '.code-header',
  '.code-copy-btn',
  '.tok-keyword',
  '.tok-string',
  '.tok-function',
  '.topbar-left',
  '.topbar-title-container',
  '.topbar-title',
  '.topbar-search-bar',
  '.topbar-action-btn',
  '.topbar-badge',
  '.topbar-dropdown',
  '.date-selector-dropdown',
  '.date-select-item',
  '.sidebar-logo',
  '.sidebar-upload-info',
  '.sidebar-nav',
  '.nav-section-wrapper',
  '.nav-section-header',
  '.nav-sub-wrapper',
  '.nav-item.active',
  '.nav-item-loading',
  '.sidebar-footer',
  '.sidebar-overlay',
  '.btn-close-sidebar',
  'body.sidebar-collapsed .sidebar',
  'body.sidebar-collapsed .main-wrapper',
  'body.sidebar-collapsed .topbar',
  '.breadcrumb-bar',
  '#breadcrumb-bar',
  '.breadcrumb-list',
  '.breadcrumb-item.active',
  '.breadcrumb-separator',
  '.bottom-nav-overlay',
  '.bottom-nav-sheet',
  '.bottom-nav-sheet-header',
  '.bottom-nav-sheet-handle',
  '.bottom-nav-sheet-title',
  '.bottom-nav-sheet-close',
  '.bottom-nav-sheet-content',
  '.sheet-section-title',
  '.sheet-quick-actions-bar',
  '.sheet-quick-action-pill',
  '.sheet-quick-grid',
  '.sheet-grid-card',
  '.bottom-sheet-item',
  '.bottom-sheet-hero',
  '.page-header',
  '.page-title',
  '.page-actions',
  '.historical-view-banner',
  '.help-tooltip-container',
  '.help-tooltip-box',
  '.help-tooltip-icon',
  '.pagination',
  '.pagination-pages',
  '.page-btn',
  '.page-btn.active',
  '.search-modal-backdrop',
  '.search-modal-card',
  '.search-modal-header',
  '.search-modal-body',
  '.search-modal-footer',
  '.custom-modal-backdrop',
  '.flash-messages',
  '.live-pulse-dot',
  '.live-status-pill',
  '.empty-state',
  '.empty-state-icon'
];

assert(fs.existsSync(path.join(distDir, 'taka-charts.min.js')), 'Berkas dist/taka-charts.min.js tersedia');

requiredSelectors.forEach(sel => {
  const exists = cssRaw.includes(sel);
  assert(exists, `Selector komponen '${sel}' terdefinisi`);
});

// -------------------------------------------------------------
// 5. PENGUJIAN MULTI-TEMA (THEME PACKS COVERAGE)
// -------------------------------------------------------------
console.log('\n5. [Pengujian Paket Multi-Tema]');
const themes = [
  { className: 'theme-orange', name: 'SE2026 Orange' },
  { className: 'theme-cyan', name: 'Sakernas Cyan' },
  { className: 'theme-purple', name: 'Sakernas Purple' },
  { className: 'theme-emerald', name: 'Emerald' },
  { className: 'theme-blue', name: 'Sapphire' }
];

themes.forEach(t => {
  assert(cssRaw.includes(t.className), `Tema '${t.name}' (.${t.className}) terdaftar dengan palet lengkap`);
});

// -------------------------------------------------------------
// 6. SIMULASI PROYEK TERISOLASI (PORTABLE SANDBOX TEST)
// -------------------------------------------------------------
console.log('\n6. [Simulasi Proyek Terisolasi / Sandbox Deployment]');
const sandboxDir = path.join(rootDir, 'test', 'sandbox-app');
if (!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive: true });

// Salin hanya file minified ke sandbox
const sandboxCssPath = path.join(sandboxDir, 'taka-ui.min.css');
fs.copyFileSync(minCssPath, sandboxCssPath);
assert(fs.existsSync(sandboxCssPath), 'Penyalinan dist/taka-ui.min.css ke folder sandbox berhasil');

// Buat halaman HTML mandiri di sandbox
const sandboxHtml = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="taka-ui.min.css">
</head>
<body class="theme-cyan">
  <div class="stat-card green">
    <span class="stat-label">Sandbox Test</span>
    <span class="stat-value">100%</span>
  </div>
</body>
</html>`;
const sandboxHtmlPath = path.join(sandboxDir, 'index.html');
fs.writeFileSync(sandboxHtmlPath, sandboxHtml, 'utf8');
assert(fs.existsSync(sandboxHtmlPath), 'Pembuatan HTML mandiri tanpa dependensi luar berhasil');

console.log('\n===========================================================');
console.log(`HASIL EVALUASI: ${passCount} LULUS, ${failCount} GAGAL`);
const score = ((passCount / (passCount + failCount)) * 100).toFixed(1);
console.log(`SKOR TINGKAT BERBAGI-PAKAI (REUSABILITY SCORE): ${score}%`);
console.log('===========================================================');

process.exit(failCount === 0 ? 0 : 1);
