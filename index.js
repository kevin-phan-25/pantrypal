import express from 'express';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import vision from '@google-cloud/vision';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(fileUpload());
app.use(express.static('public'));

initializeApp({ credential: cert('./serviceAccount.json') });
const auth = getAuth();

const client = new vision.ImageAnnotatorClient();

// Middleware to check Firebase token
async function checkAuth(req,res,next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({error:'No auth token'});
  const token = header.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch(e){ res.status(401).json({error:'Invalid token'}); }
}

// AI Scan endpoint
app.post('/scan', checkAuth, async (req,res)=>{
  if(!req.files || !req.files.image) return res.status(400).json({error:'No image uploaded'});
  try {
    const imageBuffer = req.files.image.data;
    const [result] = await client.textDetection({image:{content:imageBuffer}});
    const detections = result.textAnnotations;
    const detectedText = detections.length>0?detections[0].description:'';
    // Simple heuristic: first line = item name, look for date pattern
    const lines = detectedText.split('\n');
    let itemName = lines[0] || 'Unknown';
    let expirationDate = lines.find(l=>/\d{4}-\d{2}-\d{2}/.test(l)) || '';
    res.json({success:true, record:{itemName, expirationDate, detectedText}});
  } catch(err) {
    console.error(err);
    res.json({success:false, error:err.message});
  }
});

app.post('/add', checkAuth, async (req,res)=>{
  // Placeholder: save item to DB (could be Firestore, SQLite, etc.)
  console.log('Add item', req.body);
  res.json({success:true});
});

app.get('/inventory', checkAuth, async (req,res)=>{
  // Placeholder: return dummy items
  res.json({items:[
    {barcode:'123', name:'Milk', quantity:2, expiration:'2025-11-10'},
    {barcode:'456', name:'Bread', quantity:1, expiration:'2025-11-05'}
  ]});
});

app.listen(3000,()=>console.log('Server running on port 3000'));
