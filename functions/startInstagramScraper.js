const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase'); // Import externalDb
const { Buffer } = require('buffer');

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

    // Prepare Apify input
    const input = {
      "username": instagramUsernames.split(',').map(u => u.trim()),
    };
    if (startDate) {
      input.onlyPostsNewerThan = startDate;
    }

    // Prepare webhook definition
    const webhookUrl = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/apifyWebhookHandler';
    const webhookPayload = '{ "runId": "{{runId}}", "datasetId": "{{defaultDatasetId}}", "status": "{{status}}", "error": "{{errorMessage}}" }';
    const webhooks = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
        requestUrl: webhookUrl,
        payloadTemplate: webhookPayload,
      }
    ];
    const webhooksParam = Buffer.from(JSON.stringify(webhooks)).toString('base64');

    logger.info('--- startInstagramScraper: Webhooks param (decoded) ---', { webhooks });
    logger.info('--- startInstagramScraper: Webhooks param (base64) ---', { webhooksParam });

    // Start Apify actor run using REST API with webhooks param
    const apifyRunUrl = `https://api.apify.com/v2/acts/apify~instagram-post-scraper/runs?token=${APIFY_API_TOKEN}&webhooks=${webhooksParam}`;
    let runResult = null;
    try {
      logger.info('--- startInstagramScraper: Starting Apify run via REST API ---', { apifyRunUrl, input, webhooks });
      const runResponse = await fetch(apifyRunUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      runResult = await runResponse.json();
      logger.info('--- startInstagramScraper: Apify run REST API response ---', { runResult });
      if (!runResult.data || !runResult.data.id) {
        throw new Error('Apify run did not return a valid run ID');
      }
      // Save run info to Firestore
      logger.info('--- startInstagramScraper: Saving run info to Firestore ---', { runId: runResult.data.id, datasetId: runResult.data.defaultDatasetId });
      const runDocRef = externalDb.collection('apifyRuns').doc(runResult.data.id);
      await runDocRef.set({
        runId: runResult.data.id,
        datasetId: runResult.data.defaultDatasetId,
        status: 'initiated',
        initiatedAt: new Date().toISOString(),
        instagramUsernames: instagramUsernames,
      });
      // Respond immediately
      logger.info('--- startInstagramScraper: Responding to client ---', { runId: runResult.data.id });
      res.status(200).json({ success: true, message: 'Scrape requested. Webhook attached at run start.', runId: runResult.data.id, inputSent: { instagramUsernames, startDate }, webhookPayload, runResult });
    } catch (error) {
      logger.error('startInstagramScraper error', { error: error.message, stack: error.stack, fullError: error });
      res.status(500).json({ success: false, error: 'Failed to start scraper', details: error.message });
    }

  } catch (error) {
    logger.error('startInstagramScraper error', { error: error.message, stack: error.stack, fullError: error });
    res.status(500).json({ success: false, error: 'Failed to start scraper', details: error.message });
  }
});
