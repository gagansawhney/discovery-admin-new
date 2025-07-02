const functions = require('firebase-functions');
const { db, bucket, externalDb } = require('./firebase');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const cors = require('cors')({ 
  origin: true,
  credentials: true
});
const logger = require('firebase-functions/logger');
const { Buffer } = require('buffer');


exports.generateUploadUrl = functions.https.onRequest({ invoker: 'public' }, (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  cors(req, res, async () => {
    logger.info('generateUploadUrl called', { method: req.method, headers: req.headers, query: req.query, body: req.body });
    try {
      const id = uuidv4();
      const path = `flyers/temp/${id}.jpg`;
      logger.info('Generated path', { path });
      
      // Generate image hash if image data is provided
      let imageHash = null;
      if (req.body && req.body.imageData) {
        const imageBuffer = Buffer.from(req.body.imageData, 'base64');
        imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
        logger.info('Generated image hash', { imageHash });
        
        // Check for duplicate in Firestore
        const duplicateQuery = await externalDb.collection('events').where('imageHash', '==', imageHash).limit(1).get();
        if (!duplicateQuery.empty) {
          const duplicateDoc = duplicateQuery.docs[0];
          logger.info('Duplicate image detected', { imageHash, existingId: duplicateDoc.id });
          return res.json({ 
            duplicate: true, 
            existingEvent: duplicateDoc.data(),
            message: 'This image has already been uploaded'
          });
        }
      }
      
      // Use default storage bucket
      const file = bucket.file(path);
      const expires = Date.now() + 60 * 60 * 1000;
      // Accept contentType from query or body, fallback to application/octet-stream
      let contentType = req.query.contentType || req.body?.contentType || 'application/octet-stream';
      logger.info('Using contentType for signed URL', { contentType });
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        contentType,
      });
      logger.info('Generated signed URL', { uploadUrl });
      res.json({ uploadUrl, path, imageHash });
    } catch (err) {
      logger.error('generateUploadUrl error', { error: err, stack: err.stack });
      res.status(500).json({ error: 'Could not generate upload URL', details: err.message });
    }
  });
});