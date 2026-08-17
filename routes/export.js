const express = require('express');
const router = express.Router();
const { 
  getDb, 
  getAllUploads, 
  getSettings,
  getTargetFormula,
  getRealizationFormula,
  getAdaptiveMuatanFormula,
  getUsahaTotalFormula,
  getKeluargaTotalFormula
} = require('../database');

// GET /export - Halaman Utama Ekspor Terpadu
router.get('/', (req, res) => {
const settings = res.locals.settings || getSettings();
  if (settings.page_export === '0') {
    return res.status(403).render('error', {
      title: 'Fitur Dinonaktifkan',
      message: 'Halaman ekspor data sedang dinonaktifkan oleh Administrator.',
      activePage: ''
    });
  }

  try {
    const db = getDb();
    const uploads = getAllUploads().sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    const kecList = db.prepare("SELECT DISTINCT kecamatan FROM subsls_master WHERE kecamatan IS NOT NULL AND kecamatan != '' ORDER BY kecamatan").all().map(r => r.kecamatan);
    const korlapList = db.prepare("SELECT DISTINCT korlap FROM subsls_master WHERE korlap IS NOT NULL AND korlap != '' ORDER BY korlap").all().map(r => r.korlap);
    const pmlList = db.prepare("SELECT DISTINCT pml FROM subsls_master WHERE pml IS NOT NULL AND pml != '' ORDER BY pml").all().map(r => r.pml);
    const pclList = db.prepare("SELECT DISTINCT pcl FROM subsls_master WHERE pcl IS NOT NULL AND pcl != '' ORDER BY pcl").all().map(r => r.pcl);

    res.render('export', {
      title: 'Ekspor Data Terpadu',
      activePage: 'export',
      uploads,
      kecList,
      korlapList,
      pmlList,
      pclList
    });
  } catch (err) {
    console.error('Error rendering export page:', err);
    res.status(500).render('error', {
      title: 'Server Error',
      message: 'Terjadi kesalahan saat memuat halaman ekspor: ' + err.message,
      activePage: ''
    });
  }
});

