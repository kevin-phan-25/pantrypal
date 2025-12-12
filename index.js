const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();

app.use(cors({ origin: ['https://pantrypal-zdi4.onrender.com', 'http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }));
app.use(express.static('public'));

// Firebase Admin
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY || require('./credentials.json'));
} catch (e) { process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Google Vision
const vision = new ImageAnnotatorClient({ credentials: JSON.parse(process.env.GCLOUD_KEY_JSON || '{}') });

// OpenAI for recipes
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Auth middleware
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

const getUserRef = uid => db.collection('users').doc(uid);

// User data (rooms, shopping, settings)
app.get('/api/data', verifyToken, async (req, res) => {
  try {
    const doc = await getUserRef(req.user.uid).get();
    res.json(doc.data() || { rooms: { fridge: [], pantry: [], storage: [] }, shopping: { list: [] }, settings: { notifications: true, subscription: 'free' } });
  } catch (e) { res.status(500).json({ error: 'Load failed' }); }
});

// Add to room
app.post('/api/room/:room', verifyToken, async (req, res) => {
  const { room } = req.params;
  if (!['fridge', 'pantry', 'storage'].includes(room)) return res.status(400).json({ error: 'Invalid room' });
  let { name, image, quantity = 1, expiration } = req.body;
  name = (name || "Unknown Item").trim() || "Unknown Item";
  const item = { name, quantity: Number(quantity), addedAt: admin.firestore.FieldValue.serverTimestamp(), ...(image && { image }), ...(expiration && { expiration }) };
  await db.runTransaction(async t => {
    const doc = await t.get(getUserRef(req.user.uid));
    const data = doc.exists ? doc.data() : {};
    const rooms = data.rooms || { fridge: [], pantry: [], storage: [] };
    rooms[room].push(item);
    t.set(getUserRef(req.user.uid), { rooms }, { merge: true });
  });
  res.json({ success: true });
});

// AI Scan
app.post('/api/scan', verifyToken, async (req, res) => {
  try {
    if (!req.files?.image) return res.status(400).json({ error: 'No image' });
    const file = req.files.image;
    const [result] = await vision.labelDetection({ image: { content: file.data.toString('base64') } });
    const labels = result.labelAnnotations?.map(l => ({ description: l.description, score: l.score })) || [];
    const foodKeywords = ['food','fruit','vegetable','drink','snack','ingredient','produce','dairy','meat','bread','milk','egg','cheese','yogurt','chicken','beef','apple','banana','tomato','potato','rice','pasta','oil','butter','juice','cereal','chocolate','cookie','sandwich','pizza','salad','soup','fish','nuts','cake','noodle','veggie','berry','citrus','grain'];
    const detected = labels
      .filter(l => l.score > 0.5)
      .map(l => l.description.toLowerCase())
      .filter(d => foodKeywords.some(k => d.includes(k) || k.includes(d)))
      .map(d => d.charAt(0).toUpperCase() + d.slice(1).replace(/ [a-z]/g, m => m.toUpperCase()))
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .slice(0, 12);
    res.json({ labels: detected.length > 0 ? detected : labels.slice(0, 8).map(l => l.description) });
  } catch (err) {
    console.error('Vision error:', err);
    res.status(500).json({ error: 'AI scan failed' });
  }
});

// Shopping
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
    const list = (data.shopping?.list || []).concat({ itemName: itemName.trim(), addedAt: admin.firestore.FieldValue.serverTimestamp() });
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

// Room delete
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

// Subscription (Stripe)
app.post('/api/subscribe', verifyToken, async (req, res) => {
  const { priceId } = req.body;
  const customer = await stripe.customers.create({ email: req.user.email });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });
  await db.collection('users').doc(req.user.uid).update({ subscription: subscription.id });
  res.json({ clientSecret: subscription.latest_invoice.payment_intent.client_secret });
});

app.get('/api/subscription', verifyToken, async (req, res) => {
  const doc = await db.collection('users').doc(req.user.uid).get();
  const subId = doc.data()?.subscription;
  if (!subId) return res.json({ status: 'free' });
  const subscription = await stripe.subscriptions.retrieve(subId);
  res.json({ status: subscription.status, tier: subscription.items.data[0].price.nickname });
});

// Expiration notifications (cron job or Cloud Function - call this daily)
app.post('/api/check-expirations', async (req, res) => {
  // This would be a Cloud Function triggered daily
  const snapshot = await db.collection('users').get();
  snapshot.docs.forEach(async doc => {
    const data = doc.data();
    const rooms = data.rooms || {};
    Object.values(rooms).flat().forEach(item => {
      if (item.expiration && new Date(item.expiration) - Date.now() < 3 * 24 * 60 * 60 * 1000) {
        // Send push via FCM
        const messaging = admin.messaging();
        const message = {
          notification: {
            title: 'Expiring Soon!',
            body: `${item.name} expires in ${Math.ceil((new Date(item.expiration) - Date.now()) / 86400000)} days!`
          },
          token: data.pushToken
        };
        messaging.send(message);
      }
    });
  });
  res.json({ success: true });
});

// Recipe suggestions (OpenAI)
app.post('/api/recipes', verifyToken, async (req, res) => {
  const { items } = req.body;
  const prompt = `Suggest 3 simple recipes using these ingredients: ${items.join(', ')}. Include steps and time.`;
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }]
  });
  res.json({ recipes: completion.choices[0].message.content });
});

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`PantryPal Pro LIVE on port ${PORT}`));
