const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const logger = require('firebase-functions/logger');
const { admin, externalDb } = require('./firebase');
const OpenAI = require('openai');
const stringSimilarity = require('string-similarity');

const FieldValue = admin.firestore.FieldValue;

// Fuzzy matching threshold (0.0 - 1.0): higher = stricter matching
const FUZZY_MATCH_THRESHOLD = 0.6;

// Helper function to calculate similarity between two strings
function getSimilarity(str1, str2) {
  const s1 = str1.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Exact match after cleaning
  if (s1 === s2) return 1.0;
  
  return stringSimilarity.compareTwoStrings(
    str1.trim().toLowerCase(),
    str2.trim().toLowerCase()
  );
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

    // Step 1: Try exact match on venue name
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
        canonicalName: venueData.name,
        matchType: 'exact'
      });
      return {
        id: venueDoc.id,
        ...venueData
      };
    }

    // Step 2: Check name variations (exact match)
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
          matchedVariation: nameVariations.find(v => v.toLowerCase() === normalizedVenueName),
          matchType: 'variation_exact'
        });
        return {
          id: doc.id,
          ...venueData
        };
      }
    }

    // Step 3: Fuzzy matching on canonical names and variations
    logger.info(`--- lookupVenue: Starting fuzzy matching ---`, { venueName, threshold: FUZZY_MATCH_THRESHOLD });
    
    let bestMatch = null;
    let bestSimilarity = 0;
    let matchType = null;

    for (const doc of allVenuesSnapshot.docs) {
      const venueData = doc.data();
      
      // Check fuzzy match against canonical name
      const canonicalSimilarity = getSimilarity(venueName, venueData.name);
      if (canonicalSimilarity > bestSimilarity) {
        bestSimilarity = canonicalSimilarity;
        bestMatch = { id: doc.id, ...venueData };
        matchType = 'fuzzy_canonical';
      }

      // Check fuzzy match against variations
      const nameVariations = venueData.nameVariations || [];
      for (const variation of nameVariations) {
        const variationSimilarity = getSimilarity(venueName, variation);
        if (variationSimilarity > bestSimilarity) {
          bestSimilarity = variationSimilarity;
          bestMatch = { id: doc.id, ...venueData };
          matchType = 'fuzzy_variation';
        }
      }
    }

    if (bestMatch && bestSimilarity >= FUZZY_MATCH_THRESHOLD) {
      logger.info(`--- lookupVenue: Found fuzzy match ---`, {
        venueName,
        venueId: bestMatch.id,
        canonicalName: bestMatch.name,
        similarity: bestSimilarity,
        matchType,
        threshold: FUZZY_MATCH_THRESHOLD
      });
      return bestMatch;
    }

    logger.warn(`--- lookupVenue: No venue found (fuzzy matching failed) ---`, { 
      venueName, 
      bestSimilarity: bestMatch ? bestSimilarity : 0,
      threshold: FUZZY_MATCH_THRESHOLD
    });
    return null;
  } catch (error) {
    logger.error(`--- lookupVenue: Error looking up venue ---`, { venueName, error: error.message });
    throw error;
  }
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json()); // Enable JSON body parsing

app.post('/', async (req, res) => {
  logger.info('saveEvent called', { method: req.method, body: req.body });
  try {
    const eventData = req.body;

    if (!eventData || !eventData.id) {
      return res.status(400).json({ success: false, error: 'Event data and ID are required' });
    }

    let venueData = null;

    if (eventData.forceVenueId) {
      logger.info('Using forced venue ID', { forceVenueId: eventData.forceVenueId });
      const venueDoc = await externalDb.collection('venues').doc(eventData.forceVenueId).get();
      if (!venueDoc.exists) {
        return res.status(400).json({ success: false, error: `Forced venue ID not found: ${eventData.forceVenueId}` });
      }
      venueData = { id: venueDoc.id, ...venueDoc.data() };
    } else {
      // Standardize venue structure: support { venue: { name: '...' } } or { venueName: '...' }
      let venueName = eventData.venue?.name || eventData.venueName || eventData.venue;
      
      // If venue is still not a string, check if AI returned it as a flat field 'venue.name'
      if (typeof venueName !== 'string' && eventData['venue.name']) {
        venueName = eventData['venue.name'];
      }

      if (!venueName || typeof venueName !== 'string' || !venueName.trim()) {
        return res.status(400).json({ success: false, error: 'Event must have a venue name' });
      }

      // Lookup venue in venues collection
      venueData = await lookupVenue(venueName);
      if (!venueData) {
        return res.status(400).json({
          success: false,
          error: `Venue not found in venues collection: "${venueName}". Please add this venue first.`
        });
      }
    }

    logger.info('Venue validated for manual event save', {
      venueId: venueData.id
    });

    // Replace venue data with canonical venue data from venues collection
    const canonicalVenue = {
      name: venueData.name,
      address: venueData.address,
      geo: {
        lat: venueData.latitude || venueData.geo?.lat,
        lon: venueData.longitude || venueData.geo?.lon
      }
    };

    // Update event data with canonical venue
    const updatedEventData = {
      ...eventData,
      venue: canonicalVenue,
      venueId: venueData.id // Link to venue document
    };

    // Auto-capitalize title if present, or use capitalized name as title
    const sourceTitle = eventData.title || eventData.name;
    if (sourceTitle) {
      updatedEventData.title = sourceTitle.replace(/\b\w/g, l => l.toUpperCase());
    }

    // Generate embedding for searchText
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }
    if (!updatedEventData.searchText || typeof updatedEventData.searchText !== 'string' || !updatedEventData.searchText.trim()) {
      return res.status(400).json({ success: false, error: 'searchText is required for embedding' });
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    let embedding = null;
    try {
      const embeddingResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: updatedEventData.searchText
      });
      embedding = embeddingResp.data[0].embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('OpenAI embedding API did not return a valid embedding');
      }
    } catch (embedErr) {
      logger.error('Error generating embedding', { error: embedErr.message, searchText: updatedEventData.searchText });
      return res.status(500).json({ success: false, error: 'Failed to generate embedding', details: embedErr.message });
    }
    updatedEventData.embedding = FieldValue.vector(embedding);

    await externalDb.collection('events').doc(updatedEventData.id).set(updatedEventData, { merge: true });

    logger.info('Event saved successfully', {
      eventId: updatedEventData.id,
      venueId: venueData.id,
      canonicalVenueName: venueData.name
    });
    res.json({
      success: true,
      message: 'Event saved successfully',
      eventId: updatedEventData.id,
      venueId: venueData.id
    });
  } catch (error) {
    logger.error('Error saving event', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: `Failed to save event: ${error.message}` });
  }
});

exports.saveEvent = functions.https.onRequest({ secrets: ["OPENAI_API_KEY"] }, app);