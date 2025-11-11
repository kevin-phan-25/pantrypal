const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fetch = require('node-fetch');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// ———————— CREDENTIALS: LOAD FROM RENDER SECRET FILE ————————
let serviceAccount;
try {
  const secretsDir = '/var/render/secrets';
  const keyPath = path.join(secretsDir, 'gcloud-key.json');

  // Debug: show what's actually in the secrets directory
  if (fs.existsSync(secretsDir)) {
    const files = fs.readdirSync(secretsDir);
    console.log('Secret files found:', files);
  } else {
    console.log('No secret directory at /var/render/secrets');
  }

  if (!fs.existsSync(keyPath)) {
    console.error('ERROR: gcloud-key.json NOT FOUND at', keyPath);
    throw new Error(
      'gcloud-key.json is missing. Go to Render Dashboard → Secrets → Add Secret File → Name: gcloud-key.json → Paste your JSON and save.'
    );
  }

  serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  console.log('SUCCESS: Loaded gcloud-key.json from Render secrets');

} catch (err) {
  console.error('Failed to load credentials:', err.message);
  process.exit(1);
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Initialize Google Cloud Vision (automatically uses the same key)
const vision = new ImageAnnotatorClient();

// ———————— Express App Setup ————————
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// ———————— Your Routes Go Here ————————
// Example route to confirm it's working
app.get('/', (req, res) => {
  res.json({ message: 'PantryPal backend is running!', time: new Date().toISOString() });
});

// Add all your other routes below (upload, vision, push, etc.)
// Example:
// app.post('/upload', async (req, res) => { ... });

// ———————— Start Server ————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit: https://your-service-name.onrender.com`);
});

module.exports = app;
