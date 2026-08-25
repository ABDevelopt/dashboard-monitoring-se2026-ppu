const express = require('express');
const router = express.Router();
const { getDb, resolveSurveyId, getMasterTableSql } = require('../database');
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

  const requestedSurvey = req.query.survey || req.query.surveyId || (res.locals && res.locals.surveyId) || 'se2026';
  const surveyId = resolveSurveyId(requestedSurvey);
  const db = getDb(surveyId);
  const masterTable = getMasterTableSql(surveyId);
  const navPrefix = (surveyId && surveyId !== 'se2026') ? '/' + surveyId : '';
  const isSakernas = surveyId && surveyId.startsWith('sakernas');
  const officerLabel = isSakernas ? 'PPL' : 'PCL';
  const query = q.trim();

  try {
    function calculateBoost(mainLabel, qStr) {
      if (!mainLabel || !qStr) return 0;
      const m = mainLabel.toLowerCase().trim();
      const qClean = qStr.toLowerCase().trim();
      if (m === qClean) return 15.0; // exact match
      if (m.startsWith(qClean)) return 8.0; // starts with query
      if (m.includes(qClean)) return 4.0; // contains query
      return 0.0;
    }

    // 1. Search PCLs
    const pclsRaw = db.prepare(`
      SELECT DISTINCT pcl, pml, korlap, kecamatan 
      FROM ${masterTable} 
      WHERE pcl IS NOT NULL AND pcl != ''
    `).all();
    const pclDocs = pclsRaw.map((p, idx) => ({
      id: idx,
      text: `${p.pcl} ${p.pml || ''} ${p.korlap || ''} ${p.kecamatan || ''}`,
      ref: p
    }));
    const pclBM25 = new FuzzyBM25(pclDocs);
    const pclResults = pclBM25.search(query, 0.1).slice(0, 8);

    const pclFormatted = pclResults.map(r => ({
      type: 'pcl',
      category: 'pcl',
      categoryLabel: officerLabel,
      badge: 'badge-purple',
      icon: 'bi-person-badge-fill',
      label: r.doc.ref.pcl,
      sublabel: isSakernas 
        ? `PML: ${r.doc.ref.pml || '-'} (${r.doc.ref.kecamatan || '-'})`
        : `PML: ${r.doc.ref.pml || '-'} · Korlap: ${r.doc.ref.korlap || '-'} (${r.doc.ref.kecamatan || '-'})`,
      href: `${navPrefix}/pcl?pcl=${encodeURIComponent(r.doc.ref.pcl)}`,
      score: (r.score || 0) + calculateBoost(r.doc.ref.pcl, query)
    }));

    // 2. Search PMLs
    const pmlsRaw = db.prepare(`
      SELECT DISTINCT pml, korlap, kecamatan 
      FROM ${masterTable} 
      WHERE pml IS NOT NULL AND pml != ''
    `).all();
    const pmlDocs = pmlsRaw.map((p, idx) => ({
      id: idx,
      text: `${p.pml} ${p.korlap || ''} ${p.kecamatan || ''}`,
      ref: p
    }));
    const pmlBM25 = new FuzzyBM25(pmlDocs);
    const pmlResults = pmlBM25.search(query, 0.1).slice(0, 8);

    const pmlFormatted = pmlResults.map(r => ({
      type: 'pml',
      category: 'pml',
      categoryLabel: 'PML',
      badge: 'badge-blue',
      icon: 'bi-person-gear',
      label: r.doc.ref.pml,
      sublabel: isSakernas
        ? `Kecamatan: ${r.doc.ref.kecamatan || '-'}`
        : `Korlap: ${r.doc.ref.korlap || '-'} (${r.doc.ref.kecamatan || '-'})`,
      href: `${navPrefix}/pml?pml=${encodeURIComponent(r.doc.ref.pml)}`,
      score: (r.score || 0) + calculateBoost(r.doc.ref.pml, query)
    }));

    // 3. Search Korlaps
    let korlapFormatted = [];
    if (!isSakernas) {
      const korlapsRaw = db.prepare(`
        SELECT DISTINCT korlap, kecamatan 
        FROM ${masterTable} 
        WHERE korlap IS NOT NULL AND korlap != ''
      `).all();
      const korlapDocs = korlapsRaw.map((k, idx) => ({
        id: idx,
        text: `${k.korlap} ${k.kecamatan || ''}`,
        ref: k
      }));
      const korlapBM25 = new FuzzyBM25(korlapDocs);
      const korlapResults = korlapBM25.search(query, 0.1).slice(0, 8);

      korlapFormatted = korlapResults.map(r => ({
        type: 'korlap',
        category: 'korlap',
        categoryLabel: 'Korlap',
        badge: 'badge-orange',
        icon: 'bi-person-workspace',
        label: r.doc.ref.korlap,
        sublabel: `Kecamatan: ${r.doc.ref.kecamatan || '-'}`,
        href: `${navPrefix}/korlap?korlap=${encodeURIComponent(r.doc.ref.korlap)}`,
        score: (r.score || 0) + calculateBoost(r.doc.ref.korlap, query)
      }));
    }

    // 4. Search Kecamatan
    const kecamatansRaw = db.prepare(`
      SELECT DISTINCT kecamatan 
      FROM ${masterTable} 
      WHERE kecamatan IS NOT NULL AND kecamatan != ''
    `).all();
    const kecamatanDocs = kecamatansRaw.map((k, idx) => ({
      id: idx,
      text: k.kecamatan,
      ref: k
    }));
    const kecamatanBM25 = new FuzzyBM25(kecamatanDocs);
    const kecamatanResults = kecamatanBM25.search(query, 0.1).slice(0, 8);

    const kecamatanFormatted = kecamatanResults.map(r => ({
      type: 'kecamatan',
      category: 'wilayah',
      categoryLabel: 'Kecamatan',
      badge: 'badge-cyan',
      icon: 'bi-geo-alt-fill',
      label: r.doc.ref.kecamatan,
      sublabel: `Kecamatan di Penajam Paser Utara`,
      href: `${navPrefix}/kecamatan?kec=${encodeURIComponent(r.doc.ref.kecamatan)}`,
      score: (r.score || 0) + calculateBoost(r.doc.ref.kecamatan, query)
    }));

    // 5. Search Desa/Kelurahan
    const desasRaw = db.prepare(`
      SELECT DISTINCT desa, kecamatan 
      FROM ${masterTable} 
      WHERE desa IS NOT NULL AND desa != ''
    `).all();
    const desaDocs = desasRaw.map((d, idx) => ({
      id: idx,
      text: `${d.desa} ${d.kecamatan || ''}`,
      ref: d
    }));
    const desaBM25 = new FuzzyBM25(desaDocs);
    const desaResults = desaBM25.search(query, 0.1).slice(0, 8);

    const desaFormatted = desaResults.map(r => ({
      type: 'desa',
      category: 'wilayah',
      categoryLabel: 'Desa',
      badge: 'badge-green',
      icon: 'bi-geo-fill',
      label: r.doc.ref.desa,
      sublabel: `Kecamatan: ${r.doc.ref.kecamatan || '-'}`,
      href: `${navPrefix}/subsls?kec=${encodeURIComponent(r.doc.ref.kecamatan)}&desa=${encodeURIComponent(r.doc.ref.desa)}`,
      score: (r.score || 0) + calculateBoost(r.doc.ref.desa, query)
    }));

    // 6. Search SLS
    const slsRaw = db.prepare(`
      SELECT kode, nama_sls, desa, kecamatan, pcl 
      FROM ${masterTable} 
      WHERE nama_sls IS NOT NULL AND nama_sls != ''
    `).all();
    const slsDocs = slsRaw.map((s, idx) => ({
      id: idx,
      text: `${s.nama_sls} ${s.kode} ${s.desa || ''} ${s.kecamatan || ''} ${s.pcl || ''}`,
      ref: s
    }));
    const slsBM25 = new FuzzyBM25(slsDocs);
    const slsResults = slsBM25.search(query, 0.1).slice(0, 15);

    const slsFormatted = slsResults.map(r => ({
      type: 'sls',
      category: 'sls',
      categoryLabel: 'SLS',
      badge: 'badge-gray',
      icon: 'bi-box-seam',
      label: r.doc.ref.nama_sls,
      sublabel: `${r.doc.ref.desa || '-'}, ${r.doc.ref.kecamatan || '-'} (${officerLabel}: ${r.doc.ref.pcl || '-'}) · Kode: ${r.doc.ref.kode}`,
      href: `${navPrefix}/subsls?kode=${encodeURIComponent(r.doc.ref.kode)}`,
      score: (r.score || 0) + calculateBoost(r.doc.ref.nama_sls, query) + calculateBoost(r.doc.ref.kode, query)
    }));

    // Unified globally ranked items sorted by score descending
    const all = [
      ...pclFormatted,
      ...pmlFormatted,
      ...korlapFormatted,
      ...kecamatanFormatted,
      ...desaFormatted,
      ...slsFormatted
    ].sort((a, b) => b.score - a.score);

    return res.json({
      all,
      pcl: pclFormatted.sort((a, b) => b.score - a.score),
      pml: pmlFormatted.sort((a, b) => b.score - a.score),
      korlap: korlapFormatted.sort((a, b) => b.score - a.score),
      wilayah: [...kecamatanFormatted, ...desaFormatted].sort((a, b) => b.score - a.score),
      kecamatan: kecamatanFormatted.sort((a, b) => b.score - a.score),
      desa: desaFormatted.sort((a, b) => b.score - a.score),
      sls: slsFormatted.sort((a, b) => b.score - a.score)
    });
  } catch (err) {
    console.error('Error executing global search query:', err);
    return res.status(500).json({ error: 'Failed to execute search' });
  }
});

module.exports = router;
