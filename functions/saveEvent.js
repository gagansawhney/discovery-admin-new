const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');

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

    await externalDb.collection('events').doc(eventData.id).set(eventData, { merge: true });

    logger.info('Event saved successfully', { eventId: eventData.id });
    res.json({ success: true, message: 'Event saved successfully', eventId: eventData.id });
  } catch (error) {
    logger.error('Error saving event', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to save event', details: error.message });
  }
});

exports.saveEvent = functions.https.onRequest(app);