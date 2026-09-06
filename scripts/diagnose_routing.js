const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '..', 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.ejs'));

const internalRoutes = [
  '', 'map', 'agent', 'kecamatan', 'subsls', 'korlap', 'pml', 'pcl',
  'performa', 'harian', 'leaderboard', 'performa-terendah', 'early-warning', 'earlywarning',
  'deteksi-anomali', 'export', 'help', 'admin', 'pbi', 'kipp'
];

const results = [];

files.forEach(file => {
  const content = fs.readFileSync(path.join(viewsDir, file), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const matches = line.matchAll(/(href|action)=["'](\/[^"'#\s?]*)([^"']*)["']/g);
    for (const m of matches) {
      const attr = m[1];
      const basePath = m[2];
      const queryOrHash = m[3] || '';
      const fullUrl = basePath + queryOrHash;
      
      const routeSegment = basePath.replace(/^\//, '').split('/')[0];
      
      if (['css', 'js', 'images', 'icons', 'favicon.ico', 'manifest.json', 'api', 'login', 'logout', 'surveys'].includes(routeSegment)) {
        continue;
      }
      
      if (internalRoutes.includes(routeSegment)) {
        if (!line.includes('navPrefix') && !line.includes('routePrefix')) {
          results.push({ file, line: idx + 1, attr, href: fullUrl, snippet: line.trim() });
        }
      }
    }
  });
});

console.log(`\n=== POTENTIAL HARDCODED ROUTES IN VIEWS (${results.length}) ===`);
results.forEach(r => {
  console.log(`[${r.file}:${r.line}] ${r.attr}="${r.href}" => ${r.snippet.substring(0, 90)}`);
});
