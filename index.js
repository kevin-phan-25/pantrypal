const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// CORS - allow your frontend
app.use(cors({
  origin: ['https://pantrypal-zdi4.onrender.com', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Admin Setup
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
} catch (e) {
  console.error('Invalid FIREBASE_ADMIN_KEY');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// === MIDDLEWARE: Verify Firebase ID Token ===
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verify failed:', err.message);
    res.status(401).json({ error: 'Invalid token' });
  }
}

// === USER INFO ===
app.get('/api/user-info', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data = userDoc.data() || {};
    res.json({
      isPro: data.isPro === true,
      scans: data.scans || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === INVENTORY ===
app.get('/api/inventory', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('inventories').doc(req.user.uid).get();
    if (!doc.exists) {
      return res.json({ items: [] });
    }
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory', verifyToken, async (req, res) => {
  try {
    const { name, barcode, quantity = 1, expiration = null } = req.body;

    if (!name && !barcode) return res.status(400).json({ error: 'Name or barcode required' });

    const item = {
      name: name || barcode,
      barcode: barcode || null,
      quantity,
      expiration,
      addedAt: new Date().toISOString()
    };

    const ref = db.collection('inventories').doc(req.user.uid);
    const doc = await ref.get();

    if (doc.exists) {
      await ref.update({
        items: admin.firestore.FieldValue.arrayUnion(item)
      });
    } else {
      await ref.set({ items: [item] });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Inventory save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// === SHOPPING LIST ===
app.get('/api/shopping', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('shopping').doc(req.user.uid).get();
    if (!doc.exists) return res.json({ list: [] });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shopping', verifyToken, async (req, res) => {
  try {
    const { itemName } = req.body;
    if (!itemName) return res.status(400).json({ error: 'Item name required' });

    const item = { itemName, addedAt: new Date().toISOString() };

    const ref = db.collection('shopping').doc(req.user.uid);
    const doc = await ref.get();

    if (doc.exists) {
      await ref.update({
        list: admin.firestore.FieldValue.arrayUnion(item)
      });
    } else {
      await ref.set({ list: [item] });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === SAVE PUSH TOKEN (for future notifications) ===
app.post('/api/save-token', verifyToken, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token' });

  await db.collection('push_tokens').doc(req.user.uid).set({
    token,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  res.json({ success: true });
});

// === SERVE FRONTEND ===
app.get('*', (req, res) => {
  {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PantryPal backend running on port ${PORT}`);
  console.log(`Visit: https://pantrypal-zdi4.onrender.com`);
});
