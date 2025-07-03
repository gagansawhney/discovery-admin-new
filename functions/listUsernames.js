const functions = require('firebase-functions');
const cors = require('cors')({ origin: true, credentials: true });
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');

exports.listUsernames = functions.https.onRequest((req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  cors(req, res, async () => {
    if (req.method !== 'GET') {
      res.status(405).json({ success: false, error: 'Method Not Allowed' });
      return;
    }
    try {
      const snapshot = await externalDb.collection('scraperUsernames').get();
      const usernames = snapshot.docs.map(doc => doc.data().username);
      logger.info('Fetched usernames', { count: usernames.length });
      res.json({ success: true, usernames });
    } catch (error) {
      logger.error('Error listing usernames', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to list usernames', details: error.message });
    }
  });
}); 