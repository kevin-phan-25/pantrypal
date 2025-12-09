const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();

const app = express();
app.use(cors({ origin: ['https://pantrypal-zdi4.onrender.com', 'http://localhost:3000'] }));
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());
app.use(express.static('public'));

// Firebase Admin
let serviceAccount;
try { serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY || require('./credentials.json')); } 
catch (e) { console.error('Invalid key'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Google Vision
const vision = new ImageAnnotatorClient({ credentials: JSON.parse(process.env.GCLOUD_KEY_JSON || '{}') });

async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = await admin.auth().verifyIdToken(token); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// Helper: Get user doc
const getUserRef = (uid) => db.collection('users').doc(uid);

// API: Get all data
app.get('/api/data', verifyToken, async (req, res) => {
  const doc = await getUserRef(req.user.uid).get();
  const data = doc.data() || {};
  res.json({
    rooms: data.rooms || { fridge: [], pantry: [], storage: [] },
    shopping: data.shopping || { list: [] }
  });
});

// Add item to room
app.post('/api/room/:room', verifyToken, async (req, res) => {
  const { room } = req.params;
  if (!['fridge', 'pantry', 'storage'].includes(room)) return res.status(400).json({ error: 'Invalid room' });

  let { name, image, quantity = 1, expiration } = req.body;
  name = (name || "Unknown Item").trim() || "Unknown Item";

  const item = {
    name,
    quantity: Number(quantity),
    addedAt: new Date().toISOString(),
    ...(image && { image }),
    ...(expiration && { expiration })
  };

  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const data = doc.exists ? doc.data() : {};
    const rooms = data.rooms || { fridge: [], pantry: [], storage: [] };
    rooms[room].push(item);
    t.set(getUserRef(req.user.uid), { rooms }, { merge: true });
  });
  res.json({ success: true });
});

// Edit item
app.put('/api/room/:room/:index', verifyToken, async (req, res) => {
  const { room, index } = req.params;
  const idx = parseInt(index);
  if (!['fridge', 'pantry', 'storage'].includes(room) || isNaN(idx)) return res.status(400).json({ error: 'Invalid' });

  const { name, quantity, expiration } = req.body;
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const rooms = doc.data()?.rooms || { fridge: [], pantry: [], storage: [] };
    if (!rooms[room][idx]) throw new Error('Not found');
    rooms[room][idx] = { ...rooms[room][idx], name: name?.trim() || rooms[room][idx].name, quantity: Number(quantity) || 1, expiration: expiration || null };
    t.update(getUserRef(req.user.uid), { rooms });
  });
  res.json({ success: true });
});

// Delete single
app.delete('/api/room/:room/:index', verifyToken, async (req, res) => {
  const { room, index } = req.params;
  const idx = parseInt(index);
  if (!['fridge', 'pantry', 'storage'].includes(room) || isNaN(idx)) return res.status(400).json({ error: 'Invalid' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const rooms = doc.data()?.rooms || { fridge: [], pantry: [], storage: [] };
    rooms[room].splice(idx, 1);
    t.update(getUserRef(req.user.uid), { rooms });
  });
  res.json({ success: true });
});

// Bulk delete
app.post('/api/room/:room/bulk-delete', verifyToken, async (req, res) => {
  const { room } = req.params;
  const { indices } = req.body;
  if (!['fridge', 'pantry', 'storage'].includes(room) || !Array.isArray(indices)) return res.status(400).json({ error: 'Invalid' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const rooms = doc.data()?.rooms || { fridge: [], pantry: [], storage: [] };
    indices.sort((a, b) => b - a).forEach(i => rooms[room].splice(i, 1));
    t.update(getUserRef(req.user.uid), { rooms });
  });
  res.json({ success: true });
});

// Shopping list (same as before)
app.get('/api/shopping', verifyToken, async (req, res) => {
  const doc = await getUserRef(req.user.uid).get();
  res.json(doc.data()?.shopping || { list: [] });
});

app.post('/api/shopping', verifyToken, async (req, res) => {
  const { itemName } = req.body;
  if (!itemName?.trim()) return res.status(400).json({ error: 'Invalid' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const data = doc.exists ? doc.data() : {};
    const list = (data.shopping?.list || []).concat({ itemName: itemName.trim(), addedAt: new Date().toISOString() });
    t.set(getUserRef(req.user.uid), { shopping: { list } }, { merge: true });
  });
  res.json({ success: true });
});

app.delete('/api/shopping/:index', verifyToken, async (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const list = doc.data()?.shopping?.list || [];
    list.splice(idx, 1);
    t.update(getUserRef(req.user.uid), { 'shopping.list': list });
  });
  res.json({ success: true });
});

// AI Scan
app.post('/api/scan', verifyToken, async (req, res) => {
  try {
    if (!req.files?.image) return res.status(400).json({ error: 'No image' });
    const [result] = await vision.labelDetection(req.files.image.data);
    const labels = result.labelAnnotations?.map(l => l.description) || [];
    res.json({ labels: labels.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: 'AI failed' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`PantryPal Pro LIVE on port ${PORT}`));
