const express = require('express');
const admin = require('firebase-admin');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path'); // ← already have this

// ... your credential loading code (unchanged) ...

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(fileUpload());

// Your API routes (unchanged)
app.get('/meals', (req, res) => res.json({ meals: {} }));
app.post('/save-meals', (req, res) => { console.log('Meals saved:', req.body); res.json({ success: true }); });
app.post('/add-to-shopping', (req, res) => { console.log('Added:', req.body); res.json({ success: true }); });
app.post('/nutrition', (req, res) => {
  res.json({ calories: 1850, totalNutrients: { PROCNT: { quantity: 92 }, CHOCDF: { quantity: 210 }, FAT: { quantity: 78 } } });
});

// THIS IS THE ONLY CHANGE YOU NEED — KEEP public/ EXACTLY WHERE IT IS
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PantryPal LIVE at https://pantrypal-zdi4.onrender.com`);
});
