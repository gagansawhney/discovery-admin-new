const functions = require('firebase-functions');
const { Actor } = require('apify');
const logger = require('firebase-functions/logger');
const { externalDb, bucket } = require('./firebase');
const fetch = require('node-fetch');

function toMillis(timestampLike) {
  if (!timestampLike) return NaN;
  if (typeof timestampLike === 'number') {
    return timestampLike < 1e12 ? timestampLike * 1000 : timestampLike;
  }
  const parsed = Date.parse(timestampLike);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function extractStoryMedia(story) {
  // Prefer video when available
  const videoCandidates = [];
  if (typeof story.videoUrl === 'string') videoCandidates.push(story.videoUrl);
  if (typeof story.video_url === 'string') videoCandidates.push(story.video_url);
  if (typeof story.video === 'string') videoCandidates.push(story.video);
  if (Array.isArray(story.video_versions)) {
    for (const v of story.video_versions) {
      if (v && typeof v.url === 'string') videoCandidates.push(v.url);
    }
  }
  // Some actors may nest media inside 'resources'
  if (Array.isArray(story.resources)) {
    for (const r of story.resources) {
      const u = (r && (r.url || r.src)) || '';
      if (typeof u === 'string' && u.includes('.mp4')) videoCandidates.push(u);
    }
  }

  const imageCandidates = [];
  ['displayUrl', 'media', 'source', 'mediaUrl', 'thumbnail', 'url', 'image'].forEach((k) => {
    const u = story && story[k];
    if (typeof u === 'string') imageCandidates.push(u);
  });
  if (typeof story.thumbnail_url === 'string') imageCandidates.push(story.thumbnail_url);
  if (story && story.image_versions2 && Array.isArray(story.image_versions2.candidates)) {
    for (const c of story.image_versions2.candidates) {
      if (c && typeof c.url === 'string') imageCandidates.push(c.url);
    }
  }
  if (Array.isArray(story.resources)) {
    for (const r of story.resources) {
      const u = (r && (r.url || r.src)) || '';
      if (typeof u === 'string' && !u.includes('.mp4')) imageCandidates.push(u);
    }
  }

  const videoUrl = videoCandidates.find((u) => typeof u === 'string' && u.startsWith('http')) || '';
  const imageUrl = imageCandidates.find((u) => typeof u === 'string' && u.startsWith('http')) || '';
  if (videoUrl) return { url: videoUrl, type: 'video' };
  if (imageUrl) return { url: imageUrl, type: 'image' };
  return { url: '', type: '' };
}

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

    // Determine run type from Firestore (defaults to 'posts')
    let runType = 'posts';
    try {
      const runDoc = await externalDb.collection('apifyRuns').doc(runId).get();
      if (runDoc.exists) {
        const data = runDoc.data() || {};
        if (data.type === 'stories') runType = 'stories';
      }
    } catch (e) {
      logger.warn('Failed to read run type; defaulting to posts', { error: e.message });
    }

    if (status === 'SUCCEEDED') {
      // Fetch dataset from Apify
      await Actor.init();
      const dataset = await Actor.openDataset(datasetId);
      const { items } = await dataset.getData();
      logger.info('Fetched items from Apify dataset', { count: (items || []).length, runType });

      // We'll also collect a normalized results array to save to apifyResults for UI
      const normalizedResults = [];

      if (runType === 'stories') {
        // Persist stories
        for (const story of items || []) {
          const storyId = story.id || story.story_id || story.code || story.media || story.source || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const username = story.username || story.ownerUsername || story.author || story['user.username'] || (story.user && story.user.username) || 'unknown';
          const mediaPick = extractStoryMedia(story);
          const mediaUrl = mediaPick.url;
          const rawTs = story.timestamp || story.taken_at || story.takenAt;
          const ms = toMillis(rawTs);
          const timestamp = Number.isNaN(ms) ? '' : new Date(ms).toISOString();
          const takenAtText = story.taken_at || story.takenAt || '';

          const docData = {
            storyId,
            username,
            mediaUrl,
            mediaType: mediaPick.type || (mediaUrl.endsWith('.mp4') ? 'video' : 'image'),
            timestampISO: timestamp,
            takenAtText,
            savedAt: new Date().toISOString(),
            runId,
          };

          normalizedResults.push({ id: storyId, ownerUsername: username, displayUrl: mediaUrl, mediaUrl, mediaType: docData.mediaType, caption: story.caption || story.text || '', timestamp });

          // Save to Firestore
          await externalDb.collection('instagramStories').doc(storyId).set(docData, { merge: true });

          // Attempt to upload media (image/video) to Cloud Storage
          if (mediaUrl) {
            try {
              const response = await fetch(mediaUrl);
              if (response.ok) {
                const buffer = await response.buffer();
                const ext = mediaUrl.includes('.mp4') || (response.headers.get('content-type') || '').includes('video') ? 'mp4' : 'jpg';
                const contentType = ext === 'mp4' ? 'video/mp4' : 'image/jpeg';
                const safeUser = String(username || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
                const file = bucket.file(`instagram_stories/${safeUser}/${storyId}.${ext}`);
                await file.save(buffer, { contentType });
                logger.info('Uploaded story media to Cloud Storage', { path: `instagram_stories/${safeUser}/${storyId}.${ext}` });
              } else {
                logger.warn('Failed to fetch story media', { status: response.status });
              }
            } catch (imgErr) {
              logger.error('Error uploading story media to Cloud Storage', { storyId, error: imgErr.message });
            }
          }
        }
      } else {
        // Existing posts flow
        const posts = items || [];
        logger.info('Processing posts dataset for webhook', { count: posts.length });
        for (const post of posts) {
          const postId = post.id || post.code || post.shortcode || Date.now().toString();
          const username = post.ownerUsername || post.username || 'unknown';
          const rawTs = post.timestamp || post.taken_at || post.takenAt || post.postTime;
          const ms = toMillis(rawTs);
          const timestampISO = Number.isNaN(ms) ? '' : new Date(ms).toISOString();
          const docData = {
            postId,
            username,
            caption: post.caption || '',
            mediaUrl: post.displayUrl || post.thumbnailUrl || '',
            postTime: timestampISO,
            savedAt: new Date().toISOString(),
            runId,
          };
          normalizedResults.push({ id: postId, ownerUsername: username, caption: docData.caption, displayUrl: docData.mediaUrl, timestamp: timestampISO });
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
      }

      // Save normalized results for UI
      try {
        await externalDb.collection('apifyResults').doc(runId).set({
          runId,
          results: normalizedResults,
          completedAt: new Date().toISOString(),
          type: runType,
        });
        logger.info('Saved normalized results to apifyResults', { runId, count: normalizedResults.length });
      } catch (e) {
        logger.error('Failed to write apifyResults', { runId, error: e.message });
      }

      // Update run status as completed
      try {
        await externalDb.collection('apifyRuns').doc(runId).set({ status: 'COMPLETED', completedAt: new Date().toISOString() }, { merge: true });
      } catch (e) {
        logger.warn('Failed to update apifyRuns status', { runId, error: e.message });
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
      // Also mark run as failed
      try {
        await externalDb.collection('apifyRuns').doc(runId).set({ status: 'FAILED', finishedAt: new Date().toISOString() }, { merge: true });
      } catch {}
    }
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('apifyWebhookHandler error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: err.message });
  }
}); 