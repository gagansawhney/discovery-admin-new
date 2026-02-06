const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');
const OpenAI = require('openai');
const { FieldValue } = require('@google-cloud/firestore');

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

    // Validate venue exists in venues collection
    if (!eventData.venue || !eventData.venue.name) {
      return res.status(400).json({ success: false, error: 'Event must have a venue name' });
    }

    // Lookup venue in venues collection
    const venueData = await lookupVenue(eventData.venue.name);
    if (!venueData) {
      return res.status(400).json({
        success: false,
        error: `Venue not found in venues collection: "${eventData.venue.name}". Please add this venue first.`
      });
    }

    logger.info('Venue validated for manual event save', {
      originalVenueName: eventData.venue.name,
      canonicalVenueName: venueData.name,
      venueId: venueData.id
    });

    // Replace venue data with canonical venue data from venues collection
    const canonicalVenue = {
      name: venueData.name,
      address: venueData.address,
      geo: {
        lat: venueData.latitude,
        lon: venueData.longitude
      }
    };

    // Update event data with canonical venue
    const updatedEventData = {
      ...eventData,
      title: eventData.title ? eventData.title.replace(/\b\w/g, l => l.toUpperCase()) : eventData.title, // Auto-capitalize title
      venue: canonicalVenue,
      venueId: venueData.id // Link to venue document
    };

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
    res.status(500).json({ success: false, error: 'Failed to save event', details: error.message });
  }
});

exports.saveEvent = functions.https.onRequest({ secrets: ["OPENAI_API_KEY"] }, app);