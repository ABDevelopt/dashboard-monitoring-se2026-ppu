const dns = require('dns');
// Paksa Node.js menggunakan IPv4 terlebih dahulu untuk mencegah ETIMEDOUT pada server hosting (Dewaweb/CloudLinux/cPanel) yang memblokir egress IPv6
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

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
const { getDb, getLatestUpload, getLatestUploadsDetailed, getSettings, getKippOfficers, runWalCheckpointAll } = require('./database');


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
    "img-src 'self' data: blob: https: http:; " +
    "connect-src 'self' https: http:; " +
    "frame-ancestors 'self';"
  );
  
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Prevent browser & proxy caching for dynamic routes (EJS views and API endpoints)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
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

// Inisialisasi WhatsApp Service saat Top-Level Server Boot (Kompatibel dengan cPanel Passenger, PM2, & CLI)
try {
  const whatsappService = require('./services/whatsappService');
  whatsappService.initialize();
  whatsappService.startSupervisor();
  logger.info('🚀 [Startup Top-Level] WhatsApp Service & Watchdog Supervisor 24/7 initialized.');
} catch (err) {
  logger.error('❌ Gagal menginisialisasi WhatsApp Service pada top-level startup:', err);
}

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
    const isAjaxOrJson = req.xhr || 
                         (req.headers.accept && req.headers.accept.includes('json')) || 
                         (contentType.includes('application/json')) ||
                         req.path.includes('/chat');
    if (isAjaxOrJson) {
      return res.status(403).json({ error: 'Token CSRF tidak valid atau kedaluwarsa. Silakan muat ulang halaman.' });
    }
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
  res.locals.navPrefix = '';
  res.locals.routePrefix = '';
  res.locals.activeSurvey = 'se2026';
  res.locals.surveyConfig = require('./config/surveys.json')['se2026'];
  res.locals.customStyles = '';
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.activePage = ''; // default value
  res.locals.surveyLogoSrc = '/logo-mark.png';
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

