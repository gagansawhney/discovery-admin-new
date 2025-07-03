const functions = require('firebase-functions');
const cors = require('cors')({ origin: true, credentials: true });
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');

exports.addUsername = functions.https.onRequest((req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method Not Allowed' });
      return;
    }
    const { username } = req.body;
    logger.info('addUsername called', { username });
    if (!username || typeof username !== 'string' || !username.trim()) {
      res.status(400).json({ success: false, error: 'Username is required' });
      return;
    }
    try {
      // Check for duplicate
      const snapshot = await externalDb.collection('scraperUsernames').where('username', '==', username.trim()).limit(1).get();
      if (!snapshot.empty) {
        res.status(409).json({ success: false, error: 'Username already exists' });
        return;
      }
      await externalDb.collection('scraperUsernames').add({ username: username.trim() });
      logger.info('Username added successfully', { username });
      res.json({ success: true, message: 'Username added', username });
    } catch (error) {
      logger.error('Error adding username', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to add username', details: error.message });
    }
  });
}); 