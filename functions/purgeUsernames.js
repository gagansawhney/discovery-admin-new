const functions = require('firebase-functions');
const { externalDb } = require('./firebase');

exports.purgeUsernames = functions.https.onRequest({ invoker: 'public', timeoutSeconds: 300, memory: '256MiB' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const snap = await externalDb.collection('scraperUsernames').get();
    const batchSize = snap.size;
    if (batchSize === 0) return res.json({ success: true, deleted: 0 });

    const batch = externalDb.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return res.json({ success: true, deleted: batchSize });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}); 