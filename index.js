const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.GCLOUD_KEY_JSON);
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

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// SERVE UI
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/inventory') || req.path.startsWith('/shopping') || req.path.startsWith('/scan') || req.path.startsWith('/user-info')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// USER INFO
app.get('/user-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ isPro: data.isPro || false, scans: data.scans || 0 });
  } catch {
    res.json({ isPro: false, scans: 0 });
  }
});

// INVENTORY
app.get('/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ items: doc.data()?.inventory || [] });
  } catch {
    res.json({ items: [] });
  }
});

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
        expiration,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// SHOPPING
app.get('/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ list: doc.data()?.shopping || [] });
  } catch {
    res.json({ list: [] });
  }
});

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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal LIVE at https://pantrypal-zdi4.onrender.com on port ${PORT}`);
});
