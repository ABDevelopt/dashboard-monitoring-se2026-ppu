/**
 * surveyScheduleService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Layanan Pemetaan Jadwal & Kalender Pelaksanaan Sensus dan Survei BPS.
 * Mengkalkulasi tanggal mulai, tanggal selesai, durasi hari, status pelaksanaan,
 * serta kepadatan beban kerja lapangan bulanan (monthly workload density)
 * untuk visualisasi Gantt / Timeline Range Bar Chart.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// Kamus Jadwal Khusus Resmi Kegiatan BPS (Override Presisi)
const EXPLICIT_SCHEDULES = {
  // Sensus Ekonomi 2026
  'se2026': {
    startDate: '2026-05-01',
    endDate: '2026-07-31',
    stage: 'Pencacahan Lapangan (CAPI)',
    periodLabel: '1 Mei — 31 Juli 2026',
    year: 2026
  },
  'se2026-pengisian-mandiri': {
    startDate: '2026-05-01',
    endDate: '2026-06-30',
    stage: 'Pendataan Mandiri (CAWI)',
    periodLabel: '1 Mei — 30 Juni 2026',
    year: 2026
  },
  'sensus-ekonomi-2026-ub': {
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    stage: 'Pendataan Usaha Besar (UB)',
    periodLabel: '1 Juni — 31 Agustus 2026',
    year: 2026
  },
  'pelatihan-se2026': {
    startDate: '2026-04-15',
    endDate: '2026-04-30',
    stage: 'Pelatihan Petugas (PCL & PML)',
    periodLabel: '15 — 30 April 2026',
    year: 2026
  },

  // Sakernas 2026
  'sakernas-pemutakhiran': {
    startDate: '2026-08-01',
    endDate: '2026-08-15',
    stage: 'Tahap 1: Pemutakhiran Muatan SLS',
    periodLabel: '1 — 15 Agustus 2026',
    year: 2026
  },
  'sakernas-pendataan': {
    startDate: '2026-08-08',
    endDate: '2026-08-31',
    stage: 'Tahap 2: Pencacahan Rumah Tangga',
    periodLabel: '8 — 31 Agustus 2026',
    year: 2026
  },
  'sakernas-feb-2026-pemutakhiran': {
    startDate: '2026-02-01',
    endDate: '2026-02-15',
    stage: 'Pemutakhiran Muatan',
    periodLabel: '1 — 15 Februari 2026',
    year: 2026
  },
  'sakernas-feb-2026-pendataan': {
    startDate: '2026-02-08',
    endDate: '2026-02-28',
    stage: 'Pencacahan Sampel',
    periodLabel: '8 — 28 Februari 2026',
    year: 2026
  },
  'sakernas-mei-2026-pemutakhiran': {
    startDate: '2026-05-01',
    endDate: '2026-05-15',
    stage: 'Pemutakhiran Muatan',
    periodLabel: '1 — 15 Mei 2026',
    year: 2026
  },
  'sakernas-mei-2026-pendataan': {
    startDate: '2026-05-08',
    endDate: '2026-05-31',
    stage: 'Pencacahan Sampel',
    periodLabel: '8 — 31 Mei 2026',
    year: 2026
  },
  'petugas-sakernas-mei-2026-pendataan': {
    startDate: '2026-04-25',
    endDate: '2026-04-30',
    stage: 'Pelatihan Petugas Pencacah',
    periodLabel: '25 — 30 April 2026',
    year: 2026
  },
  'inda-sakernas-mei-2026-pendataan': {
    startDate: '2026-04-20',
    endDate: '2026-04-24',
    stage: 'Pelatihan Instruktur Daerah',
    periodLabel: '20 — 24 April 2026',
    year: 2026
  },

  // Podes 2026
  'podes-2026-desa': {
    startDate: '2026-05-02',
    endDate: '2026-05-31',
    stage: 'Pendataan Potensi Desa (Podes)',
    periodLabel: '2 — 31 Mei 2026',
    year: 2026
  },
  'pelatihan-podes-2026-desa': {
    startDate: '2026-04-20',
    endDate: '2026-04-28',
    stage: 'Pelatihan Petugas Podes',
    periodLabel: '20 — 28 April 2026',
    year: 2026
  },

  // Pertanian & Subround (Sub-P / Sub-S)
  'sub-p-2026-subround-i': {
    startDate: '2026-01-01',
    endDate: '2026-04-30',
    stage: 'Pencacahan Ubinan Padi/Palawija Subround 1',
    periodLabel: '1 Januari — 30 April 2026',
    year: 2026
  },
  'sub-p-2026-subround-2': {
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    stage: 'Pencacahan Ubinan Padi/Palawija Subround 2',
    periodLabel: '1 Mei — 31 Agustus 2026',
    year: 2026
  },
  'sub-p-2026-subround-3': {
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    stage: 'Pencacahan Ubinan Padi/Palawija Subround 3',
    periodLabel: '1 September — 31 Desember 2026',
    year: 2026
  },
  'sub-s-2026': {
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    stage: 'Pendataan Subround Sapi/Kerbau',
    periodLabel: '1 Mei — 31 Agustus 2026',
    year: 2026
  },

  // SKGB Kering & Giling
  'pelaksanaan-skgb-kering-2026': {
    startDate: '2026-03-01',
    endDate: '2026-04-30',
    stage: 'Survei Konversi Gabah Kering Panen',
    periodLabel: '1 Maret — 30 April 2026',
    year: 2026
  },
  'pelaksanaan-skgb-giling-2026': {
    startDate: '2026-07-01',
    endDate: '2026-08-31',
    stage: 'Survei Konversi Gabah ke Beras Giling',
    periodLabel: '1 Juli — 31 Agustus 2026',
    year: 2026
  },

  // PLN Groundcheck
  'groundcheck-pelanggan-listrik-pt-pln-persero-pra': {
    startDate: '2026-06-01',
    endDate: '2026-07-31',
    stage: 'Groundcheck Lapangan Prabayar',
    periodLabel: '1 Juni — 31 Juli 2026',
    year: 2026
  },
  'groundcheck-pelanggan-listrik-pt-pln-persero-pas': {
    startDate: '2026-06-01',
    endDate: '2026-07-31',
    stage: 'Groundcheck Lapangan Pascabayar',
    periodLabel: '1 Juni — 31 Juli 2026',
    year: 2026
  },

  // VSNLIK 2026
  'vsnlik26-p-survei-nasional-literasi-dan-inklusi': {
    startDate: '2026-03-01',
    endDate: '2026-04-15',
    stage: 'Pencacahan Rumah Tangga VSNLIK',
    periodLabel: '1 Maret — 15 April 2026',
    year: 2026
  },
  'vsnlik26-k-survei-nasional-literasi-dan-inklusi': {
    startDate: '2026-03-01',
    endDate: '2026-04-15',
    stage: 'Pencacahan Korporasi VSNLIK',
    periodLabel: '1 Maret — 15 April 2026',
    year: 2026
  },
  'vsnlik26-p-pelatihan-survei-nasional-literasi-da': {
    startDate: '2026-02-15',
    endDate: '2026-02-28',
    stage: 'Pelatihan Petugas VSNLIK-P',
    periodLabel: '15 — 28 Februari 2026',
    year: 2026
  },
  'vsnlik26-k-pelatihan-survei-nasional-literasi-da': {
    startDate: '2026-02-15',
    endDate: '2026-02-28',
    stage: 'Pelatihan Petugas VSNLIK-K',
    periodLabel: '15 — 28 Februari 2026',
    year: 2026
  },

  // Kegiatan Tahun 2025
  'supas-2025-pemutahiran': {
    startDate: '2025-06-01',
    endDate: '2025-06-25',
    stage: 'Pemutakhiran Blok Sensus SUPAS',
    periodLabel: '1 — 25 Juni 2025',
    year: 2025
  },
  'supas-2025-pendataan': {
    startDate: '2025-07-01',
    endDate: '2025-07-31',
    stage: 'Pencacahan Sampel SUPAS',
    periodLabel: '1 — 31 Juli 2025',
    year: 2025
  },
  'imk-tahunan-2025-pencacahan': {
    startDate: '2025-07-01',
    endDate: '2025-10-31',
    stage: 'Pencacahan Industri Mikro & Kecil',
    periodLabel: '1 Juli — 31 Oktober 2025',
    year: 2025
  },
  'survei-ibs-triwulanan-sibstr-2025': {
    startDate: '2025-07-01',
    endDate: '2025-09-30',
    stage: 'Pencacahan Industri Besar & Sedang',
    periodLabel: '1 Juli — 30 September 2025',
    year: 2025
  },
  'survei-triwulanan-perusahaan-air-bersih-2025': {
    startDate: '2025-07-01',
    endDate: '2025-09-30',
    stage: 'Pencacahan Triwulanan Air Bersih',
    periodLabel: '1 Juli — 30 September 2025',
    year: 2025
  },
  'survei-triwulanan-perusahaan-penggalian-bahan-in-2': {
    startDate: '2025-07-01',
    endDate: '2025-09-30',
    stage: 'Pencacahan Triwulanan Penggalian',
    periodLabel: '1 Juli — 30 September 2025',
    year: 2025
  },
  'imk-triwulanan-2025-pencacahan': {
    startDate: '2025-07-01',
    endDate: '2025-09-30',
    stage: 'Pencacahan IMK Triwulanan',
    periodLabel: '1 Juli — 30 September 2025',
    year: 2025
  },
  'pencacahan-skth-2025': {
    startDate: '2025-08-01',
    endDate: '2025-09-30',
    stage: 'Pencacahan Hortikultura Tahunan',
    periodLabel: '1 Agustus — 30 September 2025',
    year: 2025
  },
  'pelaksanaan-stpim-2025-v-ibs26': {
    startDate: '2025-09-01',
    endDate: '2025-11-30',
    stage: 'Pelaksanaan STPIM',
    periodLabel: '1 September — 30 November 2025',
    year: 2025
  }
};

/**
 * Infer schedule details from survey identifier, category, and name
 */
