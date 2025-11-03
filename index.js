import express from 'express';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import vision from '@google-cloud/vision';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(fileUpload());
app.use(express.static('public'));

initializeApp({ credential: cert('./serviceAccount.json') });
const auth = getAuth();
const db = getFirestore();
const client = new vision.ImageAnnotatorClient();

// === AUTH MIDDLEWARE ===
async function checkAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.split('Bearer ')[1];
  try {
  const decoded = await auth.verifyIdToken(token);
  req.user = decoded;
  next();
  } catch (e) {
  res.status(401).json({ error: 'Invalid token' });
  }
}

// === AI SCAN + NAME UPDATE ===
app.post('/scan', checkAuth, async (req, res) => {
  if (!req.files || !req.files.image) return res.status(400).json({ error: 'No image' });
  try {
  const [result] = await client.textDetection({ image: { content: req.files.image.data } });
  const text = result.textAnnotations?.[0]?.description || '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const itemName = lines[0] || 'Unknown Item';
  const expirationDate = lines.find(l => /\d{4}-\d{2}-\d{2}/.test(l)) || '';

  // Auto-update name in Firestore if barcode exists
  const barcode = req.body.barcode;
  if (barcode) {
    const userId = req.user.uid;
    const itemRef = db.collection('users').doc(userId).collection('items').doc(barcode);
    const doc = await itemRef.get();
    if (doc.exists) {
    await itemRef.update({ name: itemName });
    }
  }

  res.json({ success: true, record: { itemName, expirationDate, detectedText: text } });
  } catch (err) {
  res.json({ success: false, error: err.message });
  }
});

// === ADD ITEM ===
app.post('/add', checkAuth, async (req, res) => {
  const { barcode, quantity = 1, expiration = '', name } = req.body;
  const userId = req.user.uid;

  try {
  const itemRef = db.collection('users').doc(userId).collection('items').doc(barcode);
  const doc = await itemRef.get();

  if (doc.exists) {
    await itemRef.update({
    quantity: FieldValue.increment(parseInt(quantity)),
    expiration: expiration || doc.data().expiration
    });
  } else {
    await itemRef.set({
    name: name || barcode,
    quantity: parseInt(quantity),
    expiration,
    addedAt: FieldValue.serverTimestamp()
    });
  }
  res.json({ success: true });
  } catch (err) {
  res.status(500).json({ error: err.message });
  }
});

// === GET INVENTORY ===
app.get('/inventory', checkAuth, async (req, res) => {
  const userId = req.user.uid;
  try {
  const snapshot = await db.collection('users').doc(userId).collection('items').get();
  const items = snapshot.docs.map(doc => ({
    barcode: doc.id,
    ...doc.data()
  }));
  res.json({ items });
  } catch (err) {
  res.status(500).json({ error: err.message });
  }
});

// === REMOVE ITEM ===
app.post('/remove', checkAuth, async (req, res) => {
  const { barcode } = req.body;
  const userId = req.user.uid;
  try {
  await db.collection('users').doc(userId).collection('items').doc(barcode).delete();
  res.json({ success: true });
  } catch (err) {
  res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
