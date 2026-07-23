const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../data');
const CACHE_FILE = path.join(__dirname, '../data/anomaly_cache.json');

let cache = {
  data: null,
  timestamp: 0,
  url: null
};

let isRevalidating = false;

// Load persistent cache from disk on startup
function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && saved.data) {
        cache = saved;
        console.log('[GoogleSheetsService] 💾 Loaded persistent anomaly cache from disk.');
      }
    }
  } catch (err) {
    console.warn('[GoogleSheetsService] Could not load disk cache:', err.message);
  }
}

function saveDiskCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch (err) {
    console.warn('[GoogleSheetsService] Could not save disk cache:', err.message);
  }
}

// Initial disk cache load
loadDiskCache();

const DEFAULT_SHEETS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2cciIGMfpN1IJpezUhI8d1m6XX7MAX7lE1G9XsSIFgeOMxLVOEuKJWvDtjiLdkdButQU95_7WoP9S/pubhtml';

function parseCSV(text) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentToken = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentToken += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentToken.trim());
      currentToken = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(currentToken.trim());
      if (row.some(cell => cell.length > 0)) {
        lines.push(row);
      }
      row = [];
      currentToken = '';
    } else {
      currentToken += char;
    }
  }
  if (currentToken || row.length) {
    row.push(currentToken.trim());
    if (row.some(cell => cell.length > 0)) lines.push(row);
  }
  return lines;
}

async function fetchCsvContent(csvUrl) {
  const TIMEOUT_MS = 20000;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(csvUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      return await response.text();
    }
  } catch (err) {
    console.warn(`[GoogleSheetsService] Fetch failed for ${csvUrl}: ${err.message}, trying curl fallback...`);
  }

  // Curl fallback with 25s timeout
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '-sL',
      '--connect-timeout', '10',
      '-m', '25',
      csvUrl
    ]);
    const stdoutChunks = [];
    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.on('close', code => {
      if (code === 0) resolve(Buffer.concat(stdoutChunks).toString());
      else reject(new Error(`Koneksi Google Sheets timeout / curl exit code ${code}`));
    });
  });
}

function extractBasePublishedUrl(url) {
  if (!url) return DEFAULT_SHEETS_URL;
  let cleanUrl = url.trim();
  cleanUrl = cleanUrl.replace(/\/pubhtml.*$/, '').replace(/\/pub\?.*$/, '');
  return cleanUrl;
}

