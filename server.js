// Load environment variables from .env
require('dotenv').config();

const Sentry = require("@sentry/node");
const logger = require('./services/logger');

// Initialize Sentry before importing Express for auto-instrumentation
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
  logger.info('Sentry error monitoring initialized.');
} else {
  logger.warn('Sentry DSN not found. Sentry error monitoring is disabled.');
}

const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const { loadMasterFromJson } = require('./services/excelParser');
const { getDb, getLatestUpload, getLatestUploadsDetailed, getSettings, updateSettings, getKippOfficers } = require('./database');

const app = express();
const expressLayouts = require('express-ejs-layouts');
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static files with 1 year cache and immutable headers for optimized caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 31536000000, // 1 year in ms
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css') || filePath.endsWith('.js') || filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.svg') || filePath.endsWith('.woff2')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
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
  res.locals.packageVersion = require('./package.json').version;
  res.locals.sentryDsn = process.env.SENTRY_DSN || '';

  // Inject upload info globally
  const latest = getLatestUpload();
  res.locals.latestUpload = latest || null;
  res.locals.uploadId = latest ? latest.id : null;
  res.locals.latestUploadsDetailed = getLatestUploadsDetailed();
  res.locals.user = req.session.user || null;
  res.locals.isAdmin = req.session.isAdmin || false;

  // Inject display settings globally (with session override)
  const globalSettings = getSettings() || {};
  if (!req.session.settings) {
    req.session.settings = {};
  }
  res.locals.settings = { ...globalSettings, ...req.session.settings };

  // Inject KIPP lists globally
  const kipp = getKippOfficers();
  res.locals.kippPcls = kipp.pcls;
  res.locals.kippPmls = kipp.pmls;
  res.locals.kippKorlaps = kipp.korlaps;

  next();
});

// Route Guard Middleware based on Page Display settings
const routeSettingsMap = {
  '/map': 'page_map',
  '/early-warning': 'page_earlywarning',
  '/deteksi-anomali': 'page_deteksianomali',
  '/leaderboard': 'page_leaderboard',
  '/performa-terendah': 'page_performatrendah',
  '/performa': 'page_performa',
  '/kecamatan': 'page_kecamatan',
  '/subsls': 'page_subsls',
  '/pbi': 'page_subsls',
  '/kipp': 'page_subsls',
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
app.use('/', require('./routes/auth'));
app.use('/map', require('./routes/map'));
app.use('/kecamatan', require('./routes/kecamatan'));
app.use('/korlap', require('./routes/korlap'));
app.use('/pml', require('./routes/pml'));
app.use('/pcl', require('./routes/pcl'));
app.use('/subsls', require('./routes/subsls'));
app.use('/pbi', require('./routes/pbi'));
app.use('/kipp', require('./routes/kipp'));
app.use('/early-warning', require('./routes/earlywarning'));
app.use('/leaderboard', require('./routes/leaderboard'));
app.use('/performa-terendah', require('./routes/performa-terendah'));
app.use('/performa', require('./routes/performa'));
app.use('/harian', require('./routes/harian'));
app.use('/deteksi-anomali', require('./routes/deteksianomali'));
app.use('/agent', require('./routes/agent'));
app.use('/api', require('./routes/api'));
app.use('/api/search-global', require('./routes/search'));

// Help / FAQ page (public, no auth required)
app.get('/help', (req, res) => {
  res.render('help', {
    title: 'Panduan & Bantuan',
    activePage: 'help',
  });
});


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
  res.redirect('/login');
});

adminRouter.get('/logout', (req, res) => {
  res.redirect('/logout');
});

// Protected Admin Routes
adminRouter.use('/upload', requireAdmin, require('./routes/upload'));
adminRouter.use('/master', requireAdmin, require('./routes/master'));
adminRouter.use('/settings', requireAdmin, require('./routes/settings'));
// adminRouter.use('/agent', requireAdmin, require('./routes/agent'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404 - Halaman Tidak Ditemukan', message: 'Halaman yang Anda cari tidak ada.' });
});

// Sentry error handler (must be registered before any other error middleware)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled request error:', err);
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
      logger.info(`✅ Master SubSLS loaded: ${count} records (from JSON)`);
    } else {
      logger.info(`✅ Master SubSLS already populated: ${rowCount} records (from DB)`);
    }

    // Rebuild cache on startup to ensure any code/formula updates are reflected
    const { rebuildAllSummaryCaches } = require('./database');
    setTimeout(() => {
      try {
        logger.info('🔄 Rebuilding summary caches...');
        rebuildAllSummaryCaches();
        logger.info('✅ Summary caches successfully rebuilt');
      } catch (e) {
        logger.error('❌ Failed to rebuild summary caches on startup:', e);
      }
    }, 1000);
  } catch (err) {
    logger.error('❌ Error loading master data:', err);
  }

  app.listen(PORT, () => {
    logger.info(`🚀 Dashboard SE2026 PPU berjalan di http://localhost:${PORT}`);
    logger.info(`📅 ${new Date().toLocaleString('id-ID')}`);
  });
}

init();
