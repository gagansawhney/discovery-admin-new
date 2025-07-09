const functions = require('firebase-functions');
const { externalDb, bucket } = require('./firebase');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true, credentials: true });
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

// Helper function to process a single accepted post
async function processAcceptedPost(post, originalIndex, results) {
  const postId = post.id || post.shortcode;
  logger.info(`--- processAcceptedPost: Starting processing for post ${originalIndex + 1} ---`, {
    postId,
    originalIndex,
    hasDisplayUrl: !!post.displayUrl,
    hasThumbnailUrl: !!post.thumbnailUrl,
    hasImages: !!post.images
  });

  let removeFromQueue = false;

  try {
    // Step 1: Get the best image URL
    const imageUrl = getBestImageUrl(post);
    if (!imageUrl) {
      throw new Error('No valid image URL found');
    }

    logger.info(`--- processAcceptedPost: Step 1 complete - Image URL found ---`, {
      postId,
      imageUrl: imageUrl.substring(0, 100) + '...'
    });

    // Step 2: Download image from Instagram
    const imageBuffer = await downloadImage(imageUrl);
    if (!imageBuffer) {
      throw new Error('Failed to download image');
    }

    logger.info(`--- processAcceptedPost: Step 2 complete - Image downloaded ---`, {
      postId,
      imageSize: imageBuffer.length
    });

    // Step 3: Upload to Firebase Storage
    const storagePath = await uploadToStorage(imageBuffer, postId);
    if (!storagePath) {
      throw new Error('Failed to upload image to storage');
    }

    logger.info(`--- processAcceptedPost: Step 3 complete - Image uploaded to storage ---`, {
      postId,
      storagePath
    });

    // Step 4: Extract event information using OpenAI
    const eventData = await extractEventInfo(storagePath, post);
    if (!eventData) {
      throw new Error('Failed to extract event information');
    }

    // Step 4.1: Canonicalize venue using checkVen
    if (eventData.venue && eventData.venue.name) {
      try {
        const checkVenResp = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/checkVen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venueName: eventData.venue.name })
        });
        const checkVenData = await checkVenResp.json();
        logger.info('Venue validation result:', checkVenData);
        logger.info('Event data before canonicalization:', eventData);
        if (checkVenData.success && checkVenData.venue) {
          // Overwrite the entire venue object with canonical info
          eventData.venue = { ...checkVenData.venue };
        } else {
          throw new Error('Venue not found in database');
        }
        logger.info('Event data after canonicalization:', eventData);
      } catch (err) {
        throw new Error('Venue canonicalization failed: ' + (err.message || err));
      }
    }

    // Step 4.2: Normalize event.date.start to date-only for duplicate detection and saving
    if (eventData.date && eventData.date.start) {
      eventData.date.start = normalizeToDateOnly(eventData.date.start);
    }

    logger.info(`--- processAcceptedPost: Step 4 complete - Event data extracted ---`, {
      postId,
      eventName: eventData.name,
      eventDate: eventData.date?.start
    });

    // Step 4.5: Duplicate detection by venue and date (date-only)
    const isDuplicate = await checkForDuplicateEventByVenueAndDate(eventData);
    if (isDuplicate) {
      logger.info(`--- processAcceptedPost: Duplicate event detected, not saving ---`, {
        postId,
        eventName: eventData.name,
        eventDate: eventData.date?.start,
        venueName: eventData.venue?.name
      });
      results.errors.push({
        postIndex: originalIndex,
        postId,
        duplicate: true,
        eventName: eventData.name,
        eventDate: eventData.date?.start,
        venueName: eventData.venue?.name,
        error: `Duplicate event found for venue '${eventData.venue?.name}' on date '${eventData.date?.start}'. Not saved.`
      });
      removeFromQueue = true; // Remove duplicates from queue too
      return { success: false, duplicate: true };
    }

    // Step 5: Save event to Firestore
    const eventId = await saveEventToFirestore(eventData, post);
    if (!eventId) {
      throw new Error('Failed to save event to Firestore');
    }

    logger.info(`--- processAcceptedPost: Step 5 complete - Event saved to Firestore ---`, {
      postId,
      eventId
    });

    removeFromQueue = true;
    // Update results
    results.successful++;
    results.processed++;

    logger.info(`--- processAcceptedPost: SUCCESS - Post ${originalIndex + 1} fully processed ---`, {
      postId,
      eventId
    });

    return { success: true, eventId };

  } catch (error) {
    logger.error(`--- processAcceptedPost: ERROR - Failed to process post ${originalIndex + 1} ---`, {
      postId,
      error: error.message,
      stack: error.stack
    });

    results.errors.push({
      postIndex: originalIndex,
      postId,
      error: error.message
    });
    results.failed++;
    // Only remove from queue if duplicate or canonicalization error
    if (error.message && (error.message.includes('Duplicate event') || error.message.includes('Venue not found'))) {
      removeFromQueue = true;
    }
    return { success: false, error: error.message };
  } finally {
    if (removeFromQueue) {
      await removePostFromResults(post);
      logger.info(`--- processAcceptedPost: Post removed from results (finally block) ---`, { postId });
    }
  }
}

