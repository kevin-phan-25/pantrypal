const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();

const app = express();

app.use(cors({ origin: ['https://pantrypal-zdi4.onrender.com', 'http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
} catch (e) { console.error('Invalid FIREBASE_ADMIN_KEY'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const vision = new ImageAnnotatorClient({ credentials: JSON.parse(process.env.GCLOUD_KEY_JSON) });

async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// USER INFO
app.get('/api/user-info', verifyToken, async (req, res) => {
  const doc = await db.collection('users').doc(req.user.uid).get();
  const data = doc.data() || {};
  res.json({ isPro: data.isPro === true, scans: data.scans || 0 });
});

// INVENTORY
app.get('/api/inventory', verifyToken, async (req, res) => {
  const doc = await db.collection('inventories').doc(req.user.uid).get();
  res.json(doc.exists ? doc.data() : { items: [] });
});

app.post('/api/inventory', verifyToken, async (req, res) => {
  const { name, quantity = 1, expiration } = req.body;
  const item = { name, quantity, expiration, addedAt: new Date().toISOString() };
  const ref = db.collection('inventories').doc(req.user.uid);
  const doc = await ref.get();
  if (doc.exists) {
    await ref.update({ items: admin.firestore.FieldValue.arrayUnion(item) });
  } else {
    await ref.set({ items: [item] });
  }
  res.json({ success: true });
});

// SHOPPING
app.get('/api/shopping', verifyToken, async (req, res) => {
  const doc = await db.collection('shopping').doc(req.user.uid).get();
  res.json(doc.exists ? doc.data() : { list: [] });
});

app.post('/api/shopping', verifyToken, async (req, res) => {
  const { itemName } = req.body;
  const item = { itemName, addedAt: new Date().toISOString() };
  const ref = db.collection('shopping').doc(req.user.uid);
  const doc = await ref.get();
  if (doc.exists) {
    await ref.update({ list: admin.firestore.FieldValue.arrayUnion(item) });
  } else {
    await ref.set({ list: [item] });
  }
  res.json({ success: true });
});

// AI SCAN - WORKING
app.post('/api/scan', verifyToken, async (req, res) => {
  try {
    if (!req.files || !req.files.image) return res.status(400).json({ error: 'No image' });
    const [result] = await vision.labelDetection(req.files.image.data);
    const labels = result.labelAnnotations || [];
    const foodKeywords = ['food','fruit','vegetable','drink','snack','ingredient','produce','dairy','meat','bread','milk','egg','cheese','yogurt','chicken','beef','apple','banana','tomato','potato','rice','pasta','oil','butter','juice'];
    const detected = labels
      .filter(l => l.score > 0.7)
      .map(l => l.description.toLowerCase())
      .filter(desc => foodKeywords.some(k => desc.includes(k)))
      .map(desc => desc.charAt(0).toUpperCase() + desc.slice(1))
      .slice(0, 15);
    res.json({ labels: detected.length > 0 ? detected : labels.slice(0, 8).map(l => l.description) });
  } catch (err) {
    console.error('Vision error:', err);
    res.status(500).json({ error: 'AI scan failed' });
  }
});

// SERVE FRONTEND
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`PantryPal Pro LIVE on port ${PORT}`));
