// Load environment variables from .env using absolute path
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Sentry = require("@sentry/node");
const logger = require('./services/logger');

// Debug WA Exec Path
logger.info(`[Startup] PUPPETEER_EXECUTABLE_PATH from env: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);

// Global error handlers to prevent unhandled rejections/exceptions from crashing the server
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at promise:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
  logger.error(`Uncaught Exception: ${err.message}. Origin: ${origin}. Stack: ${err.stack}`);
});

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
const session = require('express-session');
const flash = require('connect-flash');
const { loadMasterFromJson } = require('./services/excelParser');
const { getDb, getLatestUpload, getLatestUploadsDetailed, getSettings, updateSettings, getKippOfficers } = require('./database');

const app = express();
const expressLayouts = require('express-ejs-layouts');
const PORT = process.env.PORT || 3000;

// Disable X-Powered-By header to prevent technology fingerprinting
app.disable('x-powered-by');

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Global Security Headers Middleware
app.use((req, res, next) => {
  // Content Security Policy (CSP)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://browser.sentry-cdn.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://unpkg.com; " +
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com https://*.basemaps.cartocdn.com https://server.arcgisonline.com; " +
    "connect-src 'self' https://openrouter.ai https://browser.sentry-cdn.com https://cdn.jsdelivr.net https://*.sentry.io https://unpkg.com; " +
    "frame-ancestors 'self';"
  );
  
  // Anti-clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  // Strict-Transport-Security (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
});

// Static files with cache control
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.svg') || filePath.endsWith('.woff2')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Global API Status WhatsApp (Bypass Passenger & Admin middleware routing issues in cPanel)
app.get('/whatsapp-status', (req, res) => {
  try {
    const whatsappService = require('./services/whatsappService');
    res.json(whatsappService.getStatus());
  } catch (e) {
    res.status(500).json({ status: 'ERROR', message: e.message });
  }
});

// Session & Flash with persistent SQLite store to prevent logouts on server restarts
const SqliteStore = require('better-sqlite3-session-store')(session);
const sqlite3 = require('better-sqlite3');
const sessionDb = new sqlite3(path.join(__dirname, 'data/sessions.db'));

app.use(session({
  store: new SqliteStore({
    client: sessionDb, 
    expired: {
      clear: true,
      intervalMs: 900000 // Bersihkan expired sessions setiap 15 menit
    }
  }),
  secret: 'se2026-ppu-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Hari
    httpOnly: true,
    secure: false, // Set true jika menggunakan https saja, biarkan false agar flexibel
    sameSite: 'lax' // Cegah pengiriman cookie sesi dalam permintaan lintas situs (CSRF mitigation)
  }
}));
app.use(flash());

// CSRF Protection Middleware
const crypto = require('crypto');
app.use((req, res, next) => {
  if (!req.session) return next();

  // Generate token CSRF jika belum ada di sesi
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Sediakan token CSRF untuk template rendering
  res.locals.csrfToken = req.session.csrfToken;

  // Lewati verifikasi CSRF untuk metode yang aman (safe methods)
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Lewati verifikasi CSRF untuk request multipart (upload file) karena body belum diparse oleh multer
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }

  // Verifikasi token CSRF dari berbagai input sumber
  const reqToken = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || req.query._csrf;
  if (!reqToken || reqToken !== req.session.csrfToken) {
    res.status(403);
    return res.render('error', {
      title: 'Akses Ditolak (CSRF)',
      message: 'Token CSRF tidak valid atau kedaluwarsa. Silakan muat ulang halaman dan coba lagi.',
      activePage: ''
    });
  }

  next();
});


// Auto-login from Remember Me cookie (Instagram Style)
app.use((req, res, next) => {
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(c => {
      const parts = c.split('=');
      const name = parts.shift().trim();
      const val = parts.join('=');
      cookies[name] = decodeURIComponent(val);
    });
  }

  if (!req.session.user && cookies.remember_token && !req.session.loggedOut) {
    try {
      const { getUserByRememberToken } = require('./database');
      const user = getUserByRememberToken(cookies.remember_token);
      if (user) {
        req.session.user = {
          id: user.id,
          username: user.username,
          role: user.role
        };
        req.session.isAdmin = (user.role === 'admin');
      } else {
        res.clearCookie('remember_token');
      }
    } catch (err) {
      console.error("Auto-login error:", err);
    }
  }
  next();
});

// Middleware to log website visits
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const urlPath = req.path;
    // Skip static assets and APIs
    const isStatic = urlPath.includes('.') || urlPath.startsWith('/uploads/');
    const isExcluded = urlPath.startsWith('/whatsapp-status') || urlPath.startsWith('/api/');

    if (!isStatic && !isExcluded) {
      const username = req.session && req.session.user ? req.session.user.username : null;
      const role = req.session && req.session.user ? req.session.user.role : 'guest';
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      try {
        const { logVisit } = require('./database');
        logVisit({ username, role, ip, userAgent, path: urlPath });
      } catch (err) {
        console.error('Failed to log visit in middleware:', err);
      }
    }
  }
  next();
});

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
  try {
    const latest = getLatestUpload();
    res.locals.latestUpload = latest || null;
    res.locals.uploadId = latest ? latest.id : null;
    res.locals.latestUploadsDetailed = getLatestUploadsDetailed();
  } catch (err) {
    logger.error('Error injecting global upload info:', err);
    res.locals.latestUpload = null;
    res.locals.uploadId = null;
    res.locals.latestUploadsDetailed = { fasih: null, muatan: null };
  }
  res.locals.user = req.session.user || null;
  res.locals.isAdmin = req.session.isAdmin || false;

  // Inject display settings globally (with session override)
  try {
    const globalSettings = getSettings() || {};
    if (!req.session.settings) {
      req.session.settings = {};
    }
    res.locals.settings = { ...globalSettings, ...req.session.settings };
  } catch (err) {
    logger.error('Error injecting global settings:', err);
    res.locals.settings = {};
  }

  // Inject KIPP lists globally
  try {
    const kipp = getKippOfficers();
    res.locals.kippPcls = kipp.pcls;
    res.locals.kippPmls = kipp.pmls;
    res.locals.kippKorlaps = kipp.korlaps;
  } catch (err) {
    logger.error('Error injecting global KIPP officers:', err);
    res.locals.kippPcls = [];
    res.locals.kippPmls = [];
    res.locals.kippKorlaps = [];
  }

  // Inject helper functions for formatting dates to WITA (UTC+8)
  const getWitaParts = (dateInput) => {
    if (!dateInput) return null;
    let utcDate;
    if (dateInput instanceof Date) {
      utcDate = dateInput;
    } else {
      let str = String(dateInput).trim();
      if (!str.includes('T') && !str.includes('Z')) {
        str = str.replace(' ', 'T') + 'Z';
      }
      utcDate = new Date(str);
    }
    if (isNaN(utcDate.getTime())) return null;
    const witaDate = new Date(utcDate.getTime() + (8 * 60 * 60 * 1000));
    return {
      dayName: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][witaDate.getUTCDay()],
      day: witaDate.getUTCDate(),
      monthName: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][witaDate.getUTCMonth()],
      month: String(witaDate.getUTCMonth() + 1).padStart(2, '0'),
      year: witaDate.getUTCFullYear(),
      hours: String(witaDate.getUTCHours()).padStart(2, '0'),
      minutes: String(witaDate.getUTCMinutes()).padStart(2, '0'),
      seconds: String(witaDate.getUTCSeconds()).padStart(2, '0')
    };
  };

  res.locals.formatWita = (dateInput) => {
    const parts = getWitaParts(dateInput);
    if (!parts) return String(dateInput);
    return `${parts.dayName}, ${parts.day} ${parts.monthName} ${parts.year}, ${parts.hours}.${parts.minutes} WITA`;
  };

  res.locals.formatWitaShort = (dateInput) => {
    const parts = getWitaParts(dateInput);
    if (!parts) return String(dateInput || '');
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hours}.${parts.minutes}.${parts.seconds}`;
  };

  res.locals.formatIndonesianDate = (dateInput) => {
    if (!dateInput) return '';
    if (typeof dateInput === 'string' && dateInput.includes('-')) {
      const parts = dateInput.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return `${day} ${months[month]} ${year}`;
      }
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  res.locals.formatIndonesianDateShort = (dateInput) => {
    if (!dateInput) return '';
    if (typeof dateInput === 'string' && dateInput.includes('-')) {
      const parts = dateInput.split('-');
      if (parts.length === 3) {
        const day = parseInt(parts[2], 10);
        const month = parseInt(parts[1], 10) - 1;
        const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
        return `${day} ${monthsShort[month]}`;
      }
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${d.getDate()} ${monthsShort[d.getMonth()]}`;
  };

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
  '/export': 'page_export',
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
app.use('/export', require('./routes/export'));
app.use('/pbi', require('./routes/pbi'));
app.use('/kipp', require('./routes/kipp'));
app.get('/earlywarning', (req, res) => res.redirect('/early-warning'));
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
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.status(401).json({ error: 'Sesi kedaluwarsa. Silakan login kembali.', redirectUrl: '/login' });
  }
  req.flash('error', 'Akses ditolak. Silakan login sebagai admin.');
  res.redirect('/admin');
}

// Admin Router
const adminRouter = express.Router();
app.use('/admin', adminRouter);

adminRouter.get('/', (req, res) => {
  if (req.session.isAdmin) {
    return res.render('admin_menu', {
      title: 'Menu Administrasi & Sistem',
      activePage: 'admin-menu'
    });
  }
  res.redirect('/login');
});

adminRouter.get('/logout', (req, res) => {
  res.redirect('/logout');
});

// Protected Admin Routes
adminRouter.use('/upload', requireAdmin, require('./routes/upload'));
adminRouter.use('/master', requireAdmin, require('./routes/master'));
adminRouter.use('/settings', requireAdmin, require('./routes/settings'));
adminRouter.use('/settings/backup', requireAdmin, require('./routes/backup'));
adminRouter.use('/users', requireAdmin, require('./routes/users'));
adminRouter.use('/petugas-email', requireAdmin, require('./routes/petugas_email'));
adminRouter.use('/whatsapp', requireAdmin, require('./routes/whatsapp'));
adminRouter.use('/spreadsheet', requireAdmin, require('./routes/admin_spreadsheet'));
adminRouter.use('/stats', requireAdmin, require('./routes/admin_stats'));

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
  // Minify static CSS & JS assets on startup
  try {
    const { minifyAll } = require('./scripts/minify');
    minifyAll();
  } catch (err) {
    logger.error('❌ Failed to run assets minification on startup:', err);
  }

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

  // Inisialisasi WhatsApp Service saat startup
  try {
    const whatsappService = require('./services/whatsappService');
    whatsappService.initialize();
  } catch (err) {
    logger.error('❌ Gagal menginisialisasi WhatsApp Service pada startup:', err);
  }

  // Inisialisasi Firebase Sync saat startup (jika key tersedia)
  try {
    const { triggerAsyncSync } = require('./services/firebaseSyncService');
    triggerAsyncSync(true); // Full clone all SQLite tables
  } catch (err) {
    logger.error('❌ Gagal menyinkronkan data ke Firebase pada startup:', err.message);
  }

  app.listen(PORT, () => {
    logger.info(`🚀 Dashboard SE2026 PPU berjalan di http://localhost:${PORT}`);
    logger.info(`📅 ${new Date().toLocaleString('id-ID')}`);
  });
}

init();
