const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { getAnomalySheetsData } = require('../services/googleSheetsAnomalyService');

router.get('/', async (req, res) => {
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterStatus = req.query.status || '';
  const searchQuery = (req.query.q || '').toLowerCase().trim();
  const activeTab = req.query.tab || 'usaha';
  const forceRefresh = req.query.refresh === 'true';

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

  // Get filter lists from master DB
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();

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

  res.render('deteksianomali', {
    title: 'Deteksi & Audit Anomali Data (Google Sheets)',
    activePage: 'deteksi-anomali',
    sheetsData,
    filteredUsaha,
    filteredKeluarga,
    filteredPcl,
    filterKec,
    filterKorlap,
    filterStatus,
    searchQuery,
    activeTab,
    kecList,
    korlapList
  });
});

module.exports = router;
