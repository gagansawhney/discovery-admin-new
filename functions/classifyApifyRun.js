const functions = require('firebase-functions');
const { unifiedProcessRunInternal } = require('./processClassifiedRun');
const logger = require('firebase-functions/logger');

/**
 * DEPRECATED: This function is now a proxy for the unified single-pass processor.
 * Use processClassifiedRun instead.
 */
exports.classifyApifyRun = functions.https.onRequest({ invoker: 'public', secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY"], timeoutSeconds: 540 }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const { runId, model } = req.body || {};
    if (!runId) return res.status(400).json({ success: false, error: 'Missing runId' });
    
    // Proxy to unified logic
    const result = await unifiedProcessRunInternal(runId, { model: model || 'gpt-5.2' });
    return res.status(200).json({ success: true, result });
  } catch (e) {
    logger.error('classifyApifyRun error', { error: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { classifyApifyRun: exports.classifyApifyRun };
