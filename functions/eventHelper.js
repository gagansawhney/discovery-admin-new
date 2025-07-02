const { db, bucket, externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const crypto = require('crypto');
const { Buffer } = require('buffer');

// TODO: Implement extractDateRange function
function extractDateRange(caption) {
    console.warn("extractDateRange is a placeholder and needs to be implemented.");
    return null;
}

// TODO: Implement generateDayEvents function
function generateDayEvents(baseEvent, date) {
    console.warn("generateDayEvents is a placeholder and needs to be implemented.");
    return [];
}

// Extract event information from Instagram caption
function extractEventFromCaption(caption, options = {}) {
  try {
    if (!caption || caption.length < 10) {
      return null; // Too short to be an event
    }

    // Basic event detection patterns
    const eventKeywords = [
      'event', 'party', 'show', 'concert', 'festival', 'gig', 'performance',
      'night', 'club', 'dj', 'live', 'music', 'dance', 'celebration'
    ];

    const hasEventKeywords = eventKeywords.some(keyword => 
      caption.toLowerCase().includes(keyword)
    );

    if (!hasEventKeywords) {
      return null; // Doesn't seem to be an event
    }

    // Extract date using enhanced date range extraction
    const extractedDate = extractDateRange(caption);

    // Extract venue patterns
    const venuePatterns = [
      /at\s+([A-Z][a-zA-Z\s&]+)/gi,
      /venue[:\s]+([A-Z][a-zA-Z\s&]+)/gi,
      /location[:\s]+([A-Z][a-zA-Z\s&]+)/gi,
    ];

    let extractedVenue = null;
    for (const pattern of venuePatterns) {
      const match = caption.match(pattern);
      if (match && match[1]) {
        extractedVenue = match[1].trim();
        break;
      }
    }

    // Extract pricing patterns
    const pricePatterns = [
      /(\d+)\s*(rs|rupees?|inr)/gi,
      /(\d+)\s*(usd|\$)/gi,
      /price[:\s]*(\d+)/gi,
      /ticket[:\s]*(\d+)/gi,
    ];

    let extractedPrice = null;
    for (const pattern of pricePatterns) {
      const match = caption.match(pattern);
      if (match && match[1]) {
        extractedPrice = parseInt(match[1]);
        break;
      }
    }

    // Generate event name from caption
    const lines = caption.split('\n').filter(line => line.trim().length > 0);
    const eventName = lines[0] || 'Untitled Event';

    // Generate search text
    const searchText = caption.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Generate event ID
    const eventId = `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: eventId,
      name: eventName.substring(0, 100), // Limit name length
      date: extractedDate || {
        start: new Date().toISOString(),
        end: null
      },
      venue: {
        name: extractedVenue || 'Unknown Venue',
        address: null
      },
      pricing: extractedPrice ? {
        min: extractedPrice,
        max: extractedPrice,
        currency: 'INR'
      } : null,
      tags: [],
      searchText: searchText,
      extractedText: caption,
      context: 'Instagram post'
    };

  } catch (error) {
    logger.error('Error extracting event from caption', { error: error.message, caption });
    return null;
  }
}

// Process Phantom Buster scraped data into events
async function processPhantomBusterPostData(outputObject, postUrl) {
  const events = [];
  
  logger.info('Processing Phantom Buster post data', { 
    postUrl,
    outputObject: outputObject
  });

  try {
    // Extract post information from the scraped data
    const postData = outputObject;
    const caption = postData.caption || postData.text || '';
    const imageUrl = postData.imageUrl || postData.displayUrl || postData.mediaUrl || '';
    const timestamp = postData.timestamp || postData.date || new Date().toISOString();
    
    // Basic event extraction from caption
    const eventData = extractEventFromCaption(caption, {
      sourceUrl: postUrl,
      imageUrl: imageUrl,
      timestamp: timestamp,
      profileUrl: postUrl
    });

    if (eventData) {
      // Download and store image if available
      let imageHash = null;
      let path = null;
      
      if (imageUrl) {
        try {
          const imageResponse = await fetch(imageUrl);
          const imageBuffer = await imageResponse.arrayBuffer();
          const imageData = Buffer.from(imageBuffer);
          
          // Generate hash and store image
          imageHash = crypto.createHash('sha256').update(imageData).digest('hex');
          path = `events/${imageHash}.jpg`;
          
          const file = bucket.file(path);
          await file.save(imageData, {
            metadata: {
              contentType: 'image/jpeg'
            }
          });
          
          logger.info('Image stored successfully', { imageHash, path });
        } catch (error) {
          logger.warn('Failed to store image', { imageUrl, error: error.message });
        }
      }

      // Create base event object
      const baseEvent = {
        id: eventData.id || `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: eventData.name,
        date: eventData.date,
        venue: eventData.venue,
        pricing: eventData.pricing,
        tags: eventData.tags || [],
        source: {
          platform: 'Instagram',
          url: postUrl,
          profileUrl: postUrl,
          scrapedAt: new Date().toISOString()
        },
        imageUrl: imageUrl,
        imageHash: imageHash,
        path: path,
        searchText: eventData.searchText,
        rawText: caption,
        extractedText: eventData.extractedText,
        context: eventData.context,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Check if this is a date range and generate multiple events
      let eventsToSave = [baseEvent];
      
      if (eventData.date && eventData.date.isRange) {
        // Generate individual day events for the range
        const dayEvents = generateDayEvents(baseEvent, eventData.date);
        eventsToSave = dayEvents;
        logger.info('Generated multiple day events', { 
          originalEventId: baseEvent.id, 
          dayCount: dayEvents.length 
        });
      }

      // Save all events
      for (const event of eventsToSave) {
        // Check for duplicates before saving
        const existingEvent = await checkForDuplicateEvent(event);
        if (!existingEvent) {
          await externalDb.collection('events').doc(event.id).set(event);
          events.push(event);
          logger.info('Event saved successfully', { 
            eventId: event.id, 
            eventName: event.name,
            isMultiDay: event.isMultiDayEvent || false
          });
        } else {
          logger.info('Duplicate event skipped', { 
            eventId: event.id, 
            eventName: event.name 
          });
        }
      }
    } else {
      logger.info('No event data extracted from post', { postUrl });
    }
  } catch (error) {
    logger.error('Error processing post data', { postUrl, error: error.message });
  }

  return events;
}

// Check for duplicate events
async function checkForDuplicateEvent(newEvent) {
  try {
    // Check by name and date
    const snapshot = await externalDb.collection('events')
      .where('name', '==', newEvent.name)
      .where('date.start', '==', newEvent.date.start)
      .limit(1)
      .get();

    return !snapshot.empty;
  } catch (error) {
    logger.error('Error checking for duplicate event', { error: error.message });
    return false;
  }
}

module.exports = { extractEventFromCaption, processPhantomBusterPostData, checkForDuplicateEvent };