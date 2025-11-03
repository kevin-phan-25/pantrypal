// index.js – PantryPal AI + Firestore + PWA (Render + Firebase)
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

// ---- ES-module __dirname fix -------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Express setup ---------------------------------------------------------
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  abortOnLimit: true,
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Firebase Admin: ENV VAR or FILE ---------------------------------------
let credential;

try {
  if (process.env.FIREBASE_CREDENTIALS) {
    // Use JSON string from Render environment variable
    console.log('Using Firebase credentials from FIREBASE_CREDENTIALS env var');
    credential = cert(JSON.parse(process.env.FIREBASE_CREDENTIALS));
  } else if (fs.existsSync('./credentials.json')) {
    // Fallback to local file
    console.log('Using Firebase credentials from ./credentials.json');
    credential = cert('./credentials.json');
  } else {
    throw new Error('No Firebase credentials found: Set FIREBASE_CREDENTIALS env var or include credentials.json');
  }

  initializeApp({ credential });
  console.log('Firebase Admin initialized successfully');
} catch (err) {
  console.error('Firebase Admin initialization failed:', err.message);
  process.exit(1);
}

const auth = getAuth();
const db = getFirestore();
const visionClient = new vision.ImageAnnotatorClient();

// ---- Auth middleware -------------------------------------------------------
async function checkAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token' });
  }

  const idToken = header.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (e) {
    console.error('Invalid Firebase ID token:', e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---- /scan – AI receipt scan with Google Vision ----------------------------
app.post('/scan', checkAuth, async (req, res) => {
  if (!req.files?.image) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  const imageBuffer = req.files.image.data;

  try {
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const fullText = result.textAnnotations?.[0]?.description || '';
    const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

    const itemName = lines[0] || 'Unknown Item';
    const expirationDate = lines.find(l => /\d{4}-\d{2}-\d{2}/.test(l)) || '';

    // Optional: auto-update item name in Firestore
    const barcode = req.body.barcode;
    if (barcode) {
      const userId = req.user.uid;
      const itemRef = db.collection('users').doc(userId).collection('items').doc(barcode);
      const snap = await itemRef.get();
      if (snap.exists) {
        await itemRef.update({ name: itemName });
        console.log(`[SCAN] Updated name for ${barcode} → "${itemName}"`);
      }
    }

    res.json({
      success: true,
      record: { itemName, expirationDate, detectedText: fullText }
    });
  } catch (err) {
    console.error('Vision API error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- /add – add or increment item -----------------------------------------
app.post('/add', checkAuth, async (req, res) => {
  const { barcode, quantity = 1, expiration = '', name } = req.body;
  const userId = req.user.uid;

  if (!barcode) return res.status(400).json({ error: 'barcode is required' });

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
    console.error('Add item error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- /inventory – get all user items --------------------------------------
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
    console.error('Inventory fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- /remove – delete item ------------------------------------------------
app.post('/remove', checkAuth, async (req, res) => {
  const { barcode } = req.body;
  const userId = req.user.uid;

  if (!barcode) return res.status(400).json({ error: 'barcode is required' });

  try {
    await db.collection('users').doc(userId).collection('items').doc(barcode).delete();
    res.json({ success: true });
  } catch (err) {
    console.error('Remove item error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Serve PWA (fallback to index.html) -----------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Start server ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\nPantryPal AI + Firestore + PWA');
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Vision AI: ENABLED');
  console.log('Firestore: PER-USER');
  console.log('PWA: READY');
  console.log('Credentials: ENV VAR or ./credentials.json\n');
});
