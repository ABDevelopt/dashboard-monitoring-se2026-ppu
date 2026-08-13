const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const desaGeoJsonPath = path.join(__dirname, '../public/data/desa_boundaries.geojson');
const kecGeoJsonPath = path.join(__dirname, '../public/data/kecamatan_boundaries.geojson');

console.log('Loading desa boundaries from:', desaGeoJsonPath);
const desaData = JSON.parse(fs.readFileSync(desaGeoJsonPath, 'utf8'));

// Group features by nmkec
const featuresByKec = {};

desaData.features.forEach(feature => {
  const nmkec = feature.properties.nmkec ? feature.properties.nmkec.toUpperCase() : 'UNKNOWN';
  if (!featuresByKec[nmkec]) {
    featuresByKec[nmkec] = [];
  }
  featuresByKec[nmkec].push(feature);
});

const kecamatanFeatures = [];

for (const nmkec in featuresByKec) {
  const features = featuresByKec[nmkec];
  console.log(`Combining ${features.length} desa polygons for Kecamatan: ${nmkec}`);
  
  // Flatten any MultiPolygons into Polygons or union directly
  let merged = null;
  features.forEach(feat => {
    if (!merged) {
      merged = JSON.parse(JSON.stringify(feat));
    } else {
      merged = turf.union(turf.featureCollection([merged, feat]));
    }
  });

  if (merged) {
    merged.properties = {
      nmkec: nmkec,
      nmkec_display: 'Kecamatan ' + nmkec.charAt(0).toUpperCase() + nmkec.slice(1).toLowerCase()
    };
    kecamatanFeatures.push(merged);
  }
}

const kecGeoJson = {
  type: 'FeatureCollection',
  features: kecamatanFeatures
};

fs.writeFileSync(kecGeoJsonPath, JSON.stringify(kecGeoJson, null, 2));
console.log('Successfully saved kecamatan boundaries to:', kecGeoJsonPath);
