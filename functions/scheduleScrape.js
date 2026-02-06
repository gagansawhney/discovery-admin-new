const functions = require('firebase-functions');
const logger = require('firebase-functions/logger');
const fetch = require('node-fetch');
const { externalDb } = require('./firebase');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const START_POSTS_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/startInstagramScraper';
const START_STORIES_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/startInstagramStoriesScraper';

exports.scheduleScrape = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method not allowed' });
      return;
    }
    const { startAtISO, runTypes, repeat } = req.body || {};
    if (!startAtISO || typeof startAtISO !== 'string') {
      res.status(400).json({ success: false, error: 'startAtISO is required (ISO datetime string)' });
      return;
    }
    const when = new Date(startAtISO);
    if (isNaN(when.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid startAtISO datetime' });
      return;
    }
    const types = Array.isArray(runTypes) && runTypes.length > 0 ? runTypes : ['posts', 'stories'];
    const repeatValue = (typeof repeat === 'string' && ['once', 'daily'].includes(repeat)) ? repeat : 'once';
    const doc = {
      startAt: when.toISOString(),
      runTypes: types,
      repeat: repeatValue,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const ref = await externalDb.collection('scrapeSchedules').add(doc);
    res.status(200).json({ success: true, scheduleId: ref.id });
  } catch (e) {
    logger.error('scheduleScrape error', { error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  }
});

exports.processScheduledScrapes = onSchedule('every 1 minutes', async (event) => {
  const now = new Date();
  const nowISO = now.toISOString();
  try {
    const snap = await externalDb
      .collection('scrapeSchedules')
      .where('status', '==', 'pending')
      .where('startAt', '<=', nowISO)
      .get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      const docRef = doc.ref;
      try {
        await externalDb.runTransaction(async (tx) => {
          const fresh = await tx.get(docRef);
          if (!fresh.exists) return;
          const data = fresh.data();
          if (data.status !== 'pending') return;
          tx.update(docRef, { status: 'processing', processingAt: new Date().toISOString() });
        });
      } catch (claimErr) {
        logger.warn('Failed to claim schedule', { id: doc.id, error: claimErr.message });
        continue;
      }

      const data = doc.data();
      const types = Array.isArray(data.runTypes) ? data.runTypes : ['posts', 'stories'];
      const results = { posts: null, stories: null };
      try {
        if (types.includes('posts')) {
          // Align with manual scraper: pass startDate = now - 25 hours
          const now = new Date();
          now.setHours(now.getHours() - 25);
          const startDate = now.toISOString().slice(0, 19) + 'Z';
          const r = await fetch(START_POSTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.success && j.runId) results.posts = j.runId; else logger.error('Failed to start posts via schedule', { id: doc.id, status: r.status, body: j });
        }
        if (types.includes('stories')) {
          const r = await fetch(START_STORIES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.success && j.runId) results.stories = j.runId; else logger.error('Failed to start stories via schedule', { id: doc.id, status: r.status, body: j });
        }
        const succeeded = (results.posts || results.stories);
        const repeat = data.repeat || 'once';
        if (repeat === 'daily' && succeeded) {
          // Schedule the next run at the same time next day
          const currentStart = new Date(data.startAt || nowISO);
          const nextStart = new Date(currentStart.getTime());
          nextStart.setDate(nextStart.getDate() + 1);
          await docRef.set({
            status: 'pending',
            lastTriggeredAt: new Date().toISOString(),
            startAt: nextStart.toISOString(),
            postsRunId: results.posts || null,
            storiesRunId: results.stories || null,
          }, { merge: true });
        } else {
          await docRef.set({
            status: succeeded ? 'triggered' : 'failed',
            triggeredAt: new Date().toISOString(),
            postsRunId: results.posts || null,
            storiesRunId: results.stories || null,
          }, { merge: true });
        }
      } catch (e) {
        logger.error('Error processing schedule', { id: doc.id, error: e.message });
        await docRef.set({ status: 'failed', failedAt: new Date().toISOString(), error: e.message }, { merge: true });
      }
    }
  } catch (e) {
    logger.error('processScheduledScrapes error', { error: e.message, stack: e.stack });
  }
}); 