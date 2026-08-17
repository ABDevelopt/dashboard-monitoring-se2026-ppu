const express = require('express');
const router = express.Router();
const { getDb, getSettings, getTargetFormula } = require('../database');

router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  const surveyId = res.locals.activeSurvey || 'se2026';
  const db = getDb(surveyId);
  const filterKec = req.query.kec || '';
  const filterKorlap = req.query.korlap || '';
  const filterPml = req.query.pml || '';

  // Get recent 5 distinct upload dates for daily progress tracking (hanya upload riil pengguna)
  const recentUploads = db.prepare(`
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
    const weather = db.prepare('SELECT temp, code, humidity FROM weather_history WHERE tanggal = ?').get(u.tanggal);
    u.weather = weather || null;
    const countStmt = db.prepare(`
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
    const prevUploadOfFirst = db.prepare(`
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
        ) AS target_${i}
      `);
      joinParts.push(`
        LEFT JOIN progres p${i} ON m.kode = p${i}.kode AND p${i}.upload_id = ?
      `);
      queryParams.push(u.id);
    });

    let whereConditions = [];
    if (filterKec) {
      whereConditions.push('m.kecamatan = ?');
      queryParams.push(filterKec);
    }
    if (filterKorlap) {
      whereConditions.push('m.korlap = ?');
      queryParams.push(filterKorlap);
    }
    if (filterPml) {
      whereConditions.push('m.pml = ?');
      queryParams.push(filterPml);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const query = `
      SELECT 
        COALESCE(p${recentUploads.length - 1}.pcl_name, m.pcl) AS pcl,
        m.pml,
        m.korlap,
        GROUP_CONCAT(DISTINCT m.kecamatan) AS wilayah_kerja,
        GROUP_CONCAT(DISTINCT m.desa) AS desa,
        COUNT(DISTINCT m.kode) AS total_subsls,
        ${selectParts.join(', ')}
      FROM subsls_master m
      ${joinParts.join('\n')}
      ${whereClause}
      GROUP BY COALESCE(p${recentUploads.length - 1}.pcl_name, m.pcl), m.pml, m.korlap
      ORDER BY pcl ASC
    `;

    harianStats = db.prepare(query).all(...queryParams);
    
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
  const kecList = db.prepare('SELECT DISTINCT kecamatan FROM subsls_master ORDER BY kecamatan').all();
  const korlapList = db.prepare('SELECT DISTINCT korlap FROM subsls_master ORDER BY korlap').all();
  const pmlList = db.prepare('SELECT DISTINCT pml FROM subsls_master ORDER BY pml').all();

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
