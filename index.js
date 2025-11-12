require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- FIREBASE ADMIN (from GCLOUD_KEY_JSON) ----------
let serviceAccount;
try {
  if (!process.env.GCLOUD_KEY_JSON) {
    throw new Error("GCLOUD_KEY_JSON environment variable is missing");
  }
  serviceAccount = JSON.parse(process.env.GCLOUD_KEY_JSON);
  console.log("Firebase: Loaded project_id =", serviceAccount.project_id);
} catch (err) {
  console.error("Failed to parse GCLOUD_KEY_JSON:", err.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ---------- GOOGLE VISION ----------
const client = new vision.ImageAnnotatorClient(); // uses same key if needed

// ---------- MULTER ----------
const upload = multer({ storage: multer.memoryStorage() });

// ---------- ROUTES ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const [result] = await client.labelDetection(req.file.buffer);
    const labels = result.labelAnnotations.map(l => l.description);
    res.json({ labels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SERVE FRONTEND ----------
const frontendPath = path.join(__dirname, '../public');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
