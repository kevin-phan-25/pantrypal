const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');  // ← THIS WAS MISSING
const path = require('path');

let serviceAccount;
try {
  const rawKey = process.env.GCLOUD_KEY_JSON;
  if (!rawKey) throw new Error('GCLOUD_KEY_JSON missing');
  serviceAccount = JSON.parse(rawKey);
  if (!serviceAccount.project_id) throw new Error('project_id missing');
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
app.use(fileUpload());  // ← THIS WAS MISSING

// SERVE YOUR BEAUTIFUL UI
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
