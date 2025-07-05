const functions = require('firebase-functions');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true, credentials: true });

exports.deleteApifyRun = functions.https.onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  cors(req, res, async () => {
    logger.info('--- deleteApifyRun: Function started ---');

    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { runId } = req.body;

      if (!runId) {
        logger.error('deleteApifyRun error: Missing runId');
        res.status(400).json({ success: false, error: 'Missing runId' });
        return;
      }

      logger.info('--- deleteApifyRun: Deleting run ---', { runId });

      // Delete from apifyRuns collection
      try {
        await externalDb.collection('apifyRuns').doc(runId).delete();
        logger.info('--- deleteApifyRun: Deleted from apifyRuns collection ---', { runId });
      } catch (error) {
        logger.error('--- deleteApifyRun: Error deleting from apifyRuns ---', error);
        // Continue even if this fails
      }

      // Delete from apifyResults collection
      try {
        await externalDb.collection('apifyResults').doc(runId).delete();
        logger.info('--- deleteApifyRun: Deleted from apifyResults collection ---', { runId });
      } catch (error) {
        logger.error('--- deleteApifyRun: Error deleting from apifyResults ---', error);
        // Continue even if this fails
      }

      logger.info('--- deleteApifyRun: Run deletion completed ---', { runId });
      res.status(200).json({ success: true, message: 'Run deleted successfully' });

    } catch (error) {
      logger.error('deleteApifyRun error', { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, error: 'Failed to delete run', details: error.message });
    }
  });
});
