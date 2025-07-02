const functions = require('firebase-functions');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ 
  origin: true,
  credentials: true
});

exports.logError = functions.https.onRequest({ invoker: 'public' }, (req, res) => {
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
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    try {
      const { source, message, stack, extra } = req.body;
      logger.error('Client error logged', { source, message, stack, extra });
      res.json({ success: true });
    } catch (err) {
      logger.error('logError function error', { error: err });
      res.status(500).json({ error: 'Failed to log error' });
    }
  });
});