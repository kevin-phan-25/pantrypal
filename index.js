const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// ========== FIREBASE ADMIN ==========
let firebaseKey;
try {
  firebaseKey = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  console.log('Firebase Admin loaded:', firebaseKey.project_id);
} catch (err) {
  console.error('FATAL: FIREBASE_ADMIN_KEY missing or invalid');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(firebaseKey)
});
const db = admin.firestore();

// ========== GOOGLE VISION ==========
let visionKey;
try {
  visionKey = JSON.parse(process.env.GCLOUD_KEY_JSON);
  console.log('Google Vision loaded:', visionKey.project_id);
} catch (err) {
  console.error('FATAL: GCLOUD_KEY_JSON missing or invalid');
  process.exit(1);
}
const vision = new ImageAnnotatorClient({ credentials: visionKey });

// ========== SERVE UI ==========
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== USER INFO ==========
app.get('/api/user-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ isPro: data.isPro === true, scans: data.scans || 0 });
  } catch (err) {
    console.error('User info error:', err);
    res.json({ isPro: false, scans: 0 });
  }
});

// ========== INVENTORY ==========
app.get('/api/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ items: doc.data()?.inventory || [] });
  } catch (err) {
    console.error('Inventory GET error:', err);
    res.json({ items: [] });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { barcode, quantity = 1, expiration, inventory } = req.body; // Support full replace for delete

    if (inventory) {
      // Full replace (for delete)
      await db.collection('users').doc(decoded.uid).set({ inventory }, { merge: true });
    } else {
      // Add single
      await db.collection('users').doc(decoded.uid).set({
        inventory: admin.firestore.FieldValue.arrayUnion({
          barcode,
          name: barcode, // TODO: Add Open Food Facts lookup
          quantity,
          expiration: expiration || null,
          addedAt: new Date().toISOString()
        })
      }, { merge: true });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Inventory POST error:', err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ========== SHOPPING LIST ==========
app.get('/api/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ list: doc.data()?.shopping || [] });
  } catch (err) {
    console.error('Shopping GET error:', err);
    res.json({ list: [] });
  }
});

app.post('/api/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { itemName, needed = 1, shopping } = req.body; // Support full replace

    if (shopping) {
      // Full replace (for delete)
      await db.collection('users').doc(decoded.uid).set({ shopping }, { merge: true });
    } else {
      // Add single
      await db.collection('users').doc(decoded.uid).set({
        shopping: admin.firestore.FieldValue.arrayUnion({
          itemName,
          needed,
          addedAt: new Date().toISOString()
        })
      }, { merge: true });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Shopping POST error:', err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ========== AI SCAN ==========
app.post('/api/scan', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await admin.auth().verifyIdToken(token);
    if (!req.files?.image) return res.status(400).json({ error: 'No image' });
    const [result] = await vision.labelDetection(req.files.image.data);
    const labels = result.labelAnnotations?.map(a => a.description) || [];
    await db.collection('users').doc(decoded.uid).update({
      scans: admin.firestore.FieldValue.increment(1)
    });
    res.json({ labels });
  } catch (err) {
    console.error('Vision error:', err.message);
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal Pro LIVE → ${window.location.origin || 'http://localhost:' + PORT}`);
});
