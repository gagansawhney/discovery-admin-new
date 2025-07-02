const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const logger = require('firebase-functions/logger');
const { db, bucket, externalDb } = require('./firebase');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json()); // Enable JSON body parsing

app.post('/', async (req, res) => {
  try {
    const { venueName } = req.body;

    logger.info('Validating venue', { venueName });
    
    if (!venueName) {
      return res.status(400).json({ success: false, error: 'Venue name is required' });
    }
    
    // Get all venues from the venues collection
    const venuesSnapshot = await externalDb.collection('venues').get();
    
    if (venuesSnapshot.empty) {
      return res.status(404).json({ success: false, error: 'No venues found in database. Please add venues first.' });
    }
    
    const extractedName = venueName.toLowerCase().trim();
    
    // Check each venue for a match
    for (const doc of venuesSnapshot.docs) {
      const venue = doc.data();
      
      // Check primary name
      if (venue.name && venue.name.toLowerCase().trim() === extractedName) {
        logger.info('Venue matched by primary name', { 
          extractedName: venueName, 
          venueName: venue.name,
          venueId: doc.id 
        });
        return res.json({ 
          success: true, 
          venue: { id: doc.id, ...venue },
          matchType: 'primary'
        });
      }
      
      // Check name variations
      if (venue.nameVariations && Array.isArray(venue.nameVariations)) {
        for (const variation of venue.nameVariations) {
          if (variation.toLowerCase().trim() === extractedName) {
            logger.info('Venue matched by name variation', { 
              extractedName: venueName, 
              variation,
              venueName: venue.name,
              venueId: doc.id 
            });
            return res.json({ 
              success: true, 
              venue: { id: doc.id, ...venue },
              matchType: 'variation'
            });
          }
        }
      }
      
      // Check for partial matches (fuzzy matching)
      if (venue.name && venue.name.toLowerCase().includes(extractedName)) {
        logger.info('Venue matched by partial name', { 
          extractedName: venueName, 
          venueName: venue.name,
          venueId: doc.id 
        });
        return res.json({ 
          success: true, 
          venue: { id: doc.id, ...venue },
          matchType: 'partial'
        });
      }
      
      // Check if extracted name contains venue name (reverse partial match)
      if (venue.name && extractedName.includes(venue.name.toLowerCase())) {
        logger.info('Venue matched by reverse partial name', { 
          extractedName: venueName, 
          venueName: venue.name,
          venueId: doc.id 
        });
        return res.json({ 
          success: true, 
          venue: { id: doc.id, ...venue },
          matchType: 'reverse_partial'
        });
      }
    }
    
    // No match found
    logger.warn('No venue match found', { extractedVenueName: venueName });
    return res.status(404).json({ 
      success: false, 
      error: 'No venue match found in database. Please add this venue first.'
    });
    
  } catch (error) {
    logger.error('Error validating venue', { error: error.message });
    return res.status(500).json({ 
      success: false, 
      error: 'Error validating venue against database' 
    });
  }
});

exports.checkVen = functions.https.onRequest(app);