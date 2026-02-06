const functions = require('firebase-functions');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');

exports.deleteClassificationItem = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { runId, itemId } = req.body || {};
    if (!runId || !itemId) return res.status(400).json({ success: false, error: 'Missing runId or itemId' });
    const clsId = `${runId}_${itemId}`;
    await externalDb.collection('apifyClassifications').doc(clsId).delete();
    return res.status(200).json({ success: true, deletedId: clsId });
  } catch (e) {
    logger.error('deleteClassificationItem error', { error: e.message, stack: e.stack });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { deleteClassificationItem: exports.deleteClassificationItem };


