const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fetch = require('node-fetch');
const webpush = require('web-push');

// ————————  FIX STARTS HERE  ————————

// Load Firebase service account from Render secret file
let serviceAccount;
try {
  const fs = require('fs');
  const keyPath = '/var/render/secrets/gcloud-key.json'; // Render's magic path
  if (!fs.existsSync(keyPath)) {
    throw new Error('Secret file gcloud-key.json not found. Did you add it in Render Dashboard → Secrets?');
  }
  serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  console.log('Successfully loaded gcloud-key.json from Render secrets');
} catch (err) {
  console.error('Failed to load gcloud-key.json:', err.message);
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Initialize Google Vision client (uses the same key automatically via ADC)
const vision = new ImageAnnotatorClient(); // No args needed when key is in secret file

// ————————  FIX ENDS HERE  ————————
