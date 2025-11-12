require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const admin = require('firebase-admin');
const path = require('path');

// ---------- INITIALIZE EXPRESS ----------
const app = express();   // ← MUST BE HERE

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(express.json());

// ---------- FIREBASE ADMIN ----------
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ---------- GOOGLE VISION ----------
const client = new vision.ImageAnnotatorClient();

// ---------- MULTER (FILE UPLOAD) ----------
const upload = multer({ storage: multer.memoryStorage() });

// ---------- ROUTES ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Example: Upload image → detect labels
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const [result] = await client.labelDetection(req.file.buffer);
    const labels = result.labelAnnotations.map(label => label.description);
    res.json({ labels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Vision API failed' });
  }
});

// ---------- SERVE FRONTEND ----------
const frontendPath = path.join(__dirname, '../public');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
