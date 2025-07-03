const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

exports.getApifyRunResults = functions.https.onRequest({ invoker: 'public', secrets: ["APIFY_API_TOKEN"], timeoutSeconds: 540 }, async (req, res) => {
  logger.info('--- getApifyRunResults: Function started ---');

  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    logger.info('--- getApifyRunResults: OPTIONS request handled ---');
    res.status(204).send('');
    return;
  }

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

    // Initialize Apify SDK
    await Actor.init();

    const actorRun = await Actor.call('apify/instagram-post-scraper', null, { token: APIFY_API_TOKEN, runId: runId });

    logger.info('--- getApifyRunResults: Apify run status ---', { status: actorRun.status });

    let scrapedData = [];
    let runStatus = actorRun.status;

    if (actorRun.status === 'SUCCEEDED') {
      logger.info('--- getApifyRunResults: Run SUCCEEDED, fetching data ---');
      const dataset = await Actor.openDataset(datasetId, { token: APIFY_API_TOKEN });
      scrapedData = await dataset.getData().then(res => res.items);
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
          imageUrl: post.displayUrl || post.thumbnailUrl,
          rawText: post.caption,
          source: {
            platform: 'Instagram',
            postId: post.id,
            url: post.url,
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

    } else if (actorRun.status === 'FAILED') {
      logger.info('--- getApifyRunResults: Run FAILED ---');
      runStatus = 'failed';
      // Update run status in Firestore
      const runDocRef = externalDb.collection('apifyRuns').doc(runId);
      await runDocRef.update({
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: actorRun.errorMessage || 'Unknown Apify error',
      });
      logger.info('--- getApifyRunResults: Apify run status updated to FAILED ---', { runId });
    }

    res.status(200).json({ success: true, status: runStatus, data: scrapedData });

  } catch (error) {
    logger.error('getApifyRunResults error', { error: error.message, stack: error.stack, fullError: error });
    res.status(500).json({ success: false, error: 'Failed to get scraper results', details: error.message });
  } finally {
    await Actor.exit();
  }
});
