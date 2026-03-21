const functions = require('firebase-functions');
const { externalDb, bucket } = require('./firebase');
const logger = require('firebase-functions/logger');
const fetch = require('node-fetch');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');

// Helper: choose best image URL from an Apify item
function pickBestImageUrl(item, runType) {
  if (!item || typeof item !== 'object') return null;

  // 1. If it's a video, use the thumbnail for AI vision (works for Posts and Stories)
  if (item.mediaType === 'video' || item.isVideo === true || item.mediaUrl?.includes('.mp4')) {
    const thumb = item.thumbnailUrl || item.thumbnail || item.displayUrl;
    if (typeof thumb === 'string' && !thumb.includes('.mp4')) return thumb;
  }

  // 2. Try the standard Instagram large media endpoint
  const shortcode = item.shortcode || item.shortCode || item.code || null;
  if (typeof shortcode === 'string' && shortcode.length > 0 && !item.mediaUrl?.includes('.mp4')) {
    return `https://www.instagram.com/p/${shortcode}/media/?size=l`;
  }

  // 3. Fallback chain for images
  if (Array.isArray(item.images) && item.images.length > 0) {
    const url = item.images[0]?.url || item.images[0];
    if (typeof url === 'string') return url;
  }
  
  const chain = [
    item.displayUrl,
    item.thumbnailUrl,
    item.thumbnail,
    item.mediaUrl,
    item.media,
    item.url,
    item.image
  ];

  for (const url of chain) {
    if (typeof url === 'string' && url.length > 0 && !url.includes('.mp4')) {
      return url;
    }
  }

  return item.thumbnailUrl || item.thumbnail || null;
}

async function downloadImage(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.buffer();
  return buf;
}

async function uploadToStorage(buffer, targetPath) {
  const file = bucket.file(targetPath);
  await file.save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: { source: 'unified-scraper' }
    }
  });
  return targetPath;
}

async function callSaveEvent(eventData) {
  const url = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/saveEvent';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventData)
  });
  const json = await resp.json();
  if (!resp.ok || !json.success) throw new Error(json.error || 'Failed to save event');
  return json.eventId;
}

async function callGeminiUnified(apiKey, modelName, mediaUrl, caption, systemPrompt, isVideo = false) {
  const genAI = new GoogleGenerativeAI(apiKey);
  // Default 'gemini' to the latest 2.0-flash
  const actualModel = (modelName === 'gemini' || modelName.includes('2.0')) ? 'gemini-2.0-flash' : 'gemini-1.5-flash';
  
  const model = genAI.getGenerativeModel({ 
    model: actualModel,
    systemInstruction: systemPrompt 
  });

  const res = await fetch(mediaUrl);
  const buf = await res.buffer();
  const base64Data = buf.toString('base64');
  const mimeType = isVideo ? "video/mp4" : "image/jpeg";

  const result = await model.generateContent([
    {
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    },
    { text: `Caption: ${caption}` }
  ]);

  const response = await result.response;
  let text = response.text();
  text = text.replace(/```json\n?/, '').replace(/\n?```/, '').trim();
  return JSON.parse(text);
}

