const functions = require('firebase-functions');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');

exports.deleteSchedule = functions.https.onRequest(async (req, res) => {
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

    const { scheduleId } = req.body;
    if (!scheduleId || typeof scheduleId !== 'string') {
      res.status(400).json({ success: false, error: 'scheduleId is required and must be a string' });
      return;
    }

    await externalDb.collection('scrapeSchedules').doc(scheduleId).delete();

    res.status(200).json({ success: true, message: `Schedule ${scheduleId} deleted.` });
  } catch (e) {
    logger.error('deleteSchedule error', { error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  }
});
