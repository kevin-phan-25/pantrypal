// index.js - FULL PANTRYPAL: OFF + RECIPES + SHOPPING LIST + SHEETS
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.LOG_SHEET_ID?.trim();
const SHEET_NAME = 'PantryLog';
const DATA_FILE = path.join(process.cwd(), 'data.json');
const SPOONACULAR_KEY = process.env.SPOONACULAR_KEY?.trim();

let pantry = [];
let shoppingList = [];
let sheets;

// === LOAD DATA (pantry + shopping list) ===
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      pantry = saved.pantry || [];
      shoppingList = saved.shoppingList || [];
      console.log(`Loaded: ${pantry.length} pantry items, ${shoppingList.length} shopping items`);
    } catch (err) {
      console.error('Parse error in data.json:', err.message);
      pantry = [];
      shoppingList = [];
    }
  }
}

// === SAVE DATA (pantry + shopping list) ===
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ pantry, shoppingList }, null, 2), 'utf-8');
    console.log(`SAVED: ${pantry.length} pantry, ${shoppingList.length} shopping`);
  } catch (err) {
    console.error('SAVE ERROR:', err.message);
  }
}

loadData();

// === GOOGLE SHEETS SETUP ===
if (SHEET_ID) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('Google Sheets sync ENABLED');
  } catch (err) {
    console.error('Sheets setup failed:', err.message);
  }
}

// === SHELF LIFE MAP (OFF categories → days) ===
const shelfLifeMap = {
  'breakfast cereals': 365,
  'cereals': 365,
  'sodas': 365,
  'beverages': 365,
  'spreads': 180,
  'chocolate': 365,
  'canned': 730,
  'pasta': 730,
  'rice': 730,
  'dairy': 7,
  'milk': 7,
  'yogurt': 14,
  'cheese': 30,
  'meat': 5,
  'fish': 3,
  'bread': 3,
  'vegetables': 7,
  'fruits': 5,
  'snacks': 180,
};

// === LOOKUP ITEM FROM OPEN FOOD FACTS ===
async function lookupItem(barcode) {
  const existing = pantry.find(i => i.barcode === barcode);
  if (existing) return existing;

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    const data = await res.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const categories = (p.categories || '').toLowerCase();
      let days = 30;
      let matched = 'Unknown';

      for (const [key, d] of Object.entries(shelfLifeMap)) {
        if (categories.includes(key)) {
          days = d;
          matched = key;
          break;
        }
      }

      const expires = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

      const item = {
        barcode,
        itemName: p.product_name || p.brands || 'Unknown Item',
        imageUrl: p.image_front_url || null,
        category: matched,
        expires,
        added: new Date().toISOString()
      };

      console.log(`OFF HIT: ${item.itemName} → ${days} days (${matched})`);
      return item;
    } else {
      console.log(`OFF MISS: ${barcode}`);
    }
  } catch (err) {
    console.error('OFF API error:', err.message);
  }

  return {
    barcode,
    itemName: 'Unknown Item',
    imageUrl: null,
    category: 'Unknown',
    expires: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  };
}

// === LOG ITEM (ADD TO PANTRY) ===
app.post('/log', async (req, res) => {
  const { barcode, quantity = 1, expires } = req.body;
  if (!barcode) return res.status(400).json({ error: 'barcode required' });

  const qty = parseInt(quantity) || 1;
  const fullItem = await lookupItem(barcode);

  const existing = pantry.find(i => i.barcode === barcode && i.expires === (expires || fullItem.expires));
  if (existing) {
    existing.quantity += qty;
  } else {
    const newItem = { ...fullItem, quantity: qty, expires: expires || fullItem.expires };
    pantry.push(newItem);
  }

  saveData();

  if (sheets) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:G`,
        valueInputOption: 'RAW',
        requestBody: { values: [[new Date().toISOString(), barcode, fullItem.itemName, qty, expires || fullItem.expires, 'ADD']] },
      });
    } catch (err) {
      console.error('Sheets add failed:', err.message);
    }
  }

  res.json({ success: true, itemName: fullItem.itemName, quantity: existing?.quantity || qty });
});

// === GET INVENTORY ===
app.get('/inventory', (req, res) => {
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const inventory = pantry.map(item => {
    const exp = new Date(item.expires);
    const status = exp < now ? 'expired' : (exp <= sevenDays ? 'expiring' : 'good');
    return { ...item, status };
  });

  const summary = {
    totalItems: pantry.reduce((sum, i) => sum + i.quantity, 0),
    lowStock: pantry.filter(i => i.quantity <= 2).length,
    expiringSoon: pantry.filter(i => new Date(i.expires) <= sevenDays && new Date(i.expires) >= now).length,
    expired: pantry.filter(i => new Date(i.expires) < now).length,
  };

  res.json({ inventory, summary });
});

// === EDIT ITEM ===
app.put('/item/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (id >= 0 && id < pantry.length) {
    const oldQty = pantry[id].quantity;
    const { quantity, expires } = req.body;
    if (quantity !== undefined) pantry[id].quantity = parseInt(quantity) || 1;
    if (expires !== undefined) pantry[id].expires = expires;
    saveData();

    if (sheets) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A:G`,
          valueInputOption: 'RAW',
          requestBody: { values: [[new Date().toISOString(), pantry[id].barcode, pantry[id].itemName, pantry[id].quantity, pantry[id].expires, `EDIT: Qty ${oldQty}→${pantry[id].quantity}`]] },
        });
      } catch (err) {
        console.error('Sheets edit failed:', err.message);
      }
    }

    res.json({ success: true, item: pantry[id] });
  } else {
    res.status(400).json({ error: 'Invalid ID' });
  }
});

