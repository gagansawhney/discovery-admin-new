const functions = require('firebase-functions');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const OpenAI = require('openai');

// Helper: choose best image URL from an Apify item
function pickBestImageUrl(item) {
  if (!item || typeof item !== 'object') return null;
  const shortcode = item.shortcode || item.shortCode || item.code || null;
  if (typeof shortcode === 'string' && shortcode.length > 0) {
    return `https://www.instagram.com/p/${shortcode}/media/?size=l`;
  }
  // Prefer explicit images array
  if (Array.isArray(item.images) && item.images.length > 0) {
    const url = item.images[0]?.url || item.images[0];
    if (typeof url === 'string') return url;
  }
  if (typeof item.displayUrl === 'string') return item.displayUrl;
  if (typeof item.thumbnailUrl === 'string') return item.thumbnailUrl;
  if (typeof item.thumbnail === 'string') return item.thumbnail;
  if (typeof item.media === 'string') return item.media;
  if (typeof item.mediaUrl === 'string') return item.mediaUrl;
  if (typeof item.url === 'string') return item.url;
  if (typeof item.image === 'string') return item.image;
  return null;
}

// Helper: detect if video without thumbnail
function isVideoWithoutThumb(item) {
  const mediaType = (item?.mediaType || '').toString().toLowerCase();
  const isVideo = item?.isVideo === true || mediaType === 'video' || (typeof item?.displayUrl === 'string' && item.displayUrl.includes('.mp4')) || (typeof item?.media === 'string' && item.media.includes('.mp4'));
  const hasThumb = !!(item?.thumbnailUrl || item?.thumbnail);
  return isVideo && !hasThumb;
}

// Public helper to classify a run's items. Can be invoked from other functions.
async function classifyRunItems(runId, options = {}) {
  const {
    confidenceThreshold = 0.7,
    modelTriage = 'gpt-4o-mini',
    modelEscalate = 'gpt-4o',
    maxConcurrent = 3,
  } = options;

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
  if (!OPENAI_API_KEY) {
    logger.error('classifyRunItems error: OpenAI API key not configured');
    return { success: false, error: 'OpenAI API key not configured' };
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const docRef = externalDb.collection('apifyResults').doc(runId);
  const snap = await docRef.get();
  if (!snap.exists) {
    logger.warn('classifyRunItems: apifyResults doc not found', { runId });
    return { success: false, error: 'apifyResults not found' };
  }
  const data = snap.data() || {};
  const items = Array.isArray(data.results) ? data.results : [];
  const runType = data.type || null; // 'posts' | 'stories' | null
  logger.info('classifyRunItems: starting', { runId, count: items.length, runType });

  // Concurrency limiter (simple queue)
  let inFlight = 0;
  const queue = [...items.entries()];
  const results = { processed: 0, classified: 0, skipped: 0, errors: 0 };

  async function classifyOne(index, item) {
    try {
      // Idempotency: skip if already classified
      const itemId = item.id || item.shortcode || String(index);
      const clsId = `${runId}_${itemId}`;
      const clsRef = externalDb.collection('apifyClassifications').doc(clsId);
      const existing = await clsRef.get();
      if (existing.exists) {
        results.skipped++;
        return;
      }

      // If video without thumbnail, mark unknown for now (per product decision)
      if (isVideoWithoutThumb(item)) {
        await clsRef.set({
          runId,
          itemId,
          type: runType,
          isEvent: false,
          confidence: 0,
          reasons: ['video-without-thumbnail: deferred'],
          caption: item.caption || item.text || null,
          ownerUsername: item.ownerUsername || null,
          timestamp: item.timestamp || item.date || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: { triage: modelTriage, escalate: modelEscalate },
        }, { merge: true });
        results.classified++;
        return;
      }

      const rawImageUrl = pickBestImageUrl(item);
      if (!rawImageUrl || typeof rawImageUrl !== 'string') {
        await clsRef.set({
          runId,
          itemId,
          type: runType,
          isEvent: false,
          confidence: 0,
          reasons: ['no-image'],
          caption: item.caption || item.text || null,
          ownerUsername: item.ownerUsername || null,
          timestamp: item.timestamp || item.date || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: { triage: modelTriage, escalate: modelEscalate },
        }, { merge: true });
        results.classified++;
        return;
      }

      // Use proxy endpoint so OpenAI can fetch the image
      const proxiedUrl = `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(rawImageUrl)}`;
      const caption = item.caption || item.text || '';

      async function callModel(modelName) {
        const system = 'You are a vision+text classifier. Determine if this Instagram item advertises a real-world event with BOTH a date and a venue. Return ONLY JSON.';
        const messages = [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: 'Classify this as an event or not. Rules: Must have (1) a date and (2) a venue. Date may appear in the flyer image or caption text. Output JSON: {"isEvent":boolean,"confidence":number,"reasons":string[],"signals":{"dateFound":boolean,"venueFound":boolean}}' },
            { type: 'image_url', image_url: { url: proxiedUrl, detail: 'low' } },
            { type: 'text', text: `Caption: ${caption || 'n/a'}` },
          ]},
        ];
        const resp = await openai.chat.completions.create({
          model: modelName,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 400,
        });
        const content = resp.choices?.[0]?.message?.content || '{}';
        return JSON.parse(content);
      }

      let out = await callModel(modelTriage);
      if (typeof out?.confidence === 'number' && out.confidence < confidenceThreshold) {
        try {
          out = await callModel(modelEscalate);
        } catch (e) {
          // keep triage if escalate fails
        }
      }

      const isEvent = !!out?.isEvent;
      const confidence = typeof out?.confidence === 'number' ? out.confidence : 0;
      const reasons = Array.isArray(out?.reasons) ? out.reasons.slice(0, 10) : [];
      const signals = out?.signals || {};

      await clsRef.set({
        runId,
        itemId,
        type: runType,
        imageUrl: rawImageUrl,
        caption: caption || null,
        ownerUsername: item.ownerUsername || null,
        timestamp: item.timestamp || item.date || null,
        isEvent,
        confidence,
        reasons,
        signals,
        model: { triage: modelTriage, escalate: modelEscalate },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      results.classified++;
    } catch (e) {
      logger.error('classifyRunItems: classifyOne error', { runId, index, error: e.message });
      results.errors++;
    } finally {
      results.processed++;
    }
  }

  async function next() {
    if (queue.length === 0) return;
    if (inFlight >= maxConcurrent) return;
    const [index, item] = queue.shift();
    inFlight++;
    classifyOne(index, item).finally(() => {
      inFlight--;
      next();
    });
    // Also spin up more until we hit concurrency
    while (inFlight < maxConcurrent && queue.length > 0) {
      const [i2, it2] = queue.shift();
      inFlight++;
      classifyOne(i2, it2).finally(() => {
        inFlight--;
        next();
      });
    }
  }

  await new Promise((resolve) => {
    if (queue.length === 0) return resolve();
    next();
    const interval = setInterval(() => {
      if (queue.length === 0 && inFlight === 0) {
        clearInterval(interval);
        resolve();
      }
    }, 200);
  });

  logger.info('classifyRunItems: finished', { runId, results });
  return { success: true, results };
}

exports.classifyApifyRun = functions.https.onRequest({ invoker: 'public', secrets: ["OPENAI_API_KEY"] }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ success: false, error: 'Missing runId' });
    const result = await classifyRunItems(runId, {});
    return res.status(200).json({ success: true, result });
  } catch (e) {
    logger.error('classifyApifyRun error', { error: e.message, stack: e.stack });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { classifyApifyRun: exports.classifyApifyRun, classifyRunItems };
