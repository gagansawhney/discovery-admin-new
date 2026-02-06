const functions = require('firebase-functions');
const { db, externalDb } = require('./firebase');
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const cors = require('cors')({
  origin: true,
  credentials: true
});
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

exports.manageVenues = functions.https.onRequest({
  invoker: 'public',
  timeoutSeconds: 60,
  memory: '256MiB',
  secrets: ["GOOGLE_MAPS_API_KEY"]
}, (req, res) => {
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
      const { action, venue, venueId } = req.body;

      logger.info('manageVenues called', { action, venueId: venue?.id });

      switch (action) {
        case 'add':
          await addVenue(req, res);
          break;
        case 'update':
          await updateVenue(req, res);
          break;
        case 'updateUsernames':
          await updateVenueUsernames(req, res);
          break;
        case 'delete':
          await deleteVenue(req, res);
          break;
        case 'list':
          await listVenues(req, res);
          break;
        default:
          res.status(400).json({ success: false, error: 'Invalid action' });
      }
    } catch (error) {
      logger.error('manageVenues error', { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

async function addVenue(req, res) {
  try {
    const { venue } = req.body;

    if (!venue.name || !venue.address) {
      return res.status(400).json({ success: false, error: 'Name and address are required' });
    }

    let latitude = venue.latitude;
    let longitude = venue.longitude;

    // Auto-geocode if coordinates are not provided
    if (!latitude || !longitude) {
      logger.info('Auto-geocoding address for venue', { name: venue.name, address: venue.address });

      // Check if Google Maps API key is available
      if (!GOOGLE_MAPS_API_KEY) {
        logger.warn('Google Maps API key not configured, skipping auto-geocoding', { venue: venue.name });
      } else {
        try {
          const encodedAddress = encodeURIComponent(venue.address);
          const geocodingUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;

          const response = await fetch(geocodingUrl);
          const data = await response.json();

          if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            const location = result.geometry.location;

            latitude = location.lat;
            longitude = location.lng;

            logger.info('Auto-geocoding successful', {
              venue: venue.name,
              address: venue.address,
              lat: latitude,
              lng: longitude,
              formattedAddress: result.formatted_address
            });
          } else {
            logger.warn('Auto-geocoding failed', {
              venue: venue.name,
              address: venue.address,
              status: data.status
            });
          }
        } catch (geoError) {
          logger.error('Auto-geocoding error', {
            venue: venue.name,
            address: venue.address,
            error: geoError.message
          });
        }
      }
    }

    const venueData = {
      name: venue.name ? venue.name.replace(/\b\w/g, l => l.toUpperCase()) : venue.name,
      nameVariations: venue.nameVariations || [],
      address: venue.address,
      latitude: latitude,
      longitude: longitude,
      googleMapLink: venue.googleMapLink || '',
      openingHours: venue.openingHours || {},
      contactNumber: venue.contactNumber || '',
      website: venue.website || '',
      priceLevel: venue.priceLevel || null,
      rating: venue.rating || null,
      userRatingsTotal: venue.userRatingsTotal || null,
      ratingInfo: venue.ratingInfo || '',
      photoUrls: venue.photoUrls || [],
      instagramUsernames: Array.isArray(venue.instagramUsernames) ? venue.instagramUsernames : [],
      lastScan: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await externalDb.collection('venues').add(venueData);

    logger.info('Venue added successfully', { venueId: docRef.id, name: venue.name });

    res.json({
      success: true,
      venueId: docRef.id,
      message: 'Venue added successfully',
      autoGeocoded: !venue.latitude && !venue.longitude && latitude && longitude
    });
  } catch (error) {
    logger.error('Error adding venue', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to add venue' });
  }
}

async function updateVenue(req, res) {
  try {
    const { venue } = req.body;

    if (!venue.id || !venue.name || !venue.address) {
      return res.status(400).json({ success: false, error: 'ID, name and address are required' });
    }

    let latitude = venue.latitude;
    let longitude = venue.longitude;

    // Auto-geocode if coordinates are not provided
    if (!latitude || !longitude) {
      logger.info('Auto-geocoding address for venue update', { id: venue.id, name: venue.name, address: venue.address });

      // Check if Google Maps API key is available
      if (!GOOGLE_MAPS_API_KEY) {
        logger.warn('Google Maps API key not configured, skipping auto-geocoding for update', { venueId: venue.id });
      } else {
        try {
          const encodedAddress = encodeURIComponent(venue.address);
          const geocodingUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;

          const response = await fetch(geocodingUrl);
          const data = await response.json();

          if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            const location = result.geometry.location;

            latitude = location.lat;
            longitude = location.lng;

            logger.info('Auto-geocoding successful for update', {
              venueId: venue.id,
              venue: venue.name,
              address: venue.address,
              lat: latitude,
              lng: longitude,
              formattedAddress: result.formatted_address
            });
          } else {
            logger.warn('Auto-geocoding failed for update', {
              venueId: venue.id,
              venue: venue.name,
              address: venue.address,
              status: data.status
            });
          }
        } catch (geoError) {
          logger.error('Auto-geocoding error for update', {
            venueId: venue.id,
            venue: venue.name,
            address: venue.address,
            error: geoError.message
          });
        }
      }
    }

    const venueData = {
      name: venue.name,
      nameVariations: venue.nameVariations || [],
      address: venue.address,
      latitude: latitude,
      longitude: longitude,
      googleMapLink: venue.googleMapLink || '',
      openingHours: venue.openingHours || {},
      contactNumber: venue.contactNumber || '',
      website: venue.website || '',
      priceLevel: venue.priceLevel || null,
      rating: venue.rating || null,
      userRatingsTotal: venue.userRatingsTotal || null,
      ratingInfo: venue.ratingInfo || '',
      photoUrls: venue.photoUrls || [],
      instagramUsernames: Array.isArray(venue.instagramUsernames) ? venue.instagramUsernames : [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await externalDb.collection('venues').doc(venue.id).update(venueData);

    logger.info('Venue updated successfully', { venueId: venue.id, name: venue.name });

    res.json({
      success: true,
      message: 'Venue updated successfully',
      autoGeocoded: !venue.latitude && !venue.longitude && latitude && longitude
    });
  } catch (error) {
    logger.error('Error updating venue', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update venue' });
  }
}

async function updateVenueUsernames(req, res) {
  try {
    const { venueId, instagramUsernames } = req.body;
    if (!venueId || !Array.isArray(instagramUsernames)) {
      return res.status(400).json({ success: false, error: 'venueId and instagramUsernames[] are required' });
    }
    await externalDb.collection('venues').doc(venueId).update({
      instagramUsernames,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Error updating venue usernames', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to update venue usernames' });
  }
}

async function deleteVenue(req, res) {
  try {
    const { venueId } = req.body;

    logger.info('deleteVenue called', { venueId, body: req.body });

    if (!venueId) {
      logger.error('deleteVenue error: No venue ID provided', { body: req.body });
      return res.status(400).json({ success: false, error: 'Venue ID is required' });
    }

    // Check if venue exists before deleting
    const venueDoc = await externalDb.collection('venues').doc(venueId).get();

    if (!venueDoc.exists) {
      logger.error('deleteVenue error: Venue not found', { venueId });
      return res.status(404).json({ success: false, error: 'Venue not found' });
    }

    logger.info('Venue found, proceeding with deletion', { venueId, venueName: venueDoc.data().name });

    await externalDb.collection('venues').doc(venueId).delete();

    logger.info('Venue deleted successfully', { venueId });

    res.json({
      success: true,
      message: 'Venue deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting venue', { error: error.message, stack: error.stack, venueId: req.body.venueId });
    res.status(500).json({ success: false, error: 'Failed to delete venue' });
  }
}

async function listVenues(req, res) {
  try {
    const sortBy = req.body && req.body.sortBy ? req.body.sortBy : 'name';
    logger.info('listVenues called with sortBy:', sortBy, 'body:', req.body);

    let venuesSnapshot;

    if (sortBy === 'scanTime') {
      // For scanTime sorting, we need to get all venues and sort in memory
      // because Firestore can't order by fields with null values
      logger.info('Getting all venues for scanTime sorting');
      venuesSnapshot = await externalDb.collection('venues').get();
    } else {
      logger.info('Getting venues ordered by name');
      venuesSnapshot = await externalDb.collection('venues').orderBy('name').get();
    }

    const venues = [];

    venuesSnapshot.forEach(doc => {
      venues.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logger.info('Raw venues before sorting:', venues.length);

    // Sort in memory if sorting by scanTime
    if (sortBy === 'scanTime') {
      logger.info('Applying scanTime sorting');
      venues.sort((a, b) => {
        // Handle null values - venues without scans come first
        if (!a.lastScan && !b.lastScan) return a.name.localeCompare(b.name);
        if (!a.lastScan) return -1; // Never scanned venues first
        if (!b.lastScan) return 1;  // Never scanned venues first

        // Both have lastScan, compare timestamps (earliest first)
        const aTime = a.lastScan.toDate ? a.lastScan.toDate() : new Date(a.lastScan);
        const bTime = b.lastScan.toDate ? b.lastScan.toDate() : new Date(b.lastScan);
        return aTime.getTime() - bTime.getTime(); // Earliest first
      });

      // Log first few venues after sorting for debugging
      logger.info('First 3 venues after scanTime sorting:', venues.slice(0, 3).map(v => ({
        name: v.name,
        lastScan: v.lastScan,
        hasLastScan: !!v.lastScan
      })));
    }

    logger.info('Venues listed successfully', { count: venues.length, sortBy });

    res.json({
      success: true,
      venues
    });
  } catch (error) {
    logger.error('Error listing venues', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to list venues' });
  }
}