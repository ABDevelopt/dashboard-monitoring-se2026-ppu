const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const { loadMasterFromJson } = require('./services/excelParser');
const { getDb, getLatestUpload, getSettings, updateSettings } = require('./database');

const app = express();
const expressLayouts = require('express-ejs-layouts');
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session & Flash
app.use(session({
  secret: 'se2026-ppu-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(flash());

const APP_VERSION = Date.now(); // Startup timestamp for cache busting (updated to force reload)

// Global locals
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.activePage = ''; // default value
  res.locals.appVersion = APP_VERSION;

  // Inject upload info globally
  const latest = getLatestUpload();
  res.locals.latestUpload = latest || null;
  res.locals.uploadId = latest ? latest.id : null;
  res.locals.isAdmin = req.session.isAdmin || false;

  // Inject display settings globally
  res.locals.settings = getSettings() || {};
  next();
});

// Route Guard Middleware based on Page Display settings
const routeSettingsMap = {
  '/map': 'page_map',
  '/early-warning': 'page_earlywarning',
  '/deteksi-anomali': 'page_deteksianomali',
  '/leaderboard': 'page_leaderboard',
  '/performa-terendah': 'page_performatrendah',
  '/kecamatan': 'page_kecamatan',
  '/subsls': 'page_subsls',
  '/subsls/export': 'page_export',
  '/korlap': 'page_korlap',
  '/pml': 'page_pml',
  '/pcl': 'page_pcl',
  '/agent': 'page_aiagent'
};

app.use((req, res, next) => {
  const path = req.path;
  let settingKey = null;

  if (path === '/subsls/export') {
    settingKey = 'page_export';
  } else {
    for (const [routePrefix, key] of Object.entries(routeSettingsMap)) {
      if (routePrefix !== '/subsls/export' && (path === routePrefix || path.startsWith(routePrefix + '/'))) {
        settingKey = key;
        break;
      }
    }
  }

  if (settingKey) {
    const settings = res.locals.settings || {};
    if (settings[settingKey] === '0') {
      res.status(403);
      return res.render('error', {
        title: 'Fitur Dinonaktifkan',
        message: 'Halaman atau fitur ini sedang dinonaktifkan oleh Administrator.',
        activePage: ''
      });
    }
  }
  next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/map', require('./routes/map'));
app.use('/kecamatan', require('./routes/kecamatan'));
app.use('/korlap', require('./routes/korlap'));
app.use('/pml', require('./routes/pml'));
app.use('/pcl', require('./routes/pcl'));
app.use('/subsls', require('./routes/subsls'));
app.use('/early-warning', require('./routes/earlywarning'));
app.use('/leaderboard', require('./routes/leaderboard'));
app.use('/performa-terendah', require('./routes/performa-terendah'));
app.use('/deteksi-anomali', require('./routes/deteksianomali'));
app.use('/api', require('./routes/api'));

// Admin Auth Middleware
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  req.flash('error', 'Akses ditolak. Silakan login sebagai admin.');
  res.redirect('/admin');
}

// Admin Router
const adminRouter = express.Router();
app.use('/admin', adminRouter);

adminRouter.get('/', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin/upload');
  res.render('login', { title: 'Login Admin', activePage: 'admin' });
});

adminRouter.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === 'adminse2026') {
    req.session.isAdmin = true;
    res.redirect('/admin/upload');
  } else {
    req.flash('error', 'Password salah.');
    res.redirect('/admin');
  }
});

adminRouter.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Protected Admin Routes
adminRouter.use('/upload', requireAdmin, require('./routes/upload'));
adminRouter.use('/master', requireAdmin, require('./routes/master'));
adminRouter.use('/settings', requireAdmin, require('./routes/settings'));
adminRouter.use('/agent', requireAdmin, require('./routes/agent'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404 - Halaman Tidak Ditemukan', message: 'Halaman yang Anda cari tidak ada.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server Error', message: err.message });
});

// Init DB & load master data
function init() {
  try {
    const db = getDb(); // initialize schema
    const rowCount = db.prepare('SELECT COUNT(*) as count FROM subsls_master').get().count;
    if (rowCount === 0) {
      const masterPath = path.join(__dirname, 'kelompok_populasi_pml_pcl_korlap_muatan.json');
      const count = loadMasterFromJson(masterPath);
      console.log(`✅ Master SubSLS loaded: ${count} records (from JSON)`);
    } else {
      console.log(`✅ Master SubSLS already populated: ${rowCount} records (from DB)`);
    }
  } catch (err) {
    console.error('❌ Error loading master data:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Dashboard SE2026 PPU berjalan di http://localhost:${PORT}`);
    console.log(`📅 ${new Date().toLocaleString('id-ID')}`);
  });
}

init();
