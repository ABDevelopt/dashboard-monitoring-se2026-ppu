// ─────────────────────────────────────────────────────────────────────────────
//  queryHints.js — Template Query SE2026 PPU
//
//  Kolom yang tersedia di summary_cache (dari progres + subsls_master):
//  kode, kecamatan, desa, nama_sls, korlap, pml, pcl,
//  target_fasih_awal, draft_total, submitted_total, approved_total,
//  rejected_total, target_fasih_total (= target_fasih_sekarang),
//  total_muatan (= target_muatan), muatan_selesai, status,
//  usaha_tidak_ditemukan, usaha_ditemukan, usaha_baru, usaha_tutup, usaha_ganda,
//  keluarga_tidak_ditemukan, keluarga_ditemukan, keluarga_baru,
//  meninggal, total_usaha, total_keluarga,
//  rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya
//
//  Cara pakai di SYSTEM_INSTRUCTION:
//    const { QUERY_HINTS } = require('./queryHints');
//    const hintsText = Object.entries(QUERY_HINTS)
//      .map(([k, h]) => `- **${k}**: ${h.description}`)
//      .join('\n');
//
//  AI Agent mengisi parameter :uploadId, :kecamatan, :desa, :pml, :pcl,
//  :korlap, :limit sebelum menjalankan query via run_read_only_query.
// ─────────────────────────────────────────────────────────────────────────────

