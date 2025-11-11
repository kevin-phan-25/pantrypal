const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');

// ———————— ULTRA-RELIABLE ENV VAR CREDENTIALS (NO SECRET FILE) ————————
let serviceAccount;
try {
  const rawKey = process.env.GCLOUD_KEY_JSON;

  if (!rawKey) {
    throw new Error('Missing GCLOUD_KEY_JSON environment variable!');
  }

  serviceAccount = JSON.parse(rawKey);
  console.log('SUCCESS: Loaded credentials from GCLOUD_KEY_JSON env var');

} catch (err) {
  console.error('FATAL: Could not load Google Cloud credentials');
  console.error('Error:', err.message);
  process.exit(1);
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Initialize Google Cloud Vision (uses same key automatically)
const vision = new ImageAnnotatorClient();

// ———————— Express App Setup ————————
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// Test route — proves everything works
app.get('/', (req, res) => {
  res.json({
    message: 'PantryPal backend is LIVE!',
    time: new Date().toISOString(),
    status: 'ready for photo uploads & Firebase',
    developer: '@Kevin_Phan25'
  });
});

// ———————— Start Server ————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal API running on port ${PORT}`);
  console.log(`Visit: https://pantrypal.onrender.com`);
});

module.exports = app;
