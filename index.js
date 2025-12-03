const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true })); // Allow all for dev - restrict in prod
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } })); // 5MB images
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
  } catch {
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
  } catch {
    res.json({ items: [] });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { barcode, quantity = 1, expiration, name } = req.body;
    await db.collection('users').doc(decoded.uid).set({
      inventory: admin.firestore.FieldValue.arrayUnion({
        id: Date.now().toString(), // New: Unique ID
        barcode,
        name: name || barcode,
        quantity,
        expiration: expiration || null,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// New: Delete by ID
app.post('/api/inventory/delete', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { id } = req.body;
    const docRef = db.collection('users').doc(decoded.uid);
    const doc = await docRef.get();
    if (!doc.exists) return res.json({ success: false });
    let inventory = doc.data().inventory || [];
    inventory = inventory.filter(item => item.id !== id);
    await docRef.update({ inventory });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ========== SHOPPING LIST ==========
app.get('/api/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ list: doc.data()?.shopping || [] });
  } catch {
    res.json({ list: [] });
  }
});

app.post('/api/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { itemName, needed = 1 } = req.body;
    await db.collection('users').doc(decoded.uid).set({
      shopping: admin.firestore.FieldValue.arrayUnion({
        id: Date.now().toString(), // New: Unique ID
        itemName,
        needed,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// New: Delete by ID
app.post('/api/shopping/delete', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { id } = req.body;
    const docRef = db.collection('users').doc(decoded.uid);
    const doc = await docRef.get();
    if (!doc.exists) return res.json({ success: false });
    let shopping = doc.data().shopping || [];
    shopping = shopping.filter(item => item.id !== id);
    await docRef.update({ shopping });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
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
    const labels = result.labelAnnotations?.slice(0, 5).map(a => a.description).filter(l => l.length > 2); // Top 5 relevant
    await db.collection('users').doc(decoded.uid).set({
      scans: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
    res.json({ labels });
  } catch (err) {
    console.error('Vision error:', err.message);
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`PantryPal Pro LIVE on port ${PORT}`);
});
