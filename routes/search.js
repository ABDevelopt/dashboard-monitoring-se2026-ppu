const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { FuzzyBM25 } = require('../public/js/search-helper');

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

  const db = getDb();
  const query = q.trim();

  try {
    // 1. Search PCLs
    const pclsRaw = db.prepare(`
      SELECT DISTINCT pcl, pml, korlap, kecamatan 
      FROM subsls_master 
      WHERE pcl IS NOT NULL AND pcl != ''
    `).all();
    const pclDocs = pclsRaw.map((p, idx) => ({
      id: idx,
      text: `${p.pcl} ${p.pml || ''} ${p.korlap || ''} ${p.kecamatan || ''}`,
      ref: p
    }));
    const pclBM25 = new FuzzyBM25(pclDocs);
    const pclResults = pclBM25.search(query, 0.1).slice(0, 5);

    // 2. Search PMLs
    const pmlsRaw = db.prepare(`
      SELECT DISTINCT pml, korlap, kecamatan 
      FROM subsls_master 
      WHERE pml IS NOT NULL AND pml != ''
    `).all();
    const pmlDocs = pmlsRaw.map((p, idx) => ({
      id: idx,
      text: `${p.pml} ${p.korlap || ''} ${p.kecamatan || ''}`,
      ref: p
    }));
    const pmlBM25 = new FuzzyBM25(pmlDocs);
    const pmlResults = pmlBM25.search(query, 0.1).slice(0, 5);

    // 3. Search Korlaps
    const korlapsRaw = db.prepare(`
      SELECT DISTINCT korlap, kecamatan 
      FROM subsls_master 
      WHERE korlap IS NOT NULL AND korlap != ''
    `).all();
    const korlapDocs = korlapsRaw.map((k, idx) => ({
      id: idx,
      text: `${k.korlap} ${k.kecamatan || ''}`,
      ref: k
    }));
    const korlapBM25 = new FuzzyBM25(korlapDocs);
    const korlapResults = korlapBM25.search(query, 0.1).slice(0, 5);

    // 4. Search Kecamatan
    const kecamatansRaw = db.prepare(`
      SELECT DISTINCT kecamatan 
      FROM subsls_master 
      WHERE kecamatan IS NOT NULL AND kecamatan != ''
    `).all();
    const kecamatanDocs = kecamatansRaw.map((k, idx) => ({
      id: idx,
      text: k.kecamatan,
      ref: k
    }));
    const kecamatanBM25 = new FuzzyBM25(kecamatanDocs);
    const kecamatanResults = kecamatanBM25.search(query, 0.1).slice(0, 5);

    // 5. Search Desa/Kelurahan
    const desasRaw = db.prepare(`
      SELECT DISTINCT desa, kecamatan 
      FROM subsls_master 
      WHERE desa IS NOT NULL AND desa != ''
    `).all();
    const desaDocs = desasRaw.map((d, idx) => ({
      id: idx,
      text: `${d.desa} ${d.kecamatan || ''}`,
      ref: d
    }));
    const desaBM25 = new FuzzyBM25(desaDocs);
    const desaResults = desaBM25.search(query, 0.1).slice(0, 5);

    // 6. Search SLS
    const slsRaw = db.prepare(`
      SELECT kode, nama_sls, desa, kecamatan, pcl 
      FROM subsls_master 
      WHERE nama_sls IS NOT NULL AND nama_sls != ''
    `).all();
    const slsDocs = slsRaw.map((s, idx) => ({
      id: idx,
      text: `${s.nama_sls} ${s.kode} ${s.desa || ''} ${s.kecamatan || ''} ${s.pcl || ''}`,
      ref: s
    }));
    const slsBM25 = new FuzzyBM25(slsDocs);
    const slsResults = slsBM25.search(query, 0.1).slice(0, 10);

    return res.json({
      pcl: pclResults.map(r => ({
        label: r.doc.ref.pcl,
        sublabel: `PML: ${r.doc.ref.pml || '-'} · Korlap: ${r.doc.ref.korlap || '-'} (${r.doc.ref.kecamatan || '-'})`,
        href: `/pcl?pcl=${encodeURIComponent(r.doc.ref.pcl)}`
      })),
      pml: pmlResults.map(r => ({
        label: r.doc.ref.pml,
        sublabel: `Korlap: ${r.doc.ref.korlap || '-'} (${r.doc.ref.kecamatan || '-'})`,
        href: `/pml?pml=${encodeURIComponent(r.doc.ref.pml)}`
      })),
      korlap: korlapResults.map(r => ({
        label: r.doc.ref.korlap,
        sublabel: `Kecamatan: ${r.doc.ref.kecamatan || '-'}`,
        href: `/korlap?korlap=${encodeURIComponent(r.doc.ref.korlap)}`
      })),
      kecamatan: kecamatanResults.map(r => ({
        label: r.doc.ref.kecamatan,
        sublabel: `Kecamatan di PPU`,
        href: `/kecamatan?kec=${encodeURIComponent(r.doc.ref.kecamatan)}`
      })),
      desa: desaResults.map(r => ({
        label: r.doc.ref.desa,
        sublabel: `Kecamatan: ${r.doc.ref.kecamatan || '-'}`,
        href: `/subsls?kec=${encodeURIComponent(r.doc.ref.kecamatan)}&desa=${encodeURIComponent(r.doc.ref.desa)}`
      })),
      sls: slsResults.map(r => ({
        label: r.doc.ref.nama_sls,
        sublabel: `${r.doc.ref.desa || '-'}, ${r.doc.ref.kecamatan || '-'} (PCL: ${r.doc.ref.pcl || '-'}) · Kode: ${r.doc.ref.kode}`,
        href: `/subsls?kode=${encodeURIComponent(r.doc.ref.kode)}`
      }))
    });
  } catch (err) {
    console.error('Error executing global search query:', err);
    return res.status(500).json({ error: 'Failed to execute search' });
  }
});

module.exports = router;
