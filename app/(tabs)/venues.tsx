import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Ionicons } from '@expo/vector-icons';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { IconButton, Button as MUIButton, Tooltip } from '@mui/material';
import * as FileSystem from 'expo-file-system';
import { router, useGlobalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Button,
    FlatList,
    Linking,
    Modal,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

interface Venue {
  id: string;
  name: string;
  nameVariations: string[];
  address: string;
  latitude: number;
  longitude: number;
  googleMapLink: string;
  openingHours: {
    [key: string]: {
      open?: string;
      close?: string;
      closed: boolean;
    };
  };
  contactNumber: string;
  website?: string;
  priceLevel?: number;
  rating?: number;
  userRatingsTotal?: number;
  ratingInfo?: string;
  photoUrls?: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface OpeningHoursForm {
  [key: string]: {
    open?: string;
    close?: string;
    closed: boolean;
  };
}

interface VenueApiRequest {
  id?: string;
  name: string;
  nameVariations: string[];
  address: string;
  latitude?: number;
  longitude?: number;
  googleMapLink: string;
  openingHours: {
    [key: string]: {
      open?: string;
      close?: string;
      closed: boolean;
    };
  };
  contactNumber: string;
  website?: string;
  priceLevel?: number;
  rating?: number;
  userRatingsTotal?: number;
  ratingInfo?: string;
  photoUrls?: string[];
}

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday', 
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

// HTTP endpoints - 2nd Gen Cloud Functions
const MANAGE_VENUES_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/manageVenues';
const GEOCODE_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/geocodeAddress';
const FETCH_VENUE_DETAILS_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/fetchVenueDetails';

// Add SheetJS for web export
let XLSX: any = null;
if (typeof window !== 'undefined') {
  try {
    XLSX = require('xlsx');
  } catch (e) {}
}

export default function VenuesScreen() {
  const { mode } = useGlobalSearchParams<{ mode?: string }>();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [expandedVenues, setExpandedVenues] = useState<Set<string>>(new Set());
  const isViewMode = mode === 'view' || mode === undefined;
  const isAddMode = mode === 'add';
  const isBulkMode = mode === 'bulk';
  
  // Confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [venueToDelete, setVenueToDelete] = useState<Venue | null>(null);
  
  // Error modal state
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    nameVariations: '',
    address: '',
    latitude: '',
    longitude: '',
    googleMapLink: '',
    contactNumber: '',
    website: '',
    priceLevel: '',
    rating: '',
    userRatingsTotal: '',
    ratingInfo: '',
    photoUrls: '',
    instagramUsernames: ''
  });
  
  const [openingHours, setOpeningHours] = useState<OpeningHoursForm>({
    Monday: { open: '', close: '', closed: false },
    Tuesday: { open: '', close: '', closed: false },
    Wednesday: { open: '', close: '', closed: false },
    Thursday: { open: '', close: '', closed: false },
    Friday: { open: '', close: '', closed: false },
    Saturday: { open: '', close: '', closed: false },
    Sunday: { open: '', close: '', closed: false }
  });



  // Load venues on component mount
  useEffect(() => {
    loadVenues();
  }, []);

  // React to mode changes: auto-open add modal in add mode; ensure closed in view mode
  useEffect(() => {
    if (isAddMode) {
      // If already editing, keep; otherwise open a clean add modal
      if (!showAddModal) {
        resetForm();
        setShowAddModal(true);
      }
    } else {
      // In view mode, ensure add modal is closed
      if (showAddModal && !editingVenue) {
        setShowAddModal(false);
      }
    }
  }, [isAddMode]);

  const loadVenues = async () => {
    try {
      setIsLoading(true);
      console.log('🏢 Loading venues...');
      
      const response = await fetch(MANAGE_VENUES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const parseFirestoreTimestamp = (timestamp: any): Date | null => {
            if (!timestamp) return null;
            if (timestamp instanceof Date) return timestamp;
            if (timestamp.toDate && typeof timestamp.toDate === 'function') {
              return timestamp.toDate();
            }
            // Handle Firestore timestamp format with _seconds and _nanoseconds
            if (timestamp._seconds && typeof timestamp._seconds === 'number') {
              return new Date(timestamp._seconds * 1000);
            }
            if (timestamp.seconds && typeof timestamp.seconds === 'number') {
              return new Date(timestamp.seconds * 1000);
            }
            if (typeof timestamp === 'string' || typeof timestamp === 'number') {
              const parsed = new Date(timestamp);
              if (!isNaN(parsed.getTime())) return parsed;
            }
            return null;
          };

          const parsedVenues = data.venues.map((venue: any) => {
            const parsedVenue = {
              id: venue.id,
              name: venue.name,
              nameVariations: venue.nameVariations || [],
              address: venue.address,
              latitude: venue.latitude,
              longitude: venue.longitude,
              googleMapLink: venue.googleMapLink,
              openingHours: venue.openingHours || {},
              contactNumber: venue.contactNumber,
              website: venue.website,
              priceLevel: venue.priceLevel,
              rating: venue.rating,
              userRatingsTotal: venue.userRatingsTotal,
              ratingInfo: venue.ratingInfo,
              photoUrls: venue.photoUrls,
              createdAt: parseFirestoreTimestamp(venue.createdAt) || new Date(),
              updatedAt: parseFirestoreTimestamp(venue.updatedAt) || new Date()
            };
            
            return parsedVenue;
          });
          
          console.log('🏢 Setting venues, Total venues:', parsedVenues.length);
          setVenues(parsedVenues);
        }
      } else {
        console.error('🏢 Failed to load venues:', response.status);
      }
    } catch (error) {
      console.error('🏢 Error loading venues:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Sort venues alphabetically
  const sortedVenues = React.useMemo(() => {
    return [...venues].sort((a, b) => a.name.localeCompare(b.name));
  }, [venues]);

  const resetForm = () => {
    setFormData({
      name: '',
      nameVariations: '',
      address: '',
      latitude: '',
      longitude: '',
      googleMapLink: '',
      contactNumber: '',
      website: '',
      priceLevel: '',
      rating: '',
      userRatingsTotal: '',
      ratingInfo: '',
      photoUrls: '',
      instagramUsernames: ''
    });
    setOpeningHours({
      Monday: { open: '', close: '', closed: false },
      Tuesday: { open: '', close: '', closed: false },
      Wednesday: { open: '', close: '', closed: false },
      Thursday: { open: '', close: '', closed: false },
      Friday: { open: '', close: '', closed: false },
      Saturday: { open: '', close: '', closed: false },
      Sunday: { open: '', close: '', closed: false }
    });
    setEditingVenue(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
    // Reflect mode in URL for consistency
    if (!isAddMode) router.push('/venues?mode=add');
  };

  const openEditModal = (venue: Venue) => {
    setFormData({
      name: venue.name,
      nameVariations: venue.nameVariations.join(', '),
      address: venue.address,
      latitude: venue.latitude.toString(),
      longitude: venue.longitude.toString(),
      googleMapLink: venue.googleMapLink,
      contactNumber: venue.contactNumber,
      website: venue.website || '',
      priceLevel: venue.priceLevel?.toString() || '',
      rating: venue.rating?.toString() || '',
      userRatingsTotal: venue.userRatingsTotal?.toString() || '',
      ratingInfo: venue.ratingInfo || '',
      photoUrls: venue.photoUrls?.join(', ') || '',
      instagramUsernames: (venue as any).instagramUsernames?.join(', ') || ''
    });
    setOpeningHours(venue.openingHours);
    setEditingVenue(venue);
    setShowAddModal(true);
    if (!isAddMode) router.push('/venues?mode=add');
  };

  const closeModal = () => {
    setShowAddModal(false);
    resetForm();
    if (!isViewMode) router.push('/venues?mode=view');
  };

  const saveVenue = async () => {
    if (!formData.name.trim()) {
      showError('Venue name is required');
      return;
    }

    if (!formData.address.trim()) {
      showError('Address is required');
      return;
    }

    // Check for duplicates (only for new venues, not when editing)
    if (!editingVenue) {
      const venueName = formData.name.trim().toLowerCase();
      const venueAddress = formData.address.trim().toLowerCase();
      
      const isDuplicate = venues.some(venue => {
        // Check if name matches (case insensitive)
        if (venue.name.toLowerCase() === venueName) {
          return true;
        }
        
        // Check if address matches (case insensitive)
        if (venue.address.toLowerCase() === venueAddress) {
          return true;
        }
        
        // Check name variations
        if (venue.nameVariations && venue.nameVariations.length > 0) {
          if (venue.nameVariations.some(variation => 
            variation.toLowerCase() === venueName
          )) {
            return true;
          }
        }
        
        return false;
      });
      
      if (isDuplicate) {
        console.error('❌ Duplicate venue detected:', venueName, venueAddress);
        showError('A venue with this name or address already exists. Please check the existing venues or use a different name/address.');
        return;
      }
    }

    // Coordinates are optional - they can be auto-generated
    const lat = formData.latitude ? parseFloat(formData.latitude) : undefined;
    const lng = formData.longitude ? parseFloat(formData.longitude) : undefined;
    
    // Only validate if coordinates are provided manually
    if (formData.latitude && formData.longitude && (isNaN(lat!) || isNaN(lng!))) {
      showError('If provided, latitude and longitude must be valid numbers');
      return;
    }

    try {
      console.log('🏢 Saving venue...');
      
      const venue: VenueApiRequest = {
        id: editingVenue?.id,
        name: formData.name.trim(),
        nameVariations: formData.nameVariations.trim().split(',').map(v => v.trim()).filter(v => v),
        address: formData.address.trim(),
        googleMapLink: formData.googleMapLink.trim(),
        openingHours: cleanOpeningHours(openingHours),
        contactNumber: formData.contactNumber.trim(),
        website: formData.website.trim() || undefined,
        priceLevel: formData.priceLevel ? parseInt(formData.priceLevel) : undefined,
        rating: formData.rating ? parseFloat(formData.rating) : undefined,
        userRatingsTotal: formData.userRatingsTotal ? parseInt(formData.userRatingsTotal) : undefined,
        ratingInfo: formData.ratingInfo.trim() || undefined,
        photoUrls: formData.photoUrls.trim() ? formData.photoUrls.split(',').map(url => url.trim()).filter(url => url) : undefined
      };
      const instagramUsernames = formData.instagramUsernames.trim()
        ? formData.instagramUsernames.split(',').map(u => u.trim()).filter(Boolean)
        : [];
      (venue as any).instagramUsernames = instagramUsernames;

      // Only add coordinates if they are valid numbers
      if (lat !== undefined && lng !== undefined) {
        venue.latitude = lat;
        venue.longitude = lng;
      }

      const venueData = {
        action: editingVenue ? 'update' : 'add',
        venue
      };

      const response = await fetch(MANAGE_VENUES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(venueData)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          console.log('🏢 Venue saved successfully');
          
          let message = editingVenue ? 'Venue updated successfully' : 'Venue added successfully';
          if (data.autoGeocoded) {
            message += '\n\n📍 Coordinates were automatically generated from the address!';
          }
          
          Alert.alert('Success', message);
          closeModal();
          loadVenues();
        } else {
          Alert.alert('Error', data.error || 'Failed to save venue');
        }
      } else {
        Alert.alert('Error', 'Failed to save venue');
      }
    } catch (error) {
      console.error('🏢 Error saving venue:', error);
      showError('Failed to save venue');
    }
  };

  const deleteVenue = async (venue: Venue) => {
    // Set the venue to delete and show the confirmation modal
    setVenueToDelete(venue);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!venueToDelete) return;
    
    try {
      console.log('🏢 Deleting venue:', venueToDelete.id, venueToDelete.name);
      
      const requestBody = {
        action: 'delete',
        venueId: venueToDelete.id
      };
      
      console.log('🏢 Delete request body:', requestBody);
      
      const response = await fetch(MANAGE_VENUES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      console.log('🏢 Delete response status:', response.status);
      console.log('🏢 Delete response ok:', response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log('🏢 Delete response data:', data);
        
        if (data.success) {
          console.log('🏢 Venue deleted successfully');
          // Show success message (we'll add a custom success modal or use a different approach)
          console.log('✅ Venue deleted successfully');
          loadVenues();
        } else {
          console.error('🏢 Delete failed with error:', data.error);
          // Show error message
          console.error('❌ Delete failed:', data.error || 'Failed to delete venue');
        }
      } else {
        const errorText = await response.text();
        console.error('🏢 Delete request failed:', response.status, errorText);
        console.error('❌ Delete request failed:', response.status);
      }
    } catch (error) {
      console.error('🏢 Error deleting venue:', error);
      console.error('❌ Error deleting venue');
    } finally {
      // Close the modal
      setShowDeleteModal(false);
      setVenueToDelete(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setVenueToDelete(null);
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorModal(true);
  };

  const closeError = () => {
    setShowErrorModal(false);
    setErrorMessage('');
  };

  const updateOpeningHours = (day: string, field: 'open' | 'close' | 'closed', value: string | boolean) => {
    setOpeningHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  const cleanOpeningHours = (hours: OpeningHoursForm) => {
    const cleaned: OpeningHoursForm = {};
    
    Object.keys(hours).forEach(day => {
      const dayHours = hours[day];
      if (dayHours) {
        const cleanedDay: { closed: boolean; open?: string; close?: string } = {
          closed: dayHours.closed || false
        };
        
        // Only add open/close times if they have meaningful values
        if (dayHours.open && dayHours.open.trim()) {
          cleanedDay.open = dayHours.open.trim();
        }
        if (dayHours.close && dayHours.close.trim()) {
          cleanedDay.close = dayHours.close.trim();
        }
        
        cleaned[day] = cleanedDay;
      }
    });
    
    return cleaned;
  };

  const geocodeAddress = async () => {
    if (!formData.address.trim()) {
      Alert.alert('Error', 'Please enter an address first');
      return;
    }

    try {
      setIsGeocoding(true);
      console.log('🗺️ Geocoding address:', formData.address);
      
      const response = await fetch(GEOCODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: formData.address })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success) {
          console.log('🗺️ Geocoding successful:', data);
          
          setFormData(prev => ({
            ...prev,
            latitude: data.latitude.toString(),
            longitude: data.longitude.toString()
          }));
          
          Alert.alert(
            'Coordinates Found!', 
            `Latitude: ${data.latitude}\nLongitude: ${data.longitude}\n\nFormatted Address: ${data.formattedAddress}`,
            [{ text: 'OK' }]
          );
        } else {
          console.error('🗺️ Geocoding failed:', data.error);
          Alert.alert('Geocoding Failed', data.error || 'Could not find coordinates for this address');
        }
      } else {
        console.error('🗺️ Geocoding request failed:', response.status);
        Alert.alert('Error', 'Failed to geocode address. Please try again.');
      }
    } catch (error) {
      console.error('🗺️ Geocoding error:', error);
      Alert.alert('Error', 'Failed to geocode address. Please check your internet connection.');
    } finally {
      setIsGeocoding(false);
    }
  };

  const autoFillVenueDetails = async () => {
    const venueName = formData.name.trim();
    const address = formData.address.trim();
    
    if (!venueName && !address) {
      Alert.alert('Error', 'Please enter either a venue name or address to auto-fill details');
      return;
    }

    try {
      setIsAutoFilling(true);
      console.log('🔍 Auto-filling venue details:', { venueName, address });
      
      const response = await fetch(FETCH_VENUE_DETAILS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueName, address })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success) {
          console.log('🔍 Auto-fill successful:', data.venue);
          
          const venue = data.venue;
          
          // Update form data
          setFormData(prev => ({
            ...prev,
            name: venue.name || prev.name,
            address: venue.address || prev.address,
            latitude: venue.latitude ? venue.latitude.toString() : prev.latitude,
            longitude: venue.longitude ? venue.longitude.toString() : prev.longitude,
            contactNumber: venue.contactNumber || prev.contactNumber,
            googleMapLink: venue.googleMapLink || prev.googleMapLink,
            website: venue.website || prev.website,
            priceLevel: venue.priceLevel?.toString() || prev.priceLevel,
            rating: venue.rating?.toString() || prev.rating,
            userRatingsTotal: venue.userRatingsTotal?.toString() || prev.userRatingsTotal,
            ratingInfo: venue.ratingInfo || prev.ratingInfo,
            photoUrls: venue.photoUrls?.join(', ') || prev.photoUrls
          }));
          
          // Update opening hours if available
          if (venue.openingHours && Object.keys(venue.openingHours).length > 0) {
            setOpeningHours(venue.openingHours);
          }
          
          Alert.alert(
            'Venue Details Found!', 
            `✅ Successfully auto-filled venue details:\n\n• Name: ${venue.name}\n• Address: ${venue.address}\n• Phone: ${venue.contactNumber || 'Not available'}\n• Website: ${venue.website || 'Not available'}\n• Rating: ${venue.ratingInfo || 'Not available'}\n• Price Level: ${venue.priceLevel ? '$'.repeat(venue.priceLevel) + ` (${venue.priceLevel}/4)` : 'Not available'}\n• Photos: ${venue.photoUrls && venue.photoUrls.length > 0 ? `${venue.photoUrls.length} photos` : 'Not available'}\n• Opening Hours: ${venue.openingHours ? 'Loaded' : 'Not available'}`,
            [{ text: 'OK' }]
          );
        } else {
          console.error('🔍 Auto-fill failed:', data.error);
          Alert.alert('Auto-fill Failed', data.error || 'Could not find venue details');
        }
      } else {
        console.error('🔍 Auto-fill request failed:', response.status);
        Alert.alert('Error', 'Failed to auto-fill venue details. Please try again.');
      }
    } catch (error) {
      console.error('🔍 Auto-fill error:', error);
      Alert.alert('Error', 'Failed to auto-fill venue details. Please check your internet connection.');
    } finally {
      setIsAutoFilling(false);
    }
  };

  const toggleVenueExpansion = (venueId: string) => {
    setExpandedVenues(prev => {
      const newSet = new Set(prev);
      if (newSet.has(venueId)) {
        newSet.delete(venueId);
      } else {
        newSet.add(venueId);
      }
      return newSet;
    });
  };



  const renderVenue = ({ item }: { item: Venue }) => {
    const isExpanded = expandedVenues.has(item.id);
    const hasNameVariations = item.nameVariations && item.nameVariations.length > 0;
    const hasOpeningHours = item.openingHours && Object.keys(item.openingHours).length > 0;
    
    return (
      <ThemedView style={styles.venueItem}>
        <TouchableOpacity style={styles.venueHeaderCompact} onPress={() => toggleVenueExpansion(item.id)}>
          <ThemedText style={styles.venueName} numberOfLines={1}>
            {item.name}
          </ThemedText>
          <Ionicons 
            name={isExpanded ? 'chevron-up' : 'chevron-down'} 
            size={18} 
            color="#007AFF" 
          />
        </TouchableOpacity>
        
        {/* Collapsible Content Toggle handled by header */}
        
        {/* Collapsible Content */}
        {isExpanded && (
          <View style={styles.expandedContent}>
            {/* Actions moved to expanded area */}
            <View style={[styles.venueActions, { marginBottom: 8 }]}>
              <TouchableOpacity onPress={() => openEditModal(item)} style={styles.actionButton}>
                <Ionicons name="pencil" size={20} color="#007AFF" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  console.log('Delete icon pressed for', item.id, item.name);
                  deleteVenue(item);
                }}
                style={styles.actionButton}
              >
                <Ionicons name="trash" size={20} color="#ff4444" />
              </TouchableOpacity>
            </View>

            {/* Basic Info */}
            <View style={styles.venueInfo}>
              {/* Name Variations */}
              {hasNameVariations && (
                <View style={styles.nameVariationsInline}>
                  <ThemedText style={styles.nameVariationsLabel}>Also known as: </ThemedText>
                  <View style={styles.nameVariationsListInline}>
                    {item.nameVariations.map((variation, index) => (
                      <ThemedText key={index} style={styles.nameVariationInline}>
                        {variation}{index < item.nameVariations.length - 1 ? ', ' : ''}
                      </ThemedText>
                    ))}
                  </View>
                </View>
              )}

              <ThemedText style={styles.venueAddress}>{item.address}</ThemedText>
              {item.contactNumber && (
                <ThemedText style={styles.venueContact}>📞 {item.contactNumber}</ThemedText>
              )}
              <ThemedText style={styles.venueCoords}>
                📍 {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
              </ThemedText>
            </View>

            {/* Website */}
            {item.website && (
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Website:</ThemedText>
                <TouchableOpacity 
                  onPress={() => {
                    if (item.website) {
                      Linking.openURL(item.website);
                    }
                  }}
                >
                  <ThemedText style={[styles.infoValue, styles.clickableText]}>
                    {item.website} 🔗
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* Price Level */}
            {item.priceLevel !== undefined && item.priceLevel !== null && (
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Price Level:</ThemedText>
                <ThemedText style={styles.infoValue}>
                  {item.priceLevel >= 0 && item.priceLevel <= 4 ? '$'.repeat(item.priceLevel) : ''} ({item.priceLevel}/4)
                </ThemedText>
              </View>
            )}

            {/* Rating */}
            {item.ratingInfo && (
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Rating:</ThemedText>
                <TouchableOpacity 
                  onPress={() => {
                    if (item.googleMapLink) {
                      // Open the Google Maps link which will show reviews
                      Linking.openURL(item.googleMapLink);
                    }
                  }}
                  disabled={!item.googleMapLink}
                >
                  <ThemedText style={[styles.infoValue, item.googleMapLink && styles.clickableText]}>
                    {item.ratingInfo}
                    {item.googleMapLink && ' 🔗'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* Photos */}
            {item.photoUrls && item.photoUrls.length > 0 && (
              <View style={styles.photosContainer}>
                <ThemedText style={styles.photosLabel}>Photos ({item.photoUrls.length}):</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosScroll}>
                  {item.photoUrls.map((photoUrl, index) => (
                    <View key={index} style={styles.photoItem}>
                      <ThemedText style={styles.photoUrl} numberOfLines={2}>
                        {photoUrl}
                      </ThemedText>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {hasOpeningHours && (
              <View style={styles.openingHoursContainer}>
                <ThemedText style={styles.openingHoursLabel}>Opening Hours:</ThemedText>
                {DAYS_OF_WEEK.map(day => {
                  const hours = item.openingHours[day];
                  if (!hours) return null;
                  
                  let hoursText = '';
                  if (hours.closed) {
                    hoursText = 'Closed';
                  } else {
                    const hasOpen = hours.open && hours.open.trim();
                    const hasClose = hours.close && hours.close.trim();
                    
                    if (hasOpen && hasClose) {
                      hoursText = `${hours.open} - ${hours.close}`;
                    } else if (hasOpen) {
                      hoursText = `Opens at ${hours.open}`;
                    } else if (hasClose) {
                      hoursText = `Closes at ${hours.close}`;
                    } else {
                      hoursText = 'Open (no times specified)';
                    }
                  }
                  
                  return (
                    <View key={day} style={styles.dayRow}>
                      <ThemedText style={styles.dayName}>{day}:</ThemedText>
                      <ThemedText style={styles.dayHours}>{hoursText}</ThemedText>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ThemedView>
    );
  };

  // Export venues to Excel/CSV
  const handleExportVenues = async () => {
    try {
      const names = venues.map(v => v.name);
      const header = ['Venue Name'];
      const rows = [header, ...names.map(name => [name])];
      if (typeof window !== 'undefined' && XLSX) {
        // Web: Use SheetJS to create and download xlsx
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Venues');
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'venues.xlsx';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);
        Alert.alert('Success', 'Venues exported to Excel!');
      } else {
        // Native: Export as CSV and share
        const csv = rows.map(r => r.join(',')).join('\n');
        const fileUri = FileSystem.cacheDirectory + 'venues.csv';
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Venues' });
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to export venues.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Venues</ThemedText>
        <View style={styles.venuesHeaderButtonsRight}>
          {(!isViewMode && !isBulkMode) && (
            <MUIButton variant="contained" size="small" startIcon={<AddLocationAltIcon />} onClick={openAddModal}>Add Venue</MUIButton>
          )}
          <MUIButton variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportVenues}>Export to Excel</MUIButton>
          <Tooltip title="Refresh venues">
            <IconButton color="primary" size="small" onClick={() => { loadVenues(); }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </View>
      </ThemedView>

      {!isBulkMode && (
        <ThemedView style={styles.countContainer}>
          <ThemedText style={styles.countText}>
            Total Venues: {venues.length}
          </ThemedText>
        </ThemedView>
      )}

      {isBulkMode ? (
        <ThemedView style={{ margin: 16, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#eee' }}>
          <ThemedText>Bulk Add (coming soon)</ThemedText>
        </ThemedView>
      ) : isLoading ? (
        <ThemedView style={styles.loadingContainer}>
          <ThemedText>Loading venues...</ThemedText>
        </ThemedView>
      ) : venues.length === 0 ? (
        <ThemedView style={styles.emptyState}>
          <Ionicons name="location-outline" size={40} color="#888" />
          <ThemedText style={styles.emptyText}>No venues found. Add your first venue!</ThemedText>
        </ThemedView>
      ) : (
        <FlatList
          data={sortedVenues}
          renderItem={renderVenue}
          keyExtractor={item => item.id}
          scrollEnabled={false}
        />
      )}

      {/* Add/Edit Venue Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <ScrollView style={styles.modalContainer}>
          <ThemedView style={styles.modalHeader}>
            <ThemedText type="title">
              {editingVenue ? 'Edit Venue' : 'Add New Venue'}
            </ThemedText>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Basic Information</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="Venue Name *"
              value={formData.name}
              onChangeText={(text) => setFormData(prev => ({ ...prev, name: text }))}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Name Variations (comma-separated)"
              value={formData.nameVariations}
              onChangeText={(text) => setFormData(prev => ({ ...prev, nameVariations: text }))}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Address *"
              value={formData.address}
              onChangeText={(text) => setFormData(prev => ({ ...prev, address: text }))}
            />
            
            <TouchableOpacity 
              style={[styles.autoFillButton, isAutoFilling && styles.autoFillButtonDisabled]}
              onPress={autoFillVenueDetails}
              disabled={isAutoFilling}
            >
              <ThemedText style={styles.autoFillButtonText}>
                {isAutoFilling ? '🔍 Finding Venue Details...' : '🔍 Auto-Fill Venue Details'}
              </ThemedText>
            </TouchableOpacity>
            
            <TextInput
              style={styles.input}
              placeholder="Contact Number"
              value={formData.contactNumber}
              onChangeText={(text) => setFormData(prev => ({ ...prev, contactNumber: text }))}
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Location</ThemedText>
            
            <View style={styles.coordinatesRow}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="Latitude *"
                value={formData.latitude}
                onChangeText={(text) => setFormData(prev => ({ ...prev, latitude: text }))}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="Longitude *"
                value={formData.longitude}
                onChangeText={(text) => setFormData(prev => ({ ...prev, longitude: text }))}
                keyboardType="numeric"
              />
            </View>
            
            <TouchableOpacity 
              style={[styles.geocodeButton, isGeocoding && styles.geocodeButtonDisabled]}
              onPress={geocodeAddress}
              disabled={isGeocoding}
            >
              <ThemedText style={styles.geocodeButtonText}>
                {isGeocoding ? 'Getting Coordinates...' : '🗺️ Get Coordinates from Address'}
              </ThemedText>
            </TouchableOpacity>
            
            <TextInput
              style={styles.input}
              placeholder="Google Maps Link"
              value={formData.googleMapLink}
              onChangeText={(text) => setFormData(prev => ({ ...prev, googleMapLink: text }))}
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Website</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="Website"
              value={formData.website}
              onChangeText={(text) => setFormData(prev => ({ ...prev, website: text }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Instagram Usernames (comma-separated)"
              value={formData.instagramUsernames}
              onChangeText={(text) => setFormData(prev => ({ ...prev, instagramUsernames: text }))}
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Price Level</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="Price Level"
              value={formData.priceLevel}
              onChangeText={(text) => setFormData(prev => ({ ...prev, priceLevel: text }))}
              keyboardType="numeric"
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Rating</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="Rating"
              value={formData.rating}
              onChangeText={(text) => setFormData(prev => ({ ...prev, rating: text }))}
              keyboardType="numeric"
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>User Ratings Total</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="User Ratings Total"
              value={formData.userRatingsTotal}
              onChangeText={(text) => setFormData(prev => ({ ...prev, userRatingsTotal: text }))}
              keyboardType="numeric"
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Rating Info</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="Rating Info"
              value={formData.ratingInfo}
              onChangeText={(text) => setFormData(prev => ({ ...prev, ratingInfo: text }))}
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Photo URLs</ThemedText>
            
            <TextInput
              style={styles.input}
              placeholder="Photo URLs"
              value={formData.photoUrls}
              onChangeText={(text) => setFormData(prev => ({ ...prev, photoUrls: text }))}
            />
          </ThemedView>

          <ThemedView style={styles.formSection}>
            <ThemedText style={styles.sectionTitle}>Opening Hours</ThemedText>
            
            {DAYS_OF_WEEK.map(day => {
              const hours = openingHours[day];
              return (
                <View key={day} style={styles.dayContainer}>
                  <ThemedText style={styles.dayLabel}>{day}</ThemedText>
                  
                  <View style={styles.hoursRow}>
                    <TouchableOpacity
                      style={[styles.closedButton, hours.closed && styles.closedButtonActive]}
                      onPress={() => updateOpeningHours(day, 'closed', !hours.closed)}
                    >
                      <ThemedText style={[styles.closedButtonText, hours.closed && styles.closedButtonTextActive]}>
                        Closed
                      </ThemedText>
                    </TouchableOpacity>
                    
                    {!hours.closed && (
                      <>
                        <TextInput
                          style={styles.timeInput}
                          placeholder="Open time (optional)"
                          value={hours.open || ''}
                          onChangeText={(text) => updateOpeningHours(day, 'open', text)}
                        />
                        <ThemedText style={styles.timeSeparator}>to</ThemedText>
                        <TextInput
                          style={styles.timeInput}
                          placeholder="Close time (optional)"
                          value={hours.close || ''}
                          onChangeText={(text) => updateOpeningHours(day, 'close', text)}
                        />
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </ThemedView>

          <View style={styles.modalActions}>
            <Button title="Cancel" onPress={closeModal} />
            <Button title="Save" onPress={saveVenue} />
          </View>
        </ScrollView>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        animationType="fade"
        transparent={true}
        onRequestClose={cancelDelete}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmationModal}>
            <ThemedText style={styles.confirmationTitle}>Delete Venue</ThemedText>
            <ThemedText style={styles.confirmationMessage}>
              Are you sure you want to delete &quot;{venueToDelete?.name}&quot;?
            </ThemedText>
            <View style={styles.confirmationButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={cancelDelete}>
                <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete}>
                <ThemedText style={styles.deleteButtonText}>Delete</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Error Modal */}
      <Modal
        visible={showErrorModal}
        animationType="fade"
        transparent={true}
        onRequestClose={closeError}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmationModal}>
            <ThemedText style={styles.confirmationTitle}>Error</ThemedText>
            <ThemedText style={styles.confirmationMessage}>
              {errorMessage}
            </ThemedText>
            <TouchableOpacity style={styles.cancelButton} onPress={closeError}>
              <ThemedText style={styles.cancelButtonText}>OK</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  venuesHeaderButtonsRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    marginTop: 8,
    color: '#888',
    textAlign: 'center',
  },
  venueItem: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  venueHeaderCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  venueName: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 8,
  },
  venueActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
  },
  venueInfo: {
    flex: 1,
  },
  venueAddress: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  venueContact: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  venueCoords: {
    fontSize: 12,
    color: '#999',
  },
  variationsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  variationsLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  variationsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  variationItem: {
    fontSize: 12,
    color: '#666',
    marginRight: 8,
  },
  nameVariationsInline: {
    marginBottom: 4,
  },
  nameVariationsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  nameVariationsListInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  nameVariationInline: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  openingHoursContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  openingHoursLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  dayName: {
    fontSize: 12,
    fontWeight: '500',
  },
  dayHours: {
    fontSize: 12,
    color: '#666',
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  formSection: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  coordinatesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  halfInput: {
    flex: 1,
  },
  dayContainer: {
    marginBottom: 12,
  },
  dayLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closedButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
  },
  closedButtonActive: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
  },
  closedButtonText: {
    fontSize: 12,
    color: '#666',
  },
  closedButtonTextActive: {
    color: 'white',
  },
  timeInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    width: 80,
    textAlign: 'center',
  },
  timeSeparator: {
    fontSize: 12,
    color: '#666',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  geocodeButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#28a745',
    borderRadius: 8,
    backgroundColor: '#28a745',
    marginVertical: 8,
    alignItems: 'center',
  },
  geocodeButtonDisabled: {
    backgroundColor: '#ccc',
    borderColor: '#ccc',
  },
  geocodeButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  autoFillButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#28a745',
    borderRadius: 8,
    backgroundColor: '#28a745',
    marginVertical: 8,
    alignItems: 'center',
  },
  autoFillButtonDisabled: {
    backgroundColor: '#ccc',
    borderColor: '#ccc',
  },
  autoFillButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  expandedContent: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 14,
    color: '#666',
  },
  photosContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  photosLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  photosScroll: {
    padding: 8,
  },
  photoItem: {
    marginRight: 8,
  },
  photoUrl: {
    fontSize: 12,
    color: '#666',
  },
  clickableText: {
    color: '#007AFF',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  confirmationModal: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    width: '80%',
    alignItems: 'center',
  },
  confirmationTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  confirmationMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  confirmationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  cancelButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
  },
  deleteButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ff4444',
    borderRadius: 4,
    backgroundColor: '#ff4444',
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  cancelButtonText: {
    fontSize: 14,
    color: '#666',
  },
  countContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  countText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
}); 