const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/', (req, res) => {
  const q = req.query.q || '';
  if (!q || q.trim().length < 2) {
    return res.json({
      pcl: [],
      pml: [],
      korlap: [],
      kecamatan: [],
      desa: [],
      sls: []
    });
  }

  const queryStr = `%${q.trim()}%`;
  const db = getDb();

  try {
    // 1. Search PCLs
    const pcls = db.prepare(`
      SELECT DISTINCT pcl, pml, korlap, kecamatan 
      FROM subsls_master 
      WHERE pcl LIKE ? AND pcl IS NOT NULL AND pcl != ''
      LIMIT 5
    `).all(queryStr);

    // 2. Search PMLs
    const pmls = db.prepare(`
      SELECT DISTINCT pml, korlap, kecamatan 
      FROM subsls_master 
      WHERE pml LIKE ? AND pml IS NOT NULL AND pml != ''
      LIMIT 5
    `).all(queryStr);

    // 3. Search Korlaps
    const korlaps = db.prepare(`
      SELECT DISTINCT korlap, kecamatan 
      FROM subsls_master 
      WHERE korlap LIKE ? AND korlap IS NOT NULL AND korlap != ''
      LIMIT 5
    `).all(queryStr);

    // 4. Search Kecamatan
    const kecamatans = db.prepare(`
      SELECT DISTINCT kecamatan 
      FROM subsls_master 
      WHERE kecamatan LIKE ? AND kecamatan IS NOT NULL AND kecamatan != ''
      LIMIT 5
    `).all(queryStr);

    // 5. Search Desa/Kelurahan
    const desas = db.prepare(`
      SELECT DISTINCT desa, kecamatan 
      FROM subsls_master 
      WHERE desa LIKE ? AND desa IS NOT NULL AND desa != ''
      LIMIT 5
    `).all(queryStr);

    // 6. Search SLS
    const sls = db.prepare(`
      SELECT kode, nama_sls, desa, kecamatan, pcl 
      FROM subsls_master 
      WHERE (nama_sls LIKE ? OR kode LIKE ?) AND nama_sls IS NOT NULL AND nama_sls != ''
      LIMIT 10
    `).all(queryStr, queryStr);

    return res.json({
      pcl: pcls.map(p => ({
        label: p.pcl,
        sublabel: `PML: ${p.pml || '-'} · Korlap: ${p.korlap || '-'} (${p.kecamatan || '-'})`,
        href: `/pcl?pcl=${encodeURIComponent(p.pcl)}`
      })),
      pml: pmls.map(p => ({
        label: p.pml,
        sublabel: `Korlap: ${p.korlap || '-'} (${p.kecamatan || '-'})`,
        href: `/pml?pml=${encodeURIComponent(p.pml)}`
      })),
      korlap: korlaps.map(k => ({
        label: k.korlap,
        sublabel: `Kecamatan: ${k.kecamatan || '-'}`,
        href: `/korlap?korlap=${encodeURIComponent(k.korlap)}`
      })),
      kecamatan: kecamatans.map(k => ({
        label: k.kecamatan,
        sublabel: `Kecamatan di PPU`,
        href: `/kecamatan?kec=${encodeURIComponent(k.kecamatan)}`
      })),
      desa: desas.map(d => ({
        label: d.desa,
        sublabel: `Kecamatan: ${d.kecamatan || '-'}`,
        href: `/subsls?kec=${encodeURIComponent(d.kecamatan)}&desa=${encodeURIComponent(d.desa)}`
      })),
      sls: sls.map(s => ({
        label: s.nama_sls,
        sublabel: `${s.desa || '-'}, ${s.kecamatan || '-'} (PCL: ${s.pcl || '-'}) · Kode: ${s.kode}`,
        href: `/subsls?kode=${encodeURIComponent(s.kode)}`
      }))
    });
  } catch (err) {
    console.error('Error executing global search query:', err);
    return res.status(500).json({ error: 'Failed to execute search' });
  }
});

module.exports = router;
