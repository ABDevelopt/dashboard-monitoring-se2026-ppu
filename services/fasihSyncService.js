const path = require('path');
const fs = require('fs');
const { getDb, getSharedDb, getSettings, rebuildSummaryCache, rebuildAllSummaryCaches, importTitikUjiPetik, reloadDbConnection, getSurveyProgressSnapshotsMap, upsertSurveyProgressSnapshot, refreshSurveyProgressSnapshot, saveOfficerProgressTelemetry, getLatestUpload } = require('../database');
const logger = require('./logger');

const DEFAULT_API_URL = process.env.FASIH_API_BASE_URL || 'http://43.163.98.53/api/sync/monitoring-data';
const DEFAULT_API_KEY = process.env.FASIH_API_KEY || 'fasih_ppu_sync_secret_token_2026';

class FasihSyncService {
  /**
   * Helper: Format and harmonize officer names from email/username strings
   */
  _formatOfficerName(rawName, fallbackName = null) {
    if (!rawName || typeof rawName !== 'string') {
      return fallbackName || 'Petugas Lapangan';
    }
    const trimmed = rawName.trim();
    if (!trimmed) {
      return fallbackName || 'Petugas Lapangan';
    }

    let baseStr = trimmed;
    if (trimmed.includes('@')) {
      baseStr = trimmed.split('@')[0];
    }

    // Ganti digit angka, titik, underscore, dash dengan spasi
    const cleanWords = baseStr.replace(/[0-9._-]+/g, ' ').trim();
    if (!cleanWords) return fallbackName || 'Petugas Lapangan';

    const formatted = cleanWords
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

    // Cek kecocokan di tabel ref_petugas jika ada
    try {
      const sharedDb = getSharedDb();
      const oCompact = formatted.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (oCompact.length >= 4) {
        const found = sharedDb.prepare(`
          SELECT nama_lengkap FROM ref_petugas 
          WHERE LOWER(REPLACE(nama_lengkap, ' ', '')) = ? 
             OR (LENGTH(?) >= 6 AND LOWER(REPLACE(nama_lengkap, ' ', '')) LIKE ?)
          LIMIT 1
        `).get(oCompact, oCompact, `%${oCompact}%`);
        if (found && found.nama_lengkap) {
          return found.nama_lengkap;
        }
      }
    } catch (_) {}

    return formatted;
  }

  /**
   * Helper: In-memory geographic master lookup (cached across sync iterations)
   */
  _getMasterLookup() {
    if (this._masterLookup) return this._masterLookup;

    const lookup = {
      byCode: new Map(),
      desas: new Map(),
      kecamatans: new Map()
    };

    try {
      const seDb = getDb('se2026');
      const rows = seDb.prepare('SELECT kode, kode_kec, kecamatan, desa, nama_sls, pcl, pml, korlap FROM subsls_master').all();
      for (const r of rows) {
        lookup.byCode.set(r.kode, r);
      }
    } catch (_) {}

    try {
      const sharedDb = getSharedDb();
      const desas = sharedDb.prepare('SELECT kode_desa, kode_kec, nama_desa FROM ref_desa').all();
      for (const d of desas) {
        lookup.desas.set(d.kode_desa, d);
      }
      const kecs = sharedDb.prepare('SELECT kode_kec, nama_kecamatan FROM ref_kecamatan').all();
      for (const k of kecs) {
        lookup.kecamatans.set(k.kode_kec, k.nama_kecamatan);
      }
    } catch (_) {}

    this._masterLookup = lookup;
    return lookup;
  }

  /**
   * Resolve URL & API Key from environment or SQLite settings
   */
  getConfig() {
    let settings = {};
    try {
      settings = getSettings('se2026') || {};
    } catch (_) {}

    const apiUrl = settings.fasih_api_url || process.env.FASIH_API_BASE_URL || DEFAULT_API_URL;
    const apiKey = settings.fasih_api_key || process.env.FASIH_API_KEY || DEFAULT_API_KEY;

    return { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() };
  }

  /**
   * Quick connection & health check to FASIH-SM API
   */
  async checkConnection(customUrl = null, customKey = null) {
    const config = this.getConfig();
    const targetUrl = (customUrl || config.apiUrl).replace(/\/+$/, '');
    const targetKey = customKey || config.apiKey;

    const pingUrl = targetUrl.includes('?') 
      ? `${targetUrl}&ping=true` 
      : `${targetUrl}?ping=true`;

    const start = Date.now();
    try {
      const res = await fetch(pingUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-FASIH-API-KEY': targetKey
        },
        signal: AbortSignal.timeout(10000)
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errJson = await res.json();
          if (errJson.error) errMsg = errJson.error;
        } catch (_) {}
        return { ok: false, status: 'error', statusCode: res.status, error: errMsg, latencyMs };
      }

