const functions = require('firebase-functions');
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const cors = require('cors')({ 
  origin: true,
  credentials: true
});
const logger = require('firebase-functions/logger');

exports.fetchVenueDetails = functions.https.onRequest({ invoker: 'public', secrets: ["GOOGLE_MAPS_API_KEY"] }, (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const { venueName, address } = req.body;
      
      if (!venueName && !address) {
        return res.status(400).json({ 
          success: false, 
          error: 'Either venue name or address is required' 
        });
      }

      logger.info('Fetching venue details', { venueName, address });

      // Check if Google Maps API key is available
      if (!GOOGLE_MAPS_API_KEY) {
        logger.error('fetchVenueDetails error: Google Maps API key not configured');
        res.status(500).json({ 
          success: false, 
          error: 'Google Maps API key not configured. Please contact administrator.' 
        });
        return;
      }

      // Step 1: Search for the place
      const searchQuery = venueName || address;
      const encodedQuery = encodeURIComponent(searchQuery);
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodedQuery}&key=${GOOGLE_MAPS_API_KEY}`;

      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();

      if (searchData.status !== 'OK' || searchData.results.length === 0) {
        logger.warn('No places found', { query: searchQuery, status: searchData.status });
        return res.json({
          success: false,
          error: 'No venue found with the provided information',
          details: searchData.error_message || 'Try a different search term'
        });
      }

      const place = searchData.results[0];
      logger.info('Place found', { placeId: place.place_id, name: place.name });

      // Step 2: Get detailed information
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,geometry,formatted_phone_number,opening_hours,website,url,price_level,rating,user_ratings_total,photos&key=${GOOGLE_MAPS_API_KEY}`;
      
      const detailsResponse = await fetch(detailsUrl);
      const detailsData = await detailsResponse.json();

      if (detailsData.status !== 'OK') {
        logger.warn('Failed to get place details', { placeId: place.place_id, status: detailsData.status });
        return res.json({
          success: false,
          error: 'Failed to fetch venue details',
          details: detailsData.error_message || 'Could not retrieve detailed information'
        });
      }

      const details = detailsData.result;
      
      // Parse opening hours
      let openingHours = {};
      if (details.opening_hours && details.opening_hours.periods) {
        const daysMap = {
          0: 'Sunday',
          1: 'Monday', 
          2: 'Tuesday',
          3: 'Wednesday',
          4: 'Thursday',
          5: 'Friday',
          6: 'Saturday'
        };

        details.opening_hours.periods.forEach((period) => {
          const dayName = daysMap[period.open.day];
          if (dayName) {
            openingHours[dayName] = {
              open: period.open.time,
              close: period.close ? period.close.time : undefined,
              closed: false
            };
          }
        });

        // Handle days that might be closed (not in periods)
        Object.values(daysMap).forEach(day => {
          if (!openingHours[day]) {
            openingHours[day] = { closed: true };
          }
        });
      }

      // Format phone number
      let contactNumber = '';
      if (details.formatted_phone_number) {
        contactNumber = details.formatted_phone_number;
      }

      // Create Google Maps link
      const googleMapLink = details.url || `https://maps.google.com/?q=${encodeURIComponent(details.formatted_address)}`;

      // Process photos
      let photoUrls = [];
      if (details.photos && details.photos.length > 0) {
        // Get up to 5 photos
        const maxPhotos = Math.min(5, details.photos.length);
        for (let i = 0; i < maxPhotos; i++) {
          const photo = details.photos[i];
          const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${GOOGLE_MAPS_API_KEY}`;
          photoUrls.push(photoUrl);
        }
      }

      // Format rating
      let ratingInfo = '';
      if (details.rating && details.user_ratings_total) {
        ratingInfo = `${details.rating} (${details.user_ratings_total} reviews)`;
      } else if (details.rating) {
        ratingInfo = `${details.rating} (no reviews)`;
      }

      logger.info('Venue details fetched successfully', { 
        name: details.name,
        address: details.formatted_address,
        hasPhone: !!contactNumber,
        hasHours: !!details.opening_hours,
        hasWebsite: !!details.website,
        hasPhotos: photoUrls.length > 0,
        rating: ratingInfo,
        priceLevel: details.price_level
      });

      res.json({
        success: true,
        venue: {
          name: details.name,
          address: details.formatted_address,
          latitude: details.geometry.location.lat,
          longitude: details.geometry.location.lng,
          contactNumber,
          googleMapLink,
          openingHours,
          website: details.website || '',
          priceLevel: details.price_level || null,
          rating: details.rating || null,
          userRatingsTotal: details.user_ratings_total || null,
          ratingInfo,
          photoUrls
        }
      });
    } catch (error) {
      logger.error('Error fetching venue details', { error: error.message, stack: error.stack });
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch venue details',
        details: error.message 
      });
    }
  });
});