const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { getPmlStats, getDb, getSettings, attachProgressPercentages, getAllUploads } = require('../database');

// Date Formatting Helpers
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const day = d.getDate();
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const month = months[d.getMonth()];
  return `${day} ${month} ${d.getFullYear()}`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const month = months[d.getMonth()];
  return `${day} ${month}`;
}

// Helper to compile report data for both HTML and Excel
function getReportData(selectedUploadIds, filterPml) {
  const db = getDb();
  
  // 1. Get the list of selected uploads
  let uploads = [];
  if (selectedUploadIds && selectedUploadIds.length > 0) {
    const placeholders = selectedUploadIds.map(() => '?').join(',');
    uploads = db.prepare(`SELECT id, tanggal FROM uploads WHERE id IN (${placeholders}) ORDER BY tanggal ASC`).all(...selectedUploadIds);
  } else {
    // Default to last 6 uploads
    uploads = db.prepare('SELECT id, tanggal FROM uploads ORDER BY tanggal DESC LIMIT 6').all().reverse();
  }

  if (uploads.length === 0) {
    return { uploads: [], groupedData: {}, pmlList: [] };
  }

  const uploadIds = uploads.map(u => u.id);

  // 2. Fetch PCL master list
  let pmlFilterSql = '';
  const params = [];
  if (filterPml) {
    pmlFilterSql = 'AND UPPER(m.pml) = ?';
    params.push(filterPml.toUpperCase());
  }

  const pcls = db.prepare(`
    SELECT DISTINCT m.pcl, m.pml, m.desa
    FROM subsls_master m
    WHERE m.pcl IS NOT NULL AND m.pcl != '' AND m.pml IS NOT NULL AND m.pml != ''
    ${pmlFilterSql}
    ORDER BY m.pml ASC, m.pcl ASC
  `).all(...params);

  // Group by PCL to get unique PCLs and their working Desas
  const pclMap = new Map();
  for (const p of pcls) {
    const key = `${p.pml.trim()}|||${p.pcl.trim()}`;
    if (!pclMap.has(key)) {
      pclMap.set(key, {
        pcl: p.pcl.trim(),
        pml: p.pml.trim(),
        desas: new Set()
      });
    }
    if (p.desa) {
      pclMap.get(key).desas.add(p.desa.trim());
    }
  }

  // Get target_fasih_mode setting to determine formula
  const settings = getSettings();
  const isStatic = settings.target_fasih_mode === 'static';
  const targetFormula = isStatic
    ? 'COALESCE(m.target_fasih, 0)'
    : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

  // Query progress for each PCL on each selected upload_id
  const progressQuery = db.prepare(`
    SELECT 
      m.pcl, m.pml,
      SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) AS realisasi,
      SUM(${targetFormula}) AS target
    FROM subsls_master m
    LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
    GROUP BY m.pcl, m.pml
  `);

  // For each upload, query and map the progress percentages
  const uploadProgresses = [];
  for (const u of uploads) {
    const progRows = progressQuery.all(u.id);
    const progMap = new Map();
    for (const r of progRows) {
      const key = `${r.pml.trim()}|||${r.pcl.trim()}`;
      const target = r.target || 0;
      const realisasi = r.realisasi || 0;
      const pct = target > 0 ? (realisasi / target * 100) : 0;
      progMap.set(key, pct);
    }
    uploadProgresses.push({
      id: u.id,
      tanggal: u.tanggal,
      map: progMap
    });
  }

  // Combine everything into a structured PML report list grouped by PML
  const groupedData = {};
  for (const [key, value] of pclMap.entries()) {
    const pmlName = value.pml;
    if (!groupedData[pmlName]) {
      groupedData[pmlName] = [];
    }

    const rowData = {
      pcl: value.pcl,
      pml: value.pml,
      wilayah: Array.from(value.desas).join(', '),
      progress: []
    };

    for (const up of uploadProgresses) {
      const pct = up.map.get(key) || 0;
      rowData.progress.push({
        tanggal: up.tanggal,
        pct: pct.toFixed(2)
      });
    }

    groupedData[pmlName].push(rowData);
  }

  // Get list of all PMLs for filter dropdown
  const pmlList = db.prepare(`
    SELECT DISTINCT m.pml
    FROM subsls_master m
    WHERE m.pml IS NOT NULL AND m.pml != ''
    ORDER BY m.pml ASC
  `).all().map(r => r.pml);

  return {
    uploads,
    groupedData,
    pmlList
  };
}

