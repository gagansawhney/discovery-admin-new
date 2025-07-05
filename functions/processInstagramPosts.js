const functions = require('firebase-functions');
const { externalDb, bucket } = require('./firebase');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true, credentials: true });
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

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

    logger.info(`--- processAcceptedPost: Step 4 complete - Event data extracted ---`, {
      postId,
      eventName: eventData.name,
      eventDate: eventData.date?.start
    });

    // Step 5: Save event to Firestore
    const eventId = await saveEventToFirestore(eventData, post);
    if (!eventId) {
      throw new Error('Failed to save event to Firestore');
    }

    logger.info(`--- processAcceptedPost: Step 5 complete - Event saved to Firestore ---`, {
      postId,
      eventId
    });

    // Step 6: Remove post from apifyResults
    await removePostFromResults(post);

    logger.info(`--- processAcceptedPost: Step 6 complete - Post removed from results ---`, {
      postId
    });

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

    return { success: false, error: error.message };
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

    logger.info('--- processInstagramPosts: Processing posts ---', { 
      totalPosts: posts.length, 
      decisionsLength: decisions.length,
      decisionsSample: decisions.slice(0, 5),
      firstPostSample: posts[0] ? {
        id: posts[0].id,
        shortcode: posts[0].shortcode,
        displayUrl: posts[0].displayUrl,
        caption: posts[0].caption?.substring(0, 100)
      } : null
    });

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
    
    logger.info('--- processInstagramPosts: Post separation complete ---', {
      totalPosts: posts.length,
      rejectedCount: rejectedPosts.length,
      acceptedCount: acceptedPosts.length
    });

    // Process rejected posts (delete from Firestore)
    logger.info('--- processInstagramPosts: Starting rejected posts processing ---');
    for (const { post, index } of rejectedPosts) {
      try {
        logger.info(`--- Processing rejected post ${index + 1}/${posts.length} ---`, {
          postId: post.id || post.shortcode,
          postIndex: index
        });
        
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
              logger.info(`--- Successfully removed rejected post ${index + 1} from results array ---`);
              postRemoved = true;
              break;
            }
          }
        }
        
        if (!postRemoved) {
          logger.info(`--- Rejected post ${index + 1} not found in any apifyResults document ---`);
        }
        
        results.deleted++;
      } catch (error) {
        logger.error(`--- Error processing rejected post ${index + 1} ---`, error);
        results.errors.push({
          postIndex: index,
          postId: post.id || post.shortcode,
          error: `Failed to delete: ${error.message}`
        });
        results.failed++;
      }
    }

    // Process accepted posts in batches (extract and save events)
    logger.info('--- processInstagramPosts: Starting accepted posts processing ---');
    const batchSize = 5;
    
    for (let i = 0; i < acceptedPosts.length; i += batchSize) {
      const batch = acceptedPosts.slice(i, i + batchSize);
      logger.info(`--- Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(acceptedPosts.length / batchSize)} ---`, {
        batchStart: i + 1,
        batchEnd: Math.min(i + batchSize, acceptedPosts.length),
        batchSize: batch.length
      });
      
      // Process batch in parallel
      const batchPromises = batch.map(async ({ post, index }) => {
        return await processAcceptedPost(post, index, results);
      });
      
      try {
        await Promise.all(batchPromises);
        logger.info(`--- Batch ${Math.floor(i / batchSize) + 1} completed successfully ---`);
      } catch (error) {
        logger.error(`--- Error in batch ${Math.floor(i / batchSize) + 1} ---`, error);
      }
    }

    logger.info('--- processInstagramPosts: Processing completed ---', results);
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