async function fetchFreshDataFromGoogleSheets(baseUrl) {
  const startTime = Date.now();
  const urlUsaha = `${baseUrl}/pub?single=true&output=csv&gid=0`;
  const urlKeluarga = `${baseUrl}/pub?single=true&output=csv&gid=1116284119`;

  const [textUsaha, textKeluarga] = await Promise.all([
    fetchCsvContent(urlUsaha).catch(e => { console.error('Error fetching Usaha CSV:', e.message); return ''; }),
    fetchCsvContent(urlKeluarga).catch(e => { console.error('Error fetching Keluarga CSV:', e.message); return ''; })
  ]);

  const rawUsahaRows = parseCSV(textUsaha);
  const rawKeluargaRows = parseCSV(textKeluarga);

  const usahaList = [];
  if (rawUsahaRows.length > 1) {
    for (let i = 1; i < rawUsahaRows.length; i++) {
      const row = rawUsahaRows[i];
      if (!row || row.length < 16) continue;
      
      const assignmentId = row[15] || '';
      const linkFasih = row[20] && row[20].startsWith('http') 
        ? row[20] 
        : (assignmentId ? `https://fasih-sm.bps.go.id/app/assignment-detail/${assignmentId}` : '');

      const statusTL = row[17] || 'Belum Ditindaklanjuti';
      const isDone = statusTL.toLowerCase().includes('sudah') || statusTL.toLowerCase().includes('selesai');

      usahaList.push({
        id: `U_${i}`,
        type: 'usaha',
        idsubsls: row[0] || '',
        korlap: row[1] || 'Lainnya',
        petugas: row[2] || 'Tidak Diketahui',
        no: row[3] || i,
        nama_usaha: row[4] || '-',
        provinsi: row[6] || 'KALIMANTAN TIMUR',
        kabupaten: row[8] || 'PENAJAM PASER UTARA',
        kecamatan: row[10] || 'Lainnya',
        desa: row[12] || '-',
        kode_sls: row[13] || '-',
        sub_sls: row[14] || '00',
        assignment_id: assignmentId,
        nama_anomali: row[16] || '-',
        tindak_lanjut: statusTL,
        penjelasan: row[21] || '',
        is_done: isDone,
        link_fasih: linkFasih
      });
    }
  }

  const keluargaList = [];
  if (rawKeluargaRows.length > 1) {
    for (let i = 1; i < rawKeluargaRows.length; i++) {
      const row = rawKeluargaRows[i];
      if (!row || row.length < 16) continue;

      const assignmentId = row[15] || '';
      const linkFasih = row[20] && row[20].startsWith('http') 
        ? row[20] 
        : (assignmentId ? `https://fasih-sm.bps.go.id/app/assignment-detail/${assignmentId}` : '');

      const statusTL = row[17] || 'Belum Ditindaklanjuti';
      const isDone = statusTL.toLowerCase().includes('sudah') || statusTL.toLowerCase().includes('selesai');

      keluargaList.push({
        id: `K_${i}`,
        type: 'keluarga',
        idsubsls: row[0] || '',
        korlap: row[1] || 'Lainnya',
        petugas: row[2] || 'Tidak Diketahui',
        no: row[3] || i,
        nama_kk: row[4] || '-',
        provinsi: row[6] || 'KALIMANTAN TIMUR',
        kabupaten: row[8] || 'PENAJAM PASER UTARA',
        kecamatan: row[10] || 'Lainnya',
        desa: row[12] || '-',
        kode_sls: row[13] || '-',
        sub_sls: row[14] || '00',
        assignment_id: assignmentId,
        nama_anomali: row[16] || '-',
        tindak_lanjut: statusTL,
        penjelasan: row[21] || '',
        is_done: isDone,
        link_fasih: linkFasih
      });
    }
  }

  // Aggregate by PCL Officer
  const pclMap = {};
  const processPclItem = (item, type) => {
    const key = item.petugas;
    if (!pclMap[key]) {
      pclMap[key] = {
        petugas: item.petugas,
        korlap: item.korlap,
        kecamatan: item.kecamatan,
        anomali_usaha: 0,
        anomali_keluarga: 0,
        total_anomali: 0,
        sudah_ditindaklanjuti: 0,
        belum_ditindaklanjuti: 0
      };
    }

    if (type === 'usaha') pclMap[key].anomali_usaha++;
    else pclMap[key].anomali_keluarga++;

    pclMap[key].total_anomali++;

    if (item.is_done) {
      pclMap[key].sudah_ditindaklanjuti++;
    } else {
      pclMap[key].belum_ditindaklanjuti++;
    }
  };

  usahaList.forEach(item => processPclItem(item, 'usaha'));
  keluargaList.forEach(item => processPclItem(item, 'keluarga'));

  const pclStats = Object.values(pclMap).sort((a, b) => b.total_anomali - a.total_anomali);

  // Overall totals
  const totalUsaha = usahaList.length;
  const totalKeluarga = keluargaList.length;
  const totalAnomali = totalUsaha + totalKeluarga;
  const totalSudah = usahaList.filter(u => u.is_done).length + keluargaList.filter(k => k.is_done).length;
  const totalBelum = totalAnomali - totalSudah;
  const latencyMs = Date.now() - startTime;

  const result = {
    summary: {
      total_anomali: totalAnomali,
      total_usaha: totalUsaha,
      total_keluarga: totalKeluarga,
      total_sudah: totalSudah,
      total_belum: totalBelum,
      pct_sudah: totalAnomali ? Number(((totalSudah / totalAnomali) * 100).toFixed(1)) : 0
    },
    usahaList,
    keluargaList,
    pclStats,
    lastUpdated: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    fromCache: false,
    latencyMs
  };

  cache = {
    data: result,
    timestamp: Date.now(),
    url: baseUrl
  };

  saveDiskCache();
  return result;
}

// Background revalidation helper (Stale-While-Revalidate)
async function triggerBackgroundRevalidation(baseUrl) {
  if (isRevalidating) return;
  isRevalidating = true;
  try {
    console.log('[GoogleSheetsService] 🔄 Triggering background revalidation for anomaly data...');
    await fetchFreshDataFromGoogleSheets(baseUrl);
    console.log('[GoogleSheetsService] ✅ Background revalidation completed successfully.');
  } catch (err) {
    console.warn('[GoogleSheetsService] Background revalidation failed:', err.message);
  } finally {
    isRevalidating = false;
  }
}

// Auto-refresh background timer every 10 minutes
setInterval(() => {
  if (cache.url) {
    triggerBackgroundRevalidation(cache.url);
  }
}, 10 * 60 * 1000);

async function getAnomalySheetsData(settings = {}, forceRefresh = false) {
  const rawUrl = settings.google_sheets_anomaly_url || DEFAULT_SHEETS_URL;
  const baseUrl = extractBasePublishedUrl(rawUrl);
  
  const FRESH_TTL_MS = 5 * 60 * 1000; // 5 minutes fresh
  const now = Date.now();

  // If forceRefresh is requested, bypass cache completely
  if (forceRefresh) {
    return await fetchFreshDataFromGoogleSheets(baseUrl);
  }

  // If cache exists and matches URL
  if (cache.data && cache.url === baseUrl) {
    const ageMs = now - cache.timestamp;

    // Stale-While-Revalidate: Return cached data immediately (< 10ms)
    // If older than 5 minutes, trigger background fetch silently
    if (ageMs > FRESH_TTL_MS) {
      triggerBackgroundRevalidation(baseUrl);
    }

    return { ...cache.data, fromCache: true };
  }

  // If no cache exists at all, fetch synchronously
  return await fetchFreshDataFromGoogleSheets(baseUrl);
}