// Multi-Survey Template Context Resolver Middleware
app.use((req, res, next) => {
  try {
    const surveysConfig = require("./config/surveys.json");
    const queryIdx = req.url.indexOf('?');
    const rawPath = queryIdx !== -1 ? req.url.substring(0, queryIdx) : req.url;
    const rawSearch = queryIdx !== -1 ? req.url.substring(queryIdx) : '';
    const parts = rawPath.split("/");
    const firstPart = parts[1];
    
    let matchedSurvey = null;
    if (surveysConfig[firstPart]) {
      matchedSurvey = surveysConfig[firstPart];
      res.locals.activeSurvey = firstPart;
      res.locals.surveyConfig = matchedSurvey;
      res.locals.routePrefix = "/" + firstPart;
      res.locals.navPrefix = "/" + firstPart;
      const strippedPath = "/" + parts.slice(2).join("/");
      req.url = strippedPath + rawSearch;
    } else {
      matchedSurvey = surveysConfig["se2026"];
      res.locals.activeSurvey = "se2026";
      res.locals.surveyConfig = matchedSurvey;
      res.locals.routePrefix = "";
      res.locals.navPrefix = "";
    }
    const isSe2026 = matchedSurvey.id === 'se2026';
    res.locals.customStyles = `
      :root {
        --accent-primary: ${matchedSurvey.themeColor};
        --accent-rgb: ${matchedSurvey.themeRgb};
        --accent-orange: ${matchedSurvey.themeColor};
        --accent-blue: ${matchedSurvey.themeColor};
        --accent-cyan: ${matchedSurvey.themeSecondary || matchedSurvey.themeColor};
        --survey-primary: ${matchedSurvey.themeColor};
        --survey-secondary: ${matchedSurvey.themeSecondary || matchedSurvey.themeColor};
        --survey-rgb: ${matchedSurvey.themeRgb};
        --survey-gradient: ${matchedSurvey.themeGradient || `linear-gradient(135deg, ${matchedSurvey.themeColor} 0%, ${matchedSurvey.themeSecondary || matchedSurvey.themeColor} 100%)`};
        --survey-glow: ${matchedSurvey.themeGlow || `0 16px 36px -8px rgba(${matchedSurvey.themeRgb}, 0.35)`};
      }
      ${!isSe2026 ? `
      /* Theme Isolation: Strip all orange buttons, badges, highlights & accents on non-SE2026 surveys */
      .btn-primary, .btn-submit, .btn-action-primary,
      .login-submit-btn, .btn-theme-orange, .btn-theme-cyan, .btn-theme-purple {
        background: var(--survey-gradient) !important;
        border-color: var(--accent-primary) !important;
        color: #ffffff !important;
        box-shadow: var(--survey-glow) !important;
      }
      .btn-primary:hover, .btn-submit:hover, .btn-action-primary:hover,
      .login-submit-btn:hover {
        filter: brightness(1.12) !important;
        transform: translateY(-1px) !important;
      }
      .nav-item.active, .sidebar-nav .nav-link.active, .bottom-nav-item.active {
        color: var(--accent-primary) !important;
        background: rgba(var(--accent-rgb), 0.1) !important;
        border-left-color: var(--accent-primary) !important;
      }
      .nav-item.active i, .sidebar-nav .nav-link.active i, .bottom-nav-item.active i,
      .topbar-action-btn:hover i, .text-orange, .status-open-text, .warning-stat.text-orange {
        color: var(--accent-primary) !important;
      }
      .badge-orange, .badge-primary {
        background: rgba(var(--accent-rgb), 0.14) !important;
        color: var(--accent-primary) !important;
        border: 1px solid rgba(var(--accent-rgb), 0.3) !important;
      }
      .topbar-badge, #notificationBellBadge {
        background: var(--accent-primary) !important;
        color: #ffffff !important;
      }
      .stat-card.orange::before, .stat-card.blue::before,
      .progress-bar.orange, .progress-bar {
        background: var(--survey-gradient) !important;
      }
      .status-open-bg, .bg-orange-soft {
        background-color: rgba(var(--accent-rgb), 0.07) !important;
        border-color: rgba(var(--accent-rgb), 0.2) !important;
      }
      .border-hover-orange:hover, .border-hover-orange-light:hover {
        border-color: var(--accent-primary) !important;
      }
      .bg-gradient-orange-dark, .bg-gradient-orange-red {
        background: var(--survey-gradient) !important;
      }
      /* Hide SE2026 specific decorative ornaments and logos */
      .se2026-only, .se2026-ornament, .se2026-logo {
        display: none !important;
      }
      ` : ''}
    `;
    
    // Override/update active upload info and settings for this request
    const { getLatestUpload, getLatestUploadsDetailed, getSettings } = require('./database');
    const latest = getLatestUpload(res.locals.activeSurvey);
    res.locals.latestUpload = latest || null;
    res.locals.uploadId = latest ? latest.id : null;
    res.locals.latestUploadsDetailed = getLatestUploadsDetailed(res.locals.activeSurvey);
    res.locals.settings = getSettings(res.locals.activeSurvey);
    
    let logoSrc = '/images/logo-pananyo-taka-flow.svg';
    if (res.locals.activeSurvey === 'sakernas-pemutakhiran') {
      logoSrc = '/images/logo-sakernas-pemutakhiran.svg';
    } else if (res.locals.activeSurvey === 'sakernas-pendataan') {
      logoSrc = '/images/logo-sakernas-pendataan.svg';
    } else if (res.locals.activeSurvey && res.locals.activeSurvey.startsWith('sakernas')) {
      logoSrc = '/images/logo-sakernas-mark.svg';
    } else if (res.locals.activeSurvey === 'se2026') {
      logoSrc = '/logo-mark.png';
    }
    res.locals.surveyLogoSrc = logoSrc;
    
    // Override res.redirect to automatically prepend navPrefix for internal redirect URLs
    const originalRedirect = res.redirect;
    res.redirect = function(url) {
      if (typeof url === 'string' && res.locals.navPrefix) {
        if (url.startsWith('/') && 
            !url.startsWith('//') && 
            !url.startsWith(res.locals.navPrefix) && 
            !url.startsWith('/surveys') && 
            !url.startsWith('/login') && 
            !url.startsWith('/logout') && 
            !url.startsWith('/api') &&
            !url.startsWith('/health')) {
          return originalRedirect.call(this, res.locals.navPrefix + (url === '/' ? '' : url));
        }
      }
      return originalRedirect.call(this, url);
    };

    const { surveyContext } = require('./services/contextService');
    return surveyContext.run({ activeSurvey: res.locals.activeSurvey }, () => {
      next();
    });
  } catch (err) {
    logger.error("Error resolving multi-survey context:", err);
    next();
  }
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
app.use('/surveys', require('./routes/surveys'));
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
    const db = getDb('se2026'); // initialize schema for se2026
    const rowCount = db.prepare('SELECT COUNT(*) as count FROM subsls_master').get().count;
    if (rowCount === 0) {
      let masterPath = path.join(__dirname, 'data', 'kelompok_populasi_pml_pcl_korlap_muatan.json');
      if (!fs.existsSync(masterPath)) {
        masterPath = path.join(__dirname, 'kelompok_populasi_pml_pcl_korlap_muatan.json');
      }
      if (fs.existsSync(masterPath)) {
        const count = loadMasterFromJson(masterPath, 'se2026');
        logger.info(`✅ Master SubSLS SE2026 loaded: ${count} records (from JSON)`);
      }
    } else {
      logger.info(`✅ Master SubSLS SE2026 already populated: ${rowCount} records (from DB)`);
    }

    // Rebuild cache on startup to ensure any code/formula updates are reflected
    const { rebuildAllSummaryCaches } = require('./database');
    setTimeout(() => {
      try {
        const { cleanupAllImputations } = require('./services/imputerService');
        cleanupAllImputations();

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


  // Inisialisasi Firebase Sync saat startup (jika key tersedia)
  try {
    const { triggerAsyncSync } = require('./services/firebaseSyncService');
    triggerAsyncSync(true); // Full clone all SQLite tables
  } catch (err) {
    logger.error('❌ Gagal menyinkronkan data ke Firebase pada startup:', err.message);
  }

  // Jadwalkan WAL checkpoint otomatis setiap 6 jam.
  // Setiap survei diperiksa secara independen — tidak ada ketergantungan cross-DB.
  // PASSIVE checkpoint: tidak memblokir pembaca/penulis yang sedang aktif.
  const WAL_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
  setInterval(() => {
    try {
      runWalCheckpointAll();
    } catch (e) {
      logger.error('❌ Scheduled WAL checkpoint error:', e.message);
    }
  }, WAL_CHECKPOINT_INTERVAL_MS);
  logger.info(`⏰ WAL checkpoint terjadwal setiap 6 jam (interval: ${WAL_CHECKPOINT_INTERVAL_MS}ms)`);


  const os = require('os');
  const getLocalIp = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'localhost';
  };

  const localIp = getLocalIp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Dashboard SE2026 PPU berjalan di:`);
    logger.info(`   - Local:   http://localhost:${PORT}`);
    logger.info(`   - Network: http://${localIp}:${PORT} (Akses via HP di Wi-Fi yang sama)`);
    logger.info(`📅 ${new Date().toLocaleString('id-ID')}`);
  });

  // Konfigurasi timeout untuk mencegah pemutusan koneksi oleh reverse proxy hosting (Dewaweb/LiteSpeed/Nginx)
  server.setTimeout(180000); // 3 menit timeout
  server.keepAliveTimeout = 65000; // 65 detik (lebih tinggi dari keepalive proxy 60s)
  server.headersTimeout = 66000;
}

init();
