const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Initialize Firebase Admin
const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString());
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

const db = admin.firestore();

// Middleware: Verify Firebase ID Token
async function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// === INVENTORY ===
app.get('/inventory', checkAuth, async (req, res) => {
  const snap = await db.collection('inventory').where('uid', '==', req.user.uid).get();
  const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json({ items });
});

app.post('/add-to-inventory', checkAuth, async (req, res) => {
  const { barcode, name, qty, exp } = req.body;
  await db.collection('inventory').add({
    uid: req.user.uid,
    barcode, name, qty: Number(qty), exp, addedAt: new Date()
  });
  res.json({ success: true });
});

// === SHOPPING LIST ===
app.get('/shopping', checkAuth, async (req, res) => {
  const snap = await db.collection('shopping').where('uid', '==', req.user.uid).get();
  const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json({ items });
});

app.post('/add-to-shopping', checkAuth, async (req, res) => {
  const { itemName, needed } = req.body;
  await db.collection('shopping').add({
    uid: req.user.uid,
    name: itemName,
    needed: Number(needed),
    addedAt: new Date()
  });
  res.json({ success: true });
});

// === MEAL PLAN ===
app.get('/meals', checkAuth, async (req, res) => {
  const doc = await db.collection('meals').doc(req.user.uid).get();
  res.json(doc.exists ? doc.data() : { meals: {} });
});

app.post('/save-meals', checkAuth, async (req, res) => {
  const { meals } = req.body;
  await db.collection('meals').doc(req.user.uid).set({ meals }, { merge: true });
  res.json({ success: true });
});

// === NUTRITION ANALYSIS (EDAMAM) ===
app.post('/nutrition', checkAuth, async (req, res) => {
  const { text } = req.body;
  const appId = process.env.EDAMAM_APP_ID;
  const appKey = process.env.EDAMAM_APP_KEY;

  if (!appId || !appKey) {
    return res.status(500).json({ error: 'Edamam API not configured' });
  }

  try {
    const response = await fetch(
      `https://api.edamam.com/api/nutrition-data?app_id=${appId}&app_key=${appKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingr: [text] })
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Edamam error:', err);
    res.status(500).json({ error: 'Nutrition analysis failed' });
  }
});

// === PRICE COMPARISON (Open Food Facts Open Prices) ===
app.get('/prices', checkAuth, async (req, res) => {
  const { item } = req.query;
  if (!item) return res.json({ prices: [] });

  try {
    const response = await fetch(
      `https://prices.openfoodfacts.org/api/v1/prices?product_name=${encodeURIComponent(item)}`
    );
    const data = await response.json();
    const prices = data.prices?.slice(0, 5).map(p => ({
      store: p.location || 'Unknown',
      price: p.price,
      currency: p.currency || 'USD'
    })) || [];
    res.json({ prices });
  } catch (err) {
    res.json({ prices: [] });
  }
});

// === USER INFO ===
app.get('/user-info', checkAuth, async (req, res) => {
  res.json({ isPro: false });
});

// Serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal running on port ${PORT}`);
  console.log(`Edamam: ${process.env.EDAMAM_APP_ID ? 'Configured' : 'MISSING'}`);
});
