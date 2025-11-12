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

// GET SHOPPING
app.get('/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(decoded.uid).get();
    const data = doc.data() || {};
    res.json({ list: data.shopping || [] });
  } catch (err) {
    res.status(500).json({ list: [] });
  }
});

// ADD TO SHOPPING
app.post('/shopping', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const { itemName, needed } = req.body;
    const userRef = db.collection('users').doc(decoded.uid);
    await userRef.set({
      shopping: admin.firestore.FieldValue.arrayUnion({
        itemName,
        needed,
        addedAt: new Date().toISOString()
      })
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
