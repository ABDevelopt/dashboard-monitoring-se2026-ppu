const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { getAnomalySheetsData } = require('../services/googleSheetsAnomalyService');

const masterFiltersCaches = {}; // surveyId -> cache

function getMasterFilterLists(surveyId = 'se2026') {
  const now = Date.now();
  const cache = masterFiltersCaches[surveyId];
  if (cache && cache.kecList && cache.korlapList && (now - cache.timestamp < 30 * 60 * 1000)) {
    return cache;
  }
  try {
    const db = getDb(surveyId);
    const kecList = db.prepare('SELECT DISTINCT kecamatan FROM subsls_master WHERE kecamatan IS NOT NULL ORDER BY kecamatan').all();
    const korlapList = db.prepare('SELECT DISTINCT korlap FROM subsls_master WHERE korlap IS NOT NULL ORDER BY korlap').all();
    masterFiltersCaches[surveyId] = { kecList, korlapList, timestamp: now };
  } catch (err) {
    console.error('Error fetching master filter lists for deteksi anomali:', err.message);
    masterFiltersCaches[surveyId] = { kecList: [], korlapList: [], timestamp: now };
  }
  return masterFiltersCaches[surveyId];
}

router.get('/', async (req, res) => {
res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterStatus = req.query.status || '';
  const searchQuery = (req.query.q || '').toLowerCase().trim();
  const activeTab = req.query.tab || 'usaha';
  const forceRefresh = req.query.refresh === 'true';

  const limitParam = req.query.limit || '';
  const limit = limitParam === 'all' ? 999999 : Math.max(10, Math.min(200, parseInt(limitParam) || 50));


  let sheetsData = { 
    summary: { total_anomali: 0, total_usaha: 0, total_keluarga: 0, total_sudah: 0, total_belum: 0, pct_sudah: 0 }, 
    usahaList: [], 
    keluargaList: [], 
    pclStats: [],
    lastUpdated: '-',
    fromCache: false
  };

  try {
    sheetsData = await getAnomalySheetsData(res.locals.settings || {}, forceRefresh);
  } catch (err) {
    console.error('Error loading anomaly Google Sheets data:', err.message);
  }

  // Get filter lists with 30-minute memory caching
  const activeSurvey = res.locals.activeSurvey || "se2026";
  const { kecList, korlapList } = getMasterFilterLists(activeSurvey);

  // Filter helper
  const filterItems = (list, isKeluarga = false) => {
    return (list || []).filter(item => {
      if (filterKec && (item.kecamatan || '').toLowerCase() !== filterKec.toLowerCase()) return false;
      if (filterKorlap && (item.korlap || '').toLowerCase() !== filterKorlap.toLowerCase()) return false;
      if (filterStatus === 'sudah' && !item.is_done) return false;
      if (filterStatus === 'belum' && item.is_done) return false;
      if (searchQuery) {
        const nameToSearch = isKeluarga ? item.nama_kk : item.nama_usaha;
        const haystack = `${nameToSearch} ${item.petugas} ${item.korlap} ${item.nama_anomali} ${item.desa} ${item.kode_sls}`.toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });
  };

  const filteredUsaha = filterItems(sheetsData.usahaList, false);
  const filteredKeluarga = filterItems(sheetsData.keluargaList, true);

  const filteredPcl = (sheetsData.pclStats || []).filter(p => {
    if (filterKec && (p.kecamatan || '').toLowerCase() !== filterKec.toLowerCase()) return false;
    if (filterKorlap && (p.korlap || '').toLowerCase() !== filterKorlap.toLowerCase()) return false;
    if (searchQuery) {
      const haystack = `${p.petugas} ${p.korlap} ${p.kecamatan}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });

  // Calculate pagination slices for maximum rendering performance & light DOM payload
  const startIndex = (page - 1) * limit;

  const totalRecordsUsaha = filteredUsaha.length;
  const totalPagesUsaha = Math.max(1, Math.ceil(totalRecordsUsaha / limit));
  const paginatedUsaha = filteredUsaha.slice(startIndex, startIndex + limit);

  const totalRecordsKeluarga = filteredKeluarga.length;
  const totalPagesKeluarga = Math.max(1, Math.ceil(totalRecordsKeluarga / limit));
  const paginatedKeluarga = filteredKeluarga.slice(startIndex, startIndex + limit);

  const totalRecordsPcl = filteredPcl.length;
  const totalPagesPcl = Math.max(1, Math.ceil(totalRecordsPcl / limit));
  const paginatedPcl = filteredPcl.slice(startIndex, startIndex + limit);

  res.render('deteksianomali', {
    title: 'Deteksi & Audit Anomali Data (Google Sheets)',
    activePage: 'deteksi-anomali',
    sheetsData,
    filteredUsaha,
    filteredKeluarga,
    filteredPcl,
    paginatedUsaha,
    paginatedKeluarga,
    paginatedPcl,
    currentPage: page,
    pageSize: limit,
    totalPagesUsaha,
    totalPagesKeluarga,
    totalPagesPcl,
    totalRecordsUsaha,
    totalRecordsKeluarga,
    totalRecordsPcl,
    filterKec,
    filterKorlap,
    filterStatus,
    searchQuery,
    activeTab,
    kecList,
    korlapList
  });
});

// POST: Update anomaly status via Google Apps Script (SEMENTARA DINONAKTIFKAN)
router.post('/update-status', async (req, res) => {
  return res.status(403).json({ success: false, error: 'Fitur edit status anomali sementara dinonaktifkan.' });
});

module.exports = router;

