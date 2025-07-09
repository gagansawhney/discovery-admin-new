const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');
const OpenAI = require('openai');

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
    // Generate embedding for searchText
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }
    if (!eventData.searchText || typeof eventData.searchText !== 'string' || !eventData.searchText.trim()) {
      return res.status(400).json({ success: false, error: 'searchText is required for embedding' });
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
      return res.status(500).json({ success: false, error: 'Failed to generate embedding', details: embedErr.message });
    }
    eventData.embedding = embedding;

    await externalDb.collection('events').doc(eventData.id).set(eventData, { merge: true });

    logger.info('Event saved successfully', { eventId: eventData.id });
    res.json({ success: true, message: 'Event saved successfully', eventId: eventData.id });
  } catch (error) {
    logger.error('Error saving event', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to save event', details: error.message });
  }
});

exports.saveEvent = functions.https.onRequest({ secrets: ["OPENAI_API_KEY"] }, app);