// GET: PML List and drilldown details (standard page)
router.get('/', (req, res) => {
  const uploadId = res.locals.uploadId;
  let pmlStats = [];
  let detailPcl = [];
  const filterPml = req.query.pml || '';

  if (uploadId) {
    pmlStats = getPmlStats(uploadId);

    if (filterPml) {
      const settings = getSettings();
      const isStatic = settings.target_fasih_mode === 'static';
      const targetFormula = isStatic
        ? 'COALESCE(m.target_fasih, 0)'
        : 'CASE WHEN (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) < 0 THEN 0 ELSE (COALESCE(m.target_fasih, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.keluarga_baru, 0) - COALESCE(p.usaha_tutup, 0) - COALESCE(p.tidak_ditemukan, 0)) END';

      detailPcl = attachProgressPercentages(getDb().prepare(`
        SELECT 
          m.pcl, m.pml, m.korlap, m.kecamatan,
          COUNT(m.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
          SUM(m.muatan) AS total_muatan,
          SUM(CASE WHEN p.kode IS NOT NULL AND m.muatan > 0 AND (COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0)) >= m.muatan THEN m.muatan ELSE 0 END) AS muatan_selesai,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0)) AS usaha_total,
          SUM(COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS keluarga_total,
          SUM(COALESCE(p.draft, 0)) AS draft_total,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
          SUM(COALESCE(p.approved, 0)) AS approved_total,
          SUM(COALESCE(p.rejected, 0)) AS rejected_total,
          SUM(${targetFormula}) AS target_fasih_total,
          CASE WHEN SUM(${targetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${targetFormula}), 2) ELSE 0.0 END AS pct
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE m.pml = ?
        GROUP BY m.pcl, m.kecamatan
        ORDER BY selesai ASC
      `).all(uploadId, filterPml));
    }
  }

  const selectedPmlStats = filterPml ? pmlStats.find(p => p.pml.toUpperCase() === filterPml.toUpperCase()) : null;

  res.render('pml', {
    title: 'Per PML',
    activePage: 'pml',
    pmlStats,
    detailPcl,
    selectedPmlStats,
    filterPml,
  });
});

// GET: PML Printable Report Generator Page
router.get('/laporan', (req, res) => {
  const filterPml = req.query.pml || '';
  
  // Normalize uploadIds from query
  let selectedUploadIds = [];
  if (req.query.uploadIds) {
    if (Array.isArray(req.query.uploadIds)) {
      selectedUploadIds = req.query.uploadIds.map(Number);
    } else {
      selectedUploadIds = [Number(req.query.uploadIds)];
    }
  }

  const allUploads = getAllUploads().sort((a, b) => b.tanggal.localeCompare(a.tanggal)); // descending for selection list

  // Default to pre-selecting the last 6 uploads if none specified
  if (selectedUploadIds.length === 0 && allUploads.length > 0) {
    selectedUploadIds = allUploads.slice(0, 6).map(u => u.id).reverse(); // chronological order
  }

  const { uploads, groupedData, pmlList } = getReportData(selectedUploadIds, filterPml);

  res.render('pml_laporan', {
    layout: false, // Don't use standard dashboard sidebar layout
    uploads,
    groupedData,
    pmlList,
    allUploads,
    selectedUploadIds,
    filterPml,
    formatDate,
    formatDateShort
  });
});

// GET: PML Report Download Excel
router.get('/laporan/excel', (req, res) => {
  const filterPml = req.query.pml || '';
  
  let selectedUploadIds = [];
  if (req.query.uploadIds) {
    selectedUploadIds = String(req.query.uploadIds).split(',').map(Number).filter(Boolean);
  }

  const { uploads, groupedData } = getReportData(selectedUploadIds, filterPml);

  // Build Excel Headers
  const headers = ['No', 'Nama Petugas PCL', 'PML', 'Wilayah Kerja Desa'];
  uploads.forEach(u => {
    headers.push(`Progres Tgl ${formatDateShort(u.tanggal)} (%)`);
  });

  const wsData = [headers];
  
  let globalIdx = 1;
  for (const pmlName of Object.keys(groupedData)) {
    groupedData[pmlName].forEach((row) => {
      const excelRow = [
        globalIdx++,
        row.pcl,
        row.pml,
        row.wilayah || '-'
      ];
      row.progress.forEach(p => {
        excelRow.push(parseFloat(p.pct) || 0);
      });
      wsData.push(excelRow);
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-fit column widths
  const colWidths = headers.map((h, i) => {
    let maxLen = h.length;
    wsData.forEach(row => {
      const cellVal = String(row[i] || '');
      if (cellVal.length > maxLen) {
        maxLen = cellVal.length;
      }
    });
    return { wch: maxLen + 2 };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Laporan Progres PCL');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="progres_pendataan_petugas_pcl_${dateStr}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
