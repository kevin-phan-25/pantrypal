const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

// === FIREBASE & VISION SETUP ===
let serviceAccount;
try {
  const rawKey = process.env.GCLOUD_KEY_JSON;
  if (!rawKey) throw new Error('GCLOUD_KEY_JSON missing');
  serviceAccount = JSON.parse(rawKey);
  if (!serviceAccount.project_id) throw new Error('project_id missing');
  console.log('SUCCESS: Loaded project', serviceAccount.project_id);
} catch (err) {
  console.error('FATAL:', err.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const vision = new ImageAnnotatorClient();

// === EXPRESS SETUP ===
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// === SERVE FRONTEND UI ===
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/inventory') || req.path.startsWith('/shopping') || req.path.startsWith('/scan') || req.path.startsWith('/user-info')) {
    return next(); // Let API routes handle these
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === API ROUTES ===

// USER INFO (for pro status & scan count)
app.get('/user-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({
      isPro: data.isPro || false,
      scans: data.scans || 0
    });
  } catch (err) {
    res.json({ isPro: false, scans: 0 });
  }
});

// GET INVENTORY
app.get('/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ items: data.inventory || [] });
  } catch (err) {
    console.error('GET /inventory error:', err);
    res.status(500).json({ items: [] });
  }
});

// ADD TO INVENTORY
app.post('/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { barcode, quantity = 1, expiration } = req.body;
    const userRef = db.collection('users').doc(decoded.uid);
    await userRef.set({
      inventory: admin.firestore.FieldValue.arrayUnion({
        barcode,
        name: barcode,
        quantity,
        expiration: expiration || null,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    console.log(`Added to inventory: ${barcode} x${quantity}`);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /inventory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET SHOPPING LIST
app.get('/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ list: data.shopping || [] });
  } catch (err) {
    res.status(500).json({ list: [] });
  }
});

// ADD TO SHOPPING LIST
app.post('/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { itemName, needed = 1 } = req.body;
    const userRef = db.collection('users').doc(decoded.uid);
    await userRef.set({
      shopping: admin.firestore.FieldValue.arrayUnion({
        itemName,
        needed,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /shopping error:', err);
    res.status(500).json({ error: err.message });
  }
});

// AI SCAN (IMAGE UPLOAD)
app.post('/scan', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    if (!req.files || !req.files.image) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const image = req.files.image;
    const [result] = await vision.textDetection(image.data);
    const detections = result.textAnnotations;

    const userRef = db.collection('users').doc(decoded.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const isPro = userData.isPro || false;
    const scans = (userData.scans || 0) + 1;

    if (!isPro && scans > 10) {
      return res.json({ error: 'Free scan limit reached. Upgrade to Pro!', detections: null });
    }

    await userRef.set({ scans }, { merge: true });

    res.json({
      success: true,
      text: detections ? detections[0]?.description || 'No text found' : 'No text found',
      detections
    });
  } catch (err) {
    console.error('SCAN error:', err);
    res.status(500).json({ error: err.message });
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal LIVE at https://pantrypal-zdi4.onrender.com on port ${PORT}`);
  console.log(`UI: https://pantrypal-zdi4.onrender.com`);
});