async function unifiedProcessRunInternal(runId, options = {}) {
  const { model = 'gpt-5.2', maxConcurrent = 3 } = options;
  logger.info('unifiedProcessRun: start', { runId, model });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : undefined;

  if (model.includes('gpt') && !OPENAI_API_KEY) throw new Error('OpenAI API key not configured');
  if (model.includes('gemini') && !GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  const openai = model.includes('gpt') ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

  // 1. Get raw items
  const docRef = externalDb.collection('apifyResults').doc(runId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('Run results not found');
  
  const data = snap.data() || {};
  const items = Array.isArray(data.results) ? data.results : [];
  const runType = data.type || null;

  const results = { processed: 0, saved: 0, skipped: 0, errors: 0 };
  let inFlight = 0;
  const queue = [...items.entries()];

  const systemPrompt = `YOU ARE: an event-extraction assistant.
GOAL: Analyze the Instagram post and determine if it advertises a real-world event with BOTH a date and a venue.

IF IT IS AN EVENT:
Return a JSON object with "isEvent": true and the following fields extracted:
- name: clear human title
- date.start: ISO-8601 Asia/Kolkata
- venue: { name: string }
- searchText: unique bag-of-words (title + caption + tags)
- tags: array of categories (techno, live-music, comedy, etc.)

IF IT IS NOT AN EVENT:
Return a JSON object with "isEvent": false and "reasons": array of strings.

Rules: Use IST timezone (+05:30). Assume current year is 2025.
Return ONLY raw JSON. No markdown.`;

  async function processOne(index, item) {
    const itemId = item.id || item.shortcode || String(index);
    const clsId = `${runId}_${itemId}`;
    const clsRef = externalDb.collection('apifyClassifications').doc(clsId);

    try {
      // Idempotency: skip if already processed
      const existing = await clsRef.get();
      if (existing.exists && existing.data()?.updatedAt) {
        results.skipped++;
        return;
      }

      const rawImageUrl = pickBestImageUrl(item, runType);
      const isVideo = (item.mediaType === 'video' || item.isVideo === true || item.mediaUrl?.includes('.mp4'));
      const videoUrl = (runType === 'stories' && isVideo) ? item.mediaUrl : null;
      const targetMediaUrl = (model.includes('gemini') && videoUrl) ? videoUrl : rawImageUrl;
      
      const caption = item.caption || item.text || '';

      if (!targetMediaUrl) {
        await clsRef.set({ runId, itemId, isEvent: false, reasons: ['no-media'], updatedAt: new Date().toISOString() }, { merge: true });
        results.processed++;
        return;
      }

      // We only proxy images for OpenAI. Gemini handles direct URLs or we pass base64 from a direct fetch.
      const proxiedUrl = model.includes('gpt') 
        ? `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(targetMediaUrl)}`
        : targetMediaUrl;

      let content;
      if (model.includes('gemini')) {
        content = await callGeminiUnified(GEMINI_API_KEY, model, targetMediaUrl, caption, systemPrompt, !!videoUrl);
      } else {
        // Unified AI Call (Classification + Extraction)
        const aiResponse = await openai.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [
              { type: 'image_url', image_url: { url: proxiedUrl, detail: 'high' } },
              { type: 'text', text: `Caption: ${caption}` }
            ]}
          ],
          max_completion_tokens: 1500,
          response_format: { type: 'json_object' }
        });
        content = JSON.parse(aiResponse.choices[0].message.content || '{}');
      }

      const isEvent = !!content.isEvent;

      const updatePayload = {
        runId,
        itemId,
        type: runType,
        imageUrl: rawImageUrl,
        caption: caption || null,
        ownerUsername: item.ownerUsername || null,
        timestamp: item.timestamp || item.date || null,
        isEvent,
        confidence: isEvent ? 1.0 : 0.0,
        reasons: content.reasons || [],
        signals: { dateFound: isEvent, venueFound: isEvent },
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      if (isEvent) {
        const extracted = content.data || content;
        const venueName = extracted.venue?.name || extracted.venue || extracted.venueName;
        updatePayload.detectedVenueName = venueName || null;
        updatePayload.detectedDate = extracted.date?.start || null;

        // Try to auto-save the event
        try {
          const buf = await downloadImage(rawImageUrl);
          const path = `auto-processed/${runId}/${itemId}-${Date.now()}.jpg`;
          await uploadToStorage(buf, path);
          
          const eventPayload = {
            ...extracted,
            id: uuidv4(),
            venue: venueName,
            source: { platform: 'instagram', runId, itemId, from: 'unified-scraper' },
            path,
          };
          
          const eventId = await callSaveEvent(eventPayload);
          updatePayload.eventId = eventId;
          updatePayload.path = path;
          results.saved++;
        } catch (saveErr) {
          logger.error('unifiedProcessRun: save failed', { itemId, error: saveErr.message });
          updatePayload.error = saveErr.message;
        }
      }

      await clsRef.set(updatePayload, { merge: true });
      results.processed++;

    } catch (err) {
      logger.error('unifiedProcessRun: item error', { itemId, error: err.message });
      results.errors++;
    }
  }

  // concurrency helper
  async function next() {
    if (queue.length === 0) return;
    if (inFlight >= maxConcurrent) return;
    const [index, item] = queue.shift();
    inFlight++;
    await processOne(index, item);
    inFlight--;
    next();
  }

  const tasks = Array(maxConcurrent).fill(null).map(() => next());
  await Promise.all(tasks);

  // Wait for queue to empty
  while (inFlight > 0 || queue.length > 0) {
    await new Promise(r => setTimeout(r, 100));
  }

  logger.info('unifiedProcessRun: finished', { runId, results });
  return results;
}

exports.processClassifiedRun = functions.https.onRequest({ 
  invoker: 'public', 
  secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY"],
  timeoutSeconds: 540
}, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { runId, reprocess, model } = req.body || {};
    if (!runId) return res.status(400).json({ success: false, error: 'Missing runId' });
    
    // We repurpose processClassifiedRun as our unified entry point
    const result = await unifiedProcessRunInternal(runId, { 
      model: model || 'gpt-5.2',
      reprocess: !!reprocess 
    });
    return res.status(200).json({ success: true, result });
  } catch (e) {
    logger.error('processClassifiedRun error', { error: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { processClassifiedRun: exports.processClassifiedRun, unifiedProcessRunInternal };
