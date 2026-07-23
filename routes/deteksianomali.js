let masterFiltersCache = {
  kecList: null,
  korlapList: null,
  timestamp: 0
};

function getMasterFilterLists() {
  const now = Date.now();
  if (masterFiltersCache.kecList && masterFiltersCache.korlapList && (now - masterFiltersCache.timestamp < 30 * 60 * 1000)) {
    return masterFiltersCache;
  }
  const db = getDb();
  const kecList = db.prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = db.prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  masterFiltersCache = { kecList, korlapList, timestamp: now };
  return masterFiltersCache;
}

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');

  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterStatus = req.query.status || '';
  const searchQuery = (req.query.q || '').toLowerCase().trim();
  const activeTab = req.query.tab || 'usaha';
  const forceRefresh = req.query.refresh === 'true';

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(10, Math.min(200, parseInt(req.query.limit) || 50));

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
  const { kecList, korlapList } = getMasterFilterLists();

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

// POST: Update anomaly status via Google Apps Script
router.post('/update-status', async (req, res) => {
  const { assignment_id, type, nama, no, nama_anomali, tindak_lanjut, penjelasan } = req.body;

  if (!assignment_id && !nama) {
    return res.json({ success: false, error: 'Assignment ID atau Nama Anomali wajib diisi.' });
  }

  try {
    const { updateAnomalyStatusInGoogleSheets } = require('../services/googleSheetsAnomalyService');
    const result = await updateAnomalyStatusInGoogleSheets({
      assignment_id: assignment_id || '',
      type: type || 'usaha',
      nama: nama || '',
      no: no || '',
      nama_anomali: nama_anomali || '',
      tindak_lanjut: tindak_lanjut || 'Sudah Ditindaklanjuti',
      penjelasan: penjelasan || ''
    }, res.locals.settings || {});

    res.json(result);
  } catch (err) {
    console.error('Error updating Google Sheets anomaly status:', err);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