// Helper function to get the best image URL from a post
function getBestImageUrl(post) {
  // Priority: displayUrl > thumbnailUrl > first image from images array
  if (post.displayUrl) {
    return post.displayUrl;
  }
  if (post.thumbnailUrl) {
    return post.thumbnailUrl;
  }
  if (post.images && Array.isArray(post.images) && post.images.length > 0) {
    return post.images[0].url;
  }
  return null;
}

// Helper function to download image from Instagram
async function downloadImage(imageUrl) {
  try {
    logger.info(`--- downloadImage: Starting download ---`, { imageUrl: imageUrl.substring(0, 100) + '...' });
    
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    logger.info(`--- downloadImage: Download successful ---`, { size: buffer.length });
    
    return buffer;
  } catch (error) {
    logger.error(`--- downloadImage: Download failed ---`, { imageUrl, error: error.message });
    throw error;
  }
}

// Helper function to upload image to Firebase Storage
async function uploadToStorage(imageBuffer, postId) {
  try {
    const fileName = `instagram-posts/${postId}-${Date.now()}.jpg`;
    const file = bucket.file(fileName);
    
    logger.info(`--- uploadToStorage: Starting upload ---`, { fileName });
    
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        metadata: {
          source: 'instagram',
          postId: postId,
          uploadedAt: new Date().toISOString()
        }
      }
    });
    
    logger.info(`--- uploadToStorage: Upload successful ---`, { fileName });
    
    return fileName;
  } catch (error) {
    logger.error(`--- uploadToStorage: Upload failed ---`, { postId, error: error.message });
    throw error;
  }
}

// Helper function to extract event information using OpenAI
async function extractEventInfo(storagePath, post) {
  try {
    logger.info(`--- extractEventInfo: Starting extraction ---`, { storagePath });
    
    // Generate signed URL for the uploaded image
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    const [imageUrl] = await bucket.file(storagePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });
    
    logger.info(`--- extractEventInfo: Generated signed URL ---`, { imageUrl: imageUrl.substring(0, 100) + '...' });
    
    // Call the extractFlyerInfo function
    const extractResponse = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/extractFlyerInfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: storagePath,
        context: `Extract event information from this Instagram post. Caption: ${post.caption || 'No caption'}`
      })
    });
    
    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      throw new Error(`ExtractFlyerInfo failed: ${errorText}`);
    }
    
    const extractResult = await extractResponse.json();
    if (!extractResult.success) {
      throw new Error(`ExtractFlyerInfo returned error: ${extractResult.error}`);
    }
    
    logger.info(`--- extractEventInfo: Extraction successful ---`, { 
      eventName: extractResult.data?.name,
      eventDate: extractResult.data?.date?.start
    });
    
    return extractResult.data;
  } catch (error) {
    logger.error(`--- extractEventInfo: Extraction failed ---`, { storagePath, error: error.message });
    throw error;
  }
}