      const data = await res.json();
      return {
        ok: true,
        status: data.status || 'online',
        serverTime: data.serverTime,
        latencyMs,
        service: data.service || 'FASIH-SM Cloud'
      };
    } catch (err) {
      return {
        ok: false,
        status: 'unreachable',
        error: `Gagal terhubung ke FASIH API: ${err.message}`,
        latencyMs: Date.now() - start
      };
    }
  }

  /**
   * Resolve Spatial API URL & Key
   */
  getSpatialConfig(customUrl = null, customKey = null) {
    const config = this.getConfig();
    let base = (customUrl || config.apiUrl).trim();
    if (base.includes('/api/sync/monitoring-data')) {
      base = base.replace('/api/sync/monitoring-data', '/api/sync/spatial-points');
    } else if (!base.includes('/api/sync/spatial-points')) {
      base = base.replace(/\/+$/, '') + '/api/sync/spatial-points';
    }
    const apiKey = customKey || config.apiKey;
    return { apiUrl: base, apiKey };
  }

  /**
   * Quick connection & health check for Spatial Points API
   */
  async checkSpatialConnection(customUrl = null, customKey = null) {
    const { apiUrl, apiKey } = this.getSpatialConfig(customUrl, customKey);
    const pingUrl = apiUrl.includes('?') ? `${apiUrl}&ping=true` : `${apiUrl}?ping=true`;
    const start = Date.now();
    try {
      const res = await fetch(pingUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-FASIH-API-KEY': apiKey
        },
        signal: AbortSignal.timeout(10000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errJson = await res.json();
          if (errJson.error) errMsg = errJson.error;
        } catch (_) {}
        return { ok: false, status: 'error', statusCode: res.status, error: errMsg, latencyMs };
      }

      const data = await res.json();
      return {
        ok: true,
        status: data.status || 'online',
        serverTime: data.serverTime,
        survey: data.survey,
        region: data.region,
        totalPoints: data.totalPoints || 0,
        totalIsi: data.totalIsi || 0,
        totalKosong: data.totalKosong || 0,
        lastModified: data.lastModified,
        latencyMs,
        service: data.service || 'FASIH-SM Cloud Spatial API'
      };
    } catch (err) {
      return {
        ok: false,
        status: 'unreachable',
        error: `Gagal terhubung ke FASIH Spatial API: ${err.message}`,
        latencyMs: Date.now() - start
      };
    }
  }

  /**
   * Resolve Surveys Catalog API URL & Key
   */
  getSurveysCatalogConfig(customUrl = null, customKey = null) {
    const config = this.getConfig();
    let base = (customUrl || config.apiUrl).trim();
    if (base.includes('/api/sync/monitoring-data')) {
      base = base.replace('/api/sync/monitoring-data', '/api/sync/surveys');
    } else if (base.includes('/api/sync/spatial-points')) {
      base = base.replace('/api/sync/spatial-points', '/api/sync/surveys');
    } else if (!base.includes('/api/sync/surveys')) {
      base = base.replace(/\/+$/, '') + '/api/sync/surveys';
    }
    const apiKey = customKey || config.apiKey;
    return { apiUrl: base, apiKey };
  }

  /**
   * Quick connection & health check for Surveys Catalog API
   */
  async checkSurveysCatalogConnection(customUrl = null, customKey = null) {
    const { apiUrl, apiKey } = this.getSurveysCatalogConfig(customUrl, customKey);
    const pingUrl = apiUrl.includes('?') ? `${apiUrl}&ping=true` : `${apiUrl}?ping=true`;
    const start = Date.now();
    try {
      const res = await fetch(pingUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-FASIH-API-KEY': apiKey
        },
        signal: AbortSignal.timeout(10000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errJson = await res.json();
          if (errJson.error) errMsg = errJson.error;
        } catch (_) {}
        return { ok: false, status: 'error', statusCode: res.status, error: errMsg, latencyMs };
      }

      const data = await res.json();
      return {
        ok: true,
        status: data.status || 'online',
        serverTime: data.serverTime,
        totalSurveys: data.totalSurveys || 0,
        latencyMs,
        service: data.service || 'FASIH-SM Cloud Surveys Catalog API'
      };
    } catch (err) {
      return {
        ok: false,
        status: 'unreachable',
        error: `Gagal terhubung ke FASIH Surveys API: ${err.message}`,
        latencyMs: Date.now() - start
      };
    }
  }

  /**
   * Fetch full list of surveys from Cloud API
   */
  async fetchSurveysCatalog(options = {}) {
    const { customUrl = null, customKey = null, forceRefresh = false, type = null, search = null } = options;
    const { apiUrl, apiKey } = this.getSurveysCatalogConfig(customUrl, customKey);

    const urlObj = new URL(apiUrl);
    if (forceRefresh) urlObj.searchParams.set('refresh', 'true');
    if (type) urlObj.searchParams.set('type', type);
    if (search) urlObj.searchParams.set('search', search);

    logger.info(`[FASIH-CATALOG] Mengambil katalog kegiatan survei dari: ${urlObj.toString()}...`);
    const start = Date.now();

    const res = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-FASIH-API-KEY': apiKey
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
      } catch (_) {}
      throw new Error(`Gagal mengambil katalog survei: ${errMsg}`);
    }

    const data = await res.json();
    logger.info(`[FASIH-CATALOG] Berhasil memuat ${data.total || 0} kegiatan survei (${Date.now() - start}ms)`);
    return data;
  }

  /**
   * Automatically generate dashboard configurations for all surveys from Cloud API
   */
  async autoGenerateSurveyDashboards(options = {}) {
    const catalogData = await this.fetchSurveysCatalog(options);
    const cloudSurveys = catalogData.surveys || [];

    const configPath = path.join(__dirname, '..', 'config', 'surveys.json');
    let currentConfig = {};
    try {
      if (fs.existsSync(configPath)) {
        currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (err) {
      logger.error(`[FASIH-CATALOG] Gagal membaca config/surveys.json: ${err.message}`);
      currentConfig = {};
    }

    if (options.cleanRegenerate) {
      const preserved = {};
      for (const k of ['se2026', 'sakernas-pemutakhiran', 'sakernas-pendataan']) {
        if (currentConfig[k]) preserved[k] = currentConfig[k];
      }
      currentConfig = preserved;
    }

    const THEME_PALETTES = [
      {
        theme: 'blue',
        themePack: 'Sapphire Enterprise & Cobalt Flow',
        themeColor: '#2563eb',
        themeSecondary: '#38bdf8',
        themeRgb: '37, 99, 235',
        themeGradient: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #38bdf8 100%)',
        themeGlow: '0 16px 36px -8px rgba(37, 99, 235, 0.35)',
        themeIcon: 'bi-bar-chart-line-fill'
      },
      {
        theme: 'emerald',
        themePack: 'Emerald Growth & Gold Prosperity',
        themeColor: '#10b981',
        themeSecondary: '#f59e0b',
        themeRgb: '16, 185, 129',
        themeGradient: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #f59e0b 100%)',
        themeGlow: '0 16px 36px -8px rgba(16, 185, 129, 0.35)',
        themeIcon: 'bi-clipboard-check-fill'
      },
      {
        theme: 'purple',
        themePack: 'Royal Purple & Amethyst Vision',
        themeColor: '#8b5cf6',
        themeSecondary: '#ec4899',
        themeRgb: '139, 92, 246',
        themeGradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #ec4899 100%)',
        themeGlow: '0 16px 36px -8px rgba(139, 92, 246, 0.35)',
        themeIcon: 'bi-diagram-3-fill'
      },
      {
        theme: 'cyan',
        themePack: 'Cyan Aqua & Maritime Breeze',
        themeColor: '#06b6d4',
        themeSecondary: '#3b82f6',
        themeRgb: '6, 182, 212',
        themeGradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #3b82f6 100%)',
        themeGlow: '0 16px 36px -8px rgba(6, 182, 212, 0.35)',
        themeIcon: 'bi-water'
      },
      {
        theme: 'amber',
        themePack: 'Amber Energy & Solar Spark',
        themeColor: '#f59e0b',
        themeSecondary: '#ef4444',
        themeRgb: '245, 158, 11',
        themeGradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #ef4444 100%)',
        themeGlow: '0 16px 36px -8px rgba(245, 158, 11, 0.35)',
        themeIcon: 'bi-lightning-charge-fill'
      },
      {
        theme: 'rose',
        themePack: 'Crimson Rose & Ruby Passion',
        themeColor: '#f43f5e',
        themeSecondary: '#fb7185',
        themeRgb: '244, 63, 94',
        themeGradient: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 50%, #fb7185 100%)',
        themeGlow: '0 16px 36px -8px rgba(244, 63, 94, 0.35)',
        themeIcon: 'bi-activity'
      },
      {
        theme: 'indigo',
        themePack: 'Indigo Cyber & Deep Logic',
        themeColor: '#6366f1',
        themeSecondary: '#a855f7',
        themeRgb: '99, 102, 241',
        themeGradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #a855f7 100%)',
        themeGlow: '0 16px 36px -8px rgba(99, 102, 241, 0.35)',
        themeIcon: 'bi-cpu-fill'
      },
      {
        theme: 'teal',
        themePack: 'Teal Forest & Botanical Vitality',
        themeColor: '#14b8a6',
        themeSecondary: '#06b6d4',
        themeRgb: '20, 184, 166',
        themeGradient: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 50%, #06b6d4 100%)',
        themeGlow: '0 16px 36px -8px rgba(20, 184, 166, 0.35)',
        themeIcon: 'bi-pie-chart-fill'
      }
    ];

    let addedCount = 0;
    let existingCount = 0;

    // Map existing surveys by fasihSurveyId if present
    const fasihIdMap = {};
    for (const [k, v] of Object.entries(currentConfig)) {
      if (v.fasihSurveyId) {
        fasihIdMap[v.fasihSurveyId] = k;
      }
    }

    // Explicit mappings for primary surveys
    fasihIdMap['a0429e96-51a5-477b-a415-485f9c153004'] = 'se2026'; // SENSUS EKONOMI 2026
    fasihIdMap['8b6f7c3e-ad48-45c5-83ad-4aa2c826b65d'] = 'sakernas-pemutakhiran'; // SAKERNAS AGUSTUS 2026 - PEMUTAKHIRAN
    fasihIdMap['3f1e8a1a-7ac0-49be-85d6-757133c63c38'] = 'sakernas-pendataan'; // SAKERNAS AGS 2026 - PENDATAAN

    cloudSurveys.forEach((s, idx) => {
      // Check if already mapped
      let mappedKey = fasihIdMap[s.id];
      if (!mappedKey) {
        // Check by name similarity
        const nameLower = (s.name || '').toLowerCase();
        if (nameLower === 'sensus ekonomi 2026') mappedKey = 'se2026';
        else if (nameLower.includes('sakernas agustus 2026') && nameLower.includes('pemutakhiran')) mappedKey = 'sakernas-pemutakhiran';
        else if (nameLower.includes('sakernas ags 2026') && nameLower.includes('pendataan')) mappedKey = 'sakernas-pendataan';
      }

      if (mappedKey && currentConfig[mappedKey]) {
        // Preserve existing config, just record fasihSurveyId if missing
        if (!currentConfig[mappedKey].fasihSurveyId) {
          currentConfig[mappedKey].fasihSurveyId = s.id;
        }
        existingCount++;
        return;
      }

      // Generate an informative, URL-safe clean slug
      let cleanSlug = (s.name || '')
        .replace(/\[/g, ' ')
        .replace(/\]/g, ' ')
        .replace(/[-–—_()]/g, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');

      if (!cleanSlug || cleanSlug.length < 3) {
        cleanSlug = (s.name || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      }
      if (cleanSlug.length > 48) {
        cleanSlug = cleanSlug.substring(0, 48).replace(/-$/, '');
      }

      const reservedSlugs = ['admin', 'api', 'map', 'map-ujipetik', 'ujipetik', 'login', 'logout', 'help', 'export', 'surveys', 'se2026'];
      let finalSlug = cleanSlug;
      let counter = 2;
      while (currentConfig[finalSlug] || reservedSlugs.includes(finalSlug)) {
        finalSlug = `${cleanSlug}-${counter++}`;
      }

      // Semantic metadata classifier
      const nameLower = (s.name || '').toLowerCase();
      const typeLower = (s.surveyType || '').toLowerCase();

      let category = 'survei';
      let categoryLabel = 'Survei';
      let categoryBadge = 'Survei';
      let categoryIcon = 'bi-pie-chart-fill';
      let unitName = 'dokumen';
      let showUsahaColumns = false;
      let officerRole = 'PCL';
      let officerFullRole = 'Petugas Cacah Lapangan';
      let hasKorlap = false;

      if (typeLower === 'pelatihan' || nameLower.includes('pelatihan') || nameLower.includes('[petugas]') || nameLower.includes('mooc')) {
        category = 'pelatihan';
        categoryLabel = 'Pelatihan Petugas';
        categoryBadge = 'Pelatihan';
        categoryIcon = 'bi-mortarboard-fill';
        unitName = 'Peserta';
        officerRole = 'Petugas';
        officerFullRole = 'Peserta Pelatihan';
      } else if (typeLower === 'ujicoba' || nameLower.includes('ujicoba') || nameLower.includes('uji coba')) {
        category = 'ujicoba';
        categoryLabel = 'Uji Coba Sistem';
        categoryBadge = 'Ujicoba';
        categoryIcon = 'bi-cpu-fill';
        unitName = 'Sampel';
      } else if (nameLower.includes('sensus') || nameLower.includes('se2026')) {
        category = 'sensus';
        categoryLabel = 'Sensus (100%)';
        categoryBadge = 'Sensus';
        categoryIcon = 'bi-globe2';
        unitName = 'Unit Usaha';
        showUsahaColumns = true;
        hasKorlap = true;
      } else if (nameLower.includes('usaha') || nameLower.includes('perusahaan') || nameLower.includes('pertambangan') || nameLower.includes('industri') || nameLower.includes('skgb') || nameLower.includes('dutl') || nameLower.includes('dpp') || nameLower.includes('imk')) {
        unitName = 'Perusahaan/Usaha';
        showUsahaColumns = true;
      } else if (nameLower.includes('desa') || nameLower.includes('podes')) {
        unitName = 'Desa/Kelurahan';
        categoryIcon = 'bi-geo-alt-fill';
      } else if (nameLower.includes('sakernas') || nameLower.includes('keluarga') || nameLower.includes('rt') || nameLower.includes('horti') || nameLower.includes('sub-p')) {
        unitName = 'Rumah Tangga';
        officerRole = 'PPL';
        officerFullRole = 'Petugas Pendataan Lapangan';
      }

      // Pick theme
      const themeObj = THEME_PALETTES[idx % THEME_PALETTES.length];

      // Clean shortName
      let shortName = s.name.replace(/\[.*?\]/g, '').trim();
      if (shortName.length > 25) {
        shortName = shortName.substring(0, 25).trim() + '...';
      }

      currentConfig[finalSlug] = {
        id: finalSlug,
        fasihSurveyId: s.id,
        name: s.name,
        shortName: shortName || finalSlug,
        category,
        categoryLabel,
        categoryBadge,
        categoryIcon,
        coverageDesc: `Kegiatan ${s.surveyType || 'survei'} resmi BPS`,
        tagline: s.description && s.description !== s.name ? s.description : `Pemantauan kegiatan ${s.name} di Kabupaten PPU`,
        themePack: themeObj.themePack,
        theme: themeObj.theme,
        themeColor: themeObj.themeColor,
        themeSecondary: themeObj.themeSecondary,
        themeRgb: themeObj.themeRgb,
        themeGradient: themeObj.themeGradient,
        themeGlow: themeObj.themeGlow,
        themeIcon: themeObj.themeIcon,
        unitName,
        showUsahaColumns,
        showMuatanUsaha: showUsahaColumns,
        officerRole,
        officerFullRole,
        hasKorlap,
        enabledPages: ["map", "agent", "pml", "pcl", "performa", "earlywarning", "harian", "leaderboard", "kecamatan", "subsls", "export"]
      };

      fasihIdMap[s.id] = finalSlug;
      addedCount++;
    });

    // Save back to config/surveys.json
    try {
      fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf8');
      logger.info(`[FASIH-CATALOG] config/surveys.json berhasil diperbarui! Total: ${Object.keys(currentConfig).length} survei (Ditambahkan: ${addedCount})`);
    } catch (err) {
      logger.error(`[FASIH-CATALOG] Gagal menulis file config/surveys.json: ${err.message}`);
      throw err;
    }

    // Invalidate require & surveyRegistry cache
    try {
      const { invalidateCache } = require('./surveyRegistry');
      invalidateCache();
    } catch (_) {}

    return {
      success: true,
      totalInCloud: cloudSurveys.length,
      totalRegistered: Object.keys(currentConfig).length,
      added: addedCount,
      existing: existingCount,
      surveys: Object.keys(currentConfig)
    };
  }

  /**
   * Pull and synchronize monitoring data from FASIH-SM API into SQLite
   */
  async syncFromFasih(options = {}) {
    const {
      surveyId = 'se2026',
      date = null,
      region = '6409',
      forceRefresh = false,
      triggerWa = false,
      skipIfUnchanged = false,
      customUrl = null,
      customKey = null
    } = options;

    const config = this.getConfig();
    const baseUrl = (customUrl || config.apiUrl).replace(/\/+$/, '');
    const apiKey = customKey || config.apiKey;

    // Construct request query
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('survey', surveyId);
    urlObj.searchParams.set('region', region);
    if (date) urlObj.searchParams.set('date', date);
    if (forceRefresh) urlObj.searchParams.set('refresh', 'true');

    // Cek snapshot lokal untuk ETag terakhir
    let cachedEtag = null;
    try {
      const snap = getSharedDb().prepare('SELECT etag FROM survey_progress_snapshots WHERE survey_id = ?').get(surveyId);
      if (snap && snap.etag) cachedEtag = snap.etag;
    } catch (_) {}

    const reqHeaders = {
      'Accept': 'application/json',
      'X-FASIH-API-KEY': apiKey
    };
    if (cachedEtag && !forceRefresh) {
      reqHeaders['If-None-Match'] = cachedEtag;
    }

    logger.info(`[FASIH-SYNC] Mengambil data pemantauan dari: ${urlObj.toString()} (ETag: ${cachedEtag ? cachedEtag.slice(0, 20) + '...' : 'none'})...`);

    let response;
    try {
      response = await fetch(urlObj.toString(), {
        method: 'GET',
        headers: reqHeaders,
        signal: AbortSignal.timeout(30000)
      });
    } catch (fetchErr) {
      logger.error(`[FASIH-SYNC] Koneksi gagal: ${fetchErr.message}`);
      throw new Error(`Gagal menghubungi server FASIH API: ${fetchErr.message}`);
    }

    // Tangani HTTP 304 Not Modified (Data di Cloud belum berubah)
    if (response.status === 304) {
      logger.info(`[FASIH-SYNC] ⚡ HTTP 304 Not Modified untuk [${surveyId}] (ETag cocok). Melewati transfer payload & pemrosesan.`);
      return {
        success: true,
        skipped: true,
        notModified: true,
        reason: 'not_modified_etag',
        surveyId,
        etag: cachedEtag,
        message: `Data progres kegiatan [${surveyId}] sudah versi paling mutakhir (HTTP 304).`
      };
    }

    if (!response.ok) {
      let msg = `HTTP Error ${response.status}: ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson.error) msg = errJson.error;
      } catch (_) {}
      logger.error(`[FASIH-SYNC] Respon error dari API: ${msg}`);
      throw new Error(msg);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (jsonErr) {
      logger.error(`[FASIH-SYNC] Format JSON tidak valid: ${jsonErr.message}`);
      throw new Error(`Data yang diterima bukan JSON yang valid: ${jsonErr.message}`);
    }

    if (!payload.success || !Array.isArray(payload.records) || payload.records.length === 0) {
      throw new Error(payload.error || 'Data yang diterima kosong atau tidak memiliki catatan SLS.');
    }

    const effectiveDate = payload.data_date || date || new Date().toISOString().slice(0, 10);
    const records = payload.records;

    // Cek deduplikasi jika diminta (misal dari scheduler background)
    if (skipIfUnchanged) {
      const db = getDb(surveyId);
      const latestUpload = db.prepare(`
        SELECT u.id, u.tanggal, u.stored_status_filename 
        FROM uploads u 
        WHERE u.tanggal = ? AND (u.filename LIKE 'API_FASIH_%' OR u.stored_filename LIKE 'api_sync_%')
        ORDER BY u.id DESC LIMIT 1
      `).get(effectiveDate);

      if (latestUpload) {
        const latestStats = db.prepare(`
          SELECT 
            SUM(approved) as total_approved, 
            SUM(submitted_by_pcl) as total_submitted, 
            SUM(draft) as total_draft,
            SUM(rejected) as total_rejected,
            SUM(target_upload) as total_target
          FROM progres WHERE upload_id = ?
        `).get(latestUpload.id);

        const remoteSummary = payload.summary || {};
        if (
          latestStats &&
          latestStats.total_approved === remoteSummary.total_approved &&
          latestStats.total_submitted === remoteSummary.total_submitted &&
          latestStats.total_draft === remoteSummary.total_draft &&
          latestStats.total_rejected === remoteSummary.total_rejected &&
          latestStats.total_target === remoteSummary.total_target
        ) {
          const resEtag = response.headers.get('etag') || payload.etag;
          if (resEtag) {
            try {
              getSharedDb().prepare('UPDATE survey_progress_snapshots SET etag = ?, updated_at = CURRENT_TIMESTAMP WHERE survey_id = ?').run(resEtag, surveyId);
            } catch (etagErr) {
              logger.warn(`[FASIH-SYNC] Gagal update ETag di snapshot: ${etagErr.message}`);
            }
          }
          logger.info(`[FASIH-AUTO-SYNC] Data untuk tanggal ${effectiveDate} tidak mengalami perubahan (Approved: ${remoteSummary.total_approved}). Melewati sinkronisasi duplikat.`);
          return {
            success: true,
            skipped: true,
            reason: 'unchanged',
            uploadId: latestUpload.id,
            date: effectiveDate,
            totalSls: records.length,
            etag: resEtag,
            summary: remoteSummary
          };
        }
      }
    }

    // 1. Simpan backup berkas JSON fisik ke folder uploads/ untuk audit trail & riwayat
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const ts = Date.now();
    const storedFilename = `api_sync_${surveyId}_${effectiveDate}_${ts}.json`;
    const originalFilename = `API_FASIH_${effectiveDate}.json`;
    const fullStoredPath = path.join(uploadsDir, storedFilename);

    fs.writeFileSync(fullStoredPath, JSON.stringify(payload, null, 2), 'utf8');

    // 2. Ingesti data ke database SQLite
    const db = getDb(surveyId);

    // Dapatkan data upload muatan sebelumnya jika ada
    const prevMuatanRow = db.prepare(`
      SELECT u.id FROM uploads u
      JOIN progres p ON u.id = p.upload_id
      WHERE u.tanggal <= ?
      GROUP BY u.id
      HAVING SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) > 0
      ORDER BY u.tanggal DESC, u.id DESC LIMIT 1
    `).get(effectiveDate);
    const prevMuatanId = prevMuatanRow ? prevMuatanRow.id : null;
    const getPrevMuatanRecord = db.prepare('SELECT * FROM progres WHERE upload_id = ? AND kode = ?');

    let uploadId = null;
    let insertedCount = 0;

    db.transaction(() => {
      // Masukkan baris baru ke tabel uploads
      const upRes = db.prepare(`
        INSERT INTO uploads (
          filename, stored_filename, tanggal, total_subsls_terisi, 
          status_filename, stored_status_filename, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      `).run(
        originalFilename,
        storedFilename,
        effectiveDate,
        records.length,
        originalFilename,
        storedFilename
      );
      uploadId = upRes.lastInsertRowid;

      const insertProgres = db.prepare(`
        INSERT OR REPLACE INTO progres (
          upload_id, kode,
          draft, open, submitted_by_pcl, approved, rejected, target_upload, sls_selesai,
          usaha_ditemukan, usaha_baru, usaha_tidak_ditemukan, usaha_tutup, usaha_ganda,
          ditemukan, keluarga_baru, tidak_ditemukan, meninggal, tidak_eligible, tidak_dapat_ditemui,
          rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya, keluarga_khusus
        ) VALUES (
          ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          0, 0, 0, 0, 0, 0
        )
      `);

      // Master auto-population statement
      const upsertMaster = db.prepare(`
        INSERT INTO subsls_master (
          kode, kode_kec, kecamatan, desa, nama_sls,
          korlap, pml, pcl, muatan, kode_2025, target_fasih, target_honor
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, 0
        )
        ON CONFLICT(kode) DO UPDATE SET
          target_fasih = CASE WHEN (target_fasih IS NULL OR target_fasih = 0) AND excluded.target_fasih > 0 THEN excluded.target_fasih ELSE target_fasih END,
          muatan = CASE WHEN (muatan IS NULL OR muatan = 0) AND excluded.muatan > 0 THEN excluded.muatan ELSE muatan END,
          pcl = CASE WHEN (pcl IS NULL OR pcl = '' OR pcl = 'Petugas Lapangan') AND excluded.pcl != '' THEN excluded.pcl ELSE pcl END,
          pml = CASE WHEN (pml IS NULL OR pml = '' OR pml = 'Pengawas Lapangan') AND excluded.pml != '' THEN excluded.pml ELSE pml END
      `);

      // Cek apakah subsls_master sudah pernah terisi lengkap sebelumnya
      const masterCount = db.prepare('SELECT COUNT(*) as c FROM subsls_master').get()?.c || 0;
      const needMasterSeed = masterCount === 0 || masterCount < records.length;

      const lookup = this._getMasterLookup();

      for (const rec of records) {
        let rawCode = String(rec.kode_sls || '').trim();
        if (!rawCode) continue;

        let kode = rawCode;
        if (kode.length < 16) {
          kode = kode.padEnd(16, '0');
        } else if (kode.length > 16) {
          kode = kode.slice(0, 16);
        }

        // Resolusi metadata wilayah master SLS
        let kodeKec = '00';
        let kecamatan = 'Penajam Paser Utara';
        let desa = 'Seluruh Wilayah';
        let namaSls = rec.nama_sls || rec.sls_name || '';

        const existingMaster = lookup.byCode.get(kode);
        if (existingMaster) {
          kodeKec = existingMaster.kode_kec || '00';
          kecamatan = existingMaster.kecamatan || 'Penajam Paser Utara';
          desa = existingMaster.desa || 'Seluruh Wilayah';
          if (!namaSls) namaSls = existingMaster.nama_sls || '';
        } else {
          // Jika kode SLS agregat kabupaten (6409000000000000)
          if (kode === '6409000000000000' || kode.startsWith('640900')) {
            kodeKec = '00';
            kecamatan = 'Penajam Paser Utara';
            desa = 'Kabupaten PPU';
            if (!namaSls) namaSls = 'Agregat Kabupaten PPU';
          } else {
            const kodeDesa = kode.slice(0, 10);
            const desaRow = lookup.desas.get(kodeDesa);
            if (desaRow) {
              kodeKec = desaRow.kode_kec || '00';
              desa = desaRow.nama_desa;
              kecamatan = lookup.kecamatans.get(desaRow.kode_kec) || ('Kecamatan ' + desaRow.kode_kec);
              if (!namaSls) namaSls = 'SLS ' + kode.slice(10, 14);
            } else {
              kodeKec = kode.slice(4, 6) || '00';
              kecamatan = lookup.kecamatans.get(kodeKec) || ('Kecamatan ' + kodeKec);
              desa = 'Desa ' + (kode.slice(7, 10) || '001');
              if (!namaSls) namaSls = 'Wilayah ' + kode;
            }
          }
        }

        const pclName = this._formatOfficerName(rec.pcl || rec.pcl_name, existingMaster ? existingMaster.pcl : null);
        const pmlName = this._formatOfficerName(rec.pml || rec.pml_name || 'Pengawas BPS PPU', existingMaster ? existingMaster.pml : null);
        const korlapName = (existingMaster && existingMaster.korlap) || rec.korlap || 'Koordinator Lapangan';
        const targetUpload = rec.target || 0;

        // Pastikan entri master SLS tersimpan di subsls_master jika belum ada
        if (needMasterSeed) {
          upsertMaster.run(
            kode, kodeKec, kecamatan, desa, namaSls || ('SLS ' + kode.slice(10, 14)),
            korlapName, pmlName, pclName, targetUpload, kode, targetUpload
          );
        }

        let prevM = null;
        if (prevMuatanId) {
          prevM = getPrevMuatanRecord.get(prevMuatanId, kode);
        }

        const draft = rec.draft || 0;
        const openVal = rec.open || 0;
        const submitted = rec.submitted_by_pcl || 0;
        const approved = rec.approved || 0;
        const rejected = rec.rejected || 0;
        const slsSelesai = (approved >= targetUpload && targetUpload > 0) ? 1 : 0;

        const uDitemukan = rec.usaha_ditemukan || (prevM ? prevM.usaha_ditemukan : 0) || 0;
        const uBaru = rec.usaha_baru || (prevM ? prevM.usaha_baru : 0) || 0;
        const uTdkDitemukan = rec.usaha_tidak_ditemukan || (prevM ? prevM.usaha_tidak_ditemukan : 0) || 0;
        const uTutup = rec.usaha_tutup || (prevM ? prevM.usaha_tutup : 0) || 0;
        const uGanda = rec.usaha_ganda || (prevM ? prevM.usaha_ganda : 0) || 0;

        const kDitemukan = rec.ditemukan || (prevM ? prevM.ditemukan : 0) || 0;
        const kBaru = rec.keluarga_baru || (prevM ? prevM.keluarga_baru : 0) || 0;
        const kTdkDitemukan = rec.tidak_ditemukan || (prevM ? prevM.tidak_ditemukan : 0) || 0;
        const kMeninggal = rec.meninggal || (prevM ? prevM.meninggal : 0) || 0;
        const kTdkEligible = rec.tidak_eligible || (prevM ? prevM.tidak_eligible : 0) || 0;
        const kTdkDitemui = rec.tidak_dapat_ditemui || (prevM ? prevM.tidak_dapat_ditemui : 0) || 0;

        insertProgres.run(
          uploadId, kode,
          draft, openVal, submitted, approved, rejected, targetUpload, slsSelesai,
          uDitemukan, uBaru, uTdkDitemukan, uTutup, uGanda,
          kDitemukan, kBaru, kTdkDitemukan, kMeninggal, kTdkEligible, kTdkDitemui
        );

        insertedCount++;
      }

      // Update total subsls terisi
      db.prepare('UPDATE uploads SET total_subsls_terisi = ? WHERE id = ?').run(insertedCount, uploadId);
    })();

    // 2b. Ingesti telemetri progres riil petugas langsung dari API (jika ada dalam payload)
    if (Array.isArray(payload.officers_progress) && payload.officers_progress.length > 0) {
      try {
        const savedTel = saveOfficerProgressTelemetry(surveyId, uploadId, payload.officers_progress);
        logger.info(`[FASIH-SYNC] 🎯 Berhasil menyimpan ${savedTel} telemetri progres riil petugas untuk [${surveyId}] (Upload #${uploadId})`);
      } catch (telErr) {
        logger.warn(`[FASIH-SYNC] Gagal menyimpan telemetri petugas: ${telErr.message}`);
      }
    }

    // 3. Rebuild summary_cache & reload connection
    try {
      rebuildSummaryCache(uploadId, surveyId);
      reloadDbConnection(surveyId);
      logger.info(`[FASIH-SYNC] Cache ringkasan berhasil diperbarui untuk ${surveyId} (Upload ID: #${uploadId})`);
    } catch (cacheErr) {
      logger.warn(`[FASIH-SYNC] Gagal rebuild cache untuk ${surveyId}: ${cacheErr.message}`);
    }

    // 3b. Perbarui snapshot di shared.db (untuk sub-milidetik portal /surveys)
    const resEtag = response.headers.get('etag') || payload.etag;
    try {
      const remoteSum = payload.summary || {};
      const app = Number(remoteSum.total_approved || remoteSum.approved || 0);
      const sub = Number(remoteSum.total_submitted || remoteSum.submitted || 0);
      const tgt = Number(remoteSum.total_target || remoteSum.target || 0);
      const real = app + sub;
      const pct = tgt > 0 ? parseFloat(((real / tgt) * 100).toFixed(1)) : 0;

      upsertSurveyProgressSnapshot(surveyId, {
        survey_name: payload.survey_name || surveyId,
        latest_upload_id: uploadId,
        tanggal: effectiveDate,
        total_sls: insertedCount,
        realisasi: real,
        target: tgt,
        approved: app,
        submitted: sub,
        draft: Number(remoteSum.total_draft || remoteSum.draft || 0),
        rejected: Number(remoteSum.total_rejected || remoteSum.rejected || 0),
        open: Number(remoteSum.total_open || remoteSum.open || 0),
        persen: pct,
        etag: resEtag,
        source: payload.source || 'cloud_sync'
      });
      logger.info(`[FASIH-SYNC] Snapshot portal diperbarui untuk ${surveyId} (ETag: ${resEtag || 'none'})`);
    } catch (snapErr) {
      logger.warn(`[FASIH-SYNC] Gagal update snapshot untuk ${surveyId}: ${snapErr.message}`);
    }

    // 4. Kirim notifikasi WhatsApp otomatis jika diminta
    let waResult = null;
    if (triggerWa) {
      try {
        const whatsappService = require('./whatsappService');
        waResult = await whatsappService.sendUpdateNotification(uploadId);
        logger.info(`[FASIH-SYNC] Notifikasi WA dikirim: ${JSON.stringify(waResult)}`);
      } catch (waErr) {
        logger.warn(`[FASIH-SYNC] Gagal mengirim WA: ${waErr.message}`);
        waResult = { success: false, error: waErr.message };
      }
    }

    return {
      success: true,
      surveyId,
      uploadId,
      date: effectiveDate,
      totalSls: insertedCount,
      summary: payload.summary || {},
      sourceFile: payload.source_file,
      engine: payload.engine,
      waNotification: waResult
    };
  }

  /**
   * Wrapper to synchronize progress for a specific survey
   */
  async syncSurveyProgress(surveyId, options = {}) {
    return this.syncFromFasih({ ...options, surveyId });
  }

  /**
   * Directly fetch and synchronize live officer progress telemetry from Cloud API
   */
  async syncOfficersProgressDirect(surveyId = 'se2026', options = {}) {
    const { role = null, forceRefresh = false, customUrl = null, customKey = null } = options;
    const config = this.getConfig();
    let baseUrl = (customUrl || config.apiUrl).replace(/\/+$/, '');
    if (baseUrl.includes('/api/sync/monitoring-data')) {
      baseUrl = baseUrl.replace('/api/sync/monitoring-data', '/api/sync/officers-progress');
    } else if (!baseUrl.includes('/api/sync/officers-progress')) {
      baseUrl = baseUrl + '/api/sync/officers-progress';
    }
    const apiKey = customKey || config.apiKey;

    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('survey', surveyId);
    if (role) urlObj.searchParams.set('role', role);
    if (forceRefresh) urlObj.searchParams.set('refresh', 'true');

    logger.info(`[FASIH-SYNC-OFFICERS] Mengambil telemetri langsung petugas dari: ${urlObj.toString()}...`);
    const start = Date.now();

    const response = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-FASIH-API-KEY': apiKey
      },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      let msg = `HTTP Error ${response.status}: ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson.error) msg = errJson.error;
      } catch (_) {}
      throw new Error(msg);
    }

    const payload = await response.json();
    if (!payload.success || !Array.isArray(payload.officers)) {
      throw new Error(payload.error || 'Data telemetri petugas kosong atau tidak valid.');
    }

    const latestUpload = getLatestUpload(surveyId);
    const uploadId = latestUpload ? latestUpload.id : null;

    const savedCount = saveOfficerProgressTelemetry(surveyId, uploadId, payload.officers);
    logger.info(`[FASIH-SYNC-OFFICERS] Berhasil menyimpan ${savedCount} telemetri petugas untuk [${surveyId}] (${Date.now() - start}ms)`);

    return {
      success: true,
      surveyId,
      uploadId,
      totalOfficers: payload.total_officers || payload.officers.length,
      savedCount,
      source: payload.source || 'bps_fasih_responsibility_api'
    };
  }

  /**
   * Synchronize progress sequentially across all registered surveys with pacing
   */
  async syncAllSurveysProgress(options = {}) {
    const configPath = path.join(__dirname, '..', 'config', 'surveys.json');
    let surveysConfig = {};
    try {
      surveysConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      surveysConfig = require('../config/surveys.json');
    }

    const surveyKeys = Object.keys(surveysConfig);
    const region = options.region || '6409';
    const config = this.getConfig();
    let batchBaseUrl = config.apiUrl;
    if (batchBaseUrl.includes('/api/sync/monitoring-data')) {
      batchBaseUrl = batchBaseUrl.replace('/api/sync/monitoring-data', '/api/sync/batch-summary');
    } else {
      batchBaseUrl = batchBaseUrl.replace(/\/+$/, '') + '/api/sync/batch-summary';
    }
    const batchUrl = `${batchBaseUrl}?region=${region}`;

    logger.info(`[FASIH-SYNC-ALL] Memeriksa Batch Summary Cloud: ${batchUrl}...`);
    let batchData = null;
    try {
      const bRes = await fetch(batchUrl, {
        headers: { 'X-FASIH-API-KEY': config.apiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (bRes.ok) {
        batchData = await bRes.json();
      }
    } catch (bErr) {
      logger.warn(`[FASIH-SYNC-ALL] Batch summary fetch gagal, fallback ke mode per-survei: ${bErr.message}`);
    }

    const snapshotsMap = getSurveyProgressSnapshotsMap();
    const results = [];
    let syncedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    if (batchData && batchData.success && batchData.surveys) {
      const remoteSurveys = batchData.surveys;
      logger.info(`[FASIH-SYNC-ALL] ⚡ Batch summary sukses memuat ${batchData.total_tracked} survei terdata (${batchData.active_surveys} aktif). Memeriksa delta...`);

      for (const key of surveyKeys) {
        const remoteInfo = remoteSurveys[key];
        const localSnap = snapshotsMap[key];

        // 1. Jika survei belum memiliki data sama sekali di Cloud atau 0 target di wilayah ini, lewati seketika
        if (!remoteInfo || (remoteInfo.total_sls === 0 && remoteInfo.target === 0)) {
          skippedCount++;
          results.push({
            surveyId: key,
            name: surveysConfig[key]?.name || key,
            status: 'skipped',
            reason: !remoteInfo ? 'no_remote_data' : 'no_records_for_region'
          });
          continue;
        }

        // 2. Jika ETag cocok dengan snapshot lokal dan tidak forceRefresh, lewati tanpa fetch WAN!
        if (!options.forceRefresh && localSnap && localSnap.etag && remoteInfo.etag && localSnap.etag === remoteInfo.etag) {
          skippedCount++;
          results.push({
            surveyId: key,
            name: surveysConfig[key]?.name || key,
            status: 'skipped',
            reason: 'not_modified_etag',
            etag: localSnap.etag,
            summary: {
              realisasi: localSnap.realisasi,
              target: localSnap.target,
              approved: localSnap.approved,
              submitted: localSnap.submitted
            }
          });
          continue;
        }

        // 3. Ada delta baru atau belum pernah disinkronkan: Tarik detail SLS untuk survei ini saja
        try {
          const res = await this.syncFromFasih({
            ...options,
            surveyId: key,
            skipIfUnchanged: options.skipIfUnchanged !== false
          });

          if (res.skipped) {
            skippedCount++;
            results.push({
              surveyId: key,
              name: surveysConfig[key]?.name || key,
              status: 'skipped',
              reason: res.reason,
              summary: res.summary
            });
          } else {
            syncedCount++;
            results.push({
              surveyId: key,
              name: surveysConfig[key]?.name || key,
              status: 'synced',
              uploadId: res.uploadId,
              totalSls: res.totalSls,
              summary: res.summary,
              engine: res.engine
            });
          }
        } catch (err) {
          failedCount++;
          results.push({
            surveyId: key,
            name: surveysConfig[key]?.name || key,
            status: 'error',
            error: err.message
          });
          logger.warn(`[FASIH-SYNC-ALL] Gagal menyinkronkan progres kegiatan ${key}: ${err.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      // Fallback: Sequential sync
      for (const key of surveyKeys) {
        try {
          const res = await this.syncFromFasih({
            ...options,
            surveyId: key,
            skipIfUnchanged: options.skipIfUnchanged !== false
          });

          if (res.skipped) {
            skippedCount++;
            results.push({
              surveyId: key,
              name: surveysConfig[key]?.name || key,
              status: 'skipped',
              reason: res.reason,
              summary: res.summary
            });
          } else {
            syncedCount++;
            results.push({
              surveyId: key,
              name: surveysConfig[key]?.name || key,
              status: 'synced',
              uploadId: res.uploadId,
              totalSls: res.totalSls,
              summary: res.summary,
              engine: res.engine
            });
          }
        } catch (err) {
          failedCount++;
          results.push({
            surveyId: key,
            name: surveysConfig[key]?.name || key,
            status: 'error',
            error: err.message
          });
          logger.warn(`[FASIH-SYNC-ALL] Gagal menyinkronkan progres kegiatan ${key}: ${err.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    logger.info(`[FASIH-SYNC-ALL] Selesai: ${syncedCount} disinkronkan, ${skippedCount} lewati (tidak berubah), ${failedCount} gagal.`);
    return {
      success: true,
      total: surveyKeys.length,
      synced: syncedCount,
      skipped: skippedCount,
      failed: failedCount,
      batchAccelerated: !!batchData,
      results
    };
  }

  /**
   * Get quick progress status for a survey from SQLite
   */
  getSurveyProgressStatus(surveyId = 'se2026') {
    try {
      const { getLatestUpload, getOverviewSummary, getSettings } = require('../database');
      const latestUpload = getLatestUpload(surveyId);
      if (!latestUpload) {
        return {
          hasData: false,
          surveyId,
          lastSync: null,
          totalSls: 0,
          realisasi: 0,
          target: 0,
          persen: 0
        };
      }

      const settings = getSettings(surveyId);
      const summary = getOverviewSummary(latestUpload.id, settings, surveyId);
      const realisasi = summary ? ((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0)) : 0;
      const target = summary ? (summary.target_fasih_total || 0) : 0;
      const persen = target > 0 ? parseFloat(((realisasi / target) * 100).toFixed(1)) : 0;

      return {
        hasData: true,
        surveyId,
        uploadId: latestUpload.id,
        lastSync: latestUpload.created_at || latestUpload.tanggal,
        date: latestUpload.tanggal,
        totalSls: latestUpload.total_subsls_terisi || 0,
        realisasi,
        approved: summary ? (summary.approved_total || 0) : 0,
        submitted: summary ? (summary.submitted_total || 0) : 0,
        draft: summary ? (summary.draft_total || 0) : 0,
        open: summary ? (summary.open_total || 0) : 0,
        target,
        persen
      };
    } catch (err) {
      return {
        hasData: false,
        surveyId,
        error: err.message
      };
    }
  }

  /**
   * Get past API synchronization history
   */
  getSyncHistory(surveyId = 'se2026', limit = 10) {
    try {
      const db = getDb(surveyId);
      return db.prepare(`
        SELECT id, filename, stored_filename, tanggal, total_subsls_terisi, created_at 
        FROM uploads 
        WHERE filename LIKE 'API_FASIH_%' OR stored_filename LIKE 'api_sync_%'
        ORDER BY id DESC LIMIT ?
      `).all(limit);
    } catch (err) {
      logger.error(`[FASIH-SYNC] Gagal membaca riwayat sync: ${err.message}`);
      return [];
    }
  }

  /**
   * Synchronize spatial points (Titik Uji Petik) directly from FASIH-SM Cloud via API
   */
  async syncSpatialPoints(options = {}) {
    const {
      surveyId = 'se2026',
      mode = 'replace', // 'replace' | 'append'
      region = '6409',
      customUrl = null,
      customKey = null
    } = options;

    const { apiUrl, apiKey } = this.getSpatialConfig(customUrl, customKey);
    const urlObj = new URL(apiUrl);
    urlObj.searchParams.set('survey', surveyId);
    urlObj.searchParams.set('region', region);
    urlObj.searchParams.set('format', 'compact');

    const start = Date.now();
    logger.info(`[FASIH-SPATIAL-SYNC] Memulai penarikan titik spasial dari: ${urlObj.toString()} (Mode: ${mode})`);

    const res = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-FASIH-API-KEY': apiKey
      },
      signal: AbortSignal.timeout(120000) // 2 minutes timeout for full 75k points
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
      } catch (_) {}
      throw new Error(`Gagal menarik data spasial dari FASIH API (${errMsg})`);
    }

    const payload = await res.json();
    if (!payload || !Array.isArray(payload.points) || payload.points.length === 0) {
      throw new Error('Respons FASIH Spatial API tidak mengandung data titik (array titik kosong).');
    }

    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const ts = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);
    const storedFilename = `api_spatial_sync_${surveyId}_${todayStr}_${ts}.json`;
    const originalFilename = `API_SPATIAL_${todayStr}.json`;
    const fullStoredPath = path.join(uploadsDir, storedFilename);

    // Save physical JSON file for rollback and download capability
    fs.writeFileSync(fullStoredPath, JSON.stringify(payload), 'utf8');

    // Ingest into SQLite using unified database helper
    const totalImported = importTitikUjiPetik(
      fullStoredPath,
      surveyId,
      mode === 'replace',
      {
        filename: originalFilename,
        stored_filename: storedFilename
      }
    );

    logger.info(`[FASIH-SPATIAL-SYNC] ✅ Berhasil menyinkronkan ${totalImported} titik spasial ke database (${surveyId}) dalam ${latencyMs}ms.`);

    return {
      success: true,
      mode,
      totalImported,
      totalPoints: payload.total || totalImported,
      stats: payload.stats || {},
      storedFilename,
      originalFilename,
      latencyMs
    };
  }

  /**
   * Start automated background sync scheduler
   */
  startBackgroundScheduler() {
    if (this._schedulerStarted) return;
    this._schedulerStarted = true;

    const isEnabled = process.env.FASIH_AUTO_SYNC_ENABLED !== 'false';
    if (!isEnabled) {
      logger.info('[FASIH-AUTO-SYNC] Auto-sync di latar belakang dinonaktifkan (FASIH_AUTO_SYNC_ENABLED=false)');
      return;
    }

    const intervalMinutes = parseInt(process.env.FASIH_AUTO_SYNC_INTERVAL_MIN || '60', 10);
    const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;

    logger.info(`⏰ [FASIH-AUTO-SYNC] Background scheduler aktif (Setiap ${intervalMinutes} menit)`);

    // Pengecekan awal 30 detik setelah server startup
    setTimeout(async () => {
      try {
        await this.runAutoSyncTask();
      } catch (err) {
        logger.warn(`[FASIH-AUTO-SYNC] Pengecekan awal tertunda: ${err.message}`);
      }
    }, 30000);

    // Interval berulang
    this._intervalId = setInterval(async () => {
      try {
        await this.runAutoSyncTask();
      } catch (err) {
        logger.warn(`[FASIH-AUTO-SYNC] Pengecekan terjadwal error: ${err.message}`);
      }
    }, intervalMs);
  }

  /**
   * Execute single background synchronization task with deduplication
   */
  async runAutoSyncTask() {
    const triggerWa = process.env.FASIH_AUTO_SYNC_WA === 'true';
    logger.info(`[FASIH-AUTO-SYNC] Memeriksa data baru di FASIH-SM Cloud...`);

    try {
      const result = await this.syncFromFasih({
        surveyId: 'se2026',
        skipIfUnchanged: true,
        triggerWa
      });

      if (result.skipped) {
        logger.info(`[FASIH-AUTO-SYNC] Data sudah paling mutakhir. Tidak ada perubahan status.`);
      } else {
        logger.info(`[FASIH-AUTO-SYNC] ✅ Berhasil menyinkronkan data baru! Upload ID: #${result.uploadId} (${result.totalSls} SLS)`);
      }
      return result;
    } catch (err) {
      logger.warn(`[FASIH-AUTO-SYNC] Gagal memeriksa/menyinkronkan data: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new FasihSyncService();
