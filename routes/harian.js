const express = require('express');
const router = express.Router();
const { getDb, getSettings } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';

  // Get recent 5 uploads for daily progress tracking
  const recentUploads = getDb().prepare(`
    SELECT id, tanggal 
    FROM uploads 
    ORDER BY tanggal DESC 
    LIMIT 5
  `).all();
  recentUploads.reverse(); // Chronological order (oldest to newest)

  // Attach weather details to each upload day
  recentUploads.forEach(u => {
    const weather = getDb().prepare('SELECT temp, code, humidity FROM weather_history WHERE tanggal = ?').get(u.tanggal);
    u.weather = weather || null;
  });


  let harianStats = [];
  if (uploadId && recentUploads.length > 0) {
    let selectParts = [];
    let joinParts = [];
    const settings = getSettings();
    const isStatic = settings.target_fasih_mode === 'static';

    recentUploads.forEach((u, i) => {
      const targetFormula = isStatic
        ? 'COALESCE(m.target_fasih, 0)'
        : `CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p${i}.usaha_baru, 0) + COALESCE(p${i}.keluarga_baru, 0) - COALESCE(p${i}.usaha_tutup, 0) - COALESCE(p${i}.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p${i}.usaha_baru, 0) + COALESCE(p${i}.keluarga_baru, 0) - COALESCE(p${i}.usaha_tutup, 0) - COALESCE(p${i}.tidak_ditemukan, 0)) END`;

      selectParts.push(`
        SUM(CASE WHEN p${i}.upload_id IS NOT NULL 
          THEN (COALESCE(p${i}.submitted_by_pcl, 0) + COALESCE(p${i}.approved, 0) + COALESCE(p${i}.rejected, 0)) 
          ELSE 0 END) AS realisasi_${i},
        SUM(
          CASE WHEN p${i}.upload_id IS NOT NULL 
          THEN ${targetFormula}
          ELSE COALESCE(m.target_fasih, 0) END
        ) AS target_${i}
      `);
      joinParts.push(`
        LEFT JOIN progres p${i} ON m.kode = p${i}.kode AND p${i}.upload_id = ?
      `);
    });

    let where = "WHERE m.pcl IS NOT NULL AND m.pcl != ''";
    const queryParams = [];
    recentUploads.forEach(u => queryParams.push(u.id));

    if (filterKec) { where += ' AND m.kecamatan = ?'; queryParams.push(filterKec); }
    if (filterKorlap) { where += ' AND m.korlap = ?'; queryParams.push(filterKorlap); }
    if (filterPml) { where += ' AND m.pml = ?'; queryParams.push(filterPml); }

    const harianStatsQuery = `
      SELECT 
        m.pcl AS nama_petugas,
        m.pml AS nama_pml,
        m.kecamatan AS kecamatan,
        GROUP_CONCAT(DISTINCT m.desa) AS desa,
        GROUP_CONCAT(DISTINCT m.nama_sls) AS wilayah_kerja,
        ${selectParts.join(',\n')}
      FROM subsls_master m
      ${joinParts.join('\n')}
      ${where}
      GROUP BY m.pcl, m.pml, m.kecamatan
      ORDER BY m.pcl ASC
    `;

    harianStats = getDb().prepare(harianStatsQuery).all(...queryParams);
    
    // Format list fields with space padding
    harianStats.forEach(row => {
      if (row.wilayah_kerja) {
        row.wilayah_kerja = row.wilayah_kerja.split(',').join(', ');
      }
      if (row.desa) {
        row.desa = row.desa.split(',').join(', ');
      }
      // Centralized daily progress percentage calculation
      recentUploads.forEach((u, i) => {
        const real = row['realisasi_' + i] || 0;
        const target = row['target_' + i] || 0;
        row['pct_' + i] = target > 0 ? parseFloat(((100 * real) / target).toFixed(2)) : 0.0;
        row['pct_str_' + i] = target > 0 ? ((100 * real) / target).toFixed(2) : '0.00';
      });
    });
  }

  // Dropdown filter lists
  const kecList = getDb().prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = getDb().prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = getDb().prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

  res.render('harian', {
    title: 'Progres Harian Petugas',
    activePage: 'harian',
    filterKec,
    filterKorlap,
    filterPml,
    kecList,
    korlapList,
    pmlList,
    recentUploads,
    harianStats
  });
});

module.exports = router;
