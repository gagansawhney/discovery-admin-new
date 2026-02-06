const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');
const cors = require('cors')({ origin: true, credentials: true });
const { ApifyClient } = require('apify-client');
const fetch = require('node-fetch');
const { Buffer } = require('buffer');
const { HttpsProxyAgent } = require('https-proxy-agent');

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

function toMillis(timestampLike) {
  if (!timestampLike) return NaN;
  if (typeof timestampLike === 'number') {
    // Heuristic: seconds vs ms
    return timestampLike < 1e12 ? timestampLike * 1000 : timestampLike;
  }
  const parsed = Date.parse(timestampLike);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function normalizeStories(items) {
  return (items || []).map((story, idx) => {
    const storyId = story.id || story.story_id || story.code || story.media || story.source || `${Date.now()}_${idx}`;
    const username = story.username || story.ownerUsername || story.author || story.user || 'unknown';
    const mediaUrl = story.displayUrl || story.media || story.source || story.thumbnail || story.mediaUrl || '';
    const rawTs = story.timestamp || story.taken_at || story.takenAt || story.datetime;
    const ms = toMillis(rawTs);
    const timestampISO = Number.isNaN(ms) ? '' : new Date(ms).toISOString();
    const caption = story.caption || story.text || '';
    return {
      id: storyId,
      ownerUsername: username,
      displayUrl: mediaUrl,
      caption,
      timestamp: timestampISO,
      originalIndex: typeof story.originalIndex === 'number' ? story.originalIndex : idx,
    };
  });
}

function normalizePosts(items) {
  return (items || []).map((post, idx) => {
    const id = post.id || post.code || post.shortcode || post.postId || `${Date.now()}_${idx}`;
    const ownerUsername = post.ownerUsername || post.username || 'unknown';
    const displayUrl = post.displayUrl || post.thumbnailUrl || post.mediaUrl || '';
    const rawTs = post.timestamp || post.date || post.timestampISO || post.postTime || post.takenAt || post.taken_at;
    const ms = toMillis(rawTs);
    const timestampISO = Number.isNaN(ms) ? '' : new Date(ms).toISOString();
    const caption = post.caption || post.text || '';
    return {
      id,
      ownerUsername,
      displayUrl,
      caption,
      timestamp: timestampISO,
      originalIndex: typeof post.originalIndex === 'number' ? post.originalIndex : idx,
    };
  });
}

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

      const { runId, datasetId: datasetIdFromReq } = req.body;

      if (!runId) {
        logger.error('getApifyRunResults error: Missing runId');
        res.status(400).json({ error: 'Missing runId' });
        return;
      }

      logger.info('--- getApifyRunResults: Received request ---', { runId, datasetId: datasetIdFromReq });

      // Fetch data from Firestore apifyResults collection
      logger.info('--- getApifyRunResults: Fetching from Firestore apifyResults collection ---');
      const apifyResultsDoc = await externalDb.collection('apifyResults').doc(runId).get();
      let apifyResultsData = apifyResultsDoc.exists ? apifyResultsDoc.data() : null;

      // Detect runType early
      let runType = apifyResultsData?.type || 'posts';
      if (runType !== 'stories' && runType !== 'posts') runType = 'posts';
      if (!apifyResultsData?.type) {
        try {
          const runDoc = await externalDb.collection('apifyRuns').doc(runId).get();
          if (runDoc.exists && runDoc.data()?.type === 'stories') runType = 'stories';
        } catch (e) {
          logger.warn('--- getApifyRunResults: Could not read run type from apifyRuns ---', { error: e.message });
        }
      }
      logger.info('--- getApifyRunResults: Determined runType ---', { runType });

      let scrapedData = Array.isArray(apifyResultsData?.results) ? apifyResultsData.results : null;
      if (Array.isArray(scrapedData)) {
        logger.info('--- getApifyRunResults: Firestore results count ---', { count: scrapedData.length });
        // Normalize shape expected by UI even when loading from Firestore
        scrapedData = runType === 'stories' ? normalizeStories(scrapedData) : normalizePosts(scrapedData);
        logger.info('--- getApifyRunResults: Normalized Firestore results count ---', { count: scrapedData.length });
      }

      if (!scrapedData || scrapedData.length === 0) {
        // Fallback: try fetching from Apify dataset directly
        logger.warn('--- getApifyRunResults: No results in Firestore; attempting Apify dataset fetch fallback ---', { runId });

        // Determine datasetId from request or apifyRuns doc
        let datasetId = datasetIdFromReq;
        if (!datasetId || typeof datasetId !== 'string') {
          const runDoc = await externalDb.collection('apifyRuns').doc(runId).get();
          if (runDoc.exists) {
            const runData = runDoc.data() || {};
            datasetId = runData.datasetId || datasetIdFromReq;
            if (runData.type === 'stories') runType = 'stories';
          }
        }

        if (datasetId) {
          try {
            const dsUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true${APIFY_API_TOKEN ? `&token=${APIFY_API_TOKEN}` : ''}`;
            logger.info('--- getApifyRunResults: Fetching dataset from Apify ---', { datasetId });
            const dsRes = await fetch(dsUrl);
            logger.info('--- getApifyRunResults: Dataset fetch status ---', { ok: dsRes.ok, status: dsRes.status });
            if (dsRes.ok) {
              const items = await dsRes.json();
              logger.info('--- getApifyRunResults: Fallback dataset fetch succeeded ---', { count: Array.isArray(items) ? items.length : 0, runType });

              scrapedData = runType === 'stories' ? normalizeStories(items) : normalizePosts(items);
              logger.info('--- getApifyRunResults: Normalized fallback results count ---', { count: scrapedData.length, runType });

              // Persist to apifyResults for future reads
              try {
                await externalDb.collection('apifyResults').doc(runId).set({
                  runId,
                  results: scrapedData,
                  completedAt: new Date().toISOString(),
                  type: runType,
                }, { merge: true });
                logger.info('--- getApifyRunResults: Wrote fallback results to Firestore ---', { runId, count: scrapedData.length });
              } catch (writeErr) {
                logger.error('--- getApifyRunResults: Failed writing fallback results to Firestore ---', { error: writeErr.message });
              }
            } else {
              logger.error('--- getApifyRunResults: Fallback dataset fetch failed ---', { status: dsRes.status });
            }
          } catch (e) {
            logger.error('--- getApifyRunResults: Error during fallback dataset fetch ---', { error: e.message });
          }
        } else {
          logger.error('--- getApifyRunResults: No datasetId available for fallback ---', { runId });
        }
      }

      if (!scrapedData) {
        res.status(404).json({ success: false, error: 'No results found for this run' });
        return;
      }

      // Attached data is already normalized and has originalIndex, but enforce it
      const indexedData = scrapedData.map((post, idx) => (post && typeof post === 'object' && 'originalIndex' in post) ? post : { ...post, originalIndex: idx });
      logger.info('--- getApifyRunResults: Indexed data count ---', { count: indexedData.length, runType });

      // Filter policy: posts -> 25h; stories -> no time filter (show all)
      let filteredData = indexedData;
      if (runType !== 'stories') {
        const POST_MAX_AGE_HOURS = 25;
        const now = Date.now();
        filteredData = indexedData.filter(post => {
          const raw = post.timestamp || post.date || post.timestampISO || post.postTime || post.takenAt || post.taken_at;
          if (!raw) return true; // keep if no date
          const ms = toMillis(raw);
          if (Number.isNaN(ms)) return true; // keep if unparsable
          const ageHours = (now - ms) / (1000 * 60 * 60);
          return ageHours <= POST_MAX_AGE_HOURS;
        });
      }
      logger.info('--- getApifyRunResults: Returning data ---', { itemCount: filteredData.length, runType });

      res.status(200).json({ success: true, status: 'succeeded', data: filteredData });

    } catch (error) {
      logger.error('getApifyRunResults error', { error: error.message, stack: error.stack, fullError: error });
      res.status(500).json({ success: false, error: 'Failed to get scraper results', details: error.message });
    }
  });
});

// New function to proxy Instagram images
const APIFY_PROXY_URL = process.env.APIFY_PROXY_URL || (APIFY_API_TOKEN ? `http://auto:${APIFY_API_TOKEN}@proxy.apify.com:8000` : null);

exports.proxyInstagramImage = functions.https.onRequest({ invoker: 'public', secrets: ["APIFY_API_TOKEN"] }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { imageUrl } = req.query;
    
    if (!imageUrl || typeof imageUrl !== 'string') {
      res.status(400).json({ error: 'imageUrl parameter is required' });
      return;
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.instagram.com/',
      // forward range if present
      ...(req.headers['range'] ? { Range: String(req.headers['range']) } : {}),
    };

    const attempts = [];
    if (APIFY_PROXY_URL) {
      attempts.push({ agent: new HttpsProxyAgent(APIFY_PROXY_URL), label: 'apify-proxy' });
    }
    attempts.push({ agent: undefined, label: 'direct' });

    let response;
    let attemptError = null;
    for (const attempt of attempts) {
      try {
        response = await fetch(imageUrl, { headers, redirect: 'follow', agent: attempt.agent });
        if (response.ok || response.status === 206) {
          break;
        }
        attemptError = new Error(`Upstream returned ${response.status}`);
        logger.warn('proxyInstagramImage upstream error', { status: response.status, mode: attempt.label, imageUrl });
      } catch (err) {
        attemptError = err;
        logger.warn('proxyInstagramImage fetch attempt failed', { mode: attempt.label, error: err.message, imageUrl });
      }
      response = undefined;
    }

    if (!response || (!response.ok && response.status !== 206)) {
      const status = response ? response.status : 502;
      res.status(status).json({ error: 'Failed to fetch media', details: attemptError ? attemptError.message : undefined });
      return;
    }

    // Copy relevant headers
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    const cacheControl = response.headers.get('cache-control') || 'public, max-age=3600';

    res.set('Content-Type', contentType.split(';')[0]);
    if (contentLength) res.set('Content-Length', contentLength);
    if (acceptRanges) res.set('Accept-Ranges', acceptRanges);
    if (contentRange) res.set('Content-Range', contentRange);
    res.set('Cache-Control', cacheControl);
    res.set('Content-Disposition', 'inline');

    // Status passthrough (200 or 206)
    res.status(response.status);

    // Stream body
    if (response.body && typeof response.body.pipe === 'function') {
      response.body.pipe(res);
    } else {
      // Fallback to buffer
      const buf = Buffer.from(await response.arrayBuffer());
      res.send(buf);
    }
    
  } catch (error) {
    logger.error('proxyInstagramImage error:', { message: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});
