const functions = require('firebase-functions');
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const cors = require('cors')({ 
  origin: true,
  credentials: true
});
const logger = require('firebase-functions/logger');

exports.geocodeAddress = functions.https.onRequest({ invoker: 'public', secrets: ["GOOGLE_MAPS_API_KEY"] }, (req, res) => {
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

      const { address } = req.body;
      
      if (!address) {
        return res.status(400).json({ 
          success: false, 
          error: 'Address is required' 
        });
      }

      logger.info('Geocoding address', { address });

      // Check if Google Maps API key is available
      if (!GOOGLE_MAPS_API_KEY) {
        logger.error('geocodeAddress error: Google Maps API key not configured');
        res.status(500).json({ 
          success: false, 
          error: 'Google Maps API key not configured. Please contact administrator.' 
        });
        return;
      }

      // Use Google Geocoding API
      const encodedAddress = encodeURIComponent(address);
      const geocodingUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;

      const response = await fetch(geocodingUrl);
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;
        
        logger.info('Geocoding successful', { 
          address, 
          lat: location.lat, 
          lng: location.lng,
          formattedAddress: result.formatted_address
        });

        res.json({
          success: true,
          latitude: location.lat,
          longitude: location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id
        });
      } else {
        logger.warn('Geocoding failed', { address, status: data.status, error: data.error_message });
        res.json({
          success: false,
          error: `Geocoding failed: ${data.status}`,
          details: data.error_message || 'No results found for this address'
        });
      }
    } catch (error) {
      logger.error('Geocoding error', { error: error.message, stack: error.stack });
      res.status(500).json({ 
        success: false, 
        error: 'Geocoding service error',
        details: error.message 
      });
    }
  });
});