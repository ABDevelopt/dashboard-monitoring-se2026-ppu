const express = require('express');
const router = express.Router();
const { getDb, getSettings, getTargetFormula } = require('../database');

router.get('/', (req, res) => {
const uploadId = res.locals.uploadId;
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';

  // Get recent 5 distinct upload dates for daily progress tracking (hanya upload riil pengguna)
  const recentUploads = getDb().prepare(`
    SELECT id, tanggal 
    FROM (
      SELECT MAX(id) AS id, tanggal 
      FROM uploads 
      WHERE (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%')
      GROUP BY tanggal 
      ORDER BY tanggal DESC 
      LIMIT 5
    ) 
    ORDER BY tanggal ASC
  `).all();

  // Attach weather details and session_count to each upload day
  recentUploads.forEach(u => {
    const weather = getDb().prepare('SELECT temp, code, humidity FROM weather_history WHERE tanggal = ?').get(u.tanggal);
    u.weather = weather || null;
    const countStmt = getDb().prepare(`
      SELECT COUNT(*) AS cnt 
      FROM uploads 
      WHERE (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%')
        AND tanggal = ?
    `).get(u.tanggal);
    u.session_count = countStmt ? countStmt.cnt : 1;
  });


  let harianStats = [];
  if (uploadId && recentUploads.length > 0) {
    let selectParts = [];
    let joinParts = [];
    let queryParams = [];
    const settings = res.locals.settings;

    // Check if there is a previous upload before the first of the 5 recent uploads (hanya upload riil pengguna)
    const prevUploadOfFirst = getDb().prepare(`
      SELECT MAX(id) AS id, tanggal 
      FROM uploads 
      WHERE (filename IS NULL OR filename NOT LIKE '%Imputasi Otomatis%')
        AND tanggal < ? 
      ORDER BY tanggal DESC, id DESC 
      LIMIT 1
    `).get(recentUploads[0].tanggal);

    if (prevUploadOfFirst) {
      selectParts.push(`
        SUM(CASE WHEN p_prev_first.upload_id IS NOT NULL 
          THEN (COALESCE(p_prev_first.submitted_by_pcl, 0) + COALESCE(p_prev_first.approved, 0) + COALESCE(p_prev_first.rejected, 0)) 
          ELSE 0 END) AS realisasi_baseline
      `);
      joinParts.push(`
        LEFT JOIN progres p_prev_first ON m.kode = p_prev_first.kode AND p_prev_first.upload_id = ?
      `);
      queryParams.push(prevUploadOfFirst.id);
    } else {
      selectParts.push(`0 AS realisasi_baseline`);
    }

    recentUploads.forEach((u, i) => {
      const targetFormula = getTargetFormula(settings.target_fasih_mode, `p${i}`);

      selectParts.push(`
        SUM(CASE WHEN p${i}.upload_id IS NOT NULL 
          THEN (COALESCE(p${i}.submitted_by_pcl, 0) + COALESCE(p${i}.approved, 0) + COALESCE(p${i}.rejected, 0)) 
          ELSE 0 END) AS realisasi_${i},
        SUM(
          CASE WHEN p${i}.upload_id IS NOT NULL 
          THEN ${targetFormula}
          ELSE COALESCE(m.target_fasih, 0) END
        ) AS target_${i},
        SUM(
          CASE WHEN p${i}.upload_id IS NOT NULL 
          THEN COALESCE(m.target_fasih, 0)
          ELSE COALESCE(m.target_fasih, 0) END
        ) AS target_static_${i},
        SUM(
          CASE WHEN p${i}.upload_id IS NOT NULL 
          THEN COALESCE(p${i}.target_upload, 0)
          ELSE 0 END
        ) AS target_upload_${i}
      `);
      joinParts.push(`
        LEFT JOIN progres p${i} ON m.kode = p${i}.kode AND p${i}.upload_id = ?
      `);
      queryParams.push(u.id);
    });

    let where = "WHERE m.pcl IS NOT NULL AND m.pcl != ''";

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
    
    // Format list fields with space padding and calculate daily document additions
    harianStats.forEach(row => {
      if (row.wilayah_kerja) {
        row.wilayah_kerja = row.wilayah_kerja.split(',').join(', ');
      }
      if (row.desa) {
        row.desa = row.desa.split(',').join(', ');
      }
      // Calculate daily increment & total documents per day
      recentUploads.forEach((u, i) => {
        const real = row['realisasi_' + i] || 0;
        const prevReal = i > 0 ? (row['realisasi_' + (i - 1)] || 0) : (row.realisasi_baseline || 0);
        const inc = real - prevReal;
        row['inc_' + i] = inc;
        row['real_' + i] = real;
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
