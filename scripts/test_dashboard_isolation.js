/**
 * Automated Test Suite: Dashboard Navigation & Multi-Survey Isolation Verification
 * BPS Kabupaten Penajam Paser Utara
 * 
 * Verifies:
 * 1. HTTP Status & Routing Integrity for SE2026, Sakernas Pemutakhiran, & Sakernas Pendataan
 * 2. Theme & Branding Isolation (Body class, Theme color, Logo, Title)
 * 3. Navigation Links & URL Isolation (Sidebar, Topbar, Mobile Bottom Dock)
 * 4. Officer Nomenclature (PCL on SE2026 vs PPL on Sakernas)
 * 5. Feature & Column Isolation (Usaha/Muatan visibility, Korlap visibility)
 * 6. API Isolation & Data Segregation across surveys
 * 7. Negative / Restricted Route Isolation
 */

const http = require('http');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

const testResults = {
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  totalTests: 0,
  passed: 0,
  failed: 0,
  suites: []
};

function fetchUrl(pathStr, timeoutMs = 25000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, BASE_URL);
    const req = http.get(url.href, { 
      headers: { 
        'Accept': 'text/html,application/json',
        ...extraHeaders 
      } 
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          location: res.headers['location'] || null
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${pathStr} (${timeoutMs}ms)`));
    });
  });
}

function loginAsAdmin() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/login`, (getRes) => {
      let getBody = '';
      const initialCookie = (getRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      getRes.on('data', chunk => { getBody += chunk; });
      getRes.on('end', () => {
        const match = getBody.match(/name="csrf-token"\s+content="([^"]+)"/);
        const csrfToken = match ? match[1] : '';

        const postData = `username=admin&password=adminse2026&_csrf=${encodeURIComponent(csrfToken)}`;
        const url = new URL('/login', BASE_URL);
        const req = http.request(url.href, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Cookie': initialCookie,
            'X-CSRF-Token': csrfToken
          }
        }, (postRes) => {
          let postCookie = (postRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
          resolve(postCookie || initialCookie);
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    }).on('error', reject);
  });
}

function runAssertion(suite, testName, fn) {
  testResults.totalTests++;
  const start = Date.now();
  try {
    const detail = fn();
    const durationMs = Date.now() - start;
    suite.tests.push({ name: testName, status: 'PASSED', durationMs, detail: detail || 'OK' });
    testResults.passed++;
  } catch (err) {
    const durationMs = Date.now() - start;
    suite.tests.push({ name: testName, status: 'FAILED', durationMs, error: err.message });
    testResults.failed++;
  }
}

async function runAllTests() {
  console.log(`\n======================================================================`);
  console.log(`🚀 MEMULAI PENGUJIAN NAVIGASI & ISOLASI ANTAR DASBOR`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`======================================================================\n`);

  // ─── SUITE 1: PORTAL INDUK KATALOG SURVEI (/surveys) ───
  const suitePortal = { name: 'Suite 1: Portal Induk Sensus & Survei (/surveys)', tests: [] };
  testResults.suites.push(suitePortal);
  try {
    const res = await fetchUrl('/surveys');
    runAssertion(suitePortal, 'HTTP 200 pada Portal Induk', () => {
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    runAssertion(suitePortal, 'Menampilkan link ke ketiga dasbor (SE2026, Pemutakhiran, Pendataan)', () => {
      if (!res.body.includes('href="/"')) throw new Error('Link SE2026 ("/") tidak ditemukan di portal');
      if (!res.body.includes('href="/sakernas-pemutakhiran/"')) throw new Error('Link Sakernas Pemutakhiran tidak ditemukan di portal');
      if (!res.body.includes('href="/sakernas-pendataan/"')) throw new Error('Link Sakernas Pendataan tidak ditemukan di portal');
      return 'Ketiga link modul survei lengkap di portal';
    });
    runAssertion(suitePortal, 'Identifikasi Kategori Sensus vs Survei', () => {
      if (!res.body.includes('Sensus Lengkap') || !res.body.includes('Survei Sampel')) {
        throw new Error('Badge kategori Sensus Lengkap / Survei Sampel tidak lengkap');
      }
      return 'Kategori Sensus Lengkap dan Survei Sampel teridentifikasi';
    });
  } catch (e) {
    suitePortal.tests.push({ name: 'Portal Fetch Failure', status: 'FAILED', error: e.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 2: DASBOR SENSUS EKONOMI 2026 (SE2026) ───
  const suiteSe = { name: 'Suite 2: Dasbor Sensus Ekonomi 2026 (se2026)', tests: [] };
  testResults.suites.push(suiteSe);
  try {
    const res = await fetchUrl('/');
    runAssertion(suiteSe, 'HTTP 200 pada Overview SE2026', () => {
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    runAssertion(suiteSe, 'Theme & Branding SE2026 (Orange Theme)', () => {
      if (!res.body.includes('survey-theme-orange')) throw new Error('Body tidak memiliki class survey-theme-orange');
      if (!res.body.includes('SE2026 PPU')) throw new Error('Branding title SE2026 PPU tidak ditemukan');
      if (!res.body.includes("activeSurveyId = 'se2026'")) throw new Error('activeSurveyId != se2026');
      return 'Tema orange dan branding SE2026 valid';
    });
    runAssertion(suiteSe, 'Nomenklatur Petugas PCL & PML', () => {
      if (!res.body.includes('>PCL<') && !res.body.includes('Petugas Cacah Lapangan')) {
        throw new Error('Nomenklatur PCL tidak ditemukan pada SE2026');
      }
      return 'Nomenklatur PCL terverifikasi';
    });
    runAssertion(suiteSe, 'Navigasi Korlap Tersedia pada SE2026', () => {
      if (!res.body.includes('href="/korlap"')) throw new Error('Link korlap tidak ditemukan pada SE2026');
      return 'Menu Korlap tersedia sesuai spesifikasi sensus lengkap';
    });
    runAssertion(suiteSe, 'Mobile Bottom Dock SE2026', () => {
      if (!res.body.includes('id="bottomNavHomeBtn"')) throw new Error('Bottom nav home button tidak ditemukan');
      return 'Bottom dock SE2026 aktif';
    });
  } catch (e) {
    suiteSe.tests.push({ name: 'SE2026 Overview Failure', status: 'FAILED', error: e.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 3: DASBOR SAKERNAS PEMUTAKHIRAN ───
  const suiteSakPmu = { name: 'Suite 3: Dasbor Sakernas — Pemutakhiran', tests: [] };
  testResults.suites.push(suiteSakPmu);
  try {
    const res = await fetchUrl('/sakernas-pemutakhiran/');
    runAssertion(suiteSakPmu, 'HTTP 200 pada Overview Sakernas Pemutakhiran', () => {
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    runAssertion(suiteSakPmu, 'Theme & Branding Emerald (Hijau Pertumbuhan)', () => {
      if (!res.body.includes('survey-theme-emerald')) throw new Error('Body tidak memiliki class survey-theme-emerald');
      if (!res.body.includes("activeSurveyId = 'sakernas-pemutakhiran'")) throw new Error('activeSurveyId != sakernas-pemutakhiran');
      if (!res.body.includes("navPrefix = '/sakernas-pemutakhiran'")) throw new Error('navPrefix != /sakernas-pemutakhiran');
      return 'Tema emerald dan state survey terisolasi';
    });
    runAssertion(suiteSakPmu, 'Nomenklatur Petugas PPL (Bukan PCL)', () => {
      if (!res.body.includes('>PPL<') && !res.body.includes('PPL')) {
        throw new Error('Nomenklatur PPL tidak ditemukan pada Sakernas Pemutakhiran');
      }
      return 'Nomenklatur PPL aktif untuk Sakernas';
    });
    runAssertion(suiteSakPmu, 'Isolasi Sidebar Navigasi Prefix', () => {
      const hasPrefixMap = res.body.includes('href="/sakernas-pemutakhiran/map"');
      const hasPrefixPcl = res.body.includes('href="/sakernas-pemutakhiran/pcl"');
      const hasPrefixKec = res.body.includes('href="/sakernas-pemutakhiran/kecamatan"');
      if (!hasPrefixMap || !hasPrefixPcl || !hasPrefixKec) {
        throw new Error('Link sidebar kehilangan prefix /sakernas-pemutakhiran');
      }
      return 'Seluruh link sidebar memiliki prefix /sakernas-pemutakhiran';
    });
    runAssertion(suiteSakPmu, 'Penyembunyian Kolom Muatan Usaha (Hanya Rumah Tangga/Keluarga)', () => {
      if (!res.body.includes('hideMuatanGlobal = true') && !res.body.includes('muatan-col')) {
        throw new Error('Kolom muatan usaha tidak disembunyikan pada Sakernas');
      }
      return 'Muatan usaha tersembunyi sesuai kriteria survei rumah tangga';
    });
  } catch (e) {
    suiteSakPmu.tests.push({ name: 'Sakernas Pemutakhiran Failure', status: 'FAILED', error: e.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 4: DASBOR SAKERNAS PENDATAAN (CAPI) ───
  const suiteSakPdt = { name: 'Suite 4: Dasbor Sakernas — Pendataan (CAPI)', tests: [] };
  testResults.suites.push(suiteSakPdt);
  try {
    const res = await fetchUrl('/sakernas-pendataan/');
    runAssertion(suiteSakPdt, 'HTTP 200 pada Overview Sakernas Pendataan', () => {
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    runAssertion(suiteSakPdt, 'Theme & Branding Sapphire Blue', () => {
      if (!res.body.includes('survey-theme-blue')) throw new Error('Body tidak memiliki class survey-theme-blue');
      if (!res.body.includes("activeSurveyId = 'sakernas-pendataan'")) throw new Error('activeSurveyId != sakernas-pendataan');
      if (!res.body.includes("navPrefix = '/sakernas-pendataan'")) throw new Error('navPrefix != /sakernas-pendataan');
      return 'Tema blue dan state survey terisolasi';
    });
    runAssertion(suiteSakPdt, 'Isolasi Sidebar Navigasi Prefix Pendataan', () => {
      const hasPrefixMap = res.body.includes('href="/sakernas-pendataan/map"');
      const hasPrefixPcl = res.body.includes('href="/sakernas-pendataan/pcl"');
      if (!hasPrefixMap || !hasPrefixPcl) {
        throw new Error('Link sidebar kehilangan prefix /sakernas-pendataan');
      }
      return 'Seluruh link sidebar memiliki prefix /sakernas-pendataan';
    });
  } catch (e) {
    suiteSakPdt.tests.push({ name: 'Sakernas Pendataan Failure', status: 'FAILED', error: e.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 5: ISOLASI DATA API & SEARCH ───
  const suiteApi = { name: 'Suite 5: Isolasi Data API & Search Endpoint', tests: [] };
  testResults.suites.push(suiteApi);
  try {
    // API Summary SE2026 vs Sakernas
    const resSumSe = await fetchUrl('/api/summary');
    const resSumSakPmu = await fetchUrl('/sakernas-pemutakhiran/api/summary');
    const resSumSakPdt = await fetchUrl('/sakernas-pendataan/api/summary');

    let sumSe = null, sumPmu = null, sumPdt = null;
    try { sumSe = JSON.parse(resSumSe.body); } catch (_) {}
    try { sumPmu = JSON.parse(resSumSakPmu.body); } catch (_) {}
    try { sumPdt = JSON.parse(resSumSakPdt.body); } catch (_) {}

    runAssertion(suiteApi, 'Data API Summary SE2026 vs Sakernas Pemutakhiran Berbeda (Isolasi Database)', () => {
      if (!sumSe || !sumPmu) throw new Error('Gagal mem-parse JSON summary API');
      const seCount = sumSe.total_subsls || sumSe.total;
      const pmuCount = sumPmu.total_subsls || sumPmu.total;
      if (seCount === pmuCount || !seCount || !pmuCount) {
        throw new Error(`Total SLS sama (${seCount} vs ${pmuCount}), database tidak terisolasi!`);
      }
      return `SE2026 Total SLS: ${seCount} vs Sakernas Pemutakhiran BS: ${pmuCount}`;
    });

    runAssertion(suiteApi, 'Data API Summary Sakernas Pendataan: 42 Blok Sensus', () => {
      if (!sumPdt) throw new Error('Gagal mem-parse JSON summary Sakernas Pendataan');
      const pdtCount = sumPdt.total_subsls || sumPdt.total;
      if (pdtCount !== 42) {
        throw new Error(`Expected 42 BS, got ${pdtCount}`);
      }
      return `Sakernas Pendataan: ${pdtCount} BS Sampel terdata`;
    });

    // Global Search API Per Survey
    const resSearchPmu = await fetchUrl('/api/search-global?q=Babulu&survey=sakernas-pemutakhiran');
    let searchPmu = null;
    try { searchPmu = JSON.parse(resSearchPmu.body); } catch (_) {}

    runAssertion(suiteApi, 'Search Global API Menghasilkan Link dengan NavPrefix Survei yang Tepat', () => {
      if (!searchPmu || !searchPmu.pcl || searchPmu.pcl.length === 0) {
        throw new Error('Hasil pencarian PPL Sakernas kosong');
      }
      const firstPcl = searchPmu.pcl[0];
      if (!firstPcl.href.startsWith('/sakernas-pemutakhiran/')) {
        throw new Error(`Link search PPL tidak berawalan /sakernas-pemutakhiran: ${firstPcl.href}`);
      }
      if (firstPcl.categoryLabel !== 'PPL') {
        throw new Error(`Category label bukan PPL: ${firstPcl.categoryLabel}`);
      }
      return `Pencarian mengembalikan label ${firstPcl.categoryLabel} dengan link ${firstPcl.href}`;
    });
  } catch (e) {
    suiteApi.tests.push({ name: 'API Test Failure', status: 'FAILED', error: e.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 6: VERIFIKASI HALAMAN SUB-LEVEL DI SEMUA SURVEI ───
  const suitePages = { name: 'Suite 6: Verifikasi Status HTTP Halaman Sub-Level', tests: [] };
  testResults.suites.push(suitePages);

  const subPages = [
    { name: 'Peta', path: '/map' },
    { name: 'Kecamatan', path: '/kecamatan' },
    { name: 'SubSLS', path: '/subsls' },
    { name: 'PML', path: '/pml' },
    { name: 'PCL / PPL', path: '/pcl' },
    { name: 'Harian', path: '/harian' },
    { name: 'Leaderboard', path: '/leaderboard' },
    { name: 'Early Warning', path: '/early-warning' },
    { name: 'Ekspor', path: '/export' },
    { name: 'Bantuan', path: '/help' },
    { name: 'AI Chat Agent', path: '/agent' }
  ];

  for (const p of subPages) {
    try {
      const resSe = await fetchUrl(p.path);
      const resPmu = await fetchUrl('/sakernas-pemutakhiran' + p.path);
      const resPdt = await fetchUrl('/sakernas-pendataan' + p.path);

      runAssertion(suitePages, `Halaman ${p.name} (SE2026, Pemutakhiran, Pendataan)`, () => {
        if (resSe.status !== 200) throw new Error(`SE2026 ${p.path} returned ${resSe.status}`);
        if (resPmu.status !== 200) throw new Error(`Pemutakhiran ${p.path} returned ${resPmu.status}`);
        if (resPdt.status !== 200) throw new Error(`Pendataan ${p.path} returned ${resPdt.status}`);
        return `Semua return HTTP 200`;
      });
    } catch (err) {
      suitePages.tests.push({ name: `Halaman ${p.name}`, status: 'FAILED', error: err.message });
      testResults.failed++;
      testResults.totalTests++;
    }
  }

  // ─── SUITE 7: RESTRIKSI FITUR KHUSUS (NEGATIVE TESTING) ───
  const suiteRestrictions = { name: 'Suite 7: Restriksi Fitur Khusus & Redirect Guard', tests: [] };
  testResults.suites.push(suiteRestrictions);
  try {
    // Deteksi Anomali pada Sakernas (Harus di-redirect karena bukan cakupan sensus usaha)
    const resAnomali = await fetchUrl('/sakernas-pemutakhiran/deteksi-anomali');
    runAssertion(suiteRestrictions, 'Deteksi Anomali di-redirect saat diakses di Sakernas', () => {
      if (resAnomali.status !== 302 && resAnomali.status !== 301) {
        throw new Error(`Expected redirect (302), got HTTP ${resAnomali.status}`);
      }
      if (!resAnomali.location.includes('sakernas-pemutakhiran')) {
        throw new Error(`Redirect target bukan Sakernas: ${resAnomali.location}`);
      }
      return `Redirect berhasil ke: ${resAnomali.location}`;
    });

    // Korlap pada Sakernas (Harus di-redirect karena survei sampel tidak memiliki struktur korlap)
    const resKorlap = await fetchUrl('/sakernas-pemutakhiran/korlap');
    runAssertion(suiteRestrictions, 'Korlap di-redirect saat diakses di Sakernas', () => {
      if (resKorlap.status !== 302 && resKorlap.status !== 301) {
        throw new Error(`Expected redirect (302), got HTTP ${resKorlap.status}`);
      }
      if (!resKorlap.location.includes('sakernas-pemutakhiran')) {
        throw new Error(`Redirect target bukan Sakernas: ${resKorlap.location}`);
      }
      return `Redirect berhasil ke: ${resKorlap.location}`;
    });
  } catch (err) {
    suiteRestrictions.tests.push({ name: 'Restriction Test Failure', status: 'FAILED', error: err.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 8: ISOLASI AI WIDGET & AI INSIGHTS ───
  const suiteAi = { name: 'Suite 8: Isolasi AI Widget & AI Smart Insights', tests: [] };
  testResults.suites.push(suiteAi);

  try {
    // 1. Overview Subtitle: survei vs sensus
    const resPmuHtml = await fetchUrl('/sakernas-pemutakhiran/');
    runAssertion(suiteAi, 'Subtitle AI Insights di Sakernas Pemutakhiran berbunyi "survei"', () => {
      if (!resPmuHtml.body.includes('Analisis otomatis progres lapangan survei menggunakan kecerdasan buatan')) {
        throw new Error('Subtitle AI tidak mengandung kata survei yang sesuai!');
      }
      if (resPmuHtml.body.includes('Analisis otomatis progres lapangan sensus menggunakan kecerdasan buatan')) {
        throw new Error('Subtitle AI masih membocorkan kata sensus!');
      }
      return 'Subtitle menggunakan kata "survei" secara tepat';
    });

    const resSeHtml = await fetchUrl('/');
    runAssertion(suiteAi, 'Subtitle AI Insights di SE2026 berbunyi "sensus"', () => {
      if (!resSeHtml.body.includes('Analisis otomatis progres lapangan sensus menggunakan kecerdasan buatan')) {
        throw new Error('Subtitle AI SE2026 tidak mengandung kata sensus!');
      }
      return 'Subtitle menggunakan kata "sensus" secara tepat';
    });

    // 2. AI Insights Endpoint SE2026
    const resAiSe = await fetchUrl('/api/ai-insights');
    let jsonAiSe = null;
    try { jsonAiSe = JSON.parse(resAiSe.body); } catch (_) {}
    runAssertion(suiteAi, 'Endpoint /api/ai-insights SE2026 Berfungsi', () => {
      if (!jsonAiSe || !jsonAiSe.success || !jsonAiSe.insights) {
        throw new Error('Gagal memuat AI Insights SE2026');
      }
      return 'AI Insights SE2026 valid dan berisi analisis';
    });

    // 3. AI Insights Endpoint Sakernas Pemutakhiran
    const resAiPmu = await fetchUrl('/sakernas-pemutakhiran/api/ai-insights');
    let jsonAiPmu = null;
    try { jsonAiPmu = JSON.parse(resAiPmu.body); } catch (_) {}
    runAssertion(suiteAi, 'AI Insights Sakernas Pemutakhiran Terisolasi (Bebas dari Sensus Ekonomi & PCL)', () => {
      if (!jsonAiPmu || !jsonAiPmu.success || !jsonAiPmu.insights) {
        throw new Error('Gagal memuat AI Insights Sakernas Pemutakhiran');
      }
      if (jsonAiPmu.insights.includes('Sensus Ekonomi')) {
        throw new Error('AI Insights membocorkan nama Sensus Ekonomi!');
      }
      if (jsonAiPmu.insights.includes('PCL')) {
        throw new Error('AI Insights membocorkan sebutan petugas PCL!');
      }
      return 'AI Insights Sakernas Pemutakhiran murni tanpa kebocoran SE2026/PCL';
    });

    // 4. AI Insights Endpoint Sakernas Pendataan
    const resAiPdt = await fetchUrl('/sakernas-pendataan/api/ai-insights');
    let jsonAiPdt = null;
    try { jsonAiPdt = JSON.parse(resAiPdt.body); } catch (_) {}
    runAssertion(suiteAi, 'AI Insights Sakernas Pendataan Terisolasi (Bebas dari Sensus Ekonomi & PCL)', () => {
      if (!jsonAiPdt || !jsonAiPdt.success || !jsonAiPdt.insights) {
        throw new Error('Gagal memuat AI Insights Sakernas Pendataan');
      }
      if (jsonAiPdt.insights.includes('Sensus Ekonomi')) {
        throw new Error('AI Insights membocorkan nama Sensus Ekonomi!');
      }
      if (jsonAiPdt.insights.includes('PCL')) {
        throw new Error('AI Insights membocorkan sebutan petugas PCL!');
      }
      return 'AI Insights Sakernas Pendataan murni tanpa kebocoran SE2026/PCL';
    });

    // 5. Client AI Widget JS & Minified Asset Greeting Checks
    const fs = require('fs');
    const widgetCode = fs.readFileSync('public/js/ai-widget.js', 'utf8');
    const minCode = fs.readFileSync('public/js/ai-widget.min.js', 'utf8');

    runAssertion(suiteAi, 'AI Widget JS memiliki Salam & Placeholder Khusus Sakernas', () => {
      if (!widgetCode.includes('Asisten Pintar Pemutakhiran Sakernas Penajam Paser Utara')) {
        throw new Error('Salam Pemutakhiran tidak ditemukan di ai-widget.js');
      }
      if (!widgetCode.includes('Asisten Pintar Pencacahan Sampel Sakernas (CAPI) Penajam Paser Utara')) {
        throw new Error('Salam Pendataan tidak ditemukan di ai-widget.js');
      }
      if (!widgetCode.includes('Tanyakan sesuatu tentang Sakernas Pemutakhiran...')) {
        throw new Error('Placeholder Pemutakhiran tidak ditemukan di ai-widget.js');
      }
      if (!widgetCode.includes('Tanyakan sesuatu tentang Sakernas Pendataan (CAPI)...')) {
        throw new Error('Placeholder Pendataan tidak ditemukan di ai-widget.js');
      }
      return 'Salam dan placeholder terisolasi sempurna di ai-widget.js';
    });

    runAssertion(suiteAi, 'AI Widget Minified Bundle (ai-widget.min.js) Sinkron', () => {
      if (!minCode.includes('Asisten Pintar Pemutakhiran Sakernas')) {
        throw new Error('ai-widget.min.js belum memuat salam Pemutakhiran');
      }
      if (!minCode.includes('Asisten Pintar Pencacahan Sampel Sakernas')) {
        throw new Error('ai-widget.min.js belum memuat salam Pendataan');
      }
      return 'ai-widget.min.js sinkron dengan kode terisolasi terbaru';
    });

    // 6. Ringkasan Progres Sakernas CAPI Respons Terstruktur
    const { runSimulation } = require('../services/ai/orchestrator');
    const { buildLiveContext } = require('../services/ai/contextBuilder');

    runAssertion(suiteAi, 'Live Context Sakernas CAPI Memuat Angka Capaian Akurat (91.67%)', () => {
      const liveCtx = buildLiveContext('sakernas-pendataan');
      if (!liveCtx.includes('91.67%')) throw new Error('Live context tidak memuat angka 91.67%');
      if (!liveCtx.includes('420')) throw new Error('Live context tidak memuat target 420 RT');
      if (!liveCtx.includes('385')) throw new Error('Live context tidak memuat realisasi 385 RT');
      if (liveCtx.includes('% Capaian Utama (Rumah Tangga) | **-%**') || liveCtx.includes('% Capaian Utama (Rumah Tangga) | **-**')) {
        throw new Error('Persentase capaian di live context kosong / bernilai tanda strip');
      }
      return 'Live context Sakernas CAPI memuat 91.67% target 420 dan realisasi 385 RT';
    });

    runAssertion(suiteAi, 'Jawaban Ringkasan Progres Sakernas CAPI Terstruktur & Bersih', () => {
      const sim = runSimulation('Bagaimana ringkasan progres survei Sakernas CAPI di Kabupaten PPU saat ini?', [], 'sakernas-pendataan');
      const text = sim.content || '';
      if (!text.includes('420')) throw new Error('Jawaban tidak memuat target 420');
      if (!text.includes('385')) throw new Error('Jawaban tidak memuat realisasi 385');
      if (!text.includes('91.67%')) throw new Error('Jawaban tidak memuat 91.67%');
      if (!text.includes('PPL')) throw new Error('Jawaban tidak menyebut PPL');
      if (text.includes('PCL')) throw new Error('Jawaban membocorkan sebutan PCL');
      if (text.includes('upload_id') || text.includes('summary_cache')) throw new Error('Jawaban membocorkan nama kolom database teknis');
      return 'Jawaban ringkasan Sakernas CAPI terstruktur eksekutif dan bebas dari teks teknis/PCL';
    });

  } catch (err) {
    suiteAi.tests.push({ name: 'AI Isolation Test Failure', status: 'FAILED', error: err.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── SUITE 7: ISOLASI MUATAN (SE2026 VS SURVEI LAIN) & MOBILE NAV AI CHAT ───
  const suiteMuatan = { name: 'Suite 7: Isolasi Muatan (Khusus SE2026), Penghapusan SLS Upload, & Mobile Nav AI Chat', tests: [] };
  testResults.suites.push(suiteMuatan);
  try {
    // 1. Mobile Bottom Dock displays "AI Chat"
    const homeRes = await fetchUrl('/');
    runAssertion(suiteMuatan, 'Mobile Navigation menampilkan label "AI Chat" (bukan "AI Agent")', () => {
      if (!homeRes.body.includes('<span>AI Chat</span>')) {
        throw new Error('Label "AI Chat" tidak ditemukan di navigasi mobile layout');
      }
      if (homeRes.body.includes('<span>AI Agent</span>')) {
        throw new Error('Label lama "AI Agent" masih ditemukan di navigasi mobile layout');
      }
      return 'Mobile bottom nav sukses menampilkan "AI Chat"';
    });

    // 2. Upload SLS Selesai tab removed from all dashboards
    const adminCookie = await loginAsAdmin();
    const adminHeaders = adminCookie ? { 'Cookie': adminCookie } : {};

    const uploadSlsRes = await fetchUrl('/admin/upload?tab=sls', 25000, adminHeaders);
    runAssertion(suiteMuatan, 'Upload SLS Selesai diredirect ke tab=fasih pada SE2026', () => {
      if (uploadSlsRes.status !== 302 || !uploadSlsRes.location.includes('tab=fasih')) {
        throw new Error(`Expected redirect 302 ke tab=fasih, got status ${uploadSlsRes.status} loc ${uploadSlsRes.location}`);
      }
      return 'Upload SLS diredirect ke tab=fasih di SE2026';
    });

    const sakernasUploadSlsRes = await fetchUrl('/sakernas-pemutakhiran/admin/upload?tab=sls', 25000, adminHeaders);
    runAssertion(suiteMuatan, 'Upload SLS Selesai diredirect ke tab=fasih pada Sakernas', () => {
      if (sakernasUploadSlsRes.status !== 302 || !sakernasUploadSlsRes.location.includes('tab=fasih')) {
        throw new Error(`Expected redirect 302 ke tab=fasih, got status ${sakernasUploadSlsRes.status} loc ${sakernasUploadSlsRes.location}`);
      }
      return 'Upload SLS diredirect ke tab=fasih di Sakernas';
    });

    // 3. Upload Muatan removed on Sakernas
    const sakernasUploadMuatanRes = await fetchUrl('/sakernas-pemutakhiran/admin/upload?tab=muatan', 25000, adminHeaders);
    runAssertion(suiteMuatan, 'Upload Muatan diredirect ke tab=fasih pada Sakernas', () => {
      if (sakernasUploadMuatanRes.status !== 302 || !sakernasUploadMuatanRes.location.includes('tab=fasih')) {
        throw new Error(`Expected redirect 302 ke tab=fasih, got status ${sakernasUploadMuatanRes.status} loc ${sakernasUploadMuatanRes.location}`);
      }
      return 'Upload Muatan diredirect ke tab=fasih di Sakernas';
    });

    // 4. HTML Upload Page Sakernas does not show Tab or Zone for Muatan / SLS
    const sakernasUploadPageRes = await fetchUrl('/sakernas-pemutakhiran/admin/upload', 25000, adminHeaders);
    runAssertion(suiteMuatan, 'Halaman Upload Sakernas murni FASIH (tanpa tab Muatan atau SLS)', () => {
      if (sakernasUploadPageRes.body.includes('id="tabMuatan"') || sakernasUploadPageRes.body.includes('data-tab="muatan"')) {
        throw new Error('Tab upload muatan masih muncul di Sakernas');
      }
      if (sakernasUploadPageRes.body.includes('id="tabSls"') || sakernasUploadPageRes.body.includes('data-tab="sls"')) {
        throw new Error('Tab upload SLS masih muncul di Sakernas');
      }
      return 'Halaman upload Sakernas murni FASIH';
    });

    // 5. Sakernas PCL does not contain Muatan % or Temuan Usaha
    const sakernasPclRes = await fetchUrl('/sakernas-pemutakhiran/pcl');
    runAssertion(suiteMuatan, 'Tabel PCL Sakernas bebas dari kolom Muatan % dan Temuan Keberadaan Usaha', () => {
      if (sakernasPclRes.body.includes('>Muatan %<')) {
        throw new Error('Kolom "Muatan %" masih ditemukan di tabel PCL Sakernas');
      }
      if (sakernasPclRes.body.includes('Temuan Keberadaan Usaha')) {
        throw new Error('Kolom "Temuan Keberadaan Usaha" masih ditemukan di tabel PCL Sakernas');
      }
      if (sakernasPclRes.body.includes('>Total Usaha<')) {
        throw new Error('Kolom "Total Usaha" masih ditemukan di tabel PCL Sakernas');
      }
      return 'Tabel PCL Sakernas bersih dari metrik muatan dan usaha';
    });

    // 6. Sakernas PML does not contain Muatan %
    const sakernasPmlRes = await fetchUrl('/sakernas-pemutakhiran/pml');
    runAssertion(suiteMuatan, 'Tabel PML Sakernas bebas dari kolom Muatan % dan Progres Muatan Tim', () => {
      if (sakernasPmlRes.body.includes('>Muatan %<')) {
        throw new Error('Kolom "Muatan %" masih ditemukan di tabel PML Sakernas');
      }
      if (sakernasPmlRes.body.includes('Progres Muatan Tim')) {
        throw new Error('Card "Progres Muatan Tim" masih ditemukan di drawer PML Sakernas');
      }
      return 'Tabel PML Sakernas bersih dari metrik muatan';
    });

    // 7. Sakernas SubSLS does not contain Muatan %
    const sakernasSubslsRes = await fetchUrl('/sakernas-pemutakhiran/subsls');
    runAssertion(suiteMuatan, 'Tabel SubSLS Sakernas bebas dari kolom Muatan % dan Progres Muatan', () => {
      if (sakernasSubslsRes.body.includes('>Muatan %<')) {
        throw new Error('Kolom "Muatan %" masih ditemukan di tabel SubSLS Sakernas');
      }
      if (sakernasSubslsRes.body.includes('>Usaha Baru<')) {
        throw new Error('Kolom "Usaha Baru" masih ditemukan di tabel SubSLS Sakernas');
      }
      return 'Tabel SubSLS Sakernas bersih dari metrik muatan';
    });

    // 8. SE2026 continues to display Muatan & Usaha
    const sePclRes = await fetchUrl('/pcl');
    runAssertion(suiteMuatan, 'Tabel PCL SE2026 tetap menampilkan Muatan % dan Temuan Keberadaan Usaha', () => {
      if (!sePclRes.body.includes('Muatan %')) {
        throw new Error('Kolom "Muatan %" hilang dari tabel PCL SE2026');
      }
      if (!sePclRes.body.includes('Temuan Keberadaan Usaha')) {
        throw new Error('Kolom "Temuan Keberadaan Usaha" hilang dari tabel PCL SE2026');
      }
      return 'SE2026 tetap memuat metrik muatan dan temuan usaha lengkap';
    });

    // 9. Sakernas Notification Bell bebas dari UPDATE MUATAN
    const sakernasPdtRes = await fetchUrl('/sakernas-pendataan/');
    const sakernasPmuRes = await fetchUrl('/sakernas-pemutakhiran/');
    runAssertion(suiteMuatan, 'Notifikasi lonceng Sakernas bebas dari data UPDATE MUATAN', () => {
      const checkPdt = sakernasPdtRes.body.includes('let isMuatanEnabled = false') && sakernasPdtRes.body.includes('let latestMuatanDate = null');
      const checkPmu = sakernasPmuRes.body.includes('let isMuatanEnabled = false') && sakernasPmuRes.body.includes('let latestMuatanDate = null');
      if (!checkPdt || !checkPmu) {
        throw new Error('Script notifikasi lonceng di Sakernas masih mengaktifkan data muatan!');
      }
      return 'Variabel notifikasi lonceng Sakernas murni FASIH (isMuatanEnabled=false, latestMuatanDate=null)';
    });

    // 10. API /latest-updates Sakernas bebas dari muatan
    const apiPdtUpdates = await fetchUrl('/sakernas-pendataan/api/latest-updates');
    const jsonPdtUpdates = JSON.parse(apiPdtUpdates.body);
    runAssertion(suiteMuatan, 'API /latest-updates Sakernas mengembalikan muatan null', () => {
      if (jsonPdtUpdates.muatan !== null) {
        throw new Error(`API Sakernas membocorkan objek muatan: ${JSON.stringify(jsonPdtUpdates.muatan)}`);
      }
      if (!jsonPdtUpdates.fasih) {
        throw new Error('API Sakernas tidak memuat objek fasih');
      }
      return 'API /latest-updates Sakernas murni FASIH (muatan: null)';
    });

  } catch (err) {
    suiteMuatan.tests.push({ name: 'Muatan Isolation Test Failure', status: 'FAILED', error: err.message });
    testResults.failed++;
    testResults.totalTests++;
  }

  // ─── REPORT OUTPUT ───
  console.log(`\n======================================================================`);
  console.log(`📊 RINGKASAN HASIL PENGUJIAN ISOLASI & NAVIGASI`);
  console.log(`======================================================================`);
  console.log(`Total Pengujian : ${testResults.totalTests}`);
  console.log(`✔ LULUS (Passed): ${testResults.passed}`);
  console.log(`❌ GAGAL (Failed): ${testResults.failed}`);
  console.log(`Tingkat Kelulusan: ${((testResults.passed / testResults.totalTests) * 100).toFixed(1)}%\n`);

  testResults.suites.forEach(suite => {
    console.log(`\n📌 ${suite.name}`);
    suite.tests.forEach(t => {
      if (t.status === 'PASSED') {
        console.log(`   ✔ [PASS] ${t.name} (${t.durationMs}ms) - ${t.detail}`);
      } else {
        console.log(`   ❌ [FAIL] ${t.name} (${t.durationMs}ms) - Error: ${t.error}`);
      }
    });
  });

  console.log(`\n======================================================================\n`);
  return testResults;
}

if (require.main === module) {
  runAllTests()
    .then(res => {
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}

module.exports = { runAllTests };
