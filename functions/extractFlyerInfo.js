const functions = require('firebase-functions');
const { db, bucket, externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { checkVen } = require('./checkVen');
const OpenAI = require('openai');

exports.extractFlyerInfo = functions.https.onRequest({ invoker: 'public', secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY"], timeoutSeconds: 540 }, async (req, res) => {
  logger.info('--- extractFlyerInfo: Function started ---');
  
  // Model preference: 'openai' or 'gemini'
  const modelPreference = req.body.model || 'openai';

  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    logger.info('--- extractFlyerInfo: OPTIONS request handled ---');
    res.status(204).send('');
    return;
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : undefined;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : undefined;
    
    logger.info('extractFlyerInfo called', { method: req.method, body: req.body, modelPreference });
    
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { path, context } = req.body;
    if (!path) {
      logger.error('extractFlyerInfo error: Missing storage path');
      res.status(400).json({ error: 'Missing storage path' });
      return;
    }

    // Use default storage bucket
    const file = bucket.file(path);
    await file.download(); 

    const expiresAt = Date.now() + 60 * 60 * 1000;
    const [imageUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });

    const systemPrompt = `YOU ARE: an event-extraction assistant.  
GOAL: return ONE JSON object that my database can ingest.

──────── MANDATORY FIELDS ────────
id            string   unique (UUID/hash/slug)
name          string   clear human title (OK to fabricate)
date.start    ISO-8601 Asia/Kolkata
venue         object   { name: string }
searchText    string   lower-case "bag of words" (see rules)

──────── OPTIONAL FIELDS ─────────
date.end                ISO-8601 Asia/Kolkata or null
venue.address           string or null
venue.geo.lat/lon       numbers or null
pricing.min,max,currency numbers / string
tags                    array of tag words (see rules)
rawText                 full OCR text (can be long)
source                  {platform, postId, url, scrapedAt}
updatedAt               ISO-8601 timestamp now

──────── DATE RULES ────────
* Assume current year is 2025 unless the flyer shows another year.
* Use IST timezone (+05:30) for every datetime.

──────── TAG & SEARCHTEXT RULES ────────
1. Start with the full OCR text.
2. Normalise: lower-case, remove emojis.
3. Use synonym mapping for tags (e.g. techno, live-music, comedy).
4. Build searchText = unique words from: title + caption + tags + artists.

──────── OUTPUT FORMAT ────────
Return ONLY the JSON. Do NOT wrap it in markdown or add explanations.`;

    let parsedData = null;

    if (modelPreference === 'gemini') {
      logger.info('--- extractFlyerInfo: Using Gemini (AI Studio) ---');
      if (!GEMINI_API_KEY) throw new Error('Gemini key missing');
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const resImg = await fetch(imageUrl);
        const buf = await resImg.buffer();
        const base64Data = buf.toString('base64');
        const mimeType = path.endsWith('.mp4') ? "video/mp4" : "image/jpeg";

        const result = await model.generateContent([
          { text: `${systemPrompt}\n\n${context || "Extract event information from this image/video."}` },
          { inlineData: { data: base64Data, mimeType } }
        ]);

        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json\n?/, '').replace(/\n?```/, '').trim();
        parsedData = JSON.parse(text);
      } catch (geminiErr) {
        logger.error('Gemini extraction failed', geminiErr);
        throw new Error(`Gemini failed: ${geminiErr.message}`);
      }
    } else {
      logger.info('--- extractFlyerInfo: Using OpenAI (GPT-5.2) ---');
      if (!OPENAI_API_KEY) throw new Error('OpenAI key missing');
      
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: context || "Extract event information from this image." },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
          ]}
        ],
        max_completion_tokens: 2000,
        response_format: { type: "json_object" }
      });
      
      const content = response.choices[0].message.content;
      if (!content) throw new Error('OpenAI returned empty content');
      parsedData = JSON.parse(content);
    }

    res.status(200).json({ success: true, data: parsedData });
  } catch (err) {
    logger.error('extractFlyerInfo error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: 'Extraction failed', details: err.message });
  }
});
