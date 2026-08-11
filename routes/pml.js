const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit-table');
const { getPmlStats, getDb, getSettings, attachProgressPercentages, getAllUploads, getTargetFormula, getRealizationFormula, getUsahaTotalFormula, getKeluargaTotalFormula, getAdaptiveMuatanFormula } = require('../database');

// Heatmap color generator (HSL to RGB conversion)
function getHeatmapColor(pct) {
  const p = Math.min(Math.max(pct, 0), 100);
  const hue = p * 1.2; // 0 to 120 (Red to Green)
  
  // Convert HSL (hue, 75%, 85%) to RGB Hex
  const s = 0.75;
  const l = 0.85; // Light background for readability
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  if (0 <= hue && hue < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= hue && hue < 120) {
    r = x; g = c; b = 0;
  } else {
    r = 0; g = c; b = x;
  }
  
  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');
  
  return `#${rHex}${gHex}${bHex}`;
}

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

// Helper to compile report data for both HTML, Excel, and PDF
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
  const targetFormula = getTargetFormula(settings.target_fasih_mode);

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
    pmlStats = getPmlStats(uploadId, res.locals.settings);

    if (filterPml) {
      const settings = res.locals.settings;
      const targetFormula = getTargetFormula(settings.target_fasih_mode);
      const realFormula = getRealizationFormula(settings.target_muatan_mode, 'p');
      const targetMuatanFormula = getAdaptiveMuatanFormula(settings.target_muatan_mode, 'p', 'm');
      const usahaTotalFormula = getUsahaTotalFormula(settings.target_muatan_mode, 'p');
      const keluargaTotalFormula = getKeluargaTotalFormula(settings.target_muatan_mode, 'p');

      detailPcl = attachProgressPercentages(getDb().prepare(`
        SELECT 
          COALESCE(p.pcl_name, m.pcl) AS pcl, m.pml, m.korlap, m.kecamatan,
          COUNT(DISTINCT p.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL AND (${targetFormula}) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= (${targetFormula}) THEN 1 ELSE 0 END) AS selesai,
          SUM(${targetMuatanFormula}) AS total_muatan,
          SUM(${realFormula}) AS muatan_selesai,
          SUM(${usahaTotalFormula}) AS usaha_total,
          SUM(${keluargaTotalFormula}) AS keluarga_total,
          SUM(COALESCE(p.draft, 0)) AS draft_total,
          SUM(COALESCE(p.submitted_by_pcl, 0)) AS submitted_total,
          SUM(COALESCE(p.approved, 0)) AS approved_total,
          SUM(COALESCE(p.rejected, 0)) AS rejected_total,
          SUM(${targetFormula}) AS target_fasih_total,
          SUM(COALESCE(m.target_fasih, 0)) AS target_static_total,
          SUM(COALESCE(p.target_upload, 0)) AS target_upload_total,
          CASE WHEN SUM(${targetFormula}) > 0 THEN ROUND(100.0 * SUM(COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) / SUM(${targetFormula}), 2) ELSE 0.0 END AS pct
        FROM progres p
        LEFT JOIN subsls_master m ON p.kode = m.kode
        WHERE p.upload_id = ? AND m.pml = ?
        GROUP BY COALESCE(p.pcl_email, m.pcl_email, m.pcl), m.kecamatan
        ORDER BY selesai ASC
      `).all(uploadId, filterPml));
    }
  }

  let pmlHistory = [];
  if (uploadId && filterPml) {
    pmlHistory = getDb().prepare(`
      SELECT 
        u.tanggal,
        SUM(c.draft_total) AS draft_total,
        SUM(c.submitted_total) AS submitted_total,
        SUM(c.approved_total) AS approved_total,
        SUM(c.rejected_total) AS rejected_total,
        SUM(c.submitted_total + c.approved_total + c.rejected_total) AS selesai_total,
        SUM(c.target_fasih_total) AS target_fasih_total
      FROM summary_cache c
      JOIN (
        SELECT MAX(id) AS id, tanggal FROM uploads GROUP BY tanggal
      ) u ON c.upload_id = u.id
      WHERE UPPER(c.pml) = ?
      GROUP BY u.tanggal
      ORDER BY u.tanggal ASC
    `).all(filterPml.toUpperCase());
  }

  const selectedPmlStats = filterPml ? pmlStats.find(p => p.pml.toUpperCase() === filterPml.toUpperCase()) : null;

  res.render('pml', {
    title: 'Per PML',
    activePage: 'pml',
    pmlStats,
    detailPcl,
    selectedPmlStats,
    filterPml,
    pmlHistory,
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

// GET: PML Report Download PDF (Server-side generated with heatmap)
router.get('/laporan/pdf', async (req, res) => {
  const filterPml = req.query.pml || '';
  
  let selectedUploadIds = [];
  if (req.query.uploadIds) {
    selectedUploadIds = String(req.query.uploadIds).split(',').map(Number).filter(Boolean);
  }

  const { uploads, groupedData } = getReportData(selectedUploadIds, filterPml);

  if (uploads.length === 0) {
    return res.status(400).send('Tidak ada data progres untuk dibuat PDF.');
  }

  try {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    // Set Response Headers to download PDF directly
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="progres_pendataan_petugas_pcl_${dateStr}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // Title Header
    doc.font("Helvetica-Bold").fontSize(15).text("PROGRES PENDATAAN PETUGAS PCL", { align: 'center' });
    const latestDate = uploads[uploads.length - 1].tanggal;
    doc.font("Helvetica").fontSize(9).text(`Membandingkan progres s/d tanggal ${formatDate(latestDate)}`, { align: 'center' });
    doc.moveDown(1.5);

    // Grouped Tables by PML
    const pmlKeys = Object.keys(groupedData);
    for (let i = 0; i < pmlKeys.length; i++) {
      const pmlName = pmlKeys[i];
      const pmlRows = groupedData[pmlName];

      // Draw PML Section Header
      doc.font("Helvetica-Bold").fontSize(10).text(`PML: ${pmlName}`, { underline: true });
      doc.moveDown(0.4);

      // Setup headers as objects with column property mapping and custom renderer
      const headers = [
        { label: "No", property: "no", width: 25, align: "center" },
        { label: "Nama Petugas", property: "pcl", width: 140 },
        { label: "Wilayah Kerja Desa", property: "wilayah", width: 220 }
      ];

      uploads.forEach(u => {
        headers.push({
          label: formatDateShort(u.tanggal),
          property: u.tanggal,
          align: "right",
          width: 60,
          renderer: (value, indexColumn, indexRow, row, rectRow, rectCell, docInstance) => {
            const pctVal = parseFloat(value) || 0;
            const color = getHeatmapColor(pctVal);
            
            docInstance.save();
            // Draw custom filled rectangle for the cell background
            docInstance.fillColor(color).rect(rectCell.x + 0.5, rectCell.y + 0.5, rectCell.width - 1, rectCell.height - 1).fill();
            docInstance.restore();
            
            return `${pctVal.toFixed(2)}%`;
          }
        });
      });

      const rows = [];
      pmlRows.forEach((row, idx) => {
        const docRow = [
          String(idx + 1),
          row.pcl,
          row.wilayah || '-'
        ];

        row.progress.forEach(p => {
          docRow.push(p.pct);
        });

        rows.push(docRow);
      });

      const table = {
        headers: headers,
        rows: rows
      };

      await doc.table(table, {
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(7.5),
        prepareRow: () => doc.font("Helvetica").fontSize(7.5)
      });

      doc.moveDown(1);
    }

    doc.end();
  } catch (err) {
    console.error('Gagal membuat PDF:', err);
    if (!res.headersSent) {
      res.status(500).send('Terjadi kesalahan saat membuat laporan PDF.');
    }
  }
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
