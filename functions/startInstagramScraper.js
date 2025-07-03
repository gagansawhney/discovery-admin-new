const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase'); // Import externalDb

// Define the secret for the Apify API token
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

exports.startInstagramScraper = functions.https.onRequest({ invoker: 'public', secrets: ["APIFY_API_TOKEN"], timeoutSeconds: 540 }, async (req, res) => {
  logger.info('--- startInstagramScraper: Function started ---');

  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    logger.info('--- startInstagramScraper: OPTIONS request handled ---');
    res.status(204).send('');
    return;
  }

  try {
    if (!APIFY_API_TOKEN) {
      logger.error('startInstagramScraper error: Apify API token not configured');
      res.status(500).json({ success: false, error: 'Apify API token not configured. Please contact administrator.' });
      return;
    }
    logger.info('--- startInstagramScraper: Apify API token is present ---');

    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    logger.info('--- startInstagramScraper: Request method is POST ---');

    const { instagramUsernames, startDate } = req.body;

    if (!instagramUsernames) {
      logger.error('startInstagramScraper error: Missing Instagram usernames');
      res.status(400).json({ error: 'Missing Instagram usernames' });
      return;
    }

    logger.info('--- startInstagramScraper: Received request ---', { instagramUsernames, startDate });

    // Initialize Apify SDK
    await Actor.init();

    const input = {
      "username": instagramUsernames.split(',').map(u => u.trim()),
    };

    if (startDate) {
      input.onlyPostsNewerThan = startDate;
    }

    logger.info('--- startInstagramScraper: Starting Apify actor ---', { input });

    const actor = await Actor.call('apify/instagram-post-scraper', input, { token: APIFY_API_TOKEN });

    logger.info('--- startInstagramScraper: Apify actor started ---', { actorRunId: actor.id });

    // Save run information to Firestore
    const runDocRef = externalDb.collection('apifyRuns').doc(actor.id);
    await runDocRef.set({
      runId: actor.id,
      datasetId: actor.defaultDatasetId,
      status: 'initiated',
      initiatedAt: new Date().toISOString(),
      instagramUsernames: instagramUsernames,
    });
    logger.info('--- startInstagramScraper: Apify run info saved to Firestore ---', { runId: actor.id });

    // --- LOGGING FOR USERNAMES COLLECTION ---
    try {
      const usernamesSnapshot = await externalDb.collection('scraperUsernames').get();
      logger.info('--- startInstagramScraper: scraperUsernames collection fetched ---', { count: usernamesSnapshot.size });
      logger.info('--- startInstagramScraper: scraperUsernames IDs ---', { ids: usernamesSnapshot.docs.map(doc => doc.id) });
      logger.info('--- startInstagramScraper: scraperUsernames data ---', { usernames: usernamesSnapshot.docs.map(doc => doc.data()) });
    } catch (err) {
      logger.error('--- startInstagramScraper: Error fetching scraperUsernames collection ---', { error: err.message });
    }

    res.status(200).json({ success: true, message: 'Apify actor started', runId: actor.id, datasetId: actor.defaultDatasetId });

  } catch (error) {
    logger.error('startInstagramScraper error', { error: error.message, stack: error.stack, fullError: error });
    res.status(500).json({ success: false, error: 'Failed to start scraper', details: error.message });
  } finally {
    // Exit Apify SDK
    await Actor.exit();
  }
});
