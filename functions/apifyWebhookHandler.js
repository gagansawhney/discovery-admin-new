const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb, bucket } = require('./firebase');
const fetch = require('node-fetch');

exports.apifyWebhookHandler = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  try {
    const { runId, datasetId, status, error } = req.body;
    logger.info('Webhook received', { runId, datasetId, status });
    if (status === 'SUCCEEDED') {
      // Fetch dataset from Apify
      await Actor.init();
      const dataset = await Actor.openDataset(datasetId);
      const { items: posts } = await dataset.getData();
      logger.info('Fetched posts from Apify dataset', { count: posts.length });
      for (const post of posts) {
        const postId = post.id || post.code || post.shortcode || Date.now().toString();
        const username = post.ownerUsername || post.username || 'unknown';
        const docData = {
          postId,
          username,
          caption: post.caption || '',
          mediaUrl: post.displayUrl || post.thumbnailUrl || '',
          postTime: post.timestamp ? new Date(post.timestamp).toISOString() : '',
          savedAt: new Date().toISOString(),
        };
        // Save to Firestore
        await externalDb.collection('instagramPosts').doc(postId).set(docData, { merge: true });
        // Nice-to-have: Download and upload image to Cloud Storage
        if (docData.mediaUrl) {
          try {
            const response = await fetch(docData.mediaUrl);
            if (response.ok) {
              const buffer = await response.buffer();
              const file = bucket.file(`instagram/${username}/${postId}.jpg`);
              await file.save(buffer, { contentType: 'image/jpeg' });
              logger.info('Uploaded image to Cloud Storage', { path: `instagram/${username}/${postId}.jpg` });
            }
          } catch (imgErr) {
            logger.error('Error uploading image to Cloud Storage', { postId, error: imgErr.message });
          }
        }
      }
      // Delete dataset from Apify
      try {
        await dataset.drop();
        logger.info('Deleted Apify dataset', { datasetId });
      } catch (delErr) {
        logger.error('Error deleting Apify dataset', { datasetId, error: delErr.message });
      }
      await Actor.exit();
    } else if (status === 'FAILED') {
      // Log error to Firestore
      await externalDb.collection('scrapeErrors').add({
        runId,
        datasetId,
        error: error || 'Unknown error',
        createdAt: new Date().toISOString(),
      });
      logger.info('Logged scrape error to Firestore', { runId });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('apifyWebhookHandler error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: err.message });
  }
}); 