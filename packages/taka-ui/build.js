const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const UglifyJS = require('uglify-js');

const rootDir = __dirname;
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const filesInOrder = [
  'tokens.css',
  'themes.css',
  'base.css',
  'layout.css',
  'grid.css',
  'components/cards.css',
  'components/stat-cards.css',
  'components/buttons.css',
  'components/tables.css',
  'components/badges.css',
  'components/progress.css',
  'components/forms.css',
  'components/alerts.css',
  'components/modals.css',
  'components/tooltips.css',
  'components/pagination.css',
  'components/charts.css',
  'components/overview.css',
  'components/liquid-glass.css',
  'components/code.css',
  'utilities.css'
];

console.log('[Taka UI Build] Bundling source CSS files...');

let fullCss = `/*!
 * Taka UI v1.0.0
 * Modern High-Contrast Dashboard & Monitoring CSS Framework
 * Inspired by Pananyo Taka / BPS SE2026 Monitoring Dashboard
 * MIT License
 */\n\n`;

filesInOrder.forEach(file => {
  const filePath = path.join(srcDir, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    fullCss += `/* --- File: ${file} --- */\n` + content + '\n\n';
  } else {
    console.warn(`[Taka UI Build] Missing file: ${filePath}`);
  }
});

// Write full unminified CSS
const bundlePath = path.join(distDir, 'taka-ui.css');
fs.writeFileSync(bundlePath, fullCss, 'utf8');
console.log(`✔ Generated ${bundlePath} (${(fullCss.length / 1024).toFixed(1)} KB)`);

// Minify with CleanCSS
const minified = new CleanCSS({ level: 1 }).minify(fullCss);
if (minified.errors.length) {
  console.error('[Taka UI Build] Minification errors:', minified.errors);
} else {
  const minBundlePath = path.join(distDir, 'taka-ui.min.css');
  fs.writeFileSync(minBundlePath, minified.styles, 'utf8');
  console.log(`✔ Generated ${minBundlePath} (${(minified.styles.length / 1024).toFixed(1)} KB)`);
}

// Tokens only
const tokensContent = fs.readFileSync(path.join(srcDir, 'tokens.css'), 'utf8') + '\n\n' + fs.readFileSync(path.join(srcDir, 'themes.css'), 'utf8');
fs.writeFileSync(path.join(distDir, 'taka-ui-tokens.css'), tokensContent, 'utf8');
console.log(`✔ Generated dist/taka-ui-tokens.css`);

// Build taka-charts.js
const chartsSrcPath = path.join(srcDir, 'taka-charts.js');
if (fs.existsSync(chartsSrcPath)) {
  const chartsJs = fs.readFileSync(chartsSrcPath, 'utf8');
  const chartsDistPath = path.join(distDir, 'taka-charts.js');
  fs.writeFileSync(chartsDistPath, chartsJs, 'utf8');
  console.log(`✔ Generated dist/taka-charts.js (${(chartsJs.length / 1024).toFixed(1)} KB)`);

  const minifiedJs = UglifyJS.minify(chartsJs);
  if (minifiedJs.error) {
    console.error('[Taka UI Build] Error minifying JS:', minifiedJs.error);
  } else {
    const chartsMinDistPath = path.join(distDir, 'taka-charts.min.js');
    fs.writeFileSync(chartsMinDistPath, minifiedJs.code, 'utf8');
    console.log(`✔ Generated dist/taka-charts.min.js (${(minifiedJs.code.length / 1024).toFixed(1)} KB)`);
  }
}

console.log('[Taka UI Build] All assets built successfully!');
