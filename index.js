// index.js — PantryPal Backend v1.0 (Full API)
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory storage (replace with MongoDB later)
let inventory = [
  { id: 1, name: 'Rice', quantity: 5, unit: 'kg', expDate: '2025-12-01' },
  { id: 2, name: 'Pasta', quantity: 3, unit: 'packs', expDate: '2025-11-25' },
  { id: 3, name: 'Tomato Sauce', quantity: 8, unit: 'cans', expDate: '2025-11-30' }
];

// ROOT: Health check + Welcome (Fixes "Cannot GET /")
app.get('/', (req, res) => {
  res.json({
    message: 'PantryPal API v1.0 LIVE!',
    status: 'ready',
    endpoints: {
      inventory: '/inventory (GET/POST)',
      item: '/inventory/:id (PUT/DELETE)'
    },
    developer: '@Kevin_Phan25',
    time: new Date().toISOString()
  });
});

// GET /inventory — Fetch all items
app.get('/inventory', (req, res) => {
  try {
    res.json({ success: true, data: inventory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /inventory — Add new item
app.post('/inventory', (req, res) => {
  try {
    const { name, quantity, unit, expDate } = req.body;
    if (!name || quantity == null) {
      return res.status(400).json({ success: false, error: 'Name and quantity required' });
    }
    const newItem = {
      id: Date.now(),  // Simple ID gen
      name,
      quantity: parseInt(quantity),
      unit: unit || 'units',
      expDate: expDate || null
    };
    inventory.push(newItem);
    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /inventory/:id — Update item
app.put('/inventory/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = inventory.find(i => i.id === id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    const { name, quantity, unit, expDate } = req.body;
    if (name !== undefined) item.name = name;
    if (quantity !== undefined) item.quantity = parseInt(quantity);
    if (unit !== undefined) item.unit = unit;
    if (expDate !== undefined) item.expDate = expDate;

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /inventory/:id — Remove item
app.delete('/inventory/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const index = inventory.findIndex(i => i.id === id);
    if (index === -1) return res.status(404).json({ success: false, error: 'Item not found' });

    inventory.splice(index, 1);
    res.json({ success: true, message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// 404 Handler (Optional — Catches undefined routes)
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`PantryPal API v1.0 running on port ${PORT}`);
  console.log(`Root: http://localhost:${PORT}/`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Inventory: http://localhost:${PORT}/inventory`);
});
