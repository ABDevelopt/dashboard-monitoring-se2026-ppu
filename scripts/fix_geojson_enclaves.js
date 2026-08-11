const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

function cleanFeatureGeometry(feature) {
  if (!feature.geometry) return feature;

  if (feature.geometry.type === 'MultiPolygon' && feature.geometry.coordinates.length > 1) {
    try {
      const polygons = [];
      feature.geometry.coordinates.forEach(polyCoords => {
        try {
          const poly = turf.polygon(polyCoords);
          polygons.push(poly);
        } catch (e) {
          console.warn('Skipping invalid polygon part:', e.message);
        }
      });

      if (polygons.length > 0) {
        let merged = polygons[0];
        for (let i = 1; i < polygons.length; i++) {
          merged = turf.union(turf.featureCollection([merged, polygons[i]]));
        }
        feature.geometry = merged.geometry;
      }
    } catch (err) {
      console.error('Error merging feature MultiPolygon:', err.message);
    }
  }

  return feature;
}

function processGeoJsonFile(filePath) {
  console.log('Processing GeoJSON file:', filePath);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }

  const rawData = fs.readFileSync(filePath, 'utf8');
  const geojson = JSON.parse(rawData);

  let updatedCount = 0;
  geojson.features = geojson.features.map(f => {
    const origType = f.geometry.type;
    const origParts = origType === 'MultiPolygon' ? f.geometry.coordinates.length : 1;
    
    cleanFeatureGeometry(f);

    const newType = f.geometry.type;
    const newParts = newType === 'MultiPolygon' ? f.geometry.coordinates.length : 1;

    if (origParts !== newParts) {
      updatedCount++;
      const name = f.properties.nmdesa || f.properties.nmsls || f.properties.nmkec || 'Feature';
      console.log(`  Cleaned ${name}: ${origParts} parts -> ${newParts} parts (${newType})`);
    }
    return f;
  });

  // Calculate area for each feature and sort by area DESCENDING (largest first, smallest last)
  // This ensures small enclave features are rendered ON TOP of larger container features in SVG DOM!
  console.log('Sorting features by area descending (largest area first)...');
  geojson.features.forEach(f => {
    try {
      f._area = turf.area(f);
    } catch (e) {
      f._area = 0;
    }
  });

  geojson.features.sort((a, b) => b._area - a._area);

  // Clean temp property
  geojson.features.forEach(f => { delete f._area; });

  fs.writeFileSync(filePath, JSON.stringify(geojson));
  console.log(`Successfully updated ${filePath}. Cleaned ${updatedCount} features, sorted ${geojson.features.length} features by area descending.\n`);
}

// 1. Process Desa boundaries
const desaPath = path.join(__dirname, '../public/data/desa_boundaries.geojson');
processGeoJsonFile(desaPath);

// 2. Process SLS boundaries
const slsPath = path.join(__dirname, '../public/data/sls_boundaries.geojson');
processGeoJsonFile(slsPath);

// 3. Re-generate Kecamatan boundaries from updated Desa boundaries
console.log('Re-generating kecamatan boundaries...');
require('./generate_kecamatan_geojson.js');
