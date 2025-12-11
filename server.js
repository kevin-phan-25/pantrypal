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
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } })); // 5MB limit
app.use(express.static('public'));

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY || require('./credentials.json'));
} catch (e) {
  console.error('Firebase credentials missing'); process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const vision = new ImageAnnotatorClient({ 
  keyFilename: process.env.GCLOUD_KEY_PATH || undefined,
  projectId: process.env.GCLOUD_PROJECT_ID || 'pantrypal-6e410'
}); // Use env for prod

async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

const getUserRef = uid => db.collection('users').doc(uid);

app.get('/api/data', verifyToken, async (req, res) => {
  try {
    const doc = await getUserRef(req.user.uid).get();
    res.json(doc.data() || { rooms: { fridge: [], pantry: [], storage: [] }, shopping: { list: [] } });
  } catch (e) {
    res.status(500).json({ error: 'Load failed' });
  }
});

app.post('/api/room/:room', verifyToken, async (req, res) => {
  const { room } = req.params;
  if (!['fridge', 'pantry', 'storage'].includes(room)) return res.status(400).json({ error: 'Invalid room' });
  let { name, image, quantity = 1, expiration } = req.body;
  name = (name || "Unknown Item").trim() || "Unknown Item";
  const item = { 
    name, 
    quantity: Number(quantity), 
    addedAt: admin.firestore.FieldValue.serverTimestamp(), 
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

// AI SCAN — FIXED: Lower threshold, expanded keywords, better matching
app.post('/api/scan', verifyToken, async (req, res) => {
  try {
    if (!req.files?.image) return res.status(400).json({ error: 'No image uploaded' });
    const file = req.files.image;
    if (file.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (>5MB)' });

    const [result] = await vision.labelDetection({ image: { content: file.data.toString('base64') } });
    const labels = result.labelAnnotations?.map(l => ({ description: l.description, score: l.score })) || [];
    console.log('Vision labels:', labels.map(l => `${l.description} (${l.score})`));

    const foodKeywords = [
      'food', 'fruit', 'vegetable', 'drink', 'snack', 'ingredient', 'produce', 'dairy', 'meat', 'bread', 
      'milk', 'egg', 'cheese', 'yogurt', 'chicken', 'beef', 'apple', 'banana', 'tomato', 'potato', 
      'rice', 'pasta', 'oil', 'butter', 'juice', 'cereal', 'chocolate', 'cookie', 'sandwich', 'pizza', 
      'salad', 'soup', 'fish', 'nuts', 'cake', 'pasta', 'noodle', 'veggie', 'berry', 'citrus', 'grain'
    ];
    const detected = labels
      .filter(l => l.score > 0.5) // Lowered for more detections
      .map(l => l.description.toLowerCase())
      .filter(d => foodKeywords.some(k => d.includes(k) || k.includes(d))) // Bidirectional
      .map(d => d.charAt(0).toUpperCase() + d.slice(1).replace(/ [a-z]/g, m => m.toUpperCase())) // Capitalize properly
      .filter((d, i, arr) => arr.indexOf(d) === i) // Dedupe
      .slice(0, 12);

    const responseLabels = detected.length > 0 ? detected : labels.slice(0, 8).map(l => l.description);
    res.json({ labels: responseLabels });
  } catch (err) {
    console.error('Vision error:', err);
    res.status(500).json({ error: 'AI scan failed. Check credentials/quota.' });
  }
});

// Shopping List Routes
app.get('/api/shopping', verifyToken, async (req, res) => {
  try {
    const doc = await getUserRef(req.user.uid).get();
    res.json(doc.data()?.shopping || { list: [] });
  } catch (e) {
    res.status(500).json({ error: 'Load failed' });
  }
});

app.post('/api/shopping', verifyToken, async (req, res) => {
  const { itemName } = req.body;
  if (!itemName?.trim()) return res.status(400).json({ error: 'Invalid item' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const data = doc.exists ? doc.data() : {};
    const list = (data.shopping?.list || []).concat({ 
      itemName: itemName.trim(), 
      addedAt: admin.firestore.FieldValue.serverTimestamp() 
    });
    t.set(getUserRef(req.user.uid), { shopping: { list } }, { merge: true });
  });
  res.json({ success: true });
});

app.delete('/api/shopping/:index', verifyToken, async (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const list = doc.data()?.shopping?.list || [];
    if (idx < 0 || idx >= list.length) return res.status(400).json({ error: 'Out of bounds' });
    list.splice(idx, 1);
    t.update(getUserRef(req.user.uid), { 'shopping.list': list });
  });
  res.json({ success: true });
});

// Room Delete Routes
app.delete('/api/room/:room/:index', verifyToken, async (req, res) => {
  const { room, index } = req.params;
  const idx = parseInt(index);
  if (!['fridge', 'pantry', 'storage'].includes(room) || isNaN(idx)) return res.status(400).json({ error: 'Invalid' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const rooms = doc.data()?.rooms || { fridge: [], pantry: [], storage: [] };
    if (idx < 0 || idx >= rooms[room].length) return res.status(400).json({ error: 'Out of bounds' });
    rooms[room].splice(idx, 1);
    t.update(getUserRef(req.user.uid), { rooms });
  });
  res.json({ success: true });
});

app.post('/api/room/:room/bulk-delete', verifyToken, async (req, res) => {
  const { room } = req.params;
  const { indices } = req.body;
  if (!['fridge', 'pantry', 'storage'].includes(room) || !Array.isArray(indices)) return res.status(400).json({ error: 'Invalid' });
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const rooms = doc.data()?.rooms || { fridge: [], pantry: [], storage: [] };
    indices.sort((a, b) => b - a).forEach(i => {
      if (i >= 0 && i < rooms[room].length) rooms[room].splice(i, 1);
    });
    t.update(getUserRef(req.user.uid), { rooms });
  });
  res.json({ success: true });
});

// Serve index.html for all non-API routes
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`PantryPal Pro LIVE on port ${PORT}`));