// GET /export/desa-list - Mendapatkan daftar desa berdasarkan kecamatan (AJAX helper)
router.get('/desa-list', (req, res) => {
  const kec = req.query.kec || '';
  if (!kec) return res.json([]);
  try {
    const db = getDb();
    const desaList = db.prepare("SELECT DISTINCT desa FROM subsls_master WHERE kecamatan = ? AND desa IS NOT NULL AND desa != '' ORDER BY desa").all(kec).map(r => r.desa);
    res.json(desaList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /export/data - API data terfilter untuk live preview & ekspor berkas
router.get('/data', (req, res) => {
  let uploadId = req.query.uploadId;
  const selectedDate = req.query.date;

  const dataset = req.query.dataset || 'subsls';
  const kec = req.query.kec || '';
  const desa = req.query.desa || '';
  const korlap = req.query.korlap || '';
  const pml = req.query.pml || '';
  const pcl = req.query.pcl || '';
  const status = req.query.status || '';
  const scope = req.query.scope || 'all'; // all, assignment, fasih, muatan
  const limit = req.query.limit ? parseInt(req.query.limit) : null;

  try {
    const db = getDb();

    if (selectedDate) {
      const upload = db.prepare('SELECT id FROM uploads WHERE tanggal <= ? ORDER BY tanggal DESC, id DESC LIMIT 1').get(selectedDate);
      if (!upload) {
        return res.status(404).json({ error: 'Tidak ada data upload pada atau sebelum tanggal yang dipilih.' });
      }
      uploadId = upload.id;
    }

    if (!uploadId) {
      return res.status(400).json({ error: 'Upload ID atau tanggal wajib dipilih.' });
    }

    const settings = getSettings();

    const targetFormula = getTargetFormula(settings.target_fasih_mode);
    const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
    const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
    const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
    const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

    // Build conditions
    let cond = ['1=1'];
    let params = [];

    if (kec) { cond.push('UPPER(TRIM(m.kecamatan)) = UPPER(TRIM(?))'); params.push(kec); }
    if (desa) { cond.push('UPPER(TRIM(m.desa)) = UPPER(TRIM(?))'); params.push(desa); }
    if (korlap) { cond.push('UPPER(TRIM(m.korlap)) = UPPER(TRIM(?))'); params.push(korlap); }
    if (pml) { cond.push('UPPER(TRIM(m.pml)) = UPPER(TRIM(?))'); params.push(pml); }
    if (pcl) {
      cond.push('(UPPER(TRIM(m.pcl)) = UPPER(TRIM(?)) OR UPPER(TRIM(p.pcl_name)) = UPPER(TRIM(?)) OR UPPER(TRIM(p.pcl_email)) = UPPER(TRIM(?)))');
      params.push(pcl, pcl, pcl);
    }

    if (status) {
      if (status === 'belum_mulai') {
        cond.push('(p.kode IS NULL OR (COALESCE(p.sls_selesai, 0) = 0 AND COALESCE(p.draft, 0) = 0 AND COALESCE(p.submitted_by_pcl, 0) = 0 AND COALESCE(p.approved, 0) = 0 AND COALESCE(p.rejected, 0) = 0))');
      } else if (status === 'sedang_didata') {
        cond.push('(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 0 AND (COALESCE(p.draft, 0) > 0 OR COALESCE(p.submitted_by_pcl, 0) > 0 OR COALESCE(p.approved, 0) > 0 OR COALESCE(p.rejected, 0) > 0))');
      } else if (status === 'memenuhi_target' || status === 'melebihi_target') {
        cond.push('(p.kode IS NOT NULL AND COALESCE(p.sls_selesai, 0) = 1)');
      }
    }

    const whereClause = cond.join(' AND ');

    let selectFields = [];

    if (dataset === 'subsls') {
      // Identitas SLS dasar
      selectFields.push(
        'm.kode AS "Kode SLS"',
        'm.kecamatan AS "Kecamatan"',
        'm.desa AS "Desa/Kelurahan"',
        'm.nama_sls AS "Nama SLS"',
        'm.korlap AS "Koordinator Lapangan"',
        'm.pml AS "PML (Pengawas)"',
        'm.pcl AS "PCL (Pencacah)"'
      );

      // Fasih-related
      if (scope === 'all' || scope === 'assignment' || scope === 'fasih') {
        if (scope === 'all' || scope === 'fasih') {
          selectFields.push('m.target_fasih AS "Target Fasih Awal"');
        }
        selectFields.push(
          `${targetFormula} AS "Target FASIH"`,
          'COALESCE(p.draft, 0) AS "FASIH Draft"',
          'COALESCE(p.submitted_by_pcl, 0) AS "FASIH Submitted"',
          'COALESCE(p.approved, 0) AS "FASIH Approved"',
          'COALESCE(p.rejected, 0) AS "FASIH Rejected"',
          `CASE WHEN ${targetFormula} > 0 THEN ROUND(100.0 * (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / (${targetFormula}), 2) ELSE 0.0 END AS "Capaian FASIH (%)"`
        );
        if (scope === 'all' || scope === 'fasih') {
          selectFields.push(
            'COALESCE(m.target_fasih, 0) AS "Target Static"',
            'COALESCE(p.target_upload, 0) AS "Target Upload"'
          );
        }
      }

      // Muatan-related
      if (scope === 'all' || scope === 'muatan') {
        selectFields.push(
          `${targetMuatanFormula} AS "Target Muatan"`,
          `${realFormula} AS "Realisasi Muatan"`,
          `CASE WHEN ${targetMuatanFormula} > 0 THEN ROUND(100.0 * (${realFormula}) / (${targetMuatanFormula}), 2) ELSE 0.0 END AS "Capaian Muatan (%)"`,
          `${usahaTotalFormula} AS "Total Usaha"`,
          'COALESCE(p.usaha_ditemukan, 0) AS "Usaha Ditemukan"',
          'COALESCE(p.usaha_baru, 0) AS "Usaha Baru"',
          'COALESCE(p.usaha_tidak_ditemukan, 0) AS "Usaha Tidak Ditemukan"',
          'COALESCE(p.usaha_tutup, 0) AS "Usaha Tutup"',
          'COALESCE(p.usaha_ganda, 0) AS "Usaha Ganda"',
          `${keluargaTotalFormula} AS "Total Keluarga"`,
          'COALESCE(p.ditemukan, 0) AS "Keluarga Ditemukan"',
          'COALESCE(p.keluarga_baru, 0) AS "Keluarga Baru"',
          'COALESCE(p.tidak_ditemukan, 0) AS "Keluarga Tidak Ditemukan"',
          'COALESCE(p.meninggal, 0) AS "Keluarga Meninggal"',
          'COALESCE(p.tidak_eligible, 0) AS "Keluarga Tidak Eligible"',
          'COALESCE(p.tidak_dapat_ditemui, 0) AS "Keluarga Tidak Dapat Ditemui"'
        );
      }

      // Status progres SLS
      if (scope === 'all') {
        selectFields.push(`
          CASE 
            WHEN COALESCE(p.sls_selesai, 0) = 1 THEN 'Selesai'
            WHEN p.kode IS NOT NULL AND (
              COALESCE(p.draft, 0) > 0 OR 
              COALESCE(p.submitted_by_pcl, 0) > 0 OR 
              COALESCE(p.approved, 0) > 0 OR 
              COALESCE(p.rejected, 0) > 0
            ) THEN 'Sedang Didata'
            ELSE 'Belum Mulai'
          END AS "Status Progres"
        `);
      }

      const limitSql = limit ? `LIMIT ${limit}` : '';
      const dataQuery = `
        SELECT ${selectFields.join(', ')}
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE ${whereClause}
        ORDER BY m.kecamatan, m.desa, m.kode
        ${limitSql}
      `;

      const totalQuery = `
        SELECT COUNT(*) as count
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE ${whereClause}
      `;

      const rows = db.prepare(dataQuery).all(uploadId, ...params);
      const total = db.prepare(totalQuery).get(uploadId, ...params).count;

      res.json({ success: true, rows, total });
    } else {
      // Dataset Petugas (Grouped by PCL, PML, Korlap)
      selectFields.push(
        'm.pcl AS "Nama PCL"',
        'm.pml AS "PML (Pengawas)"',
        'm.korlap AS "Korlap (Koordinator)"',
        'm.kecamatan AS "Kecamatan"',
        'COUNT(m.kode) AS "Total Sub-SLS"'
      );

      if (scope === 'all' || scope === 'assignment' || scope === 'fasih') {
        selectFields.push(
          `SUM(${targetFormula}) AS "Target FASIH"`,
          'SUM(COALESCE(p.draft, 0)) AS "FASIH Draft"',
          'SUM(COALESCE(p.submitted_by_pcl, 0)) AS "FASIH Submitted"',
          'SUM(COALESCE(p.approved, 0)) AS "FASIH Approved"',
          'SUM(COALESCE(p.rejected, 0)) AS "FASIH Rejected"',
          `CASE WHEN SUM(${targetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${targetFormula}), 2) ELSE 0.0 END AS "Capaian FASIH (%)"`
        );
      }

      if (scope === 'all' || scope === 'muatan') {
        selectFields.push(
          `SUM(${targetMuatanFormula}) AS "Target Muatan"`,
          `SUM(${realFormula}) AS "Realisasi Muatan"`,
          `CASE WHEN SUM(${targetMuatanFormula}) > 0 THEN ROUND(100.0 * SUM(${realFormula}) / SUM(${targetMuatanFormula}), 2) ELSE 0.0 END AS "Capaian Muatan (%)"`
        );
      }

      const limitSql = limit ? `LIMIT ${limit}` : '';
      const dataQuery = `
        SELECT ${selectFields.join(', ')}
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE ${whereClause}
        GROUP BY m.pcl, m.pml, m.korlap, m.kecamatan
        ORDER BY m.kecamatan, m.korlap, m.pml, m.pcl
        ${limitSql}
      `;

      const totalQuery = `
        SELECT COUNT(DISTINCT m.pcl || '_' || m.pml || '_' || m.korlap || '_' || m.kecamatan) as count
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE ${whereClause}
      `;

      const rows = db.prepare(dataQuery).all(uploadId, ...params);
      const total = db.prepare(totalQuery).get(uploadId, ...params).count;

      res.json({ success: true, rows, total });
    }
  } catch (err) {
    console.error('Error fetching export data:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
