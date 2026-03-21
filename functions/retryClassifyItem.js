const functions = require('firebase-functions');
const { externalDb, bucket } = require('./firebase');
const logger = require('firebase-functions/logger');
const OpenAI = require('openai');
const fetch = require('node-fetch');

function pickBestImageUrl(item, runType) {
  if (!item || typeof item !== 'object') return null;

  // 1. If it's a video in a POSTS run, we use the thumbnail for AI vision
  if (runType !== 'stories' && (item.mediaType === 'video' || item.isVideo === true)) {
    const thumb = item.thumbnailUrl || item.thumbnail;
    if (typeof thumb === 'string') return thumb;
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

// Processing helpers mirrored from processClassifiedRun.js
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
      metadata: { source: 'auto-classified-retry' }
    }
  });
  return targetPath;
}

async function callExtractFlyerInfo(storagePath, contextText, model, runType) {
  const url = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/extractFlyerInfo';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: storagePath, context: contextText || '', model, runType })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`extractFlyerInfo failed: ${t}`);
  }
  const json = await resp.json();
  if (!json.success) throw new Error(`extractFlyerInfo error: ${json.error || 'unknown'}`);
  return json.data;
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

exports.retryClassifyItem = functions.https.onRequest({ 
  invoker: 'public', 
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 120 // Increased timeout for full lifecycle
}, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { runId, itemId, options, model: requestModel, forceVenueId } = req.body || {};
    if (!runId || !itemId) return res.status(400).json({ success: false, error: 'Missing runId or itemId' });

    logger.info('retryClassifyItem: starting full retry', { runId, itemId, requestModel, forceVenueId });

    const {
      confidenceThreshold = 0.6,
      modelTriage = 'gpt-4o-mini',
      modelEscalate = 'gpt-4o',
    } = options || {};

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // 1. Load raw results to get the freshest image/caption
    const docRef = externalDb.collection('apifyResults').doc(runId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'apifyResults not found' });
    const data = snap.data() || {};
    const items = Array.isArray(data.results) ? data.results : [];
    const runType = data.type || null;

    let targetItem = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const cid = it?.id || it?.shortcode || String(i);
      if (cid === itemId) { targetItem = it; break; }
    }

    const clsId = `${runId}_${itemId}`;
    const clsRef = externalDb.collection('apifyClassifications').doc(clsId);
    const clsSnap = await clsRef.get();
    const clsData = clsSnap.exists ? (clsSnap.data() || {}) : {};

    if (!targetItem && !clsSnap.exists) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const rawImageUrl = targetItem ? pickBestImageUrl(targetItem, runType) : (clsData.imageUrl || null);
    const caption = targetItem ? (targetItem.caption || targetItem.text || '') : (clsData.caption || '');

    if (!rawImageUrl) {
      return res.status(400).json({ success: false, error: 'No image URL found' });
    }

    // 2. Re-run AI Triage
    const proxiedUrl = `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(rawImageUrl)}`;

    async function callModel(modelName) {
      const messages = [
        { role: 'system', content: 'Determine if this Instagram item advertises a real-world event with BOTH a date and a venue. Return ONLY JSON.' },
        { role: 'user', content: [
          { type: 'text', text: 'Output JSON: {"isEvent":boolean,"confidence":number,"reasons":string[],"signals":{"dateFound":boolean,"venueFound":boolean}}' },
          { type: 'image_url', image_url: { url: proxiedUrl, detail: 'low' } },
          { type: 'text', text: `Caption: ${caption}` },
        ]},
      ];
      const resp = await openai.chat.completions.create({
        model: modelName,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
      return JSON.parse(resp.choices[0].message.content);
    }

    let classification = await callModel(modelTriage);
    if (classification.confidence < confidenceThreshold) {
      classification = await callModel(modelEscalate);
    }

    const isEvent = !!classification.isEvent;
    
    // Initial classification update
    const updatePayload = {
      runId,
      itemId,
      type: runType,
      imageUrl: rawImageUrl,
      caption: caption || null,
      ownerUsername: targetItem?.ownerUsername || clsData.ownerUsername || null,
      timestamp: targetItem?.timestamp || targetItem?.date || clsData.timestamp || null,
      isEvent,
      confidence: classification.confidence || 0,
      reasons: classification.reasons || [],
      signals: classification.signals || {},
      model: { triage: modelTriage, escalate: modelEscalate },
      updatedAt: new Date().toISOString(),
      error: null,
      eventId: null // Reset eventId initially
    };

    // 3. IF EVENT: Trigger full processing immediately
    if (isEvent) {
      logger.info('retryClassifyItem: item is event, starting auto-processing', { itemId });
      try {
        const buf = await downloadImage(rawImageUrl);
        const path = `auto-classified/${runId}/${itemId}-${Date.now()}.jpg`;
        await uploadToStorage(buf, path);
        
        const context = `Caption: ${caption}\nUsername: ${updatePayload.ownerUsername || ''}`;
        const extracted = await callExtractFlyerInfo(path, context, requestModel, runType);
        
        const venueName = extracted.venue?.name || extracted.venue || extracted.venueName;
        updatePayload.detectedVenueName = venueName || null;
        updatePayload.detectedDate = extracted.date?.start || null;

        const eventPayload = {
          ...extracted,
          venue: extracted.venue?.name || extracted.venue || extracted.venueName,
          forceVenueId: forceVenueId || undefined,
          source: { platform: 'instagram', runId, itemId, from: 'auto-classified-retry' },
          path,
        };
        
        const eventId = await callSaveEvent(eventPayload);
        updatePayload.eventId = eventId;
        updatePayload.path = path;
        logger.info('retryClassifyItem: auto-processing success', { itemId, eventId });
      } catch (procErr) {
        logger.error('retryClassifyItem: auto-processing failed', { itemId, error: procErr.message });
        updatePayload.error = `Classification succeeded, but processing failed: ${procErr.message}`;
      }
    }

    await clsRef.set(updatePayload, { merge: true });
    const finalDoc = (await clsRef.get()).data();
    
    return res.status(200).json({ success: true, updated: { id: clsId, ...finalDoc } });

  } catch (e) {
    logger.error('retryClassifyItem overall error', { error: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
});
