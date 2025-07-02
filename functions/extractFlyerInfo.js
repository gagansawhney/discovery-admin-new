const functions = require('firebase-functions');
const { db, bucket, externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');



const { checkVen } = require('./checkVen');
const OpenAI = require('openai');

exports.extractFlyerInfo = functions.https.onRequest({ invoker: 'public', secrets: ["OPENAI_API_KEY"], timeoutSeconds: 540 }, async (req, res) => {
  logger.info('--- extractFlyerInfo: Function started ---');

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
    // Check if OpenAI API key is available
    if (!OPENAI_API_KEY) {
      logger.error('extractFlyerInfo error: OpenAI API key not configured');
      res.status(500).json({ error: 'OpenAI API key not configured. Please contact administrator.' });
      return;
    }
    logger.info('--- extractFlyerInfo: OpenAI API key is present ---');

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    logger.info('extractFlyerInfo called', { method: req.method, headers: req.headers, body: req.body });
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    logger.info('--- extractFlyerInfo: Request method is POST ---');

    const { path, context } = req.body;
    if (!path) {
      logger.error('extractFlyerInfo error: Missing storage path');
      res.status(400).json({ error: 'Missing storage path' });
      return;
    }
    logger.info('--- extractFlyerInfo: Storage path received ---', { path, context });

    // Use default storage bucket
    const file = bucket.file(path);
    logger.info('--- extractFlyerInfo: Attempting file download ---');
    await file.download(); // Download to ensure file exists, but we don't need the buffer
    logger.info('--- extractFlyerInfo: File downloaded ---');

    const expiresAt = Date.now() + 60 * 60 * 1000;
    const [imageUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });
    logger.info('--- extractFlyerInfo: Signed URL generated ---', { imageUrl });

    // Build system and user messages for OpenAI
    logger.info('--- extractFlyerInfo: Building system and user messages ---');
    const systemMessage = {
      role: "system",
      content: `YOU ARE: an event-extraction assistant.  
GOAL: return ONE JSON object that my database can ingest.

──────── MANDATORY FIELDS ────────
id            string   unique (UUID/hash/slug)
name          string   clear human title (OK to fabricate)
date.start    ISO-8601 Asia/Kolkata
venue.name    string
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
…anything else you can see (music, ageLimit, etc.) may be included but may also be omitted.

──────── DATE RULES ────────
* Assume current year is 2025 unless the flyer shows another year.
* "June 28" → "2025-06-28"; "Dec 15" → "2025-12-15".
* If only a time ("9pm") appears, combine it with today's date.
* Use IST timezone (+05:30) for every datetime.

──────── TAG & SEARCHTEXT RULES ────────
1. Start with the full OCR text (raw flyer words).
2. Normalise:
   • lower-case  
   • remove emojis & punctuation  
   • convert synonyms with this table  
    {
  "techno":      ["psytrance","psy","psy-trance","tech-house","minimal","melodic techno","deep house","edm"],
  "live-music":  ["gig","live singer","band","concert","tribute","acoustic","unplugged","cover night","jam"],
  "hip-hop":     ["rap","hip hop","beatbox","cypher"],
  "bollywood":   ["hindi hits","bolly","bolly-night","desi beats"],
  "drag":        ["drag show","drag night","drag queen","lgbtq"],
  "comedy":      ["stand-up","open mic comedy","roast","improv"],
  "karaoke":     ["sing-along","karaoke night"],
  "latin":       ["salsa","bachata","reggaeton","kizomba"],
  "jazz":        ["blues","swing","bebop"],
  "rock":        ["classic rock","indie rock","alt rock","metal"],
  "pop":         ["chart hits","top 40","mainstream"],
  "reggae":      ["dub","ska","dancehall"],
  "family":      ["kids","child friendly","all ages","family-friendly"],
  "workshop":    ["class","course","masterclass","training","bootcamp"],
  "yoga":        ["sunrise yoga","beach yoga","wellness session"],
  "wellness":    ["meditation","sound bath","breathwork"],
  "market":      ["flea market","bazaar","maker market","pop-up stalls"],
  "food-fest":   ["food festival","street food","night market","mela"],
  "brunch":      ["sunday brunch","bottomless brunch","buffet brunch"],
  "cocktail":    ["mixology","bartending workshop","happy hour"],
  "beer-fest":   ["brewfest","craft beer fest","oktoberfest"],
  "wine":        ["wine tasting","vino night"],
  "silent-disco": ["silent party","headphone party"],
  "rooftop":     ["terrace","skybar"],
  "beach":       ["seaside","shore","sandy","beachside"],
  "sunset":      ["sundowner","golden hour"],
  "sunrise":     ["dawn","early morning"],
  "afterparty":  ["late night","after hours","all-night"],
  "pool":        ["poolside","swim party"],
  "boat":        ["cruise","river cruise","yacht party"],
  "art":         ["gallery opening","exhibition","vernissage"],
  "poetry":      ["spoken word","shayari","ghazal"],
  "theatre":     ["play","drama","stage show"]
}
3. For every synonym mapping:
   • If any right-hand phrase appears, add the left-hand word to **tags[]**.
4. Add any obvious vibe/venue words you spot ("rooftop", "sunset", "beach").
5. Build **searchText** = unique words from: title + caption + tags + artist/DJ names
   (space-separated, lower-case, duplicates removed).
   Example:  
   "full moon beach techno live music drums sunset rooftop"
6. Keep tag words INSIDE searchText too.

──────── OUTPUT FORMAT ────────
Return ONLY the JSON. Do NOT wrap it in markdown or add explanations.
Omit keys you cannot fill; do not output null for missing optional keys
(except where the schema above explicitly allows null).

BEGIN.`
    };
    const userMessages = [
      { type: "text", text: context ? context : "Extract event information from this image." },
      { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
    ];
    logger.info('--- extractFlyerInfo: System Message ---', systemMessage);
    logger.info('--- extractFlyerInfo: User Messages ---', userMessages);
    logger.info('--- extractFlyerInfo: Calling OpenAI API ---');
    let rawMessage = null;
    let jsonString = null; // Declare jsonString here
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [systemMessage, { role: "user", content: userMessages }],
        max_tokens: 1000,
      });
      rawMessage = response.choices[0].message.content;
      logger.info('--- extractFlyerInfo: OpenAI API call successful ---');
      logger.info('--- extractFlyerInfo: Raw message from OpenAI ---', rawMessage);
    } catch (openaiError) {
      logger.error('OpenAI API call failed', { error: openaiError.message, response: openaiError.response });
      return res.status(500).json({ success: false, error: 'Extraction failed', details: 'OpenAI API call failed.' });
    }
    logger.info('--- extractFlyerInfo: Processing OpenAI response ---');
    
    // Remove Markdown code block if present
    if (rawMessage.startsWith('```')) {
      jsonString = rawMessage.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    } else {
      jsonString = rawMessage.trim();
    }
    logger.info('--- extractFlyerInfo: Processed JSON string ---', jsonString);
    let parsedData;
    try {
      parsedData = JSON.parse(jsonString);
      logger.info('--- extractFlyerInfo: Successfully parsed JSON ---', parsedData);
    } catch (parseError) {
      logger.error('extractFlyerInfo error: JSON parsing failed', { error: parseError.message, rawJson: jsonString });
      return res.status(500).json({ success: false, error: 'Extraction failed', details: 'Failed to parse OpenAI response.' });
    }

    logger.info('--- extractFlyerInfo: Sending final response ---');
    res.status(200).json({ success: true, data: parsedData });
  } catch (err) {
    logger.error('extractFlyerInfo error', { error: err, stack: err.stack });
    res.status(500).json({ error: 'Extraction failed', details: err.message });
  }
});