function inferSchedule(survey) {
  const id = survey.id || '';
  const name = (survey.name || '').toLowerCase();
  const cat = survey.category || 'survei';

  // 1. Cek kamus eksplisit terlebih dahulu
  if (EXPLICIT_SCHEDULES[id]) {
    return { ...EXPLICIT_SCHEDULES[id] };
  }

  // 2. Tentukan Tahun (Default 2026, jika mengandung 2025 maka 2025)
  const is2025 = id.includes('2025') || name.includes('2025');
  const year = is2025 ? 2025 : 2026;

  let startDate = `${year}-06-01`;
  let endDate = `${year}-07-31`;
  let stage = 'Pencacahan Lapangan';
  let periodLabel = `Juni — Juli ${year}`;

  // 3. Pola Subround (Pertanian / Ubinan)
  if (name.includes('subround 3') || name.includes('subround iii') || id.includes('subround-3')) {
    startDate = `${year}-09-01`;
    endDate = `${year}-12-31`;
    stage = 'Pencacahan Lapangan (Subround 3)';
    periodLabel = `1 September — 31 Desember ${year}`;
  } else if (name.includes('subround 2') || name.includes('subround ii') || id.includes('subround-2')) {
    startDate = `${year}-05-01`;
    endDate = `${year}-08-31`;
    stage = 'Pencacahan Lapangan (Subround 2)';
    periodLabel = `1 Mei — 31 Agustus ${year}`;
  } else if (name.includes('subround 1') || name.includes('subround i') || id.includes('subround-i') || id.includes('subround-1')) {
    startDate = `${year}-01-01`;
    endDate = `${year}-04-30`;
    stage = 'Pencacahan Lapangan (Subround 1)';
    periodLabel = `1 Januari — 30 April ${year}`;
  }
  // 4. Pola Triwulanan
  else if (name.includes('triwulan') || id.includes('triwulan') || name.includes('sibstr')) {
    if (name.includes('listing')) {
      startDate = `${year}-05-15`;
      endDate = `${year}-06-30`;
      stage = 'Pemutakhiran Direktori Sampel';
      periodLabel = `15 Mei — 30 Juni ${year}`;
    } else {
      startDate = `${year}-07-01`;
      endDate = `${year}-09-30`;
      stage = 'Pencacahan Triwulan III';
      periodLabel = `1 Juli — 30 September ${year}`;
    }
  }
  // 5. Pola Survei Tahunan
  else if (name.includes('tahunan') || id.includes('tahunan')) {
    startDate = `${year}-07-01`;
    endDate = `${year}-10-31`;
    stage = 'Pendataan Perusahaan Tahunan';
    periodLabel = `1 Juli — 31 Oktober ${year}`;
  }
  // 6. Pola Updating Direktori / Listing
  else if (name.includes('updating') || name.includes('listing') || name.includes('pemutakhiran')) {
    startDate = `${year}-05-01`;
    endDate = `${year}-06-15`;
    stage = 'Pemutakhiran Direktori';
    periodLabel = `1 Mei — 15 Juni ${year}`;
  }
  // 7. Pola Pelatihan Petugas
  else if (cat === 'pelatihan' || name.includes('pelatihan') || id.includes('pelatihan')) {
    startDate = `${year}-04-15`;
    endDate = `${year}-04-28`;
    stage = 'Pelatihan Petugas';
    periodLabel = `15 — 28 April ${year}`;
  }
  // 8. Pola Hortikultura / Perkebunan
  else if (name.includes('horti') || name.includes('vpvn') || name.includes('skth') || name.includes('sktr')) {
    startDate = `${year}-07-15`;
    endDate = `${year}-09-15`;
    stage = 'Pencacahan Lapangan Hortikultura';
    periodLabel = `15 Juli — 15 September ${year}`;
  }
  // 9. Pola Ekonomi Keluarga / Khusus
  else if (name.includes('ekonomi keluarga') || name.includes('skp2026') || name.includes('udpe')) {
    startDate = `${year}-08-01`;
    endDate = `${year}-09-30`;
    stage = 'Pendataan Sampel Rumah Tangga/Usaha';
    periodLabel = `1 Agustus — 30 September ${year}`;
  }

  return {
    startDate,
    endDate,
    stage,
    periodLabel,
    year
  };
}

/**
 * Hitung selisih hari antara dua tanggal (inklusif)
 */
function calculateDays(startDateStr, endDateStr) {
  const d1 = new Date(startDateStr);
  const d2 = new Date(endDateStr);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Format tanggal Indonesia ramah pengguna (contoh: "15 Mei 2026")
 */
function formatDateId(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Generate dataset timeline lengkap untuk seluruh survei
 * @param {Array} surveysList — Daftar survei dari routes/surveys.js
 * @param {Date} [referenceDate] — Tanggal acuan "Hari Ini"
 */
function getTimelineDataset(surveysList, referenceDate = new Date()) {
  const todayTime = referenceDate.getTime();
  const todayStr = referenceDate.toISOString().slice(0, 10);
  const currentRefYear = referenceDate.getFullYear();

  const items = surveysList.map((s) => {
    const sched = inferSchedule(s);
    const startD = new Date(sched.startDate);
    const endD = new Date(sched.endDate);
    const durationDays = calculateDays(sched.startDate, sched.endDate);

    // Status pelaksanaan
    let status = 'akan_datang';
    let statusLabel = 'Akan Datang';
    let statusClass = 'status-upcoming';

    if (s.persen >= 100) {
      status = 'selesai';
      statusLabel = 'Selesai 100%';
      statusClass = 'status-completed';
    } else if (todayTime >= startD.getTime() && todayTime <= endD.getTime()) {
      status = 'aktif';
      statusLabel = 'Sedang Berjalan';
      statusClass = 'status-active';
    } else if (todayTime > endD.getTime()) {
      status = (s.hasData && s.persen > 0) ? 'selesai' : 'selesai_evaluasi';
      statusLabel = (s.hasData && s.persen > 0) ? `Terlaksana (${s.persen}%)` : 'Tutup Lapangan';
      statusClass = 'status-completed';
    }

    // Kalkulasi posisi balok relatif terhadap 1 Tahun Kalender (1 Jan s.d. 31 Des = 365/366 hari)
    const yearStart = new Date(`${sched.year}-01-01T00:00:00`).getTime();
    const yearEnd = new Date(`${sched.year}-12-31T23:59:59`).getTime();
    const totalYearMs = yearEnd - yearStart;

    const clampedStart = Math.max(yearStart, startD.getTime());
    const clampedEnd = Math.min(yearEnd, endD.getTime());

    const leftPercent = Math.max(0, Math.min(100, ((clampedStart - yearStart) / totalYearMs) * 100));
    const widthPercent = Math.max(1.8, Math.min(100 - leftPercent, ((clampedEnd - clampedStart) / totalYearMs) * 100));

    // Ekstrak bulan aktif (0-11)
    const activeMonths = [];
    let curMonth = new Date(startD.getFullYear(), startD.getMonth(), 1);
    const endMonth = new Date(endD.getFullYear(), endD.getMonth(), 1);
    while (curMonth <= endMonth) {
      activeMonths.push(`${curMonth.getFullYear()}-${String(curMonth.getMonth() + 1).padStart(2, '0')}`);
      curMonth.setMonth(curMonth.getMonth() + 1);
    }

    return {
      ...s,
      startDate: sched.startDate,
      endDate: sched.endDate,
      startDateFormatted: formatDateId(sched.startDate),
      endDateFormatted: formatDateId(sched.endDate),
      periodLabel: sched.periodLabel,
      stage: sched.stage,
      year: sched.year,
      durationDays,
      status,
      statusLabel,
      statusClass,
      leftPercent: parseFloat(leftPercent.toFixed(2)),
      widthPercent: parseFloat(widthPercent.toFixed(2)),
      activeMonths
    };
  });

  // Urutkan default: kegiatan tahun 2026 terlebih dahulu, lalu berdasarkan tanggal mulai terawal
  items.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year; // 2026 sebelum 2025
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    return a.name.localeCompare(b.name);
  });

  // Kalkulasi posisi Today Marker untuk tahun 2026
  const targetYear = 2026;
  const yStart2026 = new Date(`${targetYear}-01-01T00:00:00`).getTime();
  const yEnd2026 = new Date(`${targetYear}-12-31T23:59:59`).getTime();
  const todayPercent2026 = Math.max(0, Math.min(100, ((todayTime - yStart2026) / (yEnd2026 - yStart2026)) * 100));
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const todayFormatted = `${referenceDate.getDate()} ${monthNamesShort[referenceDate.getMonth()]}`;

  // Metrik Agregat Ringkasan
  const totalCount = items.length;
  const count2026 = items.filter(i => i.year === 2026).length;
  const count2025 = items.filter(i => i.year === 2025).length;
  const countActive = items.filter(i => i.status === 'aktif').length;
  const countCompleted = items.filter(i => i.status === 'selesai' || i.persen >= 100).length;
  const avgDuration = Math.round(items.reduce((acc, i) => acc + i.durationDays, 0) / (totalCount || 1));

  // Hitung Kepadatan Bulanan (Monthly Workload Density) untuk tahun 2026
  const monthNames = [
    { num: '01', code: 'Jan', name: 'Januari' },
    { num: '02', code: 'Feb', name: 'Februari' },
    { num: '03', code: 'Mar', name: 'Maret' },
    { num: '04', code: 'Apr', name: 'April' },
    { num: '05', code: 'Mei', name: 'Mei' },
    { num: '06', code: 'Jun', name: 'Juni' },
    { num: '07', code: 'Jul', name: 'Juli' },
    { num: '08', code: 'Ags', name: 'Agustus' },
    { num: '09', code: 'Sep', name: 'September' },
    { num: '10', code: 'Okt', name: 'Oktober' },
    { num: '11', code: 'Nov', name: 'November' },
    { num: '12', code: 'Des', name: 'Desember' }
  ];

  const density2026 = monthNames.map((m, idx) => {
    const key = `2026-${m.num}`;
    const activeSurveys = items.filter(i => i.year === 2026 && i.activeMonths.includes(key));
    return {
      monthIndex: idx,
      monthNum: m.num,
      monthCode: m.code,
      monthName: m.name,
      count: activeSurveys.length,
      surveyNames: activeSurveys.map(s => s.shortName || s.name)
    };
  });

  const maxDensity = Math.max(...density2026.map(d => d.count), 1);
  const peakMonth = density2026.reduce((prev, cur) => (cur.count > prev.count ? cur : prev), density2026[0]);

  return {
    items,
    summary: {
      totalCount,
      count2026,
      count2025,
      countActive,
      countCompleted,
      avgDuration,
      todayStr,
      todayFormatted,
      todayPercent2026: parseFloat(todayPercent2026.toFixed(2)),
      peakSeason: `${peakMonth.monthName} 2026 (${peakMonth.count} kegiatan aktif)`
    },
    density2026,
    maxDensity
  };
}

module.exports = {
  EXPLICIT_SCHEDULES,
  inferSchedule,
  calculateDays,
  formatDateId,
  getTimelineDataset
};