// Helper function to save event to Firestore
async function saveEventToFirestore(eventData, post) {
  try {
    logger.info(`--- saveEventToFirestore: Starting save ---`, { eventName: eventData.name });

    // Generate embedding for searchText
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }
    if (!eventData.searchText || typeof eventData.searchText !== 'string' || !eventData.searchText.trim()) {
      throw new Error('searchText is required for embedding');
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    let embedding = null;
    try {
      const embeddingResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: eventData.searchText
      });
      embedding = embeddingResp.data[0].embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('OpenAI embedding API did not return a valid embedding');
      }
    } catch (embedErr) {
      logger.error('Error generating embedding', { error: embedErr.message, searchText: eventData.searchText });
      throw new Error('Failed to generate embedding: ' + embedErr.message);
    }
    eventData.embedding = embedding;

    // Add source information
    const eventWithSource = {
      ...eventData,
      source: {
        platform: 'instagram',
        postId: post.id || post.shortcode,
        url: post.url || `https://www.instagram.com/p/${post.shortcode}/`,
        scrapedAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    };

    // Generate unique ID if not provided
    if (!eventWithSource.id) {
      eventWithSource.id = uuidv4();
    }

    // Save to events collection
    const eventRef = externalDb.collection('events').doc(eventWithSource.id);
    await eventRef.set(eventWithSource);

    logger.info(`--- saveEventToFirestore: Save successful ---`, { eventId: eventWithSource.id });

    return eventWithSource.id;
  } catch (error) {
    logger.error(`--- saveEventToFirestore: Save failed ---`, { eventName: eventData.name, error: error.message });
    throw error;
  }
}

// Helper function to remove post from apifyResults
async function removePostFromResults(post) {
  try {
    logger.info(`--- removePostFromResults: Starting removal ---`, { postId: post.id || post.shortcode });
    
    const apifyResultsQuery = await externalDb.collection('apifyResults').get();
    let postRemoved = false;
    
    for (const doc of apifyResultsQuery.docs) {
      const data = doc.data();
      
      if (data.results && Array.isArray(data.results)) {
        const postIndex = data.results.findIndex(result => 
          result.id === post.id || result.shortcode === post.shortcode
        );
        
        if (postIndex !== -1) {
          data.results.splice(postIndex, 1);
          await doc.ref.update({ results: data.results });
          logger.info(`--- removePostFromResults: Post removed successfully ---`, { postId: post.id || post.shortcode });
          postRemoved = true;
          break;
        }
      }
    }
    
    if (!postRemoved) {
      logger.info(`--- removePostFromResults: Post not found in any apifyResults document ---`, { postId: post.id || post.shortcode });
    }
    
    return postRemoved;
  } catch (error) {
    logger.error(`--- removePostFromResults: Removal failed ---`, { postId: post.id || post.shortcode, error: error.message });
    throw error;
  }
}

// Helper function to check for duplicate event by venue and date (date-only)
async function checkForDuplicateEventByVenueAndDate(event) {
  try {
    if (!event.venue?.name || !event.date?.start) return false;
    const dateOnly = normalizeToDateOnly(event.date.start);
    const snapshot = await externalDb.collection('events')
      .where('venue.name', '==', event.venue.name)
      .where('date.start', '==', dateOnly)
      .limit(1)
      .get();
    return !snapshot.empty;
  } catch (error) {
    logger.error('Error checking for duplicate event by venue and date', { error: error.message });
    return false;
  }
}

// Helper to normalize ISO date string to YYYY-MM-DD
function normalizeToDateOnly(isoString) {
  if (!isoString) return null;
  // Handles both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm:ssZ'
  return isoString.split('T')[0];
}

