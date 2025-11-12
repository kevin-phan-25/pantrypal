// index.js — PantryPal Backend v1.0
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Sample inventory data (replace with DB later)
let inventory = [
  { id: 1, name: 'Rice', quantity: 5, unit: 'kg' },
  { id: 2, name: 'Pasta', quantity: 3, unit: 'packs' },
  { id: 3, name: 'Tomato Sauce', quantity: 8, unit: 'cans' }
];

// GET: Fetch all inventory
app.get('/inventory', async (req, res) => {
  try {
    res.json({ success: true, data: inventory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new item
app.post('/inventory', async (req, res) => {
  try {
    const { name, quantity, unit } = req.body;
    if (!name || !quantity) {
      return res.status(400).json({ success: false, error: 'Name and quantity required' });
    }
    const newItem = {
      id: inventory.length + 1,
      name,
      quantity: parseInt(quantity),
      unit: unit || 'units'
    };
    inventory.push(newItem);
    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT: Update item
app.put('/inventory/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = inventory.find(i => i.id === id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    const { name, quantity, unit } = req.body;
    if (name) item.name = name;
    if (quantity !== undefined) item.quantity = parseInt(quantity);
    if (unit) item.unit = unit;

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE: Remove item
app.delete('/inventory/:id', async (req, res) => {
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`PantryPal API running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});
