const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' })); // Increased for URLs
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// ========== FIREBASE ADMIN (new key) ==========
let firebaseKey;
try {
  firebaseKey = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  console.log('Firebase Admin loaded:', firebaseKey.project_id);
} catch (err) {
  console.error('FATAL: FIREBASE_ADMIN_KEY missing or invalid');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(firebaseKey)
});
const db = admin.firestore();

// ========== GOOGLE VISION (your existing GCLOUD_KEY_JSON) ==========
let visionKey;
try {
  visionKey = JSON.parse(process.env.GCLOUD_KEY_JSON);
  console.log('Google Vision loaded:', visionKey.project_id);
} catch (err) {
  console.error('FATAL: GCLOUD_KEY_JSON missing or invalid');
  process.exit(1);
}
const vision = new ImageAnnotatorClient({ credentials: visionKey });

// ========== DOWNLOAD IMAGE FROM URL ==========
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 10000 }, (resp) => {
      if (resp.statusCode !== 200) {
        return reject(new Error(`HTTP ${resp.statusCode} from ${url}`));
      }

      const chunks = [];
      resp.on('data', chunk => chunks.push(chunk));
      resp.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          reject(new Error('Empty image downloaded'));
        } else {
          resolve(buffer);
        }
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// ========== SERVE UI ==========
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== USER INFO ==========
app.get('/api/user-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ isPro: data.isPro === true, scans: data.scans || 0 });
  } catch {
    res.json({ isPro: false, scans: 0 });
  }
});

// ========== INVENTORY ==========
app.get('/api/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ items: doc.data()?.inventory || [] });
  } catch {
    res.json({ items: [] });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { barcode, quantity = 1, expiration } = req.body;

    await db.collection('users').doc(decoded.uid).set({
      inventory: admin.firestore.FieldValue.arrayUnion({
        barcode,
        name: barcode,
        quantity,
        expiration: expiration || null,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ========== SHOPPING LIST ==========
app.get('/api/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ list: doc.data()?.shopping || [] });
  } catch {
    res.json({ list: [] });
  }
});

app.post('/api/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { itemName, needed = 1 } = req.body;

    await db.collection('users').doc(decoded.uid).set({
      shopping: admin.firestore.FieldValue.arrayUnion({
        itemName,
        needed,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ========== AI SCAN (Google Vision) – NOW SUPPORTS URL ==========
app.post('/api/scan', async (req, res) => {
  try {
    // ---- Auth ----
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await admin.auth().verifyIdToken(token);

    // ---- Get image buffer (file OR URL) ----
    let imageBuffer;

    if (req.files?.image) {
      console.log('Scan: Using uploaded file');
      imageBuffer = req.files.image.data;
    } 
    else if (req.body.imageUrl) {
      const url = req.body.imageUrl.trim();
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      console.log('Scan: Downloading image from URL:', url);
      imageBuffer = await downloadImage(url);
    } 
    else {
      return res.status(400).json({ error: 'No image provided (use file upload or imageUrl)' });
    }

    // ---- Validate buffer ----
    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ error: 'Empty image data' });
    }

    // ---- Run Google Vision ----
    console.log(`Scan: Sending ${imageBuffer.length} bytes to Google Vision...`);
    const [result] = await vision.labelDetection(imageBuffer);
    const labels = result.labelAnnotations?.map(a => a.description) || [];

    // ---- Update scan count ----
    await db.collection('users').doc(decoded.uid).update({
      scans: admin.firestore.FieldValue.increment(1)
    });

    console.log('Scan successful:', labels.slice(0, 5).join(', '));
    res.json({ labels });

  } catch (err) {
    console.error('Vision error:', err.message);
    res.status(500).json({ 
      error: 'Scan failed', 
      details: err.message 
    });
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal Pro LIVE → https://pantrypal-zdi4.onrender.com`);
  console.log(`Server running on port ${PORT}`);
});
