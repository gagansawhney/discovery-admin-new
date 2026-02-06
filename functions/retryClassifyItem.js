const functions = require('firebase-functions');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const OpenAI = require('openai');

function pickBestImageUrl(item) {
  if (!item || typeof item !== 'object') return null;
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

exports.retryClassifyItem = functions.https.onRequest({ invoker: 'public', secrets: ["OPENAI_API_KEY"] }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { runId, itemId, options } = req.body || {};
    if (!runId || !itemId) return res.status(400).json({ success: false, error: 'Missing runId or itemId' });

    const {
      confidenceThreshold = 0.7,
      modelTriage = 'gpt-4o-mini',
      modelEscalate = 'gpt-4o',
    } = options || {};

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
    if (!OPENAI_API_KEY) {
      logger.error('retryClassifyItem error: OpenAI API key not configured');
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // Load run results
    const docRef = externalDb.collection('apifyResults').doc(runId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'apifyResults not found' });
    const data = snap.data() || {};
    const items = Array.isArray(data.results) ? data.results : [];
    const runType = data.type || null;

    // Find target item
    let targetIndex = -1;
    let targetItem = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const cid = it?.id || it?.shortcode || String(i);
      if (cid === itemId) { targetIndex = i; targetItem = it; break; }
    }

    // Fallback: use existing classification doc to recover image/caption if needed
    const clsId = `${runId}_${itemId}`;
    const clsRef = externalDb.collection('apifyClassifications').doc(clsId);
    const clsSnap = await clsRef.get();
    const clsData = clsSnap.exists ? (clsSnap.data() || {}) : {};

    if (!targetItem && !clsSnap.exists) {
      return res.status(404).json({ success: false, error: 'Item not found in run results or classifications' });
    }

    // Build inputs
    const rawImageUrl = targetItem ? pickBestImageUrl(targetItem) : (clsData.imageUrl || null);
    const caption = targetItem ? (targetItem.caption || targetItem.text || '') : (clsData.caption || '');

    // If still no image, write a non-event with reason
    if (!rawImageUrl || typeof rawImageUrl !== 'string') {
      await clsRef.set({
        runId,
        itemId,
        type: runType,
        isEvent: false,
        confidence: 0,
        reasons: ['no-image'],
        caption: caption || null,
        ownerUsername: targetItem?.ownerUsername || clsData.ownerUsername || null,
        timestamp: targetItem?.timestamp || targetItem?.date || clsData.timestamp || null,
        updatedAt: new Date().toISOString(),
        model: { triage: modelTriage, escalate: modelEscalate },
        error: null,
      }, { merge: true });
      const out = (await clsRef.get()).data();
      return res.status(200).json({ success: true, updated: { id: clsId, ...out } });
    }

    // Proxy image for OpenAI fetch
    const proxiedUrl = `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(rawImageUrl)}`;

    async function callModel(modelName) {
      const system = 'You are a vision+text classifier. Determine if this Instagram item advertises a real-world event with BOTH a date and a venue. Return ONLY JSON.';
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: 'Classify this as an event or not. Rules: Must have (1) a date and (2) a venue. Output JSON: {"isEvent":boolean,"confidence":number,"reasons":string[],"signals":{"dateFound":boolean,"venueFound":boolean}}' },
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

    let out;
    try {
      out = await callModel(modelTriage);
      if (typeof out?.confidence === 'number' && out.confidence < confidenceThreshold) {
        try { out = await callModel(modelEscalate); } catch (_) {}
      }
    } catch (e) {
      // write error on the doc
      await clsRef.set({
        runId,
        itemId,
        type: runType,
        imageUrl: rawImageUrl,
        caption: caption || null,
        ownerUsername: targetItem?.ownerUsername || clsData.ownerUsername || null,
        timestamp: targetItem?.timestamp || targetItem?.date || clsData.timestamp || null,
        updatedAt: new Date().toISOString(),
        error: e.message || 'classification-failed',
      }, { merge: true });
      const errDoc = (await clsRef.get()).data();
      return res.status(200).json({ success: false, updated: { id: clsId, ...errDoc } });
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
      ownerUsername: targetItem?.ownerUsername || clsData.ownerUsername || null,
      timestamp: targetItem?.timestamp || targetItem?.date || clsData.timestamp || null,
      isEvent,
      confidence,
      reasons,
      signals,
      model: { triage: modelTriage, escalate: modelEscalate },
      updatedAt: new Date().toISOString(),
      error: null,
    }, { merge: true });

    const updatedDoc = (await clsRef.get()).data();
    return res.status(200).json({ success: true, updated: { id: clsId, ...updatedDoc } });
  } catch (e) {
    logger.error('retryClassifyItem error', { error: e.message, stack: e.stack });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { retryClassifyItem: exports.retryClassifyItem };


