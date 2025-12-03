const express = require('express');
const admin = require('firebase-admin');
require('dotenv').config();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.static('public'));

// Initialize Firebase Admin — MUST have FIREBASE_ADMIN_KEY env var
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
} catch (e) {
  console.error("FIREBASE_ADMIN_KEY is missing or invalid JSON");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Middleware: verify Firebase ID token
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const token = authHeader.split('Bearer ')[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Routes
app.post('/api/inventory', verifyToken, async (req, res) => {
  const { name, qty = 1, exp } = req.body;
  const ref = db.collection('users').doc(req.user.uid);
  await ref.set({
    inventory: admin.firestore.FieldValue.arrayUnion({
      id: Date.now() + Math.random(),
      name, qty, exp
    })
  }, { merge: true });
  res.json({ success: true });
});

app.post('/api/inventory/delete', verifyToken, async (req, res) => {
  const { id } = req.body;
  const ref = db.collection('users').doc(req.user.uid);
  const snap = await ref.get();
  const inventory = snap.data()?.inventory || [];
  await ref.update({ inventory: inventory.filter(i => i.id !== id) });
  res.json({ success: true });
});

app.post('/api/inventory', verifyToken, async (req, res) => { /* same as above */ });

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PantryPal running on port ${PORT}`));
