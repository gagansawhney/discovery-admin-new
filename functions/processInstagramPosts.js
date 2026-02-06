const functions = require('firebase-functions');
const { externalDb, bucket } = require('./firebase');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true, credentials: true });
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const { FieldValue } = require('@google-cloud/firestore');

// Helper function to process a single accepted post
async function processAcceptedPost(post, originalIndex, results) {
  const postId = post.id || post.shortcode;
  logger.info(`--- processAcceptedPost: Starting processing for post ${originalIndex + 1} ---`, {
    postId,
    originalIndex,
    hasDisplayUrl: !!post.displayUrl,
    hasThumbnailUrl: !!post.thumbnailUrl,
    hasImages: !!post.images,
    isVideo: !!post.isVideo,
    hasVideoUrl: !!post.videoUrl
  });

  // Skip posts older than 25 hours
  const POST_MAX_AGE_HOURS = 25;
  const postDate = post.timestamp || post.date;
  if (postDate) {
    const postTime = new Date(postDate).getTime();
    const now = Date.now();
    const ageHours = (now - postTime) / (1000 * 60 * 60);
    if (ageHours > POST_MAX_AGE_HOURS) {
      logger.info(`Skipping post ${postId}: older than ${POST_MAX_AGE_HOURS} hours (${ageHours.toFixed(2)}h old)`);
      results.errors.push({
        postIndex: originalIndex,
        postId,
        skipped: true,
        reason: `Post too old (${ageHours.toFixed(2)}h)`
      });
      results.failed++;
      // Optionally remove from queue
      await removePostFromResults(post);
      logger.info(`--- processAcceptedPost: Old post removed from results (age filter) ---`, { postId });
      return { success: false, skipped: true, reason: 'Post too old' };
    }
  }

  let removeFromQueue = false;

  try {
    let storagePath, imageForExtraction, videoPath = null;
    if (post.isVideo && post.videoUrl) {
      // Download and upload video
      const videoBuffer = await downloadVideo(post.videoUrl);
      storagePath = await uploadVideoToStorage(videoBuffer, postId);
      videoPath = storagePath;
      // Use thumbnail for event extraction if available
      imageForExtraction = post.thumbnailUrl || null;
      if (!imageForExtraction) {
        throw new Error('Video post has no thumbnail for event extraction');
      }
    } else {
      // Existing image logic
      const imageUrl = getBestImageUrl(post);
      if (!imageUrl) throw new Error('No valid image URL found');
      const imageBuffer = await downloadImage(imageUrl);
      storagePath = await uploadToStorage(imageBuffer, postId);
      imageForExtraction = imageUrl;
    }

    logger.info(`--- processAcceptedPost: Media uploaded to storage ---`, {
      postId,
      storagePath,
      videoPath,
      imageForExtraction
    });

    // Step 4: Extract event information using OpenAI (use imageForExtraction)
    let eventData = null;
    if (imageForExtraction) {
      // If imageForExtraction is a URL, download and upload to storage for extraction
      let extractionStoragePath = storagePath;
      if (post.isVideo && post.videoUrl && post.thumbnailUrl) {
        // Download and upload thumbnail to storage for extraction
        const thumbBuffer = await downloadImage(post.thumbnailUrl);
        extractionStoragePath = await uploadToStorage(thumbBuffer, postId + '-thumb');
      }
      eventData = await extractEventInfo(extractionStoragePath, post);
      if (!eventData) {
        throw new Error('Failed to extract event information');
      }
    } else {
      throw new Error('No image available for event extraction');
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
    logger.info(`--- processAcceptedPost: Counted as successful. Processed: ${results.processed}, Successful: ${results.successful}`);

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

    // Check if this is a venue not found error
    const isVenueNotFound = error.message && error.message.includes('Venue not found in venues collection');
    
    results.errors.push({
      postIndex: originalIndex,
      postId,
      error: error.message
    });
    results.failed++;
    
    // Only remove from queue if it's NOT a venue not found error
    // This allows the post to be processed again after adding the venue
    if (!isVenueNotFound) {
      removeFromQueue = true;
      logger.info(`--- processAcceptedPost: Will remove post from queue (non-venue error) ---`, { postId });
    } else {
      logger.info(`--- processAcceptedPost: Will NOT remove post from queue (venue not found) ---`, { postId });
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

    // Validate venue exists in venues collection
    if (!eventData.venue || !eventData.venue.name) {
      throw new Error('Event must have a venue name');
    }

    const venueData = await lookupVenue(eventData.venue.name);
    if (!venueData) {
      throw new Error(`Venue not found in venues collection: "${eventData.venue.name}". Please add this venue first.`);
    }

    logger.info(`--- saveEventToFirestore: Venue validated ---`, { 
      originalVenueName: eventData.venue.name,
      canonicalVenueName: venueData.name,
      venueId: venueData.id
    });

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
    eventData.embedding = FieldValue.vector(embedding);

    // Replace venue data with canonical venue data from venues collection
    const canonicalVenue = {
      name: venueData.name,
      address: venueData.address,
      geo: {
        lat: venueData.latitude,
        lon: venueData.longitude
      }
    };

    // Add source information
    const eventWithSource = {
      ...eventData,
      venue: canonicalVenue,
      venueId: venueData.id, // Link to venue document
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

    logger.info(`--- saveEventToFirestore: Save successful ---`, { 
      eventId: eventWithSource.id,
      venueId: venueData.id,
      canonicalVenueName: venueData.name
    });

    return eventWithSource.id;
  } catch (error) {
    logger.error(`--- saveEventToFirestore: Save failed ---`, { eventName: eventData.name, error: error.message });
    throw error;
  }
}

// Helper function to remove post from apifyResults
async function removePostFromResults(post) {
  try {
    logger.info(`--- removePostFromResults: Starting removal (by id only) ---`, { postId: post.id });
    if (!post.id) {
      logger.error('--- removePostFromResults: No id provided in post, cannot remove ---', { post });
      return false;
    }
    // Find the correct apifyResults document (assume only one for now)
    const apifyResultsQuery = await externalDb.collection('apifyResults').get();
    if (apifyResultsQuery.empty) {
      logger.info('--- removePostFromResults: No apifyResults documents found ---');
      return false;
    }
    const doc = apifyResultsQuery.docs[0];
    const docRef = doc.ref;
    // Use a Firestore transaction for atomic update
    await externalDb.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(docRef);
      const data = docSnap.data();
      if (!data || !Array.isArray(data.results)) {
        logger.info('--- removePostFromResults: No results array in document ---', { docId: docRef.id });
        return;
      }
      const postIndex = data.results.findIndex(result => result.id === post.id);
      logger.info('--- removePostFromResults: Removing by id ---', { docId: docRef.id, postId: post.id, foundIndex: postIndex });
      if (postIndex !== -1) {
        data.results.splice(postIndex, 1);
        transaction.update(docRef, { results: data.results });
        logger.info('--- removePostFromResults: Transaction post removed ---', { docId: docRef.id, newLength: data.results.length });
      } else {
        logger.info('--- removePostFromResults: Post not found in results ---', { docId: docRef.id, postId: post.id });
      }
    });
    // Verify removal
    const updatedDoc = await docRef.get();
    const updatedData = updatedDoc.data();
    const stillPresent = updatedData.results.some(result => result.id === post.id);
    logger.info('--- removePostFromResults: Post-update verification (transaction) ---', {
      docId: docRef.id,
      resultsLength: updatedData.results.length,
      postStillPresent: stillPresent
    });
    return true;
  } catch (error) {
    logger.error('--- removePostFromResults: Transaction removal failed ---', { postId: post.id, error: error.message, stack: error.stack });
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

// Helper function to lookup venue in venues collection
async function lookupVenue(venueName) {
  try {
    logger.info(`--- lookupVenue: Looking up venue ---`, { venueName });
    
    if (!venueName || typeof venueName !== 'string' || !venueName.trim()) {
      logger.warn(`--- lookupVenue: Invalid venue name ---`, { venueName });
      return null;
    }
    
    const normalizedVenueName = venueName.trim().toLowerCase();
    
    // First, try exact match on venue name
    let venueSnapshot = await externalDb.collection('venues')
      .where('name', '==', venueName.trim())
      .limit(1)
      .get();
    
    if (!venueSnapshot.empty) {
      const venueDoc = venueSnapshot.docs[0];
      const venueData = venueDoc.data();
      logger.info(`--- lookupVenue: Found exact match ---`, { 
        venueName, 
        venueId: venueDoc.id,
        canonicalName: venueData.name 
      });
      return {
        id: venueDoc.id,
        ...venueData
      };
    }
    
    // If no exact match, check name variations
    const allVenuesSnapshot = await externalDb.collection('venues').get();
    
    for (const doc of allVenuesSnapshot.docs) {
      const venueData = doc.data();
      const nameVariations = venueData.nameVariations || [];
      
      // Check if the venue name matches any variation (case-insensitive)
      const matchesVariation = nameVariations.some(variation => 
        variation.toLowerCase() === normalizedVenueName
      );
      
      if (matchesVariation) {
        logger.info(`--- lookupVenue: Found match in name variations ---`, { 
          venueName, 
          venueId: doc.id,
          canonicalName: venueData.name,
          matchedVariation: nameVariations.find(v => v.toLowerCase() === normalizedVenueName)
        });
        return {
          id: doc.id,
          ...venueData
        };
      }
    }
    
    logger.warn(`--- lookupVenue: No venue found ---`, { venueName });
    return null;
  } catch (error) {
    logger.error(`--- lookupVenue: Error looking up venue ---`, { venueName, error: error.message });
    throw error;
  }
}

// Helper function to download video from Instagram
async function downloadVideo(videoUrl) {
  try {
    logger.info(`--- downloadVideo: Starting download ---`, { videoUrl: videoUrl.substring(0, 100) + '...' });
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const buffer = await response.buffer();
    logger.info(`--- downloadVideo: Download successful ---`, { size: buffer.length });
    return buffer;
  } catch (error) {
    logger.error(`--- downloadVideo: Download failed ---`, { videoUrl, error: error.message });
    throw error;
  }
}

// Helper function to upload video to Firebase Storage
async function uploadVideoToStorage(videoBuffer, postId) {
  try {
    const fileName = `instagram-posts/${postId}-${Date.now()}.mp4`;
    const file = bucket.file(fileName);
    logger.info(`--- uploadVideoToStorage: Starting upload ---`, { fileName });
    await file.save(videoBuffer, {
      metadata: {
        contentType: 'video/mp4',
        metadata: {
          source: 'instagram',
          postId: postId,
          uploadedAt: new Date().toISOString()
        }
      }
    });
    logger.info(`--- uploadVideoToStorage: Upload successful ---`, { fileName });
    return fileName;
  } catch (error) {
    logger.error(`--- uploadVideoToStorage: Upload failed ---`, { postId, error: error.message });
    throw error;
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

  // SSE/live update support removed; always respond with summary at end

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
      res.status(400).json({ error: 'Invalid request body. Expected posts and decisions arrays.' });
      return;
    }

    // Filter out error/no-data entries
    const validIndexes = posts.map((post, i) => (!post.error && (post.id || post.shortcode)) ? i : null).filter(i => i !== null);
    const validPosts = validIndexes.map(i => posts[i]);
    const validDecisions = validIndexes.map(i => decisions[i]);
    logger.info(`--- processInstagramPosts: Filtering posts ---`, {
      originalCount: posts.length,
      validCount: validPosts.length
    });
    posts.forEach((post, i) => {
      if (post.error || (!post.id && !post.shortcode)) {
        logger.warn(`Skipping post at index ${i}: error=${post.error}, id=${post.id}, shortcode=${post.shortcode}`);
      }
    });
    if (validPosts.length === 0) {
      logger.warn('No valid posts to process after filtering.');
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
    for (let i = 0; i < validPosts.length; i++) {
      const post = validPosts[i];
      const decision = validDecisions[i];
      if (decision === 'reject') {
        rejectedPosts.push({ post, index: i });
      } else if (decision === 'accept') {
        acceptedPosts.push({ post, index: i });
      }
    }

    // Process rejected posts (delete from Firestore)
    for (const { post, index } of rejectedPosts) {
      try {
        if (!post.id) {
          logger.error('--- processInstagramPosts: Rejected post has no id, cannot remove ---', { post });
          continue;
        }
        // Remove rejected post from the results array in apifyResults collection
        const apifyResultsQuery = await externalDb.collection('apifyResults').get();
        let postRemoved = false;
        for (const doc of apifyResultsQuery.docs) {
          const data = doc.data();
          if (data.results && Array.isArray(data.results)) {
            const postIndex = data.results.findIndex(result => result.id === post.id);
            if (postIndex !== -1) {
              data.results.splice(postIndex, 1);
              await doc.ref.update({ results: data.results });
              postRemoved = true;
              break;
            }
          }
        }
        if (!postRemoved) {
          logger.info('--- processInstagramPosts: Rejected post not found in results ---', { postId: post.id });
        }
        results.deleted++;
      } catch (error) {
        results.errors.push({
          postIndex: index,
          postId: post.id,
          error: `Failed to delete: ${error.message}`
        });
        results.failed++;
      }
    }

    // Process accepted posts in batches (extract and save events)
    const batchSize = 5;
    for (let i = 0; i < acceptedPosts.length; i += batchSize) {
      const batch = acceptedPosts.slice(i, i + batchSize);
      // Process batch in parallel
      const batchPromises = batch.map(async ({ post, index }) => {
        const result = await processAcceptedPost(post, index, results);
        return result;
      });
      try {
        await Promise.all(batchPromises);
      } catch (error) {
        // Just log, don't stream errors
      }
    }

    res.status(200).json({ 
      success: true, 
      results 
    });
  } catch (error) {
    logger.error('--- processInstagramPosts: Function error ---', error);
    res.status(500).json({ 
      success: false, 
      error: 'Processing failed', 
      details: error.message 
    });
  }
}); 