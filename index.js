const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');

// ———————— LOAD CREDENTIALS FROM ENV VAR (RELIABLE) ————————
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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const vision = new ImageAnnotatorClient();

// ———————— Express App ————————
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// Test route
app.get('/', (req, res) => {
  res.json({
    message: 'PantryPal backend is LIVE!',
    time: new Date().toISOString(),
    status: 'ready',
    developer: '@Kevin_Phan25',
    time_est: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  });
});

// ———————— API ROUTES (REQUIRED FOR FRONTEND) ————————
app.get('/meals', async (req, res) => {
  res.json({ meals: {} }); // In real app: fetch from Firestore
});

app.post('/save-meals', async (req, res) => {
  try {
    console.log('Meals saved:', req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/add-to-shopping', async (req, res) => {
  try {
    console.log('Added to shopping:', req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/nutrition', async (req, res) => {
  // Mock response — replace with real Edamam API later
  res.json({
    calories: 1850,
    totalNutrients: {
      PROCNT: { quantity: 92 },
      CHOCDF: { quantity: 210 },
      FAT: { quantity: 78 }
    }
  });
});

// ———————— Start Server ————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal API running on port ${PORT}`);
  console.log(`Backend: https://pantrypal.onrender.com`);
  console.log(`Time (EST): ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
});

module.exports = app;
