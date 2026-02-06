const functions = require('firebase-functions');
const { externalDb, bucket } = require('./firebase');
const logger = require('firebase-functions/logger');
const fetch = require('node-fetch');

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
      metadata: { source: 'auto-classified' }
    }
  });
  return targetPath;
}

async function callExtractFlyerInfo(storagePath, contextText) {
  const url = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/extractFlyerInfo';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: storagePath, context: contextText || '' })
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

async function processClassifiedRunInternal(runId, options = {}) {
  logger.info('processClassifiedRun: start', { runId });
  const q = await externalDb.collection('apifyClassifications')
    .where('runId', '==', runId)
    .where('isEvent', '==', true)
    .get();
  if (q.empty) {
    logger.info('processClassifiedRun: no positive classifications', { runId });
    return { processed: 0, saved: 0, errors: 0 };
  }
  let processed = 0, saved = 0, errors = 0;
  for (const doc of q.docs) {
    const cls = doc.data();
    // skip if already linked
    if (cls.eventId) { processed++; continue; }
    const itemId = cls.itemId || doc.id;
    try {
      const imageUrl = cls.imageUrl;
      if (!imageUrl) throw new Error('no imageUrl in classification');
      const buf = await downloadImage(imageUrl);
      const path = `auto-classified/${runId}/${itemId}-${Date.now()}.jpg`;
      await uploadToStorage(buf, path);
      const context = `Caption: ${cls.caption || ''}\nUsername: ${cls.ownerUsername || ''}`;
      const extracted = await callExtractFlyerInfo(path, context);
      // attach source info for provenance
      const eventPayload = {
        ...extracted,
        source: {
          platform: 'instagram',
          runId,
          itemId,
          from: 'auto-classified',
        },
        path,
      };
      const eventId = await callSaveEvent(eventPayload);
      await doc.ref.set({ eventId, path, updatedAt: new Date().toISOString() }, { merge: true });
      saved++;
    } catch (e) {
      logger.error('processClassifiedRun: item error', { runId, itemId, error: e.message });
      errors++;
      await doc.ref.set({ error: e.message, updatedAt: new Date().toISOString() }, { merge: true });
    } finally {
      processed++;
    }
  }
  logger.info('processClassifiedRun: finished', { runId, processed, saved, errors });
  return { processed, saved, errors };
}

exports.processClassifiedRun = functions.https.onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ success: false, error: 'Missing runId' });
    const result = await processClassifiedRunInternal(runId, {});
    return res.status(200).json({ success: true, result });
  } catch (e) {
    logger.error('processClassifiedRun error', { error: e.message, stack: e.stack });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { processClassifiedRun: exports.processClassifiedRun, processClassifiedRunInternal };


