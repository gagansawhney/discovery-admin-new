const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');
const cors = require('cors')({ origin: true, credentials: true });
const { ApifyClient } = require('apify-client');
const fetch = require('node-fetch');
const { Buffer } = require('buffer');

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
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }
      logger.info('--- getApifyRunResults: Request method is POST ---');

      const { runId, datasetId } = req.body;

      if (!runId) {
        logger.error('getApifyRunResults error: Missing runId');
        res.status(400).json({ error: 'Missing runId' });
        return;
      }

      logger.info('--- getApifyRunResults: Received request ---', { runId, datasetId });

      // Fetch data from Firestore apifyResults collection
      logger.info('--- getApifyRunResults: Fetching from Firestore apifyResults collection ---');
      const apifyResultsDoc = await externalDb.collection('apifyResults').doc(runId).get();
      
      if (!apifyResultsDoc.exists) {
        logger.error('--- getApifyRunResults: No apifyResults document found for runId ---', { runId });
        res.status(404).json({ success: false, error: 'No results found for this run' });
        return;
      }

      const apifyResultsData = apifyResultsDoc.data();
      logger.info('--- getApifyRunResults: Found apifyResults document ---', { 
        runId, 
        hasResults: !!apifyResultsData.results,
        resultsLength: apifyResultsData.results ? apifyResultsData.results.length : 0
      });

      if (!apifyResultsData.results || !Array.isArray(apifyResultsData.results)) {
        logger.error('--- getApifyRunResults: No results array found in document ---');
        res.status(404).json({ success: false, error: 'No results array found' });
        return;
      }

      const scrapedData = apifyResultsData.results;
      logger.info('--- getApifyRunResults: Returning data from Firestore ---', { itemCount: scrapedData.length });

      res.status(200).json({ success: true, status: 'succeeded', data: scrapedData });

    } catch (error) {
      logger.error('getApifyRunResults error', { error: error.message, stack: error.stack, fullError: error });
      res.status(500).json({ success: false, error: 'Failed to get scraper results', details: error.message });
    }
  });
});

// New function to proxy Instagram images
exports.proxyInstagramImage = functions.https.onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { imageUrl } = req.query;
    
    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl parameter is required' });
      return;
    }

    // Fetch the image
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to fetch image' });
      return;
    }

    // Get the image buffer
    const imageBuffer = await response.arrayBuffer();
    
    // Set appropriate headers
    const contentType = response.headers.get('content-type');
    // Remove charset from content-type for images
    const cleanContentType = contentType ? contentType.split(';')[0] : 'image/jpeg';
    
    res.set('Content-Type', cleanContentType);
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.set('Content-Disposition', 'inline');
    
    // Send the image
    res.send(Buffer.from(imageBuffer));
    
  } catch (error) {
    logger.error('proxyInstagramImage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