// === DELETE ITEM ===
app.delete('/item/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (id >= 0 && id < pantry.length) {
    const removed = pantry.splice(id, 1)[0];
    saveData();

    if (sheets) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A:G`,
          valueInputOption: 'RAW',
          requestBody: { values: [[new Date().toISOString(), removed.barcode, removed.itemName, 0, removed.expires, 'DELETED']] },
        });
      } catch (err) {
        console.error('Sheets delete failed:', err.message);
      }
    }

    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid ID' });
  }
});

// === SHOPPING LIST: GET ===
app.get('/shopping', (req, res) => {
  const lowStock = pantry
    .filter(i => i.quantity <= 2)
    .map(i => ({ barcode: i.barcode, itemName: i.itemName, needed: Math.max(1, 3 - i.quantity) }));
  res.json({ list: shoppingList, lowStock });
});

// === SHOPPING LIST: ADD ===
app.post('/shopping', (req, res) => {
  const { barcode, itemName, needed = 1 } = req.body;
  if (!barcode || !itemName) return res.status(400).json({ error: 'Invalid data' });

  const existing = shoppingList.find(i => i.barcode === barcode);
  if (existing) {
    existing.needed += needed;
  } else {
    shoppingList.push({ barcode, itemName, needed: parseInt(needed) });
  }
  saveData();
  res.json({ success: true });
});

// === SHOPPING LIST: REMOVE ITEM ===
app.delete('/shopping/:barcode', (req, res) => {
  const barcode = req.params.barcode;
  shoppingList = shoppingList.filter(i => i.barcode !== barcode);
  saveData();
  res.json({ success: true });
});

// === SHOPPING LIST: CLEAR ALL ===
app.delete('/shopping', (req, res) => {
  shoppingList = [];
  saveData();
  res.json({ success: true });
});

// === RECIPES ===
app.get('/recipes', async (req, res) => {
  if (!SPOONACULAR_KEY) {
    console.log('SPOONACULAR_KEY missing in .env');
    return res.json({ error: 'Add SPOONACULAR_KEY to .env (free at spoonacular.com)' });
  }

  const ingredients = pantry.map(i => i.itemName).filter(Boolean).join(', ');
  if (!ingredients) return res.json([]);

  console.log(`Fetching recipes for: ${ingredients}`);
  try {
    const apiRes = await fetch(
      `https://api.spoonacular.com/recipes/complexSearch?apiKey=${SPOONACULAR_KEY}&query=${encodeURIComponent(ingredients)}&number=5&addRecipeInformation=true`
    );
    const data = await apiRes.json();

    if (data.results) {
      const recipes = data.results.map(r => ({
        title: r.title,
        image: r.image,
        readyIn: r.readyInMinutes,
        servings: r.servings,
        link: r.sourceUrl || `https://spoonacular.com/recipes/${r.id}`
      }));
      console.log(`Found ${recipes.length} recipes`);
      res.json(recipes);
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Recipe API error:', err.message);
    res.json({ error: 'Service down' });
  }
});

// === SERVE UI ===
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// === START SERVER ===
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPantryPal FULLY LOADED!`);
  console.log(`   Open: http://localhost:3000`);
  console.log(`   Features: OFF, Recipes, Shopping List, Sheets Sync`);
  console.log(`   SPOONACULAR_KEY: ${SPOONACULAR_KEY ? 'SET' : 'MISSING'}\n`);
});