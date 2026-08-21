// ─────────────────────────────────────────────────────────────────────────────
//  queryHints.js — Template Query Lengkap Sistem Monitoring Sensus/Survei BPS PPU
//
//  Tabel Utama yang Digunakan:
//  1. summary_cache:
//     upload_id, kecamatan, desa, korlap, pml, pcl, total_sls, selesai,
//     total_muatan, muatan_selesai, usaha_total, keluarga_total, draft_total,
//     submitted_total, approved_total, rejected_total, target_fasih_total,
//     target_static_total, target_upload_total, target_honor_total,
//     usaha_ditemukan, usaha_baru, ditemukan, keluarga_baru,
//     usaha_tidak_ditemukan, tidak_ditemukan, usaha_tutup, meninggal, usaha_ganda,
//     rumah_tunggal, rumah_deret, rumah_susun, apartemen, lainnya.
//
//  2. subsls_master (Master Wilayah SLS) & progres (Detail transaksi per upload)
//  3. uploads (Riwayat unggah data & tanggal)
//  4. weather_history (Kondisi cuaca harian)
// ─────────────────────────────────────────────────────────────────────────────

const QUERY_HINTS = {

  // ═══════════════════════════════════════════════════════════════
  //  1. OVERVIEW & RINGKASAN WILAYAH
  // ═══════════════════════════════════════════════════════════════

  overview_kabupaten: {
    description: 'Ringkasan total progres FASIH dan Muatan se-Kabupaten PPU dalam satu baris agregat',
    sql: `
      SELECT
        COUNT(*)                          AS total_sls,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(target_static_total)          AS target_fasih_awal,
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
        SUM(ditemukan + keluarga_baru)                        AS total_keluarga_terdata,
        SUM(usaha_ganda)                                      AS total_usaha_ganda,
        SUM(usaha_tutup)                                      AS total_usaha_tutup,
        SUM(usaha_tidak_ditemukan)                            AS total_usaha_tidak_ditemukan,
        SUM(tidak_ditemukan)                                  AS total_keluarga_tidak_ditemukan
      FROM summary_cache
      WHERE upload_id = :uploadId
    `
  },

  overview_per_kecamatan: {
    description: 'Ringkasan progres FASIH dan Muatan dikelompokkan per kecamatan untuk perbandingan antar wilayah',
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
    description: 'Ringkasan progres FASIH dan Muatan per desa/kelurahan',
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
  //  2. PROGRES DOKUMEN FASIH
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
        SUM(target_static_total)          AS target_awal,
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
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.korlap, m.pml, m.pcl,
        COALESCE(m.target_fasih, 0) AS target_fasih_total,
        COALESCE(m.muatan, 0) AS total_muatan
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE (:kecamatan IS NULL OR LOWER(m.kecamatan) = LOWER(:kecamatan))
        AND COALESCE(p.draft, 0) = 0
        AND COALESCE(p.submitted_by_pcl, 0) = 0
        AND COALESCE(p.approved, 0) = 0
        AND COALESCE(p.rejected, 0) = 0
        AND COALESCE(m.target_fasih, 0) > 0
      ORDER BY m.kecamatan, m.desa, m.nama_sls
      LIMIT :limit
    `
  },

  sls_draft_menumpuk: {
    description: 'SLS dengan draft tinggi namun belum disubmit ke pengawas',
    sql: `
      SELECT
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.pcl, m.pml,
        COALESCE(p.draft, 0) AS draft_total,
        COALESCE(p.submitted_by_pcl, 0) AS submitted_total,
        COALESCE(p.approved, 0) AS approved_total,
        COALESCE(m.target_fasih, 0) AS target_fasih_total,
        ROUND(100.0 * COALESCE(p.draft, 0) / NULLIF(m.target_fasih, 0), 2) AS pct_draft
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE (:kecamatan IS NULL OR LOWER(m.kecamatan) = LOWER(:kecamatan))
        AND COALESCE(p.draft, 0) > 0
        AND COALESCE(p.submitted_by_pcl, 0) = 0
        AND COALESCE(m.target_fasih, 0) > 0
      ORDER BY draft_total DESC
      LIMIT :limit
    `
  },

  perubahan_target_fasih: {
    description: 'SLS yang target FASIH-nya berubah dibanding master awal',
    sql: `
      SELECT
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.pcl, m.pml,
        COALESCE(m.target_fasih, 0) AS target_fasih_awal,
        COALESCE(p.target_upload, m.target_fasih) AS target_fasih_sekarang,
        (COALESCE(p.target_upload, m.target_fasih) - m.target_fasih) AS selisih,
        COALESCE(p.submitted_by_pcl, 0) AS submitted_total,
        COALESCE(p.approved, 0) AS approved_total
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE (:kecamatan IS NULL OR LOWER(m.kecamatan) = LOWER(:kecamatan))
        AND p.target_upload IS NOT NULL
        AND p.target_upload != m.target_fasih
      ORDER BY ABS(selisih) DESC
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
        SUM(ditemukan + keluarga_baru)    AS keluarga_terdata,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
      GROUP BY kecamatan
      ORDER BY pct_muatan DESC
    `
  },

  detail_muatan_usaha: {
    description: 'Detail muatan kategori usaha: ditemukan, baru, tutup, tidak ditemukan, ganda per kecamatan',
    sql: `
      SELECT
        kecamatan,
        SUM(usaha_ditemukan)              AS usaha_ditemukan,
        SUM(usaha_baru)                   AS usaha_baru,
        SUM(usaha_tutup)                  AS usaha_tutup,
        SUM(usaha_tidak_ditemukan)        AS usaha_tidak_ditemukan,
        SUM(usaha_ganda)                  AS usaha_ganda,
        SUM(usaha_ditemukan + usaha_baru) AS total_usaha_valid,
        SUM(usaha_total)                  AS total_usaha_terdaftar
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan
      ORDER BY total_usaha_valid DESC
    `
  },

  detail_muatan_keluarga: {
    description: 'Detail muatan kategori keluarga/rumah tangga: ditemukan, baru, tidak ditemukan, meninggal per kecamatan',
    sql: `
      SELECT
        kecamatan,
        SUM(ditemukan)                    AS keluarga_ditemukan,
        SUM(keluarga_baru)                AS keluarga_baru,
        SUM(tidak_ditemukan)              AS keluarga_tidak_ditemukan,
        SUM(meninggal)                    AS meninggal,
        SUM(ditemukan + keluarga_baru)    AS total_keluarga_valid,
        SUM(keluarga_total)               AS total_keluarga_terdaftar
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan
      ORDER BY total_keluarga_valid DESC
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  4. PERINGKAT & KINERJA PCL (SURVEYOR)
  // ═══════════════════════════════════════════════════════════════

  top_pcl_fasih: {
    description: 'Daftar PCL dengan persentase capaian FASIH tertinggi (minimal memiliki target > 0)',
    sql: `
      SELECT
        pcl, MAX(pml) AS pml, MAX(kecamatan) AS kecamatan,
        COUNT(*)                          AS jumlah_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(approved_total)               AS approved,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND (:pml IS NULL OR LOWER(pml) = LOWER(:pml))
      GROUP BY pcl
      HAVING SUM(target_fasih_total) > 0
      ORDER BY pct_fasih DESC, realisasi_fasih DESC
      LIMIT :limit
    `
  },

  bottom_pcl_fasih: {
    description: 'Daftar PCL dengan persentase capaian FASIH terendah yang butuh pendampingan',
    sql: `
      SELECT
        pcl, MAX(pml) AS pml, MAX(kecamatan) AS kecamatan,
        COUNT(*)                          AS jumlah_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        SUM(approved_total)               AS approved,
        SUM(draft_total)                  AS draft,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total)
          / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
        AND (:pml IS NULL OR LOWER(pml) = LOWER(:pml))
      GROUP BY pcl
      HAVING SUM(target_fasih_total) > 0
      ORDER BY pct_fasih ASC, realisasi_fasih ASC
      LIMIT :limit
    `
  },

  pcl_muatan_tertinggi: {
    description: 'Daftar PCL dengan realisasi muatan (usaha + keluarga) terbanyak',
    sql: `
      SELECT
        pcl, MAX(pml) AS pml, MAX(kecamatan) AS kecamatan,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(usaha_ditemukan + usaha_baru) AS usaha_terdata,
        SUM(ditemukan + keluarga_baru)    AS keluarga_terdata,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl
      ORDER BY muatan_selesai DESC
      LIMIT :limit
    `
  },

  pcl_muatan_terendah: {
    description: 'Daftar PCL dengan realisasi muatan terendah',
    sql: `
      SELECT
        pcl, MAX(pml) AS pml, MAX(kecamatan) AS kecamatan,
        SUM(total_muatan)                 AS target_muatan,
        SUM(muatan_selesai)               AS muatan_selesai,
        SUM(usaha_tidak_ditemukan)        AS usaha_tidak_ditemukan,
        SUM(tidak_ditemukan)              AS keluarga_tidak_ditemukan,
        ROUND(100.0 * SUM(muatan_selesai)
          / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl
      ORDER BY pct_muatan ASC, muatan_selesai ASC
      LIMIT :limit
    `
  },

  pcl_detail_seorang: {
    description: 'Daftar seluruh SubSLS yang ditugaskan ke satu orang PCL tertentu',
    sql: `
      SELECT
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.pml, m.korlap,
        COALESCE(m.target_fasih, 0)       AS target_fasih,
        (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS realisasi_fasih,
        COALESCE(p.approved, 0)           AS approved,
        COALESCE(p.submitted_by_pcl, 0)   AS submitted,
        COALESCE(p.rejected, 0)           AS rejected,
        COALESCE(p.draft, 0)              AS draft,
        COALESCE(m.muatan, 0)             AS target_muatan,
        (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS muatan_selesai,
        ROUND(100.0 * (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))
          / NULLIF(m.target_fasih, 0), 2) AS pct_fasih
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE LOWER(m.pcl) LIKE LOWER(:pcl)
      ORDER BY pct_fasih ASC, m.desa, m.nama_sls
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  5. PERINGKAT & KINERJA PML (PENGAWAS)
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
        AND pml IS NOT NULL AND pml != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pml, kecamatan
      ORDER BY pct_fasih DESC
      LIMIT :limit
    `
  },

  pml_rejection_rate: {
    description: 'PML dengan tingkat penolakan (rejection) dokumen tertinggi',
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
        AND pml IS NOT NULL AND pml != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pml, kecamatan
      HAVING (SUM(submitted_total) + SUM(approved_total) + SUM(rejected_total)) > 0
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
  //  6. PERINGKAT & KINERJA KORLAP (KOORDINATOR)
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
        AND korlap IS NOT NULL AND korlap != ''
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
    description: 'PCL atau desa dengan kasus usaha_ganda terbanyak (indikasi duplikasi data)',
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
    description: 'PCL dengan rasio penolakan dokumen FASIH sangat tinggi',
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
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl, pml, korlap, kecamatan
      HAVING (SUM(submitted_total) + SUM(approved_total) + SUM(rejected_total)) > 0
      ORDER BY pct_rejected DESC
      LIMIT :limit
    `
  },

  anomali_tidak_ditemukan_tinggi: {
    description: 'PCL dengan jumlah usaha atau keluarga tidak ditemukan sangat tinggi',
    sql: `
      SELECT
        pcl, pml, korlap, kecamatan,
        SUM(usaha_tidak_ditemukan)        AS usaha_tidak_ditemukan,
        SUM(tidak_ditemukan)              AS keluarga_tidak_ditemukan,
        SUM(usaha_tidak_ditemukan + tidak_ditemukan) AS total_tidak_ditemukan,
        SUM(usaha_ditemukan + usaha_baru + ditemukan + keluarga_baru) AS total_terdata
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl, pml, korlap, kecamatan
      HAVING total_tidak_ditemukan > 0
      ORDER BY total_tidak_ditemukan DESC
      LIMIT :limit
    `
  },

  anomali_meninggal_tinggi: {
    description: 'SLS atau desa dengan angka kematian (meninggal) tinggi yang perlu verifikasi',
    sql: `
      SELECT
        kecamatan, desa, pcl, pml,
        SUM(meninggal)                    AS total_meninggal,
        SUM(keluarga_total)               AS total_keluarga,
        SUM(ditemukan)                    AS keluarga_ditemukan,
        ROUND(100.0 * SUM(meninggal) / NULLIF(SUM(keluarga_total), 0), 2) AS pct_meninggal
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND meninggal > 0
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa, pcl, pml
      ORDER BY total_meninggal DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  8. EARLY WARNING & RISIKO PERFORMA
  // ═══════════════════════════════════════════════════════════════

  early_warning_pcl_nol: {
    description: 'PCL yang capaiannya masih 0% sama sekali di upload terbaru',
    sql: `
      SELECT
        pcl, MAX(pml) AS pml, MAX(korlap) AS korlap, MAX(kecamatan) AS kecamatan,
        COUNT(*)                          AS total_sls,
        SUM(target_fasih_total)           AS target_fasih,
        SUM(draft_total)                  AS draft,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY pcl
      HAVING realisasi_fasih = 0 AND SUM(target_fasih_total) > 0
      ORDER BY target_fasih DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  9. PENCARIAN SPESIFIK (SLS / KODE / NAMA)
  // ═══════════════════════════════════════════════════════════════

  sls_detail_per_kode: {
    description: 'Informasi lengkap satu SubSLS berdasarkan kode wilayah (16 digit penuh atau prefix 14/10 digit)',
    sql: `
      SELECT
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.korlap, m.pml, m.pcl,
        COALESCE(m.target_fasih, 0) AS target_fasih,
        (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS realisasi_fasih,
        COALESCE(p.approved, 0) AS approved,
        COALESCE(p.submitted_by_pcl, 0) AS submitted,
        COALESCE(p.rejected, 0) AS rejected,
        COALESCE(p.draft, 0) AS draft,
        COALESCE(m.muatan, 0) AS target_muatan,
        (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) AS muatan_selesai,
        ROUND(100.0 * (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / NULLIF(m.target_fasih, 0), 2) AS pct_fasih
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE (m.kode = :kode OR m.kode LIKE :kode || '%')
      LIMIT 1
    `
  },


  sls_per_nama: {
    description: 'Cari SLS berdasarkan nama wilayah',
    sql: `
      SELECT
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.pcl, m.pml,
        COALESCE(m.target_fasih, 0) AS target_fasih_total,
        (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS realisasi_fasih,
        ROUND(100.0 * (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / NULLIF(m.target_fasih, 0), 2) AS pct_fasih
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE LOWER(m.nama_sls) LIKE LOWER(:nama_sls)
      ORDER BY m.kecamatan, m.desa
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
    description: 'Tren progres harian per kecamatan dari semua upload',
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
  },

  rata_rata_harian_petugas: {
    description: 'Menghitung rata-rata laju penambahan dokumen harian tertinggi per petugas (PCL/PML) sepanjang kegiatan sensus',
    sql: `
      SELECT 
        s.pcl, 
        MAX(s.pml) AS pml, 
        MAX(s.kecamatan) AS kecamatan,
        SUM(s.submitted_total + s.approved_total + s.rejected_total) AS total_realisasi,
        ROUND(CAST(SUM(s.submitted_total + s.approved_total + s.rejected_total) AS FLOAT) / 
          NULLIF((SELECT COUNT(DISTINCT tanggal) FROM uploads WHERE filename IS NULL OR filename NOT LIKE '%Imputasi%'), 0), 2) AS rata_rata_per_hari
      FROM summary_cache s
      WHERE s.upload_id = (SELECT MAX(id) FROM uploads)
        AND s.pcl IS NOT NULL AND s.pcl != ''
      GROUP BY s.pcl
      ORDER BY rata_rata_per_hari DESC
      LIMIT :limit
    `
  },

  penambahan_harian_terakhir_petugas: {
    description: 'Menghitung lonjakan penambahan progres dokumen riil per petugas (PCL) pada sesi upload terbaru dibanding upload hari sebelumnya',
    sql: `
      WITH latest_two AS (
        SELECT id, tanggal, ROW_NUMBER() OVER (ORDER BY tanggal DESC, id DESC) as rn
        FROM (SELECT MAX(id) AS id, tanggal FROM uploads WHERE filename IS NULL OR filename NOT LIKE '%Imputasi%' GROUP BY tanggal)
        LIMIT 2
      ),
      curr AS (
        SELECT pcl, MAX(pml) as pml, MAX(kecamatan) as kecamatan, SUM(submitted_total + approved_total + rejected_total) as selesai
        FROM summary_cache WHERE upload_id = (SELECT id FROM latest_two WHERE rn = 1)
        GROUP BY pcl
      ),
      prev AS (
        SELECT pcl, SUM(submitted_total + approved_total + rejected_total) as selesai
        FROM summary_cache WHERE upload_id = (SELECT id FROM latest_two WHERE rn = 2)
        GROUP BY pcl
      )
      SELECT 
        c.pcl, 
        c.pml,
        c.kecamatan,
        c.selesai AS realisasi_terbaru,
        COALESCE(p.selesai, 0) AS realisasi_sebelumnya,
        (c.selesai - COALESCE(p.selesai, 0)) AS penambahan_harian
      FROM curr c
      LEFT JOIN prev p ON c.pcl = p.pcl
      WHERE c.pcl IS NOT NULL AND c.pcl != ''
      ORDER BY penambahan_harian DESC
      LIMIT :limit
    `
  },

  // ═══════════════════════════════════════════════════════════════
  //  11. ANALITIK LANJUTAN & PROYEKSI PENYELESAIAN
  // ═══════════════════════════════════════════════════════════════

  kecepatan_dan_proyeksi_selesai_petugas: {
    description: 'Menghitung laju harian rata-rata, sisa target dokumen, dan estimasi sisa hari kerja hingga PCL selesai',
    sql: `
      SELECT 
        s.pcl, 
        MAX(s.pml) AS pml, 
        MAX(s.kecamatan) AS kecamatan,
        SUM(s.target_fasih_total) AS target_fasih,
        SUM(s.submitted_total + s.approved_total + s.rejected_total) AS realisasi_fasih,
        (SUM(s.target_fasih_total) - SUM(s.submitted_total + s.approved_total + s.rejected_total)) AS sisa_target,
        ROUND(CAST(SUM(s.submitted_total + s.approved_total + s.rejected_total) AS FLOAT) / 
          NULLIF((SELECT COUNT(DISTINCT tanggal) FROM uploads WHERE filename IS NULL OR filename NOT LIKE '%Imputasi%'), 0), 2) AS laju_harian,
        ROUND(CAST((SUM(s.target_fasih_total) - SUM(s.submitted_total + s.approved_total + s.rejected_total)) AS FLOAT) / 
          NULLIF(CAST(SUM(s.submitted_total + s.approved_total + s.rejected_total) AS FLOAT) / 
            NULLIF((SELECT COUNT(DISTINCT tanggal) FROM uploads WHERE filename IS NULL OR filename NOT LIKE '%Imputasi%'), 0), 0), 1) AS estimasi_sisa_hari
      FROM summary_cache s
      WHERE s.upload_id = :uploadId
        AND s.pcl IS NOT NULL AND s.pcl != ''
      GROUP BY s.pcl
      ORDER BY estimasi_sisa_hari DESC
      LIMIT :limit
    `
  },

  pml_approval_backlog: {
    description: 'PML dengan antrian dokumen submitted yang menumpuk di meja pengawas belum diapprove/direview',
    sql: `
      SELECT 
        pml, kecamatan,
        COUNT(DISTINCT pcl) AS jumlah_pcl,
        SUM(submitted_total) AS dokumen_menunggu_approval,
        SUM(approved_total) AS dokumen_approved,
        SUM(rejected_total) AS dokumen_rejected,
        SUM(submitted_total + approved_total + rejected_total) AS total_realisasi,
        ROUND(100.0 * SUM(submitted_total) / 
          NULLIF(SUM(submitted_total + approved_total + rejected_total), 0), 2) AS pct_antrian_submitted
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pml IS NOT NULL AND pml != ''
      GROUP BY pml, kecamatan
      HAVING dokumen_menunggu_approval > 0
      ORDER BY dokumen_menunggu_approval DESC
      LIMIT :limit
    `
  },

  pcl_beban_kerja: {
    description: 'Distribusi beban kerja PCL: total SLS yang dipegang, target muatan, dan target dokumen FASIH',
    sql: `
      SELECT 
        pcl, MAX(pml) AS pml, MAX(kecamatan) AS kecamatan,
        COUNT(*) AS total_sls_dipegang,
        SUM(total_muatan) AS total_target_muatan,
        SUM(target_fasih_total) AS total_target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total) / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND pcl IS NOT NULL AND pcl != ''
      GROUP BY pcl
      ORDER BY total_target_fasih DESC
      LIMIT :limit
    `
  },

  desa_capaian_tertinggi_dan_terendah: {
    description: 'Peringkat desa/kelurahan berdasarkan persentase capaian FASIH',
    sql: `
      SELECT 
        kecamatan, desa,
        COUNT(*) AS total_sls,
        SUM(target_fasih_total) AS target_fasih,
        SUM(submitted_total + approved_total + rejected_total) AS realisasi_fasih,
        ROUND(100.0 * SUM(submitted_total + approved_total + rejected_total) / NULLIF(SUM(target_fasih_total), 0), 2) AS pct_fasih,
        SUM(total_muatan) AS target_muatan,
        SUM(muatan_selesai) AS muatan_selesai,
        ROUND(100.0 * SUM(muatan_selesai) / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa
      ORDER BY pct_fasih DESC
      LIMIT :limit
    `
  },

  sls_selesai_tuntas: {
    description: 'Daftar SubSLS yang sudah selesai 100% (dokumen approved mencapai target FASIH)',
    sql: `
      SELECT 
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.pcl, m.pml, m.korlap,
        COALESCE(m.target_fasih, 0) AS target_fasih_total,
        COALESCE(p.approved, 0) AS approved_total,
        COALESCE(p.submitted_by_pcl, 0) AS submitted_total,
        COALESCE(p.rejected, 0) AS rejected_total
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE COALESCE(p.approved, 0) >= COALESCE(m.target_fasih, 0)
        AND COALESCE(m.target_fasih, 0) > 0
        AND (:kecamatan IS NULL OR LOWER(m.kecamatan) = LOWER(:kecamatan))
      ORDER BY m.kecamatan, m.desa, m.nama_sls
      LIMIT :limit
    `
  },

  sls_sisa_terbanyak_prioritas: {
    description: 'SubSLS prioritas yang memiliki sisa dokumen FASIH terbanyak yang belum selesai',
    sql: `
      SELECT 
        m.kode, m.kecamatan, m.desa, m.nama_sls, m.pcl, m.pml, m.korlap,
        COALESCE(m.target_fasih, 0) AS target_fasih_total,
        (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS realisasi_fasih,
        (COALESCE(m.target_fasih, 0) - (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) AS sisa_dokumen,
        COALESCE(p.draft, 0) AS draft_total
      FROM subsls_master m
      LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = :uploadId
      WHERE (COALESCE(m.target_fasih, 0) - (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0))) > 0
        AND (:kecamatan IS NULL OR LOWER(m.kecamatan) = LOWER(:kecamatan))
      ORDER BY sisa_dokumen DESC
      LIMIT :limit
    `
  },

  korelasi_cuaca_dan_progres: {
    description: 'Menganalisis perbandingan capaian penambahan harian dengan kondisi cuaca, suhu, dan kelembaban pada setiap tanggal upload',
    sql: `
      SELECT 
        u.tanggal,
        w.temp AS suhu_celcius,
        w.humidity AS kelembaban_persen,
        CASE 
          WHEN w.code = 0 THEN 'Cerah'
          WHEN w.code IN (1, 2) THEN 'Cerah Berawan'
          WHEN w.code = 3 THEN 'Berawan'
          WHEN w.code IN (45, 48) THEN 'Kabut'
          WHEN w.code IN (51, 53, 55, 61, 63) THEN 'Hujan Ringan / Gerimis'
          WHEN w.code IN (65, 80, 81, 82) THEN 'Hujan'
          WHEN w.code >= 95 THEN 'Hujan Badai'
          ELSE 'Normal'
        END AS kondisi_cuaca,
        SUM(s.submitted_total + s.approved_total + s.rejected_total) AS akumulasi_fasih
      FROM uploads u
      LEFT JOIN weather_history w ON u.tanggal = w.tanggal
      LEFT JOIN summary_cache s ON u.id = s.upload_id
      WHERE (u.filename IS NULL OR u.filename NOT LIKE '%Imputasi%')
      GROUP BY u.id, u.tanggal
      ORDER BY u.tanggal DESC
      LIMIT 15
    `
  },

  rekap_jenis_bangunan: {
    description: 'Komposisi jenis tempat tinggal/bangunan sensus (rumah tunggal, deret, susun, apartemen, lainnya) per kecamatan',
    sql: `
      SELECT 
        kecamatan,
        SUM(rumah_tunggal) AS rumah_tunggal,
        SUM(rumah_deret) AS rumah_deret,
        SUM(rumah_susun) AS rumah_susun,
        SUM(apartemen) AS apartemen,
        SUM(lainnya) AS lainnya,
        SUM(rumah_tunggal + rumah_deret + rumah_susun + apartemen + lainnya) AS total_bangunan
      FROM summary_cache
      WHERE upload_id = :uploadId
      GROUP BY kecamatan
      ORDER BY total_bangunan DESC
    `
  },

  rasio_usaha_dan_keluarga_baru: {
    description: 'Daerah atau petugas dengan temuan usaha baru atau keluarga baru terbanyak',
    sql: `
      SELECT 
        kecamatan, desa,
        SUM(usaha_ditemukan) AS usaha_ditemukan,
        SUM(usaha_baru) AS usaha_baru,
        ROUND(100.0 * SUM(usaha_baru) / NULLIF(SUM(usaha_ditemukan + usaha_baru), 0), 2) AS pct_usaha_baru,
        SUM(ditemukan) AS keluarga_ditemukan,
        SUM(keluarga_baru) AS keluarga_baru,
        ROUND(100.0 * SUM(keluarga_baru) / NULLIF(SUM(ditemukan + keluarga_baru), 0), 2) AS pct_keluarga_baru
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa
      ORDER BY usaha_baru DESC
      LIMIT :limit
    `
  },

  tren_harian_per_status: {
    description: 'Tren pergerakan harian rincian status dokumen FASIH (draft, submitted, approved, rejected) se-kabupaten',
    sql: `
      SELECT 
        u.tanggal,
        u.id AS upload_id,
        SUM(s.draft_total) AS total_draft,
        SUM(s.submitted_total) AS total_submitted,
        SUM(s.approved_total) AS total_approved,
        SUM(s.rejected_total) AS total_rejected,
        SUM(s.submitted_total + s.approved_total + s.rejected_total) AS total_realisasi
      FROM summary_cache s
      JOIN uploads u ON u.id = s.upload_id
      GROUP BY u.id, u.tanggal
      ORDER BY u.tanggal DESC
      LIMIT 15
    `
  },

  dinamika_usaha_tutup_dan_ganda: {
    description: 'Peringkat kecamatan/desa dengan angka usaha tutup atau usaha ganda tertinggi',
    sql: `
      SELECT 
        kecamatan, desa,
        SUM(usaha_tutup) AS total_usaha_tutup,
        SUM(usaha_ganda) AS total_usaha_ganda,
        SUM(usaha_ditemukan + usaha_baru) AS total_usaha_aktif,
        ROUND(100.0 * SUM(usaha_tutup) / NULLIF(SUM(usaha_ditemukan + usaha_baru + usaha_tutup), 0), 2) AS pct_usaha_tutup
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa
      HAVING (total_usaha_tutup + total_usaha_ganda) > 0
      ORDER BY total_usaha_tutup DESC, total_usaha_ganda DESC
      LIMIT :limit
    `
  },

  petugas_stagnan_update_terakhir: {
    description: 'Daftar PCL yang tidak mengalami penambahan dokumen (selisih = 0) pada sesi upload terbaru dibanding upload sebelumnya',
    sql: `
      WITH latest_two AS (
        SELECT id, tanggal, ROW_NUMBER() OVER (ORDER BY tanggal DESC, id DESC) as rn
        FROM (SELECT MAX(id) AS id, tanggal FROM uploads WHERE filename IS NULL OR filename NOT LIKE '%Imputasi%' GROUP BY tanggal)
        LIMIT 2
      ),
      curr AS (
        SELECT pcl, MAX(pml) as pml, MAX(kecamatan) as kecamatan, SUM(submitted_total + approved_total + rejected_total) as selesai,
               SUM(target_fasih_total) as target_fasih
        FROM summary_cache WHERE upload_id = (SELECT id FROM latest_two WHERE rn = 1)
        GROUP BY pcl
      ),
      prev AS (
        SELECT pcl, SUM(submitted_total + approved_total + rejected_total) as selesai
        FROM summary_cache WHERE upload_id = (SELECT id FROM latest_two WHERE rn = 2)
        GROUP BY pcl
      )
      SELECT 
        c.pcl, 
        c.pml, 
        c.kecamatan,
        c.selesai AS realisasi_sekarang,
        c.target_fasih AS target_dokumen,
        (c.target_fasih - c.selesai) AS sisa_dokumen,
        (c.selesai - COALESCE(p.selesai, 0)) AS delta_penambahan
      FROM curr c
      LEFT JOIN prev p ON c.pcl = p.pcl
      WHERE (c.selesai - COALESCE(p.selesai, 0)) <= 0
        AND c.selesai < c.target_fasih
        AND c.pcl IS NOT NULL AND c.pcl != ''
      ORDER BY sisa_dokumen DESC
      LIMIT :limit
    `
  },

  ringkasan_muatan_per_desa: {
    description: 'Rincian target vs realisasi muatan (usaha + keluarga) per desa',
    sql: `
      SELECT 
        kecamatan, desa,
        SUM(total_muatan) AS target_muatan,
        SUM(muatan_selesai) AS muatan_selesai,
        (SUM(total_muatan) - SUM(muatan_selesai)) AS sisa_muatan,
        ROUND(100.0 * SUM(muatan_selesai) / NULLIF(SUM(total_muatan), 0), 2) AS pct_muatan
      FROM summary_cache
      WHERE upload_id = :uploadId
        AND (:kecamatan IS NULL OR LOWER(kecamatan) = LOWER(:kecamatan))
      GROUP BY kecamatan, desa
      ORDER BY pct_muatan ASC
      LIMIT :limit
    `
  }

};

module.exports = { QUERY_HINTS };