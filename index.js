const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path'); // ADD THIS LINE

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

// API ROUTES
app.get('/meals', async (req, res) => {
  res.json({ meals: {} });
});

app.post('/save-meals', async (req, res) => {
  console.log('Meals saved:', req.body);
  res.json({ success: true });
});

app.post('/add-to-shopping', async (req, res) => {
  console.log('Added to shopping:', req.body);
  res.json({ success: true });
});

app.post('/nutrition', async (req, res) => {
  res.json({
    calories: 1850,
    totalNutrients: {
      PROCNT: { quantity: 92 },
      CHOCDF: { quantity: 210 },
      FAT: { quantity: 78 }
    }
  });
});

// ———————— SERVE THE UI AT ROOT ————————
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static files (icons, manifest, etc.)
app.use(express.static(__dirname));

// ———————— Start Server ————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal running on port ${PORT}`);
  console.log(`GO TO: https://pantrypal-zdi4.onrender.com`);
});
