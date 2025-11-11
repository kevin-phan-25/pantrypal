const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const client = new vision.ImageAnnotatorClient();

admin.initializeApp();
const db = admin.firestore();
const upload = multer();

app.use(express.json());

// PRO CHECK + SCAN COUNTER
app.get('/user-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || { scans: 0, isPro: false };
    res.json({ scans: data.scans || 0, isPro: data.isPro || false, familyCode: data.familyCode });
  } catch { res.json({ scans: 0, isPro: false }); }
});

// RECORD SCAN (FREE LIMIT)
app.post('/record-scan', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const ref = db.collection('users').doc(decoded.uid);
    const doc = await ref.get();
    const data = doc.data() || { scans: 0 };
    if (data.isPro || data.scans < 10) {
      await ref.set({ scans: (data.scans || 0) + 1 }, { merge: true });
      res.json({ allowed: true });
    } else {
      res.json({ allowed: false, message: "Upgrade to Pro for unlimited scans!" });
    }
  } catch { res.json({ allowed: false }); }
});

// AI SCAN
app.post('/scan', upload.single('image'), async (req, res) => {
  try {
    const [result] = await client.labelDetection(req.file.buffer);
    const labels = result.labelAnnotations.map(l => l.description);
    res.json({ success: true, record: { labels, barcode: "123456789" } }); // mock barcode
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET INVENTORY
app.get('/inventory', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ items: data.inventory || [] });
  } catch (err) {
    res.status(500).json({ items: [] });
  }
});

// ADD TO INVENTORY
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

// All your existing routes: /inventory, /add, /remove, /shopping, /join-family, etc.
