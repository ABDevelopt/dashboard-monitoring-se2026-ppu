const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const { getFirestore: getFs } = require('firebase-admin/firestore');

let db = null;
let isInitialized = false;

function initFirebase() {
  if (isInitialized) return db;

  const keyPathFromEnv = process.env.FIREBASE_KEY_PATH;
  const possiblePaths = [
    keyPathFromEnv ? path.resolve(keyPathFromEnv) : null,
    path.join(__dirname, '../firebase-key.json'),
    path.join(__dirname, '../firebase-service-account.json'),
    path.join(__dirname, '../data/firebase-key.json')
  ].filter(Boolean);

  let keyFilePath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      keyFilePath = p;
      break;
    }
  }

  if (!keyFilePath) {
    logger.warn('[FIREBASE] Key file not found (checked firebase-key.json / firebase-service-account.json). Firebase sync & reader disabled.');
    isInitialized = true;
    return null;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));

    const certCredential = typeof admin.cert === 'function' 
      ? admin.cert(serviceAccount) 
      : admin.credential.cert(serviceAccount);

    admin.initializeApp({
      credential: certCredential
    });

    db = getFs();
    // Disable settings warning for timestamps
    db.settings({ ignoreUndefinedProperties: true });

    isInitialized = true;
    logger.info(`[FIREBASE] ✅ Connected to Firestore (Project ID: ${serviceAccount.project_id || 'OK'})`);
    return db;
  } catch (err) {
    logger.error(`[FIREBASE] ❌ Initialization error: ${err.message}`);
    isInitialized = true;
    db = null;
    return null;
  }
}

function getFirestore() {
  if (!isInitialized) {
    return initFirebase();
  }
  return db;
}

function isFirebaseActive() {
  return !!getFirestore();
}

module.exports = {
  getFirestore,
  isFirebaseActive
};
