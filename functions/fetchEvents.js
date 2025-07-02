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
    const { type = 'all' } = req.body; // 'upcoming', 'past', or 'all'
    
    logger.info('Fetching events', { type });

    // Get all events from the events collection
    const eventsSnapshot = await externalDb.collection('events').orderBy('date.start', 'desc').get();
    const events = [];
    const now = new Date();
    
    for (const doc of eventsSnapshot.docs) {
      const eventData = doc.data();
      
      // Parse the event date - use end date if available, otherwise use start date
      let eventDate;
      if (eventData.date && eventData.date.end) {
        eventDate = new Date(eventData.date.end);
      } else if (eventData.date && eventData.date.start) {
        eventDate = new Date(eventData.date.start);
      } else if (eventData.date) {
        eventDate = new Date(eventData.date);
      } else {
        // Skip events without dates
        continue;
      }
      
      // Filter based on type using end date for comparison
      if (type === 'upcoming' && eventDate <= now) continue;
      if (type === 'past' && eventDate > now) continue;
      
      // Parse Firestore timestamps
      const parseFirestoreTimestamp = (timestamp) => {
        if (!timestamp) return new Date();
        if (timestamp instanceof Date) return timestamp;
        if (timestamp.toDate && typeof timestamp.toDate === 'function') {
          return timestamp.toDate();
        }
        if (timestamp.seconds && typeof timestamp.seconds === 'number') {
          return new Date(timestamp.seconds * 1000);
        }
        if (typeof timestamp === 'string' || typeof timestamp === 'number') {
          const parsed = new Date(timestamp);
          if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date();
      };

      // Generate photo URL if path exists
      let photoUrl = null;
      if (eventData.path) {
        try {
          const file = bucket.file(eventData.path);
          const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
          });
          photoUrl = signedUrl;
        } catch (error) {
          logger.warn('Failed to generate photo URL from path', { path: eventData.path, error: error.message });
        }
      }
      
      // If no photo URL from path, try using imageHash
      if (!photoUrl && eventData.imageHash) {
        try {
          // Try to construct a path from imageHash
          const possiblePath = `events/${eventData.imageHash}.jpg`;
          const file = bucket.file(possiblePath);
          const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
          });
          photoUrl = signedUrl;
          logger.info('Generated photo URL from imageHash', { imageHash: eventData.imageHash, path: possiblePath });
        } catch (error) {
          logger.warn('Failed to generate photo URL from imageHash', { imageHash: eventData.imageHash, error: error.message });
        }
      }
      
      // If still no photo URL, try other possible paths
      if (!photoUrl && eventData.imageHash) {
        const possiblePaths = [
          `events/${eventData.imageHash}`,
          `events/${eventData.imageHash}.png`,
          `events/${eventData.imageHash}.jpeg`,
          `uploads/${eventData.imageHash}.jpg`,
          `uploads/${eventData.imageHash}.png`,
          `uploads/${eventData.imageHash}.jpeg`
        ];
        
        for (const possiblePath of possiblePaths) {
          try {
            const file = bucket.file(possiblePath);
            const [signedUrl] = await file.getSignedUrl({
              version: 'v4',
              action: 'read',
              expires: Date.now() + 60 * 60 * 1000, // 1 hour
            });
            photoUrl = signedUrl;
            logger.info('Generated photo URL from possible path', { imageHash: eventData.imageHash, path: possiblePath });
            break;
          } catch (error) {
            // Continue trying other paths
          }
        }
      }

      events.push({
        id: doc.id,
        name: eventData.name || eventData.data?.name || 'Untitled Event',
        date: {
          start: eventData.date?.start || eventData.date,
          end: eventData.date?.end
        },
        venue: {
          name: eventData.venue?.name || eventData.data?.venue?.name || 'Unknown Venue',
          address: eventData.venue?.address || eventData.data?.venue?.address
        },
        pricing: eventData.pricing || eventData.data?.pricing,
        tags: eventData.tags || eventData.data?.tags || [],
        source: eventData.source || eventData.data?.source || {
          platform: 'upload',
          url: null
        },
        imageUrl: eventData.imageUrl || eventData.data?.imageUrl,
        imageHash: eventData.imageHash,
        context: eventData.context,
        searchText: eventData.searchText || eventData.data?.searchText,
        rawText: eventData.rawText || eventData.data?.rawText,
        extractedText: eventData.extractedText || eventData.data?.extractedText,
        path: eventData.path,
        photoUrl: photoUrl,
        createdAt: parseFirestoreTimestamp(eventData.createdAt),
        updatedAt: parseFirestoreTimestamp(eventData.updatedAt)
      });
    }
    
    logger.info('Events fetched successfully', { 
      type, 
      totalEvents: events.length,
      ongoingCount: events.filter(e => {
        const startDate = new Date(e.date.start);
        const endDate = e.date.end ? new Date(e.date.end) : new Date(e.date.start);
        return startDate <= now && endDate > now;
      }).length,
      upcomingCount: events.filter(e => {
        const startDate = new Date(e.date.start);
        return startDate > now;
      }).length,
      pastCount: events.filter(e => {
        const endDate = e.date.end ? new Date(e.date.end) : new Date(e.date.start);
        return endDate <= now;
      }).length
    });
    
    res.json({ 
      success: true, 
      events,
      count: events.length
    });
  } catch (error) {
    logger.error('Error fetching events', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch events',
      details: error.message 
    });
  }
});

exports.fetchEvents = functions.https.onRequest(app);