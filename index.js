const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

// CREDENTIALS — SAFE VERSION
let serviceAccount;
try {
  const rawKey = process.env.GCLOUD_KEY_JSON;
  if (!rawKey) throw new Error('GCLOUD_KEY_JSON missing');
  serviceAccount = JSON.parse(rawKey);
  if (!serviceAccount.project_id) throw new Error('project_id missing in GCLOUD_KEY_JSON');
  console.log('SUCCESS: Loaded project', serviceAccount.project_id);
} catch (err) {
  console.error('FATAL:', err.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const vision = new ImageAnnotatorClient();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// SERVE UI — THIS IS THE FIX
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// YOUR API ROUTES (inventory, shopping, etc.)
app.get('/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    res.json({ items: doc.data()?.inventory || [] });
  } catch { res.json({ items: [] }); }
});

app.post('/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { barcode, quantity, expiration } = req.body;
    const userRef = db.collection('users').doc(decoded.uid);
    await userRef.set({
      inventory: admin.firestore.FieldValue.arrayUnion({
        barcode,
        name: barcode,
        quantity,
        expiration,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Add your other routes here (shopping, scan, etc.)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal LIVE at https://pantrypal-zdi4.onrender.com`);
});
