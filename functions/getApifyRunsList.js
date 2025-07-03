const functions = require('firebase-functions');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');

exports.getApifyRunsList = functions.https.onRequest({ invoker: 'public' }, async (req, res) => {
  logger.info('--- getApifyRunsList: Function started ---');

  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    logger.info('--- getApifyRunsList: OPTIONS request handled ---');
    res.status(204).send('');
    return;
  }

  try {
    if (req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    logger.info('--- getApifyRunsList: Request method is GET ---');

    const apifyRunsRef = externalDb.collection('apifyRuns');
    const snapshot = await apifyRunsRef.orderBy('initiatedAt', 'desc').get();

    const runs = [];
    snapshot.forEach(doc => {
      runs.push(doc.data());
    });

    logger.info('--- getApifyRunsList: Fetched Apify runs ---', { count: runs.length });
    logger.info('--- getApifyRunsList: Document IDs ---', { ids: snapshot.docs.map(doc => doc.id) });
    logger.info('--- getApifyRunsList: Runs data ---', { runs });
    res.status(200).json({ success: true, runs });

  } catch (error) {
    logger.error('getApifyRunsList error', { error: error.message, stack: error.stack, fullError: error });
    res.status(500).json({ success: false, error: 'Failed to get Apify runs list', details: error.message });
  }
});
