// index.js – PantryPal AI + Firestore + PWA + Google Auth (NO PUSH)
import express from 'express';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import vision from '@google-cloud/vision';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));
app.use(express.static(path.join(__dirname, 'public')));

// === Firebase Admin ===
let credential;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    credential = cert(JSON.parse(process.env.FIREBASE_CREDENTIALS));
    console.log('Using FIREBASE_CREDENTIALS env var');
  } else if (fs.existsSync('./credentials.json')) {
    credential = cert('./credentials.json');
    console.log('Using ./credentials.json');
  } else {
    throw new Error('No Firebase credentials');
  }
  initializeApp({ credential });
  console.log('Firebase Admin OK');
} catch (err) {
  console.error('Firebase init failed:', err.message);
  process.exit(1);
}

const auth = getAuth();
const db = getFirestore();
const visionClient = new vision.ImageAnnotatorClient();

// === Auth Middleware ===
async function checkAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = header.split(' ')[1];
  try {
    req.user = await auth.verifyIdToken(token);
    const userRef = db.collection('users').doc(req.user.uid);
    const doc = await userRef.get();
    if (!doc.exists) {
      await userRef.set({ scans: 0, isPro: false, createdAt: FieldValue.serverTimestamp() });
    }
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// === AI SCAN (Improved for Image Upload) ===
app.post('/scan', checkAuth, async (req, res) => {
  if (!req.files?.image) {
    console.error('No image uploaded');
    return res.status(400).json({ error: 'No image uploaded' });
  }

  try {
    const [result] = await visionClient.textDetection({ image: { content: req.files.image.data } });
    const text = result.textAnnotations?.[0]?.description || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const itemName = lines[0] || 'Unknown';
    const expMatch = lines.find(l => /\d{4}-\d{2}-\d{2}/.test(l));
    const expirationDate = expMatch || '';
    const barcodeMatch = lines.find(l => /^\d{8,}$/.test(l)) || req.body.barcode || '';

    console.log('AI Scan Result:', { itemName, expirationDate, barcodeMatch, fullText: text });

    if (barcodeMatch) {
      const ref = db.collection('users').doc(req.user.uid).collection('items').doc(barcodeMatch);
      const doc = await ref.get();
      if (doc.exists) {
        await ref.update({ name: itemName, expiration: expirationDate || doc.data().expiration });
      } else {
        await ref.set({
          name: itemName,
          barcode: barcodeMatch,
          quantity: 1,
          expiration: expirationDate,
          addedAt: FieldValue.serverTimestamp()
        });
      }
    }

    res.json({
      success: true,
      record: { itemName, expirationDate, barcode: barcodeMatch, detectedText: text }
    });
  } catch (err) {
    console.error('AI Scan Error:', err);
    res.status(500).json({ error: 'Failed to process image: ' + err.message });
  }
});

// === ADD TO INVENTORY ===
app.post('/add', checkAuth, async (req, res) => {
  const { barcode, quantity = 1, expiration = '', name } = req.body;
  const userId = req.user.uid;
  if (!barcode) return res.status(400).json({ error: 'barcode required' });
  const ref = db.collection('users').doc(userId).collection('items').doc(barcode);
  const doc = await ref.get();
  if (doc.exists) {
    await ref.update({
      quantity: FieldValue.increment(parseInt(quantity)),
      expiration: expiration || doc.data().expiration
    });
  } else {
    await ref.set({
      name: name || barcode,
      quantity: parseInt(quantity),
      expiration,
      addedAt: FieldValue.serverTimestamp()
    });
  }
  res.json({ success: true });
});

// === ADD TO SHOPPING LIST ===
app.post('/add-to-shopping', checkAuth, async (req, res) => {
  const { barcode, itemName, needed = 1 } = req.body;
  const userId = req.user.uid;
  if (!barcode || !itemName) return res.status(400).json({ error: 'barcode and itemName required' });
  const ref = db.collection('users').doc(userId).collection('shopping').doc(barcode);
  const doc = await ref.get();
  if (doc.exists) {
    await ref.update({ needed: FieldValue.increment(parseInt(needed)) });
  } else {
    await ref.set({ itemName, needed: parseInt(needed), addedAt: FieldValue.serverTimestamp() });
  }
  res.json({ success: true });
});

// === GET INVENTORY ===
app.get('/inventory', checkAuth, async (req, res) => {
  const snapshot = await db.collection('users').doc(req.user.uid).collection('items').get();
  const items = snapshot.docs.map(d => ({ barcode: d.id, ...d.data() }));
  res.json({ items });
});

// === GET SHOPPING LIST ===
app.get('/shopping', checkAuth, async (req, res) => {
  const snapshot = await db.collection('users').doc(req.user.uid).collection('shopping').get();
  const list = snapshot.docs.map(d => ({ barcode: d.id, ...d.data() }));
  res.json({ list });
});

// === REMOVE FROM INVENTORY ===
app.post('/remove', checkAuth, async (req, res) => {
  const { barcode } = req.body;
  await db.collection('users').doc(req.user.uid).collection('items').doc(barcode).delete();
  res.json({ success: true });
});

// === REMOVE FROM SHOPPING ===
app.post('/remove-from-shopping', checkAuth, async (req, res) => {
  const { barcode } = req.body;
  await db.collection('users').doc(req.user.uid).collection('shopping').doc(barcode).delete();
  res.json({ success: true });
});

// === PRODUCT INFO (Open Food Facts) ===
app.get('/product-info/:barcode', checkAuth, async (req, res) => {
  const { barcode } = req.params;
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await response.json();
    if (data.status === 1) {
      const p = data.product;
      res.json({
        name: p.product_name || p.generic_name || barcode,
        image: p.image_front_thumb_url || p.image_small_url || null
      });
    } else {
      res.json({ name: barcode, image: null });
    }
  } catch (err) {
    console.error('OFF API error:', err);
    res.json({ name: barcode, image: null });
  }
});

// === USER INFO (scan count + pro status) ===
app.get('/user-info', checkAuth, async (req, res) => {
  const snap = await db.collection('users').doc(req.user.uid).get();
  const data = snap.data();
  res.json({ scans: data.scans || 0, isPro: !!data.isPro });
});

// === RECORD SCAN (free limit 10) ===
app.post('/record-scan', checkAuth, async (req, res) => {
  const userRef = db.collection('users').doc(req.user.uid);
  const snap = await userRef.get();
  const data = snap.data();

  if (data.isPro) {
    return res.json({ allowed: true });
  }

  const newCount = (data.scans || 0) + 1;
  if (newCount > 10) {
    return res.json({ allowed: false, message: 'Free limit reached (10 scans). Upgrade to Pro!' });
  }

  await userRef.update({ scans: newCount });
  res.json({ allowed: true });
});

// === EXPORT INVENTORY CSV ===
app.get('/export-csv', checkAuth, async (req, res) => {
  const snapshot = await db.collection('users').doc(req.user.uid).collection('items').get();
  const items = snapshot.docs.map(d => ({ barcode: d.id, ...d.data() }));
  const csv = [
    ['Barcode', 'Name', 'Quantity', 'Expiration'],
    ...items.map(i => [i.barcode, i.name || i.barcode, i.quantity, i.expiration || ''])
  ].map(row => row.join(',')).join('\n');

  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="pantrypal-inventory.csv"');
  res.send(csv);
});

// === SERVE PWA ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PantryPal running on port ${PORT}`);
});
