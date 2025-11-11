const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');

// ———————— LOAD CREDENTIALS FROM RENDER SECRET FILE ————————
let serviceAccount;
try {
  const keyPath = '/var/render/secrets/gcloud-key.json';

  // This WILL work now that you re-added it
  if (!fs.existsSync(keyPath)) {
    // Final fallback: show what Render actually sees
    console.error('gcloud-key.json NOT found!');
    if (fs.existsSync('/var/render/secrets')) {
      const files = fs.readdirSync('/var/render/secrets');
      console.error('Available secret files:', files);
    }
    throw new Error('Secret file missing. Re-add it as exactly: gcloud-key.json');
  }

  serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  console.log('SUCCESS: Loaded gcloud-key.json from Render secrets');

} catch (err) {
  console.error('Credential error:', err.message);
  process.exit(1);
}

// Initialize Firebase & Vision
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const vision = new ImageAnnotatorClient();

// ———————— Express Setup ————————
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'PantryPal backend is LIVE!', time: new Date().toISOString() });
});

// ———————— Start Server ————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal server running on port ${PORT}`);
});

module.exports = app;
