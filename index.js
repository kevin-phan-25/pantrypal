const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

const app = express();

// Enhanced CORS for Render
app.use(cors({
  origin: ['https://pantrypal-zdi4.onrender.com', 'https://pantrypal-zdi4.onrender.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

console.log('Starting PantryPal backend...');

// Firebase Admin
let firebaseKey;
try {
  firebaseKey = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  console.log('Firebase Admin loaded:', firebaseKey.project_id);
} catch (err) {
  console.error('FATAL: FIREBASE_ADMIN_KEY invalid');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(firebaseKey) });
const db = admin.firestore();

// Google Vision
let visionKey;
try {
  visionKey = JSON.parse(process.env.GCLOUD_KEY_JSON);
  console.log('Google Vision loaded:', visionKey.project_id);
} catch (err) {
  console.error('FATAL: GCLOUD_KEY_JSON invalid');
  process.exit(1);
}
const vision = new ImageAnnotatorClient({ credentials: visionKey });

// Serve frontend
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API with logs
app.get('/api/user-info', async (req, res) => {
  console.log('GET /api/user-info - token:', req.headers.authorization ? 'present' : 'missing');
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ isPro: data.isPro === true, scans: data.scans || 0 });
  } catch (err) {
    console.error('User-info error:', err.message);
    res.status(401).json({ error: err.message });
  }
});

// Similar logs for /api/inventory, /api/shopping, /api/scan - add console.log('Endpoint hit') to each

// Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PantryPal backend listening on port ${PORT}`);
});
