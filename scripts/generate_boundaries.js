const fs = require('fs');
const path = require('path');

console.log('--- Start Generating Boundaries GeoJSON from Batas Wilayah PPU.kml ---');

const kmlPath = path.join(__dirname, '..', 'Batas Wilayah PPU.kml');
if (!fs.existsSync(kmlPath)) {
  console.error('KML file not found at:', kmlPath);
  process.exit(1);
}

const kml = fs.readFileSync(kmlPath, 'utf8');

const placemarkRegex = /<Placemark>[\s\S]*?<\/Placemark>/g;
const placemarks = kml.match(placemarkRegex) || [];
console.log(`Total placemarks found in KML: ${placemarks.length}`);

function parseCoordinates(coordStr) {
  return coordStr.trim().split(/\s+/).map(pt => {
    const parts = pt.split(',').map(Number);
    // Round to 6 decimal places for cleanliness & compact size
    return [
      parseFloat(parts[0].toFixed(6)),
      parseFloat(parts[1].toFixed(6))
    ];
  }).filter(pt => !isNaN(pt[0]) && !isNaN(pt[1]));
}

function parsePolygon(polyXml) {
  const outerMatch = polyXml.match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/);
  if (!outerMatch) return null;
  
  const outerRing = parseCoordinates(outerMatch[1]);
  if (outerRing.length < 3) return null;
  
  const rings = [outerRing];
  
  const innerMatches = polyXml.match(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/innerBoundaryIs>/g) || [];
  innerMatches.forEach(inXml => {
    const inCoordMatch = inXml.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (inCoordMatch) {
      const innerRing = parseCoordinates(inCoordMatch[1]);
      if (innerRing.length >= 3) rings.push(innerRing);
    }
  });
  
  return rings;
}

function parseDescriptionProperties(descXml) {
  const properties = {};
  const kvRegex = /([a-z0-9_]+):\s*(.*?)(?:<br>|\]\]>|$)/gi;
  let match;
  while ((match = kvRegex.exec(descXml)) !== null) {
    properties[match[1].toLowerCase()] = match[2].trim();
  }
  return properties;
}

// Containers
const slsFeatures = [];
const desaMap = {};

placemarks.forEach((pm) => {
  const nameMatch = pm.match(/<name>(.*?)<\/name>/);
  const name = nameMatch ? nameMatch[1].trim() : '';
  const descMatch = pm.match(/<description>[\s\S]*?<\/description>/);
  const desc = descMatch ? descMatch[0] : '';
  const properties = parseDescriptionProperties(desc);

  const polyBlocks = pm.match(/<Polygon>[\s\S]*?<\/Polygon>/g) || [];
  const parsedPolygons = polyBlocks.map(parsePolygon).filter(Boolean);
  if (parsedPolygons.length === 0) return;

  if (name) {
    // This is an SLS boundary feature
    const kode = name || properties.idsls || '';
    const nmsls = properties.nmsls || '';
    const nmdesa = properties.nmdesa || '';
    const nmkec = properties.nmkec || '';
    const muatan = parseInt(properties.sipw_muatan || properties.muatan || '0', 10);

    let geometry;
    if (parsedPolygons.length === 1) {
      geometry = { type: 'Polygon', coordinates: parsedPolygons[0] };
    } else {
      geometry = { type: 'MultiPolygon', coordinates: parsedPolygons };
    }

    slsFeatures.push({
      type: 'Feature',
      properties: {
        kode: kode,
        nmsls: nmsls,
        nmdesa: nmdesa,
        nmkec: nmkec,
        muatan: isNaN(muatan) ? 0 : muatan
      },
      geometry: geometry
    });
  } else {
    // This is a Desa boundary feature
    let iddesa = properties.iddesa || '';
    if (!iddesa && properties.kdprov && properties.kdkab && properties.kdkec && properties.kddesa) {
      iddesa = properties.kdprov + properties.kdkab + properties.kdkec + properties.kddesa;
    }
    const nmdesa = properties.nmdesa || '';
    const nmkec = properties.nmkec || '';

    if (!iddesa) return;

    if (!desaMap[iddesa]) {
      desaMap[iddesa] = {
        iddesa: iddesa,
        nmdesa: nmdesa,
        nmkec: nmkec,
        polygons: []
      };
    }
    desaMap[iddesa].polygons.push(...parsedPolygons);
  }
});

// Helper to format coordinate key for topological edge matching
function ptKey(pt) {
  return pt[0].toFixed(5) + ',' + pt[1].toFixed(5);
}

