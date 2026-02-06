const functions = require('firebase-functions');
const { onSchedule } = require("firebase-functions/v2/scheduler");
const fetch = require('node-fetch');
const { externalDb } = require('./firebase');
const { classifyRunItems } = require('./classifyApifyRun');
const { processClassifiedRunInternal } = require('./processClassifiedRun');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true, credentials: true });

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

// Shared polling logic
const pollRunsLogic = async (typeFilter = null) => {
  if (!APIFY_API_TOKEN) {
    logger.error('pollRunsLogic error: Apify API token not configured');
    throw new Error('Apify API token not configured');
  }

  // Query Firestore for all runs with status 'initiated' or 'pending'
  const snapshot = await externalDb.collection('apifyRuns')
    .where('status', 'in', ['initiated', 'pending'])
    .get();

  const pollLog = {
    timestamp: new Date().toISOString(),
    checkedRunIds: [],
    completedRunIds: [],
    failedRunIds: [],
    errors: [],
  };

  if (snapshot.empty) {
    // Optional: Log that no runs were pending if you want verbose logs
    // await externalDb.collection('pollingLogs').add(pollLog);
    return pollLog;
  }

  for (const doc of snapshot.docs) {
    const run = doc.data();
    if (typeFilter === 'posts' && run?.type === 'stories') continue; // only posts
    if (typeFilter === 'stories' && run?.type !== 'stories') continue; // only stories

    const runId = run.runId;
    const datasetId = run.datasetId;
    pollLog.checkedRunIds.push(runId || doc.id);

    // Fast-path: if results already exist, mark as completed to unblock UI
    try {
      const existingResults = await externalDb.collection('apifyResults').doc(runId || doc.id).get();
      if (existingResults.exists) {
        await doc.ref.update({ status: 'COMPLETED', completedAt: new Date().toISOString(), classificationStatus: 'READY' });
        pollLog.completedRunIds.push(runId || doc.id);
        continue;
      }
    } catch (_) {
      // ignore errors in fast-path
    }

    try {
      let status = null;
      let statusOk = false;

      // Prefer generic run status if we have a plausible runId
      if (runId && typeof runId === 'string' && runId.length > 10) {
        const runStatusUrl = `https://api.apify.com/v2/runs/${runId}?token=${APIFY_API_TOKEN}`;
        const runStatusRes = await fetch(runStatusUrl);
        const runStatusData = await runStatusRes.json();
        // logger.info(`--- pollRunsLogic: Full run status response for runId=${runId}: ${JSON.stringify(runStatusData)}`);
        status = runStatusData.data?.status || null;
        statusOk = !!runStatusData.data;
      }

      if (status === 'SUCCEEDED') {
        // Normal path: finished
        const dsId = datasetId || (statusOk ? (await (async () => {
          const runUrl = `https://api.apify.com/v2/runs/${runId}?token=${APIFY_API_TOKEN}`;
          const r = await fetch(runUrl); const j = await r.json(); return j.data?.defaultDatasetId;
        })()) : null);

        if (dsId) {
          const datasetUrl = `https://api.apify.com/v2/datasets/${dsId}/items?clean=true${APIFY_API_TOKEN ? `&token=${APIFY_API_TOKEN}` : ''}`;
          const datasetRes = await fetch(datasetUrl);
          const results = await datasetRes.json();
          await externalDb.collection('apifyResults').doc(runId).set({
            runId,
            results: Array.isArray(results) ? results : [],
            completedAt: new Date().toISOString(),
            type: run.type || null,
          });
          await doc.ref.update({ status: 'COMPLETED', completedAt: new Date().toISOString(), classificationStatus: 'READY' });
          pollLog.completedRunIds.push(runId);
          // Trigger classification (fire-and-forget)
          try { await classifyRunItems(runId, {}); await processClassifiedRunInternal(runId, {}); } catch (_) { }
          continue;
        } else {
          // Dataset ID not available but run succeeded; mark completed to unblock UI
          await doc.ref.update({ status: 'COMPLETED', completedAt: new Date().toISOString(), classificationStatus: 'READY' });
          // Optionally persist empty results for traceability
          await externalDb.collection('apifyResults').doc(runId).set({
            runId,
            results: [],
            completedAt: new Date().toISOString(),
            type: run.type || null,
          }, { merge: true });
          pollLog.completedRunIds.push(runId);
          // Trigger classification
          try { await classifyRunItems(runId, {}); await processClassifiedRunInternal(runId, {}); } catch (_) { }
          continue;
        }
      }

      // Fallback: if run status missing/invalid but we have datasetId, treat as completed when items exist
      if ((!statusOk || !status) && datasetId) {
        try {
          const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true${APIFY_API_TOKEN ? `&token=${APIFY_API_TOKEN}` : ''}`;
          const datasetRes = await fetch(datasetUrl);
          if (datasetRes.ok) {
            const results = await datasetRes.json();
            await externalDb.collection('apifyResults').doc(runId || doc.id).set({
              runId: runId || doc.id,
              results: Array.isArray(results) ? results : [],
              completedAt: new Date().toISOString(),
              type: run.type || null,
            });
            await doc.ref.update({ status: 'COMPLETED', completedAt: new Date().toISOString(), classificationStatus: 'READY' });
            pollLog.completedRunIds.push(runId || doc.id);
            // Trigger classification
            try { await classifyRunItems(runId || doc.id, {}); await processClassifiedRunInternal(runId || doc.id, {}); } catch (_) { }
            continue;
          }
        } catch (e) {
          // ignore fallback fetch error
        }
      }

      if (status && ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        await doc.ref.update({ status: 'FAILED', finishedAt: new Date().toISOString() });
        pollLog.failedRunIds.push(runId || doc.id);
      }
      // else still running; leave as is
    } catch (error) {
      pollLog.errors.push({ runId: runId || doc.id, error: error.message });
      logger.error('pollRunsLogic error', { runId: runId || doc.id, error: error.message, stack: error.stack });
    }
  }

  // Only save log if something happened or if it was a manual trigger (manual trigger logic handles its own save if needed, but here we return it)
  if (pollLog.checkedRunIds.length > 0) {
    await externalDb.collection('pollingLogs').add(pollLog);
  }
  return pollLog;
};

// Manual HTTPS function to trigger polling on demand
exports.manualPollApifyRuns = functions.https.onRequest({ invoker: 'public', secrets: ["APIFY_API_TOKEN"] }, (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  cors(req, res, async () => {
    try {
      // Optional filter: posts or stories
      const { type } = (req.body && typeof req.body === 'object') ? req.body : {};
      const pollLog = await pollRunsLogic(type);
      res.status(200).json({ success: true, message: 'Manual poll completed.', log: pollLog });
    } catch (error) {
      logger.error('manualPollApifyRuns error', { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

// Scheduled function to poll every 5 minutes
exports.scheduledPollApifyRuns = onSchedule({ schedule: "every 5 minutes", secrets: ["APIFY_API_TOKEN"] }, async (event) => {
  try {
    await pollRunsLogic(null); // Poll all types
  } catch (error) {
    logger.error('scheduledPollApifyRuns error', { error: error.message });
  }
});

exports.deletePollingLog = functions.https.onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  try {
    const { logId } = req.body;
    if (!logId) {
      res.status(400).json({ success: false, error: 'Missing logId' });
      return;
    }
    await externalDb.collection('pollingLogs').doc(logId).delete();
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});