async function updateAnomalyStatusInGoogleSheets(payload, settings = {}) {
  const DEFAULT_APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycby3zpFtIN58xOf6GxnDqkl7gjwKX-oeUZwuAp93wL0OrejumH91ykBGa9XbsoMdhZQetA/exec';
  const appsScriptUrl = (settings.google_sheets_apps_script_url || DEFAULT_APPS_SCRIPT).trim();

  if (!appsScriptUrl) {
    throw new Error('URL Google Apps Script Web App belum dikonfigurasi.');
  }

  const startTime = Date.now();

  const payloadObj = {
    assignment_id: payload.assignment_id || '',
    type: payload.type || 'usaha',
    nama: payload.nama || '',
    no: payload.no || '',
    nama_anomali: payload.nama_anomali || '',
    tindak_lanjut: payload.tindak_lanjut,
    penjelasan: payload.penjelasan || '',
    is_test: payload.is_test ? 'true' : 'false'
  };

  const queryParams = new URLSearchParams(payloadObj).toString();
  const targetUrl = appsScriptUrl.includes('?') ? `${appsScriptUrl}&${queryParams}` : `${appsScriptUrl}?${queryParams}`;
  const postData = JSON.stringify(payloadObj);
  const TIMEOUT_MS = 30000;
  let responseText = '';

  // Attempt 1: Fetch POST with query params to survive 302 redirects
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: postData,
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    responseText = await res.text();
  } catch (fetchErr) {
    console.warn(`[GoogleSheetsService] Fetch POST to Apps Script failed: ${fetchErr.message}`);
  }

  // Attempt 2: If POST returned HTML or was empty, try GET fallback
  if (!responseText || responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resGet = await fetch(targetUrl, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timeoutId);
      const getBody = await resGet.text();
      if (getBody && !getBody.includes('<html') && !getBody.includes('<!DOCTYPE')) {
        responseText = getBody;
      }
    } catch (getErr) {
      console.warn(`[GoogleSheetsService] Fetch GET fallback failed: ${getErr.message}`);
    }
  }

  // Check if response contains HTML login/access error or missing doGet error
  if (responseText.includes('Anda memerlukan akses') || responseText.includes('accounts.google.com')) {
    throw new Error('Akses ditolak oleh Google. Silakan buka Apps Script ➔ Deploy ➔ Manage Deployments ➔ Ubah "Who has access" menjadi "Anyone" (Siapa saja).');
  }

  if (responseText.includes('Fungsi skrip tidak ditemukan: doGet') || (responseText.includes('tidak ditemukan') && responseText.includes('doGet'))) {
    throw new Error('Fungsi doGet(e) belum terpasang di Apps Script. Buka Google Spreadsheet ➔ Ekstensi ➔ Apps Script, salin kode terbaru yang memiliki fungsi doGet(e) dan doPost(e), lalu Deploy Versi Baru.');
  }

  let jsonRes;
  try {
    jsonRes = JSON.parse(responseText);
  } catch (e) {
    console.warn('[GoogleSheetsService] Raw Apps Script response:', responseText ? responseText.slice(0, 300) : '(empty)');
    if (responseText.includes('<title>Salah</title>') || responseText.includes('Script error') || responseText.includes('<!DOCTYPE')) {
      throw new Error('Google Apps Script mengalami Script Error. Pastikan Anda telah men-deploy ulang Apps Script sebagai "New Version" di Google Sheets.');
    }
    throw new Error('Respons Google Apps Script bukan JSON (Koneksi Timeout / Server Google lambat). Silakan coba simpan kembali.');
  }

  if (jsonRes.success === false) {
    throw new Error(jsonRes.error || jsonRes.message || 'Assignment ID tidak ditemukan di Google Spreadsheet');
  }

  // Invalidate / update memory cache locally as well
  if (cache.data) {
    const isDone = payload.tindak_lanjut.toLowerCase().includes('sudah') || payload.tindak_lanjut.toLowerCase().includes('selesai');
    const targetList = payload.type === 'keluarga' ? cache.data.keluargaList : cache.data.usahaList;
    const item = targetList.find(i => (payload.no && String(i.no) === String(payload.no)) || (payload.assignment_id && i.assignment_id === payload.assignment_id && payload.nama && (i.nama_usaha === payload.nama || i.nama_kk === payload.nama)));
    if (item) {
      item.tindak_lanjut = payload.tindak_lanjut;
      item.is_done = isDone;
      if (payload.penjelasan) item.penjelasan = payload.penjelasan;
      saveDiskCache();
    }
  }

  const latencyMs = Date.now() - startTime;

  return {
    success: true,
    message: jsonRes.message || 'Berhasil mengupdate data di Google Spreadsheet',
    latencyMs
  };
}

module.exports = {
  getAnomalySheetsData,
  updateAnomalyStatusInGoogleSheets,
  DEFAULT_SHEETS_URL
};
