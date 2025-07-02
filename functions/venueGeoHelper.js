const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const logger = require('firebase-functions/logger');

async function enrichVenueGeo(parsed) {
    if (!parsed.venue.address) {
        return parsed;
    }

    if (!GOOGLE_MAPS_API_KEY) {
        logger.warn('Google Maps API key not configured, skipping geo-enrichment');
        return parsed;
    }

    try {
        const encodedAddress = encodeURIComponent(parsed.venue.address);
        const geocodingUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;

        const response = await fetch(geocodingUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.results.length > 0) {
            const location = data.results[0].geometry.location;
            parsed.venue.latitude = location.lat;
            parsed.venue.longitude = location.lng;
        }
    } catch (error) {
        logger.error('Error during geo-enrichment', { error: error.message, address: parsed.venue.address });
    }

    return parsed;
}

module.exports = { enrichVenueGeo };