const QUERY_HINTS = {

  // ═══════════════════════════════════════════════════════════════
  //  1. OVERVIEW & RINGKASAN
  // ═══════════════════════════════════════════════════════════════

  overview_kabupaten: {
    description: 'Ringkasan total progres FASIH dan Muatan se-Kabupaten PPU dalam satu baris agregat',
    sql: `
      SELECT
        COUNT(*)                          AS total_sls,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(target_fasih_awal)            AS target_fasih_awal,
        SUM(draft_total)                  AS draft,
        SUM(submitted_total)              AS submitted,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_fasih,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2)                  AS pct_muatan,
        SUM(usaha_ditemukan + usaha_baru)                     AS total_usaha_terdata,
        SUM(keluarga_ditemukan + keluarga_baru)               AS total_keluarga_terdata,
        SUM(usaha_ganda)                                      AS total_usaha_ganda,
        SUM(usaha_tutup)                                      AS total_usaha_tutup,
        SUM(usaha_tidak_ditemukan)                            AS total_usaha_tidak_ditemukan,
        SUM(keluarga_tidak_ditemukan)                         AS total_keluarga_tidak_ditemukan
      FROM summary_cache
      WHERE upload_id = :uploadId
    `
  },

  overview_per_kecamatan: {
    description: 'Ringkasan progres FASIH dan Muatan dikelompokkan per kecamatan, cocok untuk perbandingan antar wilayah',
    sql: `
      SELECT
        kecamatan,
        COUNT(*)                          AS total_sls,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_fasih,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2)                  AS pct_muatan,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(draft_total)                  AS draft
      FROM summary_cache
      WHERE upload_id = :uploadId
      GROUP BY kecamatan
      ORDER BY pct_fasih DESC
    `
  },

  overview_per_desa: {
    description: 'Ringkasan progres FASIH dan Muatan per desa, bisa difilter kecamatan tertentu',
    sql: `
      SELECT
        kecamatan, desa,
        COUNT(*)                          AS total_sls,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_fasih,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2)                  AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa
      ORDER BY kecamatan, pct_fasih DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  2. PROGRES FASIH
  // ═══════════════════════════════════════════════════════════════

  rerata_fasih: {
    description: 'Rata-rata progres realisasi dokumen FASIH per kecamatan (persentase)',
    sql: `
      SELECT
        kecamatan,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(target_fasih_total)           AS target_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
      GROUP BY kecamatan
      ORDER BY pct_fasih DESC
    `
  },

  status_fasih_detail: {
    description: 'Rincian status dokumen FASIH (draft, submitted, approved, rejected) per kecamatan',
    sql: `
      SELECT
        kecamatan,
        SUM(target_fasih_awal)            AS target_awal,
        SUM(target_fasih_total)           AS target_sekarang,
        SUM(draft_total)                  AS draft,
        SUM(submitted_total)              AS submitted,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(submitted_total + approved_total + rejected_total) AS total_realisasi,
        ROUND(100.0 * SUM(approved_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_approved
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan
      ORDER BY pct_approved DESC
    `
  },

  sls_belum_mulai: {
    description: 'SLS yang belum ada aktivitas sama sekali (draft=0, submitted=0, approved=0, rejected=0)',
    sql: `
      SELECT
        kode, kecamatan, desa, nama_sls, korlap, pml, pcl,
        target_fasih_total, total_muatan, status
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND draft_total = 0
        AND submitted_total = 0
        AND approved_total = 0
        AND rejected_total = 0
        AND target_fasih_total > 0
      ORDER BY kecamatan, desa, nama_sls
      LIMIT :limit
    `
  },

  sls_draft_menumpuk: {
    description: 'SLS dengan draft tinggi namun belum ada yang disubmit — indikasi PCL berhenti di tengah jalan',
    sql: `
      SELECT
        kode, kecamatan, desa, nama_sls, pcl, pml,
        draft_total, submitted_total, approved_total, rejected_total,
        target_fasih_total,
        ROUND(100.0 * draft_total / NULLIF(target_fasih_total, 0), 2) AS pct_draft
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND draft_total > 0
        AND submitted_total = 0
        AND target_fasih_total > 0
      ORDER BY draft_total DESC
      LIMIT :limit
    `
  },

  perubahan_target_fasih: {
    description: 'SLS yang target FASIH-nya berubah (target_fasih_awal berbeda dengan target_fasih_sekarang) — indikasi revisi listing',
    sql: `
      SELECT
        kode, kecamatan, desa, nama_sls, pcl, pml,
        target_fasih_awal,
        target_fasih_total AS target_fasih_sekarang,
        (target_fasih_total - target_fasih_awal) AS selisih,
        submitted_total, approved_total
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND target_fasih_total != target_fasih_awal
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      ORDER BY ABS(target_fasih_total - target_fasih_awal) DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  3. PROGRES MUATAN (USAHA & KELUARGA)
  // ═══════════════════════════════════════════════════════════════

  rerata_muatan: {
    description: 'Rata-rata progres realisasi muatan (usaha + keluarga terdata) per kecamatan',
    sql: `
      SELECT
        kecamatan,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(usaha_ditemukan + usaha_baru) AS usaha_terdata,
        SUM(keluarga_ditemukan + keluarga_baru) AS keluarga_terdata,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
      GROUP BY kecamatan
      ORDER BY pct_muatan DESC
    `
  },

  detail_muatan_usaha: {
    description: 'Detail muatan kategori usaha: ditemukan, baru, tutup, tidak ditemukan, ganda — per kecamatan atau PCL',
    sql: `
      SELECT
        kecamatan,
        SUM(usaha_ditemukan)              AS usaha_ditemukan,
        SUM(usaha_baru)                   AS usaha_baru,
        SUM(usaha_tutup)                  AS usaha_tutup,
        SUM(usaha_tidak_ditemukan)        AS usaha_tidak_ditemukan,
        SUM(usaha_ganda)                  AS usaha_ganda,
        SUM(usaha_ditemukan + usaha_baru) AS total_usaha_valid,
        SUM(total_usaha)                  AS total_usaha_terdaftar
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan
      ORDER BY total_usaha_valid DESC
    `
  },

  detail_muatan_keluarga: {
    description: 'Detail muatan kategori keluarga/rumah tangga: ditemukan, baru, tidak ditemukan, meninggal — per kecamatan',
    sql: `
      SELECT
        kecamatan,
        SUM(keluarga_ditemukan)           AS keluarga_ditemukan,
        SUM(keluarga_baru)                AS keluarga_baru,
        SUM(keluarga_tidak_ditemukan)     AS keluarga_tidak_ditemukan,
        SUM(meninggal)                    AS meninggal,
        SUM(keluarga_ditemukan + keluarga_baru) AS total_keluarga_valid,
        SUM(total_keluarga)               AS total_keluarga_terdaftar
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan
      ORDER BY total_keluarga_valid DESC
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  4. PERINGKAT PCL
  // ═══════════════════════════════════════════════════════════════

  pcl_fasih_tertinggi: {
    description: 'Leaderboard PCL dengan capaian FASIH terbaik, bisa difilter kecamatan',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND target_fasih_total > 0
      GROUP BY pcl, pml, korlap, kecamatan
      ORDER BY pct_fasih DESC, realisasi_fasih DESC
      LIMIT :limit
    `
  },

  pcl_fasih_terendah: {
    description: 'PCL dengan capaian FASIH terburuk/terendah, cocok untuk early warning, bisa difilter kecamatan',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(draft_total)                  AS draft,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2)            AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND target_fasih_total > 0
      GROUP BY pcl, pml, korlap, kecamatan
      ORDER BY pct_fasih ASC, realisasi_fasih ASC
      LIMIT :limit
    `
  },

  pcl_muatan_tertinggi: {
    description: 'PCL dengan realisasi muatan terbanyak (usaha + keluarga terdata)',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(total_muatan)                 AS target_muatan,
        SUM(usaha_ditemukan + usaha_baru) AS usaha_terdata,
        SUM(keluarga_ditemukan + keluarga_baru) AS keluarga_terdata,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl, pml, korlap, kecamatan
      ORDER BY pct_muatan DESC, muatan_selesai DESC
      LIMIT :limit
    `
  },

  pcl_muatan_terendah: {
    description: 'PCL dengan realisasi muatan paling sedikit — indikasi perlu pendampingan lapangan',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(total_muatan)                 AS target_muatan,
        SUM(usaha_tidak_ditemukan)        AS usaha_tidak_ditemukan,
        SUM(keluarga_tidak_ditemukan)     AS keluarga_tidak_ditemukan,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND total_muatan > 0
      GROUP BY pcl, pml, korlap, kecamatan
      ORDER BY pct_muatan ASC, muatan_selesai ASC
      LIMIT :limit
    `
  },

  pcl_detail_seorang: {
    description: 'Detail lengkap semua SLS milik satu PCL tertentu — FASIH dan muatan per SLS',
    sql: `
      SELECT
        kode, kecamatan, desa, nama_sls, status,
        target_fasih_awal, target_fasih_total,
        draft_total, submitted_total, approved_total, rejected_total,
        total_muatan, muatan_selesai,
        usaha_ditemukan, usaha_baru, usaha_tutup, usaha_tidak_ditemukan, usaha_ganda,
        keluarga_ditemukan, keluarga_baru, keluarga_tidak_ditemukan, meninggal,
        ROUND(100.0 * (submitted_total + approved_total + rejected_total)
          / NULLIF(target_fasih_total, 0), 2) AS pct_fasih,
        ROUND(100.0 * muatan_selesai
          / NULLIF(total_muatan, 0), 2)        AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND LOWER(pcl) LIKE LOWER(:pcl)
      ORDER BY pct_fasih ASC
      LIMIT :limit
    `
  },

  pcl_nol_progres: {
    description: 'PCL yang sama sekali belum ada progres (realisasi FASIH = 0) padahal memiliki target',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        COUNT(*)                          AS jumlah_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(total_muatan)                 AS target_muatan,
        SUM(draft_total + submitted_total + approved_total + rejected_total) AS total_aktivitas
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND target_fasih_total > 0
      GROUP BY pcl, pml, korlap, kecamatan
      HAVING total_aktivitas = 0
      ORDER BY target_fasih DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  5. PERINGKAT PML
  // ═══════════════════════════════════════════════════════════════

  pml_ringkasan: {
    description: 'Ringkasan kinerja per PML: jumlah PCL binaan, total SLS, progres FASIH dan muatan',
    sql: `
      SELECT
        pml, kecamatan,
        COUNT(DISTINCT pcl)               AS jumlah_pcl,
        COUNT(*)                          AS total_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2)        AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pml, kecamatan
      ORDER BY pct_fasih DESC
      LIMIT :limit
    `
  },

  pml_rejection_rate: {
    description: 'PML dengan tingkat penolakan (rejection) dokumen tertinggi — indikasi ketatnya QC atau masalah PCL',
    sql: `
      SELECT
        pml, kecamatan,
        COUNT(DISTINCT pcl)               AS jumlah_pcl,
        SUM(submitted_total)              AS submitted,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        ROUND(100.0 * SUM(rejected_total)
          / NULLIF(SUM(submitted_total + approved_total + rejected_total), 0), 2) AS pct_rejected
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pml, kecamatan
      HAVING (submitted + approved + rejected) > 0
      ORDER BY pct_rejected DESC
      LIMIT :limit
    `
  },

  pml_detail_seorang: {
    description: 'Semua PCL binaan dari satu PML tertentu beserta progres masing-masing',
    sql: `
      SELECT
        pcl, kecamatan, desa,
        COUNT(*)                          AS jumlah_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND LOWER(pml) LIKE LOWER(:pml)
      GROUP BY pcl, kecamatan, desa
      ORDER BY pct_fasih ASC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  6. PERINGKAT KORLAP
  // ═══════════════════════════════════════════════════════════════

  korlap_ringkasan: {
    description: 'Ringkasan kinerja per Korlap: jumlah PML & PCL, progres FASIH dan muatan wilayah koordinasinya',
    sql: `
      SELECT
        korlap, kecamatan,
        COUNT(DISTINCT pml)               AS jumlah_pml,
        COUNT(DISTINCT pcl)               AS jumlah_pcl,
        COUNT(*)                          AS total_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2)        AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY korlap, kecamatan
      ORDER BY pct_fasih DESC
      LIMIT :limit
    `
  },

  korlap_detail_seorang: {
    description: 'Semua PML dan PCL di bawah koordinasi satu Korlap tertentu',
    sql: `
      SELECT
        pml, pcl, kecamatan, desa,
        COUNT(*)                          AS jumlah_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND LOWER(korlap) LIKE LOWER(:korlap)
      GROUP BY pml, pcl, kecamatan, desa
      ORDER BY pct_fasih ASC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  7. ANOMALI & KUALITAS DATA
  // ═══════════════════════════════════════════════════════════════

  anomali_usaha_ganda: {
    description: 'SLS atau PCL dengan kasus usaha_ganda terbanyak — indikasi double entry atau kesalahan pendataan',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan, desa,
        SUM(usaha_ganda)                  AS total_usaha_ganda,
        COUNT(*)                          AS jumlah_sls_bermasalah,
        SUM(usaha_ditemukan)              AS usaha_ditemukan,
        SUM(usaha_baru)                   AS usaha_baru
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND usaha_ganda > 0
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl, pml, korlap, kecamatan, desa
      ORDER BY total_usaha_ganda DESC
      LIMIT :limit
    `
  },

  anomali_rejection_tinggi: {
    description: 'PCL dengan rasio penolakan dokumen FASIH sangat tinggi — butuh pendampingan atau pengecekan kualitas',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(submitted_total)              AS submitted,
        SUM(approved_total)               AS approved,
        SUM(rejected_total)               AS rejected,
        SUM(submitted_total + approved_total + rejected_total) AS total_realisasi,
        ROUND(100.0 * SUM(rejected_total)
          / NULLIF(SUM(submitted_total + approved_total + rejected_total), 0), 2) AS pct_rejected
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND (submitted_total + approved_total + rejected_total) > 0
      GROUP BY pcl, pml, korlap, kecamatan
      HAVING pct_rejected > 20
      ORDER BY pct_rejected DESC
      LIMIT :limit
    `
  },

  anomali_tidak_ditemukan_tinggi: {
    description: 'PCL dengan jumlah usaha atau keluarga tidak ditemukan sangat tinggi — risiko under-coverage',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(usaha_tidak_ditemukan)        AS usaha_tidak_ditemukan,
        SUM(keluarga_tidak_ditemukan)     AS keluarga_tidak_ditemukan,
        SUM(usaha_tidak_ditemukan + keluarga_tidak_ditemukan) AS total_tidak_ditemukan,
        SUM(usaha_ditemukan + usaha_baru + keluarga_ditemukan + keluarga_baru) AS total_terdata
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND (usaha_tidak_ditemukan + keluarga_tidak_ditemukan) > 0
      GROUP BY pcl, pml, korlap, kecamatan
      ORDER BY total_tidak_ditemukan DESC
      LIMIT :limit
    `
  },

  anomali_meninggal_tinggi: {
    description: 'SLS dengan angka kematian (meninggal) tidak wajar — perlu verifikasi lapangan',
    sql: `
      SELECT
        kode, kecamatan, desa, nama_sls, pcl, pml,
        meninggal,
        total_keluarga,
        keluarga_ditemukan, keluarga_baru, keluarga_tidak_ditemukan,
        ROUND(100.0 * meninggal / NULLIF(total_keluarga, 0), 2) AS pct_meninggal
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND meninggal > 0
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      ORDER BY meninggal DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  8. BANGUNAN & JENIS TEMPAT USAHA
  // ═══════════════════════════════════════════════════════════════

  sebaran_jenis_bangunan: {
    description: 'Sebaran jenis bangunan usaha (rumah tunggal, ruko, susun, apartemen, lainnya) per kecamatan',
    sql: `
      SELECT
        kecamatan,
        SUM(rumah_tunggal)                AS rumah_tunggal,
        SUM(rumah_deret)                  AS rumah_deret,
        SUM(rumah_susun)                  AS rumah_susun,
        SUM(apartemen)                    AS apartemen,
        SUM(lainnya)                      AS lainnya,
        SUM(rumah_tunggal + rumah_deret + rumah_susun + apartemen + lainnya) AS total_bangunan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan
      ORDER BY total_bangunan DESC
    `
  },

  dominasi_bangunan_per_desa: {
    description: 'Jenis bangunan dominan per desa — berguna untuk profil wilayah dan verifikasi karakteristik SLS',
    sql: `
      SELECT
        kecamatan, desa,
        SUM(rumah_tunggal)                AS rumah_tunggal,
        SUM(rumah_deret)                  AS rumah_deret,
        SUM(rumah_susun)                  AS rumah_susun,
        SUM(apartemen)                    AS apartemen,
        SUM(lainnya)                      AS lainnya,
        SUM(rumah_tunggal + rumah_deret + rumah_susun + apartemen + lainnya) AS total_bangunan,
        CASE
          WHEN SUM(rumah_tunggal) >= SUM(rumah_deret)
               AND SUM(rumah_tunggal) >= SUM(rumah_susun)
               AND SUM(rumah_tunggal) >= SUM(apartemen)
               AND SUM(rumah_tunggal) >= SUM(lainnya) THEN 'Rumah Tunggal'
          WHEN SUM(rumah_deret) >= SUM(rumah_susun)
               AND SUM(rumah_deret) >= SUM(apartemen)
               AND SUM(rumah_deret) >= SUM(lainnya) THEN 'Rumah Deret'
          WHEN SUM(rumah_susun) >= SUM(apartemen)
               AND SUM(rumah_susun) >= SUM(lainnya) THEN 'Rumah Susun'
          WHEN SUM(apartemen) >= SUM(lainnya) THEN 'Apartemen'
          ELSE 'Lainnya'
        END AS jenis_dominan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa
      ORDER BY kecamatan, total_bangunan DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  9. STATUS SLS
  // ═══════════════════════════════════════════════════════════════

  sls_per_status: {
    description: 'Jumlah SLS dikelompokkan per nilai kolom status — menampilkan distribusi status di seluruh wilayah',
    sql: `
      SELECT
        status,
        COUNT(*)                          AS jumlah_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(total_muatan)                 AS target_muatan,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY status
      ORDER BY jumlah_sls DESC
    `
  },

  sls_detail_per_kode: {
    description: 'Data lengkap satu SLS berdasarkan kode SLS tertentu — semua kolom tersedia',
    sql: `
      SELECT *
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND kode = :kode
      LIMIT 1
    `
  },

  sls_per_nama: {
    description: 'Cari SLS berdasarkan sebagian nama SLS — gunakan LIKE untuk pencarian fleksibel',
    sql: `
      SELECT
        kode, kecamatan, desa, nama_sls, pcl, pml, korlap, status,
        target_fasih_total, submitted_total, approved_total, rejected_total,
        total_muatan, muatan_selesai,
        ROUND(100.0 * (submitted_total + approved_total + rejected_total)
          / NULLIF(target_fasih_total, 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND LOWER(nama_sls) LIKE LOWER(:nama_sls)
      ORDER BY kecamatan, desa
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  10. TREN & PERBANDINGAN ANTAR UPLOAD
  // ═══════════════════════════════════════════════════════════════

  tren_harian_kabupaten: {
    description: 'Tren progres FASIH dan muatan harian se-kabupaten dari semua upload yang tersedia',
    sql: `
      SELECT
        u.tanggal,
        u.id AS upload_id,
        SUM(s.submitted_total + s.approved_total + s.rejected_total) AS realisasi_fasih,
        SUM(s.target_fasih_total)           AS target_fasih,
        SUM(s.muatan_selesai)               AS muatan_selesai,
        SUM(s.total_muatan)                 AS target_muatan,
        ROUND(100.0 * SUM(s.submitted_total + s.approved_total + s.rejected_total)
          / NULLIF(SUM(s.target_fasih_total), 0), 2) AS pct_fasih,
        ROUND(100.0 * SUM(s.muatan_selesai)
          / NULLIF(SUM(s.total_muatan), 0), 2)        AS pct_muatan
      FROM summary_cache s
      JOIN uploads u ON u.id = s.upload_id
      GROUP BY u.id, u.tanggal
      ORDER BY u.tanggal ASC
      LIMIT 30
    `
  },

  tren_harian_per_kecamatan: {
    description: 'Tren progres harian per kecamatan dari semua upload — cocok untuk grafik tren wilayah',
    sql: `
      SELECT
        u.tanggal,
        s.kecamatan,
        ROUND(100.0 * SUM(s.submitted_total + s.approved_total + s.rejected_total)
          / NULLIF(SUM(s.target_fasih_total), 0), 2) AS pct_fasih,
        ROUND(100.0 * SUM(s.muatan_selesai)
          / NULLIF(SUM(s.total_muatan), 0), 2)        AS pct_muatan
      FROM summary_cache s
      JOIN uploads u ON u.id = s.upload_id
      WHERE (:kecamatan IS NULL OR LOWER(s.kecamatan) = LOWER(:kecamatan))
      GROUP BY u.id, u.tanggal, s.kecamatan
      ORDER BY u.tanggal ASC, s.kecamatan
      LIMIT 60
    `
  }

};

module.exports = { QUERY_HINTS };