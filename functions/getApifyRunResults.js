const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');
const cors = require('cors')({ origin: true, credentials: true });
const { ApifyClient } = require('apify-client');

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

exports.getApifyRunResults = functions.https.onRequest({ invoker: 'public', secrets: ["APIFY_API_TOKEN"], timeoutSeconds: 540 }, (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  cors(req, res, async () => {
    logger.info('--- getApifyRunResults: Function started ---');

    try {
      if (!APIFY_API_TOKEN) {
        logger.error('getApifyRunResults error: Apify API token not configured');
        res.status(500).json({ success: false, error: 'Apify API token not configured. Please contact administrator.' });
        return;
      }
      logger.info('--- getApifyRunResults: Apify API token is present ---');

      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }
      logger.info('--- getApifyRunResults: Request method is POST ---');

      const { runId, datasetId } = req.body;

      if (!runId || !datasetId) {
        logger.error('getApifyRunResults error: Missing runId or datasetId');
        res.status(400).json({ error: 'Missing runId or datasetId' });
        return;
      }

      logger.info('--- getApifyRunResults: Received request ---', { runId, datasetId });

      // Initialize Apify client
      const client = new ApifyClient({ token: APIFY_API_TOKEN });

      // Optionally fetch run info (not strictly needed if you trust the datasetId)
      // const runInfo = await client.run(runId).get();

      // Fetch dataset results
      const { items: scrapedData } = await client.dataset(datasetId).listItems();
      logger.info('--- getApifyRunResults: Data fetched ---', { itemCount: scrapedData.length });

      // Save scraped data to Firestore (events collection)
      for (const post of scrapedData) {
        // Generate a unique ID for the event, or use a suitable ID from the post data
        const eventId = `instagram-${post.id || Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const eventData = {
          id: eventId,
          name: post.caption ? post.caption.substring(0, 100) : 'Instagram Post',
          date: {
            start: post.timestamp ? new Date(post.timestamp).toISOString() : new Date().toISOString(),
          },
          venue: {
            name: post.ownerUsername || 'Instagram',
            address: '',
          },
          // Add more fields as needed from the Apify post data
          // Example: imageUrls, text, likes, comments, etc.
          imageUrl: post.displayUrl || post.thumbnailUrl || null,
          rawText: post.caption ?? null,
          source: {
            platform: 'Instagram',
            postId: post.id ?? null,
            url: post.url ?? null,
            scrapedAt: new Date().toISOString(),
          },
          tags: post.hashtags || [],
          // You might want to process and normalize tags and searchText here
          searchText: post.caption ? post.caption.toLowerCase() : '',
          updatedAt: new Date().toISOString(),
        };

        await externalDb.collection('events').doc(eventId).set(eventData, { merge: true });
        logger.info('--- getApifyRunResults: Saved Instagram post to events collection ---', { eventId });
      }

      // Update run status in Firestore
      const runDocRef = externalDb.collection('apifyRuns').doc(runId);
      await runDocRef.update({
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        itemCount: scrapedData.length,
      });
      logger.info('--- getApifyRunResults: Apify run status updated to SUCCEEDED ---', { runId });

      res.status(200).json({ success: true, status: 'succeeded', data: scrapedData });

    } catch (error) {
      logger.error('getApifyRunResults error', { error: error.message, stack: error.stack, fullError: error });
      res.status(500).json({ success: false, error: 'Failed to get scraper results', details: error.message });
    }
  });
});