exports.processInstagramPosts = functions.https.onRequest({ 
  invoker: 'public', 
  secrets: ["OPENAI_API_KEY"], 
  timeoutSeconds: 540 
}, async (req, res) => {
  logger.info('--- processInstagramPosts: Function started ---');

  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    logger.info('--- processInstagramPosts: OPTIONS request handled ---');
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Check for SSE (Server-Sent Events) request
  const isSSE = req.headers.accept && req.headers.accept.includes('text/event-stream');
  if (isSSE) {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();
  }

  try {
    const { posts, decisions } = req.body;
    logger.info('--- processInstagramPosts: Request received ---', {
      method: req.method,
      headers: req.headers,
      bodyKeys: Object.keys(req.body || {}),
      postsType: typeof posts,
      decisionsType: typeof decisions,
      postsLength: posts?.length,
      decisionsLength: decisions?.length
    });
    if (!posts || !decisions || !Array.isArray(posts) || !Array.isArray(decisions)) {
      logger.error('--- processInstagramPosts: Invalid request body ---', {
        posts: posts,
        decisions: decisions,
        postsIsArray: Array.isArray(posts),
        decisionsIsArray: Array.isArray(decisions)
      });
      if (isSSE) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid request body. Expected posts and decisions arrays.' })}\n\n`);
        res.end();
      } else {
        res.status(400).json({ error: 'Invalid request body. Expected posts and decisions arrays.' });
      }
      return;
    }

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      deleted: 0,
      errors: []
    };

    // Separate rejected and accepted posts
    const rejectedPosts = [];
    const acceptedPosts = [];
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const decision = decisions[i];
      if (decision === 'reject') {
        rejectedPosts.push({ post, index: i });
      } else if (decision === 'accept') {
        acceptedPosts.push({ post, index: i });
      }
    }

    // Process rejected posts (delete from Firestore)
    for (const { post, index } of rejectedPosts) {
      try {
        // Remove rejected post from the results array in apifyResults collection
        const apifyResultsQuery = await externalDb.collection('apifyResults').get();
        let postRemoved = false;
        for (const doc of apifyResultsQuery.docs) {
          const data = doc.data();
          if (data.results && Array.isArray(data.results)) {
            const postIndex = data.results.findIndex(result => 
              result.id === post.id || result.shortcode === post.shortcode
            );
            if (postIndex !== -1) {
              data.results.splice(postIndex, 1);
              await doc.ref.update({ results: data.results });
              postRemoved = true;
              break;
            }
          }
        }
        results.deleted++;
        if (isSSE) {
          res.write(`event: rejected\ndata: ${JSON.stringify({ postIndex: index, postId: post.id || post.shortcode })}\n\n`);
        }
      } catch (error) {
        results.errors.push({
          postIndex: index,
          postId: post.id || post.shortcode,
          error: `Failed to delete: ${error.message}`
        });
        results.failed++;
        if (isSSE) {
          res.write(`event: error\ndata: ${JSON.stringify({ postIndex: index, postId: post.id || post.shortcode, error: error.message })}\n\n`);
        }
      }
    }

    // Process accepted posts in batches (extract and save events)
    const batchSize = 5;
    for (let i = 0; i < acceptedPosts.length; i += batchSize) {
      const batch = acceptedPosts.slice(i, i + batchSize);
      // Process batch in parallel
      const batchPromises = batch.map(async ({ post, index }) => {
        const result = await processAcceptedPost(post, index, results);
        if (isSSE) {
          res.write(`event: processed\ndata: ${JSON.stringify({ postIndex: index, postId: post.id || post.shortcode, ...result })}\n\n`);
        }
        return result;
      });
      try {
        await Promise.all(batchPromises);
      } catch (error) {
        if (isSSE) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        }
      }
    }

    if (isSSE) {
      res.write(`event: summary\ndata: ${JSON.stringify(results)}\n\n`);
      res.end();
    } else {
      res.status(200).json({ 
        success: true, 
        results 
      });
    }
  } catch (error) {
    logger.error('--- processInstagramPosts: Function error ---', error);
    if (isSSE) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Processing failed', 
        details: error.message 
      });
    }
  }
}); 