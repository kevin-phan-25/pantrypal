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

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  abortOnLimit: true,
}));
app.use(express.static(path.join(__dirname, 'public')));

// === FIREBASE ADMIN INIT ===
try {
  initializeApp({
    credential: cert('./credentials.json')  // Your service account
  });
  console.log('Firebase Admin initialized');
} catch (err) {
  console.error('Firebase Admin init failed:', err.message);
  process.exit(1);
}

const auth = getAuth();
const db = getFirestore();
const client = new vision.ImageAnnotatorClient();

// === AUTH MIDDLEWARE ===
async function checkAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    console.error('Token verification failed:', e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// === AI SCAN + NAME UPDATE ===
app.post('/scan', checkAuth, async (req, res) => {
  if (!req.files || !req.files.image) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  const imageBuffer = req.files.image.data;

  try {
    const [result] = await client.textDetection({ image: { content: imageBuffer } });
    const text = result.textAnnotations?.[0]?.description || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

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
        console.log(`Updated name for ${barcode} → ${itemName}`);
      }
    }

    res.json({
      success: true,
      record: {
        itemName,
        expirationDate,
        detectedText: text
      }
    });
  } catch (err) {
    console.error('Vision API error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === ADD ITEM ===
app.post('/add', checkAuth, async (req, res) => {
  const { barcode, quantity = 1, expiration = '', name } = req.body;
  const userId = req.user.uid;

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode required' });
  }

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
    console.error('Add item failed:', err.message);
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
    console.error('Get inventory failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === REMOVE ITEM ===
app.post('/remove', checkAuth, async (req, res) => {
  const { barcode } = req.body;
  const userId = req.user.uid;

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode required' });
  }

  try {
    await db.collection('users').doc(userId).collection('items').doc(barcode).delete();
    res.json({ success: true });
  } catch (err) {
    console.error('Remove item failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === SERVE PWA UI ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPantryPal AI + Firestore + PWA running!`);
  console.log(` Open: http://localhost:${PORT}`);
  console.log(` Vision AI: ENABLED`);
  console.log(` Firestore: PER USER`);
  console.log(` PWA: READY\n`);
});