// Dissolve internal shared edges between SLS polygons to produce clean outer Desa boundaries
function dissolveDesaPolygons(features) {
  const edgeCount = new Map();
  const edgeMap = new Map();

  features.forEach(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach(rings => {
      const ring = rings[0];
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const k1 = ptKey(p1);
        const k2 = ptKey(p2);
        if (k1 === k2) continue;
        
        const eKey = k1 < k2 ? (k1 + '|' + k2) : (k2 + '|' + k1);
        edgeCount.set(eKey, (edgeCount.get(eKey) || 0) + 1);
        if (!edgeMap.has(eKey)) {
          edgeMap.set(eKey, { p1, p2, k1, k2 });
        }
      }
    });
  });

  // Filter for edges that belong exclusively to the outer boundary (frequency = 1)
  const outerEdges = [];
  edgeCount.forEach((count, eKey) => {
    if (count === 1) {
      outerEdges.push(edgeMap.get(eKey));
    }
  });

  // Construct adjacency list for ring stitching
  const adj = new Map();
  outerEdges.forEach(e => {
    if (!adj.has(e.k1)) adj.set(e.k1, []);
    if (!adj.has(e.k2)) adj.set(e.k2, []);
    adj.get(e.k1).push({ nextKey: e.k2, pt: e.p2 });
    adj.get(e.k2).push({ nextKey: e.k1, pt: e.p1 });
  });

  const keyToPt = new Map();
  outerEdges.forEach(e => {
    keyToPt.set(e.k1, e.p1);
    keyToPt.set(e.k2, e.p2);
  });

  const visitedKeys = new Set();
  const rings = [];

  keyToPt.forEach((startPt, startKey) => {
    if (visitedKeys.has(startKey)) return;
    const ring = [startPt];
    visitedKeys.add(startKey);
    let currKey = startKey;

    while (true) {
      const neighbors = adj.get(currKey) || [];
      let nextObj = neighbors.find(n => !visitedKeys.has(n.nextKey));
      if (!nextObj) break;
      visitedKeys.add(nextObj.nextKey);
      ring.push(nextObj.pt);
      currKey = nextObj.nextKey;
    }

    if (ring.length >= 3) {
      if (ptKey(ring[0]) !== ptKey(ring[ring.length - 1])) {
        ring.push(ring[0]);
      }
      rings.push(ring);
    }
  });

  return rings.length > 0 ? rings : null;
}

// Group all SLS polygon features by Desa & dissolve internal borders
const desaGrouped = {};
slsFeatures.forEach(f => {
  const nmdesa = (f.properties.nmdesa || '').trim();
  const nmkec = (f.properties.nmkec || '').trim();
  if (!nmdesa) return;

  const key = nmkec.toUpperCase() + '___' + nmdesa.toUpperCase();
  if (!desaGrouped[key]) {
    let iddesa = '';
    const kode = f.properties.kode || '';
    if (kode.length >= 10) {
      iddesa = kode.substring(0, 10);
    }
    desaGrouped[key] = {
      iddesa: iddesa,
      nmkec: nmkec,
      nmdesa: nmdesa,
      features: []
    };
  }
  desaGrouped[key].features.push(f);
});

const desaFeatures = Object.values(desaGrouped).map(item => {
  let rings = dissolveDesaPolygons(item.features);

  // Fallback if topological dissolve returns empty
  if (!rings || rings.length === 0) {
    rings = [];
    item.features.forEach(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(p => rings.push(p[0]));
    });
  }

  let geometry;
  if (rings.length === 1) {
    // GeoJSON Polygon spec: coordinates = [ outerRing, innerRing1, ... ]
    geometry = { type: 'Polygon', coordinates: [rings[0]] };
  } else {
    // GeoJSON MultiPolygon spec: coordinates = [ [ polygon1_outerRing ], [ polygon2_outerRing ], ... ]
    geometry = { type: 'MultiPolygon', coordinates: rings.map(r => [r]) };
  }

  return {
    type: 'Feature',
    properties: {
      iddesa: item.iddesa,
      nmkec: item.nmkec,
      nmdesa: item.nmdesa
    },
    geometry: geometry
  };
});

const slsGeoJson = {
  type: 'FeatureCollection',
  features: slsFeatures
};

const desaGeoJson = {
  type: 'FeatureCollection',
  features: desaFeatures
};

const slsOutPath = path.join(__dirname, '..', 'public', 'data', 'sls_boundaries.geojson');
const desaOutPath = path.join(__dirname, '..', 'public', 'data', 'desa_boundaries.geojson');

fs.writeFileSync(slsOutPath, JSON.stringify(slsGeoJson));
fs.writeFileSync(desaOutPath, JSON.stringify(desaGeoJson));

console.log(`Saved ${slsFeatures.length} SLS features to ${slsOutPath}`);
console.log(`Saved ${desaFeatures.length} Desa features to ${desaOutPath}`);

console.log('\n--- Verification ---');
const slsMultiCount = slsFeatures.filter(f => f.geometry.type === 'MultiPolygon').length;
const desaMultiCount = desaFeatures.filter(f => f.geometry.type === 'MultiPolygon').length;
console.log(`SLS MultiPolygon features count: ${slsMultiCount}`);
console.log(`Desa MultiPolygon features count: ${desaMultiCount}`);

// Inspect specific target SLS features mentioned by user
const targets = [
  { kode: '6409020001100100', label: 'WARU - API-API - LAHAN SAWIT' },
  { kode: '6409010009001200', label: 'BABULU - LABANGKA - RT 012' },
  { kode: '6409010009001300', label: 'BABULU - LABANGKA - RT 013' }
];

targets.forEach(t => {
  const feat = slsFeatures.find(f => f.properties.kode === t.kode);
  if (feat) {
    console.log(`Target [${t.label}]: geometry=${feat.geometry.type}, parts=${feat.geometry.coordinates.length}`);
  } else {
    console.warn(`Target [${t.label}] not found!`);
  }
});
