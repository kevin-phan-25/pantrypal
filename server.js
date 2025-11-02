import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
// Your Google Sheets logging functions
import { logItemToSheet } from './index.js'; // adjust if needed

const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // serve frontend HTML

// API endpoint to log scanned items
app.post('/scan', async (req, res) => {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).send('No barcode provided');

    try {
        const itemName = await logItemToSheet(barcode); // your existing function
        res.json({ success: true, itemName });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
