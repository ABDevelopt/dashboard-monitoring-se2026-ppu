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

// Build Desa Features
const desaFeatures = Object.values(desaMap).map(item => {
  let geometry;
  if (item.polygons.length === 1) {
    geometry = { type: 'Polygon', coordinates: item.polygons[0] };
  } else {
    geometry = { type: 'MultiPolygon', coordinates: item.polygons };
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
