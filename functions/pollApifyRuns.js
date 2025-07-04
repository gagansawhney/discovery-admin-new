const functions = require('firebase-functions');
const fetch = require('node-fetch');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true, credentials: true });

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_ACTOR = 'apify~instagram-post-scraper'; // Changed from slash to tilde

// Scheduled function to poll Apify runs every 2 minutes
// exports.pollApifyRuns = functions.pubsub.schedule('every 2 minutes').onRun(async (context) => {
//   logger.info('--- pollApifyRuns: Polling started ---');
//   if (!APIFY_API_TOKEN) {
//     logger.error('pollApifyRuns error: Apify API token not configured');
//     return null;
//   }
//
//   // Query Firestore for all runs with status 'initiated' or 'pending'
//   const snapshot = await externalDb.collection('apifyRuns')
//     .where('status', 'in', ['initiated', 'pending'])
//     .get();
//
//   if (snapshot.empty) {
//     logger.info('--- pollApifyRuns: No pending runs found ---');
//     // Still log the polling attempt
//     await externalDb.collection('pollingLogs').add({
//       timestamp: new Date().toISOString(),
//       checkedRunIds: [],
//       completedRunIds: [],
//       failedRunIds: [],
//       errors: [],
//     });
//     return null;
//   }
//
//   const pollLog = {
//     timestamp: new Date().toISOString(),
//     checkedRunIds: [],
//     completedRunIds: [],
//     failedRunIds: [],
//     errors: [],
//   };
//
//   for (const doc of snapshot.docs) {
//     const run = doc.data();
//     const runId = run.runId;
//     pollLog.checkedRunIds.push(runId);
//     logger.info('--- pollApifyRuns: Checking run ---', { runId });
//     try {
//       // Get run status from Apify API
//       const runStatusUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs/${runId}?token=${APIFY_API_TOKEN}`;
//       const runStatusRes = await fetch(runStatusUrl);
//       const runStatusData = await runStatusRes.json();
//       const status = runStatusData.data?.status;
//       logger.info('--- pollApifyRuns: Run status ---', { runId, status });
//
//       if (status === 'SUCCEEDED') {
//         // Fetch results from Apify dataset
//         const datasetId = runStatusData.data.defaultDatasetId;
//         const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`;
//         const datasetRes = await fetch(datasetUrl);
//         const results = await datasetRes.json();
//         // Save results to Firestore (customize as needed)
//         await externalDb.collection('apifyResults').doc(runId).set({
//           runId,
//           results,
//           completedAt: new Date().toISOString(),
//         });
//         // Update run status
//         await doc.ref.update({ status: 'COMPLETED', completedAt: new Date().toISOString() });
//         pollLog.completedRunIds.push(runId);
//         logger.info('--- pollApifyRuns: Run completed and results saved ---', { runId });
//       } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
//         await doc.ref.update({ status: 'FAILED', finishedAt: new Date().toISOString() });
//         pollLog.failedRunIds.push(runId);
//         logger.warn('--- pollApifyRuns: Run failed or aborted ---', { runId, status });
//       } else {
//         // Still running, do nothing
//         logger.info('--- pollApifyRuns: Run still in progress ---', { runId, status });
//       }
//     } catch (error) {
//       pollLog.errors.push({ runId, error: error.message });
//       logger.error('pollApifyRuns error', { runId, error: error.message, stack: error.stack });
//     }
//   }
//
//   // Save the poll log to Firestore
//   await externalDb.collection('pollingLogs').add(pollLog);
//
//   logger.info('--- pollApifyRuns: Polling finished ---');
//   return null;
// }); 

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
      // Inline the polling logic here since the scheduled function is commented out
      // Query Firestore for all runs with status 'initiated' or 'pending'
      if (!APIFY_API_TOKEN) {
        logger.error('manualPollApifyRuns error: Apify API token not configured');
        res.status(500).json({ success: false, error: 'Apify API token not configured' });
        return;
      }
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
        await externalDb.collection('pollingLogs').add(pollLog);
        res.status(200).json({ success: true, message: 'Manual poll completed. No pending runs.' });
        return;
      }
      for (const doc of snapshot.docs) {
        const run = doc.data();
        const runId = run.runId;
        pollLog.checkedRunIds.push(runId);
        try {
          // Get run status from Apify API
          const runStatusUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs/${runId}?token=${APIFY_API_TOKEN}`;
          const runStatusRes = await fetch(runStatusUrl);
          const runStatusData = await runStatusRes.json();
          const status = runStatusData.data?.status;
          logger.info(`--- manualPollApifyRuns: Full run status response for runId=${runId}: ${JSON.stringify(runStatusData)}`);
          if (status === 'SUCCEEDED') {
            // Fetch results from Apify dataset
            const datasetId = runStatusData.data.defaultDatasetId;
            const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`;
            const datasetRes = await fetch(datasetUrl);
            const results = await datasetRes.json();
            // Save results to Firestore (customize as needed)
            await externalDb.collection('apifyResults').doc(runId).set({
              runId,
              results,
              completedAt: new Date().toISOString(),
            });
            logger.info('manualPollApifyRuns: Wrote results to apifyResults', { runId, resultCount: Array.isArray(results) ? results.length : 0 });
            // Update run status
            await doc.ref.update({ status: 'COMPLETED', completedAt: new Date().toISOString() });
            pollLog.completedRunIds.push(runId);
          } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
            await doc.ref.update({ status: 'FAILED', finishedAt: new Date().toISOString() });
            pollLog.failedRunIds.push(runId);
          } else {
            // Still running, do nothing
          }
        } catch (error) {
          pollLog.errors.push({ runId, error: error.message });
          logger.error('manualPollApifyRuns error', { runId, error: error.message, stack: error.stack });
        }
      }
      await externalDb.collection('pollingLogs').add(pollLog);
      res.status(200).json({ success: true, message: 'Manual poll completed.' });
    } catch (error) {
      logger.error('manualPollApifyRuns error', { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, error: error.message });
    }
  });
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