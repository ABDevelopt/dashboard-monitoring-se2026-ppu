const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const UglifyJS = require('uglify-js');

function minifyAll() {
  console.log('[Minifier] Starting minification pipeline...');
  const publicDir = path.join(__dirname, '../public');

  const cssFiles = [
    'css/style.css',
    'css/framework.css',
    'css/spreadsheet.css',
    'css/ai-widget.css'
  ];

  const jsFiles = [
    'js/charts.js',
    'js/spreadsheet-editor.js',
    'js/search-helper.js',
    'js/table-filter.js',
    'js/ai-widget.js',
    'js/app.js'
  ];

  // Minify CSS
  cssFiles.forEach(relPath => {
    const srcPath = path.join(publicDir, relPath);
    if (!fs.existsSync(srcPath)) {
      console.warn(`[Minifier] Source file not found: ${srcPath}`);
      return;
    }

    const destPath = srcPath.replace(/\.css$/, '.min.css');
    try {
      const raw = fs.readFileSync(srcPath, 'utf8');
      const minified = new CleanCSS({ level: 1 }).minify(raw);
      if (minified.errors.length) {
        console.error(`[Minifier] Error minifying CSS ${relPath}:`, minified.errors);
      } else {
        const existing = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;
        const newline = (existing && existing.includes('\r\n')) ? '\r\n' : '\n';
        const formattedStyles = minified.styles.replace(/\r?\n/g, newline);

        if (existing !== formattedStyles) {
          fs.writeFileSync(destPath, formattedStyles, 'utf8');
          console.log(`[Minifier] ✔ CSS Minified: ${relPath} -> ${path.basename(destPath)} (${(raw.length/1024).toFixed(1)}KB -> ${(minified.styles.length/1024).toFixed(1)}KB)`);
        }
      }
    } catch (err) {
      console.error(`[Minifier] Exception minifying CSS ${relPath}:`, err);
    }
  });

  // Minify JS
  jsFiles.forEach(relPath => {
    const srcPath = path.join(publicDir, relPath);
    if (!fs.existsSync(srcPath)) {
      console.warn(`[Minifier] Source file not found: ${srcPath}`);
      return;
    }

    const destPath = srcPath.replace(/\.js$/, '.min.js');
    try {
      const raw = fs.readFileSync(srcPath, 'utf8');
      const minified = UglifyJS.minify(raw);
      if (minified.error) {
        console.error(`[Minifier] Error minifying JS ${relPath}:`, minified.error);
      } else {
        const existing = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;
        const newline = (existing && existing.includes('\r\n')) ? '\r\n' : '\n';
        const formattedCode = minified.code.replace(/\r?\n/g, newline);

        if (existing !== formattedCode) {
          fs.writeFileSync(destPath, formattedCode, 'utf8');
          console.log(`[Minifier] ✔ JS Minified: ${relPath} -> ${path.basename(destPath)} (${(raw.length/1024).toFixed(1)}KB -> ${(minified.code.length/1024).toFixed(1)}KB)`);
        }
      }
    } catch (err) {
      console.error(`[Minifier] Exception minifying JS ${relPath}:`, err);
    }
  });
}

module.exports = { minifyAll };

if (require.main === module) {
  minifyAll();
}
