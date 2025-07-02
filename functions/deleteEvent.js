const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const logger = require('firebase-functions/logger');
const { db, bucket, externalDb } = require('./firebase');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json()); // Enable JSON body parsing

app.post('/', async (req, res) => {
  logger.info('deleteEvent called', { method: req.method, headers: req.headers, query: req.query, body: req.body });
  
  try {
    const { eventId } = req.body;
    
    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required'
      });
    }

    // Get the event to check if it exists and get image info
    const eventDoc = await externalDb.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    const eventData = eventDoc.data();

    // Delete the event document from Firestore
    await externalDb.collection('events').doc(eventId).delete();

    // If the event has an image path, delete the image from Storage
    if (eventData.path) {
      const file = bucket.file(eventData.path);
      try {
        await file.delete();
        logger.info('Event image deleted from Storage', { path: eventData.path });
      } catch (error) {
        logger.error('Failed to delete event image from Storage', { path: eventData.path, error: error.message });
      }
    }

    logger.info('Event deleted successfully', { eventId });

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting event', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete event',
      details: error.message 
    });
  }
});

exports.deleteEvent = functions.https.onRequest(app);