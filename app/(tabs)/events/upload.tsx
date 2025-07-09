import { EventsTabNavigation } from '@/components/EventsTabNavigation';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Alert, Button, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

// Signed URL endpoints (deployed Cloud Functions / Cloud Run)
// HTTP endpoints - 2nd Gen Cloud Functions
const GENERATE_URL  = 'https://generateuploadurl-f3zapaqx6a-uc.a.run.app';
const EXTRACT_URL   = 'https://extractflyerinfo-f3zapaqx6a-uc.a.run.app';
const LOG_ERROR_URL = 'https://logerror-f3zapaqx6a-uc.a.run.app';
const SAVE_EVENT_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/saveEvent';

interface QueuedItem {
  id: string;
  uri: string;
  context: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
  result?: any;
  source?: 'instagram' | 'local';
  originalPost?: any;
}

interface SuccessfulUpload {
  id: string;
  uri: string;
  context: string;
  result: any;
  timestamp: Date;
}

interface FailedUpload {
  id: string;
  uri: string;
  context: string;
  error: string;
  timestamp: Date;
}

export default function UploadScreen() {
  const [queuedItems, setQueuedItems] = useState<QueuedItem[]>([]);
  const [successfulUploads, setSuccessfulUploads] = useState<SuccessfulUpload[]>([]);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'oneTime' | 'recurring'>('oneTime');
  
  // Recurring event state
  const [recurringImage, setRecurringImage] = useState<string | null>(null);
  const [recurringText, setRecurringText] = useState('');
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [isProcessingRecurring, setIsProcessingRecurring] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<{ [key: string]: boolean }>({});
  
  // Event details state
  const [eventName, setEventName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceCurrency, setPriceCurrency] = useState('USD');
  const [eventTags, setEventTags] = useState('');
  const [eventTime, setEventTime] = useState('');
  
  // Venue validation state
  const [isVenueValidated, setIsVenueValidated] = useState(false);
  const [isValidatingVenue, setIsValidatingVenue] = useState(false);
  const [venueValidationError, setVenueValidationError] = useState<string | null>(null);
  const [validatedVenue, setValidatedVenue] = useState<any>(null);

  const loadInstagramQueue = () => {
    console.log('📱 loadInstagramQueue called');
    
    if (typeof window !== 'undefined') {
      try {
        console.log('📱 Loading Instagram queue from localStorage...'); // Debug log
        const queueData = localStorage.getItem('uploadQueue');
        console.log('📱 Raw queue data from localStorage:', queueData); // Debug log
        if (queueData) {
          const parsedQueue = JSON.parse(queueData);
          console.log('📱 Parsed queue data:', parsedQueue); // Debug log
          if (parsedQueue.length > 0) {
            console.log('📱 Adding', parsedQueue.length, 'items to queue'); // Debug log
            setQueuedItems(prev => {
              const newQueue = [...prev, ...parsedQueue];
              console.log('📱 Queue updated after Instagram load - total items:', newQueue.length);
              return newQueue;
            });
            // Clear the localStorage after loading
            localStorage.removeItem('uploadQueue');
            console.log('📱 Cleared localStorage'); // Debug log
          } else {
            console.log('📱 No items in parsed queue');
          }
        } else {
          console.log('📱 No queue data in localStorage');
        }
      } catch (error) {
        console.error('📱 Failed to load Instagram queue:', error);
      }
    } else {
      console.log('📱 Window not available (not web platform)');
    }
  };

  useEffect(() => {
    console.log('🔄 UploadScreen useEffect triggered');
    console.log('🔄 Initial state:', {
      queuedItems: queuedItems.length,
      successfulUploads: successfulUploads.length,
      failedUploads: failedUploads.length,
      isProcessing
    });
    
    (async () => {
      if (Platform.OS !== 'web') {
        console.log('📱 Requesting media library permissions...');
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        console.log('📱 Permission status:', status);
        if (status !== 'granted') {
          console.log('📱 Permission denied - showing alert');
          Alert.alert(
            'Permission required',
            'Sorry, we need camera roll permissions to make this work!'
          );
        }
      } else {
        console.log('🌐 Web platform - no permissions needed');
      }
    })();
    
    // Load Instagram posts from queue if available
    console.log('📱 Loading Instagram queue...');
    loadInstagramQueue();
    
    console.log('🔄 UploadScreen useEffect completed');
  }, []);

  const pickImages = async () => {
    console.log('📸 pickImages called');
    
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    
    console.log('📸 Image picker result:', {
      canceled: result.canceled,
      assetsCount: result.assets?.length || 0
    });
    
    if (result.canceled || result.assets.length === 0) {
      console.log('📸 No images selected or picker canceled');
      return;
    }

    console.log('📸 Creating new items from selected assets...');
    const newItems: QueuedItem[] = result.assets.map((asset, index) => {
      const item: QueuedItem = {
        id: Math.random().toString(36).substr(2, 9),
        uri: asset.uri,
        context: '',
        status: 'pending' as const,
        source: 'local'
      };
      console.log(`📸 Created item ${index + 1}:`, item.id, 'URI:', asset.uri.substring(0, 50) + '...');
      return item;
    });

    console.log('📸 Adding', newItems.length, 'items to queue');
    setQueuedItems(prev => {
      const newQueue = [...prev, ...newItems];
      console.log('📸 Queue updated - total items:', newQueue.length);
      return newQueue;
    });
  };

  const updateItemContext = (id: string, context: string) => {
    console.log('✏️ Updating context for item:', id, 'Context:', context);
    setQueuedItems(prev => {
      const updated = prev.map(item => 
        item.id === id ? { ...item, context } : item
      );
      console.log('✏️ Queue updated - items with context:', updated.filter(item => item.context.length > 0).length);
      return updated;
    });
  };

  const removeQueuedItem = (id: string) => {
    console.log('🗑️ Removing item from queue:', id);
    setQueuedItems(prev => {
      const filtered = prev.filter(item => item.id !== id);
      console.log('🗑️ Queue updated - remaining items:', filtered.length);
      return filtered;
    });
  };

  const processSingleItem = async (item: QueuedItem): Promise<{ success: boolean; result?: any; error?: string; duplicate?: boolean; venueValidationError?: any }> => {
    console.log('🚀 Starting processSingleItem for:', item.id, 'URI:', item.uri.substring(0, 50) + '...');
    
    try {
      console.log('📥 Fetching file from URI...');
      const fileResponse = await fetch(item.uri);
      console.log('📥 File response status:', fileResponse.status, 'ok:', fileResponse.ok);
      
      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch file: ${fileResponse.status} ${fileResponse.statusText}`);
      }
      
      console.log('🔄 Converting to blob...');
      const blob = await fileResponse.blob();
      console.log('🔄 Blob created - size:', blob.size, 'type:', blob.type);
      
      // Convert blob to base64 for hashing
      console.log('🔢 Converting blob to base64 for hashing...');
      
      // Use FileReader for efficient base64 conversion
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the data URL prefix (e.g., "data:image/png;base64,")
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      
      console.log('🔢 Base64 conversion complete - length:', base64Data.length);
      
      // Get upload URL with image data for duplicate detection
      console.log('🌐 Requesting upload URL from:', GENERATE_URL);
      const genResp = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: blob.type || 'application/octet-stream',
          imageData: base64Data
        })
      });
      
      console.log('🌐 Generate URL response status:', genResp.status, 'ok:', genResp.ok);
      
      if (!genResp.ok) {
        const errText = await genResp.text().catch(() => genResp.statusText);
        console.error('❌ Generate URL failed:', genResp.status, errText);
        throw new Error(`Could not get upload URL: ${genResp.status} ${errText}`);
      }
      
      console.log('📄 Parsing generate URL response...');
      const genData = await genResp.json();
      console.log('📄 Generate URL response data:', genData);
      
      // Check if this is a duplicate
      if (genData.duplicate) {
        console.log('🔄 Duplicate detected:', genData.message);
        return { 
          success: false, 
          duplicate: true, 
          error: genData.message || 'Duplicate image detected',
          result: genData.existingEvent
        };
      }
      
      const { uploadUrl, path, imageHash } = genData;
      console.log('📤 Upload URL received - path:', path, 'hash:', imageHash);
      
      // Upload to storage
      console.log('☁️ Uploading to Firebase Storage...');
      const uploadResp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      });
      
      console.log('☁️ Upload response status:', uploadResp.status, 'ok:', uploadResp.ok);
      
      if (!uploadResp.ok) {
        const uploadErrorText = await uploadResp.text().catch(() => uploadResp.statusText);
        console.error('❌ Upload failed:', uploadResp.status, uploadErrorText);
        throw new Error(`Upload failed: ${uploadErrorText}`);
      }
      
      console.log('✅ Upload successful!');
      
      // Extract info with image hash
      console.log('🔍 Extracting info from:', EXTRACT_URL);
      const extractResp = await fetch(EXTRACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, context: item.context, imageHash }),
      });
      
      console.log('🔍 Extract response status:', extractResp.status, 'ok:', extractResp.ok);
      
      if (!extractResp.ok) {
        const errText = await extractResp.text().catch(() => extractResp.statusText);
        console.error('❌ Extraction failed:', extractResp.status, errText);
        throw new Error(`Extraction failed: ${extractResp.status} ${errText}`);
      }
      
      console.log('📄 Parsing extract response...');
      const data = await extractResp.json();
      console.log('📄 Extract response data:', data);
      
      // Always overwrite venue with canonical venue if available, regardless of match type
      console.log('Venue validation result:', data.venueValidation);
      console.log('Event data before canonicalization:', data.data);
      if (data.venueValidation && data.venueValidation.venue) {
        if (!data.data.venue) data.data.venue = {};
        data.data.venue.name = data.venueValidation.venue.name;
        data.data.venue.address = data.venueValidation.venue.address;
        data.data.venue.id = data.venueValidation.venue.id;
      }
      console.log('Event data after canonicalization:', data.data);
      
      // Save extracted data to database
      console.log('💾 Attempting to save extracted data to database...');
      const saveResp = await fetch(SAVE_EVENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.data), // Assuming data.data contains the event object
      });

      console.log('💾 Save to DB response status:', saveResp.status, 'ok:', saveResp.ok);
      if (!saveResp.ok) {
        const saveErrorText = await saveResp.text().catch(() => saveResp.statusText);
        console.error('❌ Failed to save to database:', saveResp.status, saveErrorText);
        throw new Error(`Failed to save event to database: ${saveErrorText}`);
      }
      console.log('✅ Data saved to database successfully!');

      // Check for venue validation errors
      if (data.venueValidation && !data.venueValidation.isValid) {
        console.log('❌ Venue validation failed:', data.venueValidation);
        return { 
          success: false, 
          error: data.venueValidation.error || 'Venue validation failed',
          venueValidationError: data.venueValidation
        };
      }
      
      // Check for general extraction errors
      if (data.error) {
        console.log('❌ Extraction error:', data.error);
        return { 
          success: false, 
          error: data.error 
        };
      }
      
      console.log('✅ processSingleItem completed successfully for:', item.id);
      return { success: true, result: data };
    } catch (error: any) {
      console.error('❌ processSingleItem failed for:', item.id, 'Error:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      return { success: false, error: error.message };
    }
  };

  const processAllItems = async () => {
    console.log('🎯 Starting processAllItems - queue length:', queuedItems.length);
    
    if (queuedItems.length === 0) {
      console.log('⚠️ No items to process');
      Alert.alert('No items to process');
      return;
    }

    console.log('🔄 Setting isProcessing to true');
    setIsProcessing(true);

    // Create a copy of the queue to avoid state mutation issues
    const itemsToProcess = [...queuedItems];
    console.log('📋 Created copy of queue with', itemsToProcess.length, 'items');
    
    // Clear the queue immediately to prevent double-processing
    console.log('🗑️ Clearing queue immediately');
    setQueuedItems([]);

    console.log('🔄 Starting to process', itemsToProcess.length, 'items...');
    
    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      console.log(`📦 Processing item ${i + 1}/${itemsToProcess.length}:`, item.id);
      
      const result = await processSingleItem(item);
      console.log(`📦 Item ${i + 1} result:`, result);
      
      if (result.success) {
        console.log(`✅ Item ${i + 1} succeeded - adding to successful uploads`);
        // Move to successful uploads
        setSuccessfulUploads(prev => {
          const newUploads = [...prev, {
            id: item.id,
            uri: item.uri,
            context: item.context,
            result: result.result,
            timestamp: new Date()
          }];
          console.log('📊 Successful uploads count:', newUploads.length);
          return newUploads;
        });
      } else if (result.duplicate) {
        console.log(`🔄 Item ${i + 1} is duplicate - adding to failed uploads`);
        // Handle duplicate - show in failed section with special message
        setFailedUploads(prev => {
          const newFailed = [...prev, {
            id: item.id,
            uri: item.uri,
            context: item.context,
            error: `Duplicate detected: ${result.result?.name || 'Event already exists'}`,
            timestamp: new Date()
          }];
          console.log('📊 Failed uploads count:', newFailed.length);
          return newFailed;
        });
      } else {
        console.log(`❌ Item ${i + 1} failed - adding to failed uploads`);
        // Move to failed uploads
        setFailedUploads(prev => {
          const newFailed = [...prev, {
            id: item.id,
            uri: item.uri,
            context: item.context,
            error: result.error || 'Unknown error',
            timestamp: new Date()
          }];
          console.log('📊 Failed uploads count:', newFailed.length);
          return newFailed;
        });
      }
    }

    console.log('🎯 processAllItems completed - setting isProcessing to false');
    setIsProcessing(false);
    console.log('✅ All items processed!');
  };

  const clearSuccessful = () => setSuccessfulUploads([]);
  const clearFailed = () => setFailedUploads([]);

  const retryFailedUpload = async (failedUpload: FailedUpload) => {
    // Create a queued item from the failed upload
    const retryItem: QueuedItem = {
      id: failedUpload.id,
      uri: failedUpload.uri,
      context: failedUpload.context,
      status: 'pending',
      source: 'local' // Default to local, could be enhanced to detect source
    };

    // Remove from failed uploads
    setFailedUploads(prev => prev.filter(upload => upload.id !== failedUpload.id));

    // Add to queue
    setQueuedItems(prev => [...prev, retryItem]);

    // Process the item
    const result = await processSingleItem(retryItem);
    
    if (result.success) {
      // Move to successful uploads
      setSuccessfulUploads(prev => [...prev, {
        id: retryItem.id,
        uri: retryItem.uri,
        context: retryItem.context,
        result: result.result,
        timestamp: new Date()
      }]);
    } else if (result.duplicate) {
      // Handle duplicate - show in failed section with special message
      setFailedUploads(prev => [...prev, {
        id: retryItem.id,
        uri: retryItem.uri,
        context: retryItem.context,
        error: `Duplicate detected: ${result.result?.name || 'Event already exists'}`,
        timestamp: new Date()
      }]);
    } else {
      // Move back to failed uploads
      setFailedUploads(prev => [...prev, {
        id: retryItem.id,
        uri: retryItem.uri,
        context: retryItem.context,
        error: result.error || 'Retry failed',
        timestamp: new Date()
      }]);
    }

    // Remove from queue
    setQueuedItems(prev => prev.filter(item => item.id !== retryItem.id));
  };

  const retryAllFailed = async () => {
    if (failedUploads.length === 0) {
      Alert.alert('No failed uploads to retry');
      return;
    }

    Alert.alert(
      'Retry All Failed',
      `Retry ${failedUploads.length} failed uploads?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Retry All', 
          onPress: async () => {
            // Create a copy of failed uploads to avoid state mutation issues
            const uploadsToRetry = [...failedUploads];
            
            // Clear all failed uploads first to avoid state conflicts
            setFailedUploads([]);
            
            // Process all failed uploads sequentially
            for (const failedUpload of uploadsToRetry) {
              // Create a queued item from the failed upload
              const retryItem: QueuedItem = {
                id: failedUpload.id,
                uri: failedUpload.uri,
                context: failedUpload.context,
                status: 'pending',
                source: 'local' // Default to local, could be enhanced to detect source
              };

              // Add to queue
              setQueuedItems(prev => [...prev, retryItem]);

              // Process the item
              const result = await processSingleItem(retryItem);
              
              if (result.success) {
                // Move to successful uploads
                setSuccessfulUploads(prev => [...prev, {
                  id: retryItem.id,
                  uri: retryItem.uri,
                  context: retryItem.context,
                  result: result.result,
                  timestamp: new Date()
                }]);
              } else if (result.duplicate) {
                // Handle duplicate - show in failed section with special message
                setFailedUploads(prev => [...prev, {
                  id: retryItem.id,
                  uri: retryItem.uri,
                  context: retryItem.context,
                  error: `Duplicate detected: ${result.result?.name || 'Event already exists'}`,
                  timestamp: new Date()
                }]);
              } else {
                // Move back to failed uploads
                setFailedUploads(prev => [...prev, {
                  id: retryItem.id,
                  uri: retryItem.uri,
                  context: retryItem.context,
                  error: result.error || 'Retry failed',
                  timestamp: new Date()
                }]);
              }

              // Remove from queue
              setQueuedItems(prev => prev.filter(item => item.id !== retryItem.id));
            }
          }
        }
      ]
    );
  };

  const clearAllState = () => {
    console.log('🧹 Clearing all state...');
    setQueuedItems([]);
    setSuccessfulUploads([]);
    setFailedUploads([]);
    setIsProcessing(false);
    console.log('🧹 All state cleared');
  };

  // Debug function to log current state
  const logCurrentState = () => {
    console.log('📊 Current State:', {
      queuedItems: queuedItems.map(item => ({ id: item.id, uri: item.uri.substring(0, 30) + '...' })),
      successfulUploads: successfulUploads.map(upload => ({ id: upload.id, result: upload.result?.data?.name || 'No name' })),
      failedUploads: failedUploads.map(upload => ({ id: upload.id, error: upload.error?.substring(0, 50) })),
      isProcessing
    });
  };

  // Recurring event functions
  const pickRecurringImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      allowsMultipleSelection: false,
    });
    
    if (!result.canceled && result.assets.length > 0) {
      setRecurringImage(result.assets[0].uri);
    }
  };

  const toggleDateSelection = (date: Date) => {
    const dateString = date.toDateString();
    setSelectedDates(prev => {
      const isSelected = prev.some(d => d.toDateString() === dateString);
      if (isSelected) {
        return prev.filter(d => d.toDateString() !== dateString);
      } else {
        return [...prev, date];
      }
    });
  };

  const toggleMonthExpansion = (monthName: string) => {
    setExpandedMonths(prev => ({
      ...prev,
      [monthName]: !prev[monthName]
    }));
  };

  const validateVenue = async () => {
    if (!venueName.trim()) {
      setVenueValidationError('Please enter a venue name first');
      return;
    }

    setIsValidatingVenue(true);
    setVenueValidationError(null);
    
    try {
      const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/checkVen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueName: venueName.trim() })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setValidatedVenue(data.venue);
        setIsVenueValidated(true);
        setVenueValidationError(null);
        // Update venue address if found
        if (data.venue && data.venue.address && !venueAddress.trim()) {
          setVenueAddress(data.venue.address);
        }
      } else {
        setVenueValidationError(data.error || 'Venue not found. Please add it to the Venues tab first.');
        setIsVenueValidated(false);
        setValidatedVenue(null);
      }
    } catch (error) {
      console.error('Error validating venue:', error);
      setVenueValidationError('Failed to validate venue. Please try again.');
      setIsVenueValidated(false);
      setValidatedVenue(null);
    } finally {
      setIsValidatingVenue(false);
    }
  };

  const processRecurringEvents = async () => {
    if (!eventName.trim() || !venueName.trim() || !recurringText.trim() || selectedDates.length === 0 || !isVenueValidated) {
      Alert.alert('Error', 'Please provide event name, venue name, description, select at least one date, and validate the venue.');
      return;
    }

    setIsProcessingRecurring(true);
    
    try {
      let baseEvent = null;
      
      if (recurringImage) {
        // Process the image first to extract event info
        const imageItem: QueuedItem = {
          id: Math.random().toString(36).substr(2, 9),
          uri: recurringImage,
          context: recurringText,
          status: 'pending',
          source: 'local'
        };

        const result = await processSingleItem(imageItem);
        
        if (result.success && result.result) {
          baseEvent = result.result;
          // Override extracted data with user input
          baseEvent.name = eventName;
          baseEvent.venue.name = venueName;
          baseEvent.venue.address = venueAddress;
        } else {
          Alert.alert('Error', 'Failed to process image. Please try again or create event with text only.');
          setIsProcessingRecurring(false);
          return;
        }
      } else {
        // Create a complete event structure from form data
        baseEvent = {
          name: eventName,
          date: {
            start: new Date().toISOString(),
            end: new Date().toISOString()
          },
          venue: {
            name: venueName,
            address: venueAddress
          },
          pricing: {
            min: priceMin ? parseFloat(priceMin) : 0,
            max: priceMax ? parseFloat(priceMax) : 0,
            currency: priceCurrency
          },
          tags: eventTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0),
          source: {
            platform: 'Manual',
            url: '',
            scrapedAt: new Date().toISOString()
          },
          searchText: recurringText,
          rawText: recurringText,
          extractedText: recurringText,
          context: recurringText
        };
      }
      
      // Create events for each selected date
      const createdEvents = [];
      
      for (const date of selectedDates) {
        // Parse event time if provided
        let startTime = new Date(date);
        let endTime = new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1000); // End of day
        
        if (eventTime.trim()) {
          try {
            const [hours, minutes] = eventTime.split(':').map(Number);
            startTime.setHours(hours, minutes, 0, 0);
            endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // Default 2 hour duration
          } catch (error) {
            console.warn('Invalid time format, using default times');
          }
        }
        
        const eventData = {
          ...baseEvent,
          id: `recurring-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: {
            start: startTime.toISOString(),
            end: endTime.toISOString()
          },
          isRecurring: true,
          recurringGroupId: `group-${Date.now()}`,
          recurringText: recurringText,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        // Save to Firestore
        console.log('Attempting to save event to Firestore:', eventData);
        const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/saveEvent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData)
        });
        console.log('Response from saveEvent function:', response.status, response.ok);
        
        if (response.ok) {
          createdEvents.push(eventData);
        }
      }
      
      Alert.alert(
        'Success', 
        `Created ${createdEvents.length} recurring events for the selected dates.`
      );
      
      // Reset form
      setRecurringImage(null);
      setRecurringText('');
      setSelectedDates([]);
      setEventName('');
      setVenueName('');
      setVenueAddress('');
      setPriceMin('');
      setPriceMax('');
      setPriceCurrency('USD');
      setEventTags('');
      setEventTime('');
      setIsVenueValidated(false);
      setValidatedVenue(null);
      setVenueValidationError(null);
      
    } catch (error) {
      console.error('Error processing recurring events:', error);
      Alert.alert('Error', 'Failed to create recurring events. Please try again.');
    } finally {
      setIsProcessingRecurring(false);
    }
  };

  const generateCalendarDays = () => {
    const months = [];
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // Generate current month and next 2 months
    for (let month = 0; month < 3; month++) {
      const monthDate = new Date(currentYear, currentMonth + month, 1);
      const daysInMonth = new Date(currentYear, currentMonth + month + 1, 0).getDate();
      const monthName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      const days = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth + month, day);
        if (date >= today) { // Only show future dates
          days.push(date);
        }
      }
      
      months.push({
        name: monthName,
        days: days,
        isExpanded: month === 0 // Current month expanded by default
      });
    }
    
    return months;
  };

  return (
    <ScrollView style={styles.container}>
      <EventsTabNavigation activeTab="upload" />
      
      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'oneTime' && styles.activeTab]}
          onPress={() => setActiveTab('oneTime')}
        >
          <ThemedText style={[styles.tabText, activeTab === 'oneTime' && styles.activeTabText]}>
            One Time Events
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'recurring' && styles.activeTab]}
          onPress={() => setActiveTab('recurring')}
        >
          <ThemedText style={[styles.tabText, activeTab === 'recurring' && styles.activeTabText]}>
            Recurring Events
          </ThemedText>
        </TouchableOpacity>
      </View>

      {activeTab === 'oneTime' ? (
        // One Time Events Tab
        <>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Batch Upload</ThemedText>
            <View style={styles.headerButtons}>
              <Button title="Add Images" onPress={pickImages} />
              <Button 
                title={isProcessing ? "Processing..." : "Process All"} 
                onPress={processAllItems}
                disabled={isProcessing || queuedItems.length === 0}
              />
            </View>
            <View style={styles.headerButtons}>
              <Button title="Debug State" onPress={logCurrentState} />
              <Button title="Clear All" onPress={clearAllState} />
            </View>
          </ThemedView>

          {/* Queue Section */}
          <ThemedView style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle">Queue ({queuedItems.length})</ThemedText>
              <View style={styles.queueActions}>
                <TouchableOpacity onPress={loadInstagramQueue}>
                  <ThemedText style={styles.actionButton}>Refresh</ThemedText>
                </TouchableOpacity>
                {queuedItems.length > 0 && (
                  <TouchableOpacity onPress={() => setQueuedItems([])}>
                    <ThemedText style={styles.clearButton}>Clear All</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            
            {queuedItems.length === 0 ? (
              <ThemedView style={styles.emptyState}>
                <Ionicons name="cloud-upload-outline" size={40} color="#888" />
                <ThemedText style={styles.emptyText}>Drag images here or tap "Add Images"</ThemedText>
              </ThemedView>
            ) : (
              queuedItems.map(item => (
                <View key={item.id} style={[
                  styles.queuedItem,
                  item.source === 'instagram' && styles.instagramItem
                ]}>
                  <View style={styles.itemHeader}>
                    <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                    <View style={styles.itemInfo}>
                      {item.source === 'instagram' && item.originalPost && (
                        <View style={styles.instagramInfo}>
                          <View style={styles.sourceIndicator}>
                            <ThemedText style={styles.sourceText}>📸 Instagram</ThemedText>
                          </View>
                          <ThemedText style={styles.instagramProfile}>
                            @{item.originalPost.profile}
                          </ThemedText>
                          <ThemedText style={styles.instagramStats}>
                            ❤️ {item.originalPost.likes} 💬 {item.originalPost.comments}
                          </ThemedText>
                        </View>
                      )}
                      {item.source !== 'instagram' && (
                        <View style={styles.sourceIndicator}>
                          <ThemedText style={styles.sourceText}>📁 Local</ThemedText>
                        </View>
                      )}
                    </View>
                    <View style={styles.itemActions}>
                      <TouchableOpacity onPress={() => removeQueuedItem(item.id)}>
                        <Ionicons name="close-circle" size={24} color="#ff4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TextInput
                    style={styles.contextInput}
                    placeholder={item.source === 'instagram' ? "Add context for this Instagram post..." : "Add context for this image..."}
                    value={item.context}
                    onChangeText={(text) => updateItemContext(item.id, text)}
                    multiline
                    numberOfLines={2}
                  />
                </View>
              ))
            )}
          </ThemedView>

          {/* Successful Uploads Section */}
          <ThemedView style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle">Successful ({successfulUploads.length})</ThemedText>
              {successfulUploads.length > 0 && (
                <TouchableOpacity onPress={clearSuccessful}>
                  <ThemedText style={styles.clearButton}>Clear</ThemedText>
                </TouchableOpacity>
              )}
            </View>
            
            {successfulUploads.map(upload => (
              <View key={upload.id} style={styles.resultItem}>
                <Image source={{ uri: upload.uri }} style={styles.thumbnail} />
                <View style={styles.resultContent}>
                  <ThemedText style={styles.resultTitle}>
                    {upload.result?.data?.name ? upload.result.data.name : 'Event extracted'}
                  </ThemedText>
                  {upload.context && (
                    <ThemedText style={styles.resultContext}>Context: {upload.context}</ThemedText>
                  )}
                  <ThemedText style={styles.resultTime}>
                    {upload.timestamp.toLocaleTimeString()}
                  </ThemedText>
                </View>
              </View>
            ))}
          </ThemedView>

          {/* Failed Uploads Section */}
          <ThemedView style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle">Failed ({failedUploads.length})</ThemedText>
              <View style={styles.queueActions}>
                {failedUploads.length > 0 && (
                  <>
                    <TouchableOpacity onPress={retryAllFailed}>
                      <ThemedText style={styles.actionButton}>Retry All</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={clearFailed}>
                      <ThemedText style={styles.clearButton}>Clear</ThemedText>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            
            {failedUploads.map(upload => (
              <View key={upload.id} style={styles.resultItem}>
                <Image source={{ uri: upload.uri }} style={styles.thumbnail} />
                <View style={styles.resultContent}>
                  <View style={styles.itemHeader}>
                    <ThemedText style={
                      upload.error?.includes('Duplicate detected') ? styles.duplicateTitle : 
                      upload.error?.includes('Venue') || upload.error?.includes('venue') ? styles.venueErrorTitle :
                      styles.errorTitle
                    }>
                      {upload.error?.includes('Duplicate detected') ? 'Duplicate Detected' : 
                       upload.error?.includes('Venue') || upload.error?.includes('venue') ? 'Venue Not Found' :
                       'Upload Failed'}
                    </ThemedText>
                    <TouchableOpacity onPress={() => retryFailedUpload(upload)}>
                      <ThemedText style={styles.actionButton}>Retry</ThemedText>
                    </TouchableOpacity>
                  </View>
                  {upload.context && (
                    <ThemedText style={styles.resultContext}>Context: {upload.context}</ThemedText>
                  )}
                  <ThemedText style={
                    upload.error?.includes('Duplicate detected') ? styles.duplicateText : 
                    upload.error?.includes('Venue') || upload.error?.includes('venue') ? styles.venueErrorText :
                    styles.errorText
                  }>
                    {upload.error || 'Unknown error'}
                  </ThemedText>
                </View>
              </View>
            ))}
          </ThemedView>
        </>
      ) : (
        // Recurring Events Tab
        <>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Recurring Events</ThemedText>
            <ThemedText style={styles.subtitle}>
              Upload an image and select dates to create multiple events
            </ThemedText>
          </ThemedView>

          {/* Image Upload Section */}
          <ThemedView style={styles.section}>
            <ThemedText type="subtitle">Event Image (Optional)</ThemedText>
            {recurringImage ? (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: recurringImage }} style={styles.imagePreview} />
                <TouchableOpacity 
                  style={styles.changeImageButton}
                  onPress={pickRecurringImage}
                >
                  <ThemedText style={styles.changeImageText}>Change Image</ThemedText>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.uploadImageButton}
                onPress={pickRecurringImage}
              >
                <Ionicons name="cloud-upload-outline" size={40} color="#888" />
                <ThemedText style={styles.uploadImageText}>Select Event Image (Optional)</ThemedText>
              </TouchableOpacity>
            )}
          </ThemedView>

          {/* Text Input Section */}
          <ThemedView style={styles.section}>
            <ThemedText type="subtitle">Event Details</ThemedText>
            
            {/* Event Name */}
            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Event Name *</ThemedText>
              <TextInput
                style={styles.formInput}
                placeholder="Enter event name..."
                value={eventName}
                onChangeText={setEventName}
              />
            </View>

            {/* Venue Information */}
            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Venue Name *</ThemedText>
              <View style={styles.venueRow}>
                <TextInput
                  style={[styles.formInput, styles.venueInput]}
                  placeholder="Enter venue name..."
                  value={venueName}
                  onChangeText={(text) => {
                    setVenueName(text);
                    setIsVenueValidated(false);
                    setVenueValidationError(null);
                  }}
                />
                <TouchableOpacity
                  style={[
                    styles.validateVenueButton,
                    (!venueName.trim() || isValidatingVenue) && styles.disabledButton
                  ]}
                  onPress={validateVenue}
                  disabled={!venueName.trim() || isValidatingVenue}
                >
                  <ThemedText style={styles.validateVenueButtonText}>
                    {isValidatingVenue ? 'Validating...' : 'Get Venue'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
              
              {/* Venue validation status */}
              {isVenueValidated && validatedVenue && (
                <View style={styles.venueSuccess}>
                  <ThemedText style={styles.venueSuccessText}>
                    ✅ Venue found: {validatedVenue.name}
                  </ThemedText>
                </View>
              )}
              
              {venueValidationError && (
                <View style={styles.venueError}>
                  <ThemedText style={styles.venueErrorText}>
                    ❌ {venueValidationError}
                  </ThemedText>
                </View>
              )}
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Venue Address</ThemedText>
              <TextInput
                style={styles.formInput}
                placeholder="Enter venue address..."
                value={venueAddress}
                onChangeText={setVenueAddress}
              />
            </View>

            {/* Pricing Information */}
            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Pricing</ThemedText>
              <View style={styles.pricingRow}>
                <TextInput
                  style={[styles.formInput, styles.priceInput]}
                  placeholder="Min price"
                  value={priceMin}
                  onChangeText={setPriceMin}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.formInput, styles.priceInput]}
                  placeholder="Max price"
                  value={priceMax}
                  onChangeText={setPriceMax}
                  keyboardType="numeric"
                />
                <View style={styles.currencyContainer}>
                  <TextInput
                    style={[styles.formInput, styles.currencyInput]}
                    placeholder="USD"
                    value={priceCurrency}
                    onChangeText={setPriceCurrency}
                  />
                </View>
              </View>
            </View>

            {/* Event Time */}
            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Event Time (HH:MM)</ThemedText>
              <TextInput
                style={styles.formInput}
                placeholder="e.g., 19:30 for 7:30 PM"
                value={eventTime}
                onChangeText={setEventTime}
              />
            </View>

            {/* Tags */}
            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Tags (comma-separated)</ThemedText>
              <TextInput
                style={styles.formInput}
                placeholder="music, live, concert, etc."
                value={eventTags}
                onChangeText={setEventTags}
              />
            </View>

            {/* Description */}
            <View style={styles.formField}>
              <ThemedText style={styles.fieldLabel}>Event Description *</ThemedText>
              <TextInput
                style={[styles.formInput, styles.textArea]}
                placeholder="Enter event description, details, or additional context..."
                value={recurringText}
                onChangeText={setRecurringText}
                multiline
                numberOfLines={4}
              />
            </View>
          </ThemedView>

          {/* Calendar Section */}
          <ThemedView style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle">Select Dates ({selectedDates.length})</ThemedText>
              {selectedDates.length > 0 && (
                <TouchableOpacity onPress={() => setSelectedDates([])}>
                  <ThemedText style={styles.clearButton}>Clear All</ThemedText>
                </TouchableOpacity>
              )}
            </View>
            
            <View style={styles.calendarContainer}>
              {generateCalendarDays().map((month, index) => {
                const isExpanded = expandedMonths[month.name] !== undefined 
                  ? expandedMonths[month.name] 
                  : month.isExpanded;
                
                return (
                  <View key={index} style={styles.monthContainer}>
                    <TouchableOpacity 
                      style={styles.monthHeader}
                      onPress={() => toggleMonthExpansion(month.name)}
                    >
                      <ThemedText style={styles.monthTitle}>{month.name}</ThemedText>
                      <ThemedText style={styles.expandIcon}>
                        {isExpanded ? '▼' : '▶'}
                      </ThemedText>
                    </TouchableOpacity>
                    
                    {isExpanded && (
                      <View style={styles.monthDays}>
                        {month.days.map((date, dayIndex) => {
                          const isSelected = selectedDates.some(d => d.toDateString() === date.toDateString());
                          const isToday = date.toDateString() === new Date().toDateString();
                          
                          return (
                            <TouchableOpacity
                              key={`${index}-${dayIndex}`}
                              style={[
                                styles.calendarDay,
                                isSelected && styles.selectedDay,
                                isToday && styles.today
                              ]}
                              onPress={() => toggleDateSelection(date)}
                            >
                              <ThemedText style={[
                                styles.calendarDayText,
                                isSelected && styles.selectedDayText,
                                isToday && styles.todayText
                              ]}>
                                {date.getDate()}
                              </ThemedText>
                              <ThemedText style={[
                                styles.calendarDayLabel,
                                isSelected && styles.selectedDayText
                              ]}>
                                {date.toLocaleDateString('en-US', { weekday: 'short' })}
                              </ThemedText>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ThemedView>

          {/* Process Button */}
          <ThemedView style={styles.section}>
            <TouchableOpacity
              style={[
                styles.processRecurringButton,
                (!eventName.trim() || !venueName.trim() || !recurringText.trim() || selectedDates.length === 0 || !isVenueValidated) && styles.disabledButton
              ]}
              onPress={processRecurringEvents}
              disabled={!eventName.trim() || !venueName.trim() || !recurringText.trim() || selectedDates.length === 0 || !isVenueValidated || isProcessingRecurring}
            >
              {isProcessingRecurring ? (
                <ThemedText style={styles.processButtonText}>Creating Events...</ThemedText>
              ) : (
                <ThemedText style={styles.processButtonText}>
                  Create {selectedDates.length} Event{selectedDates.length !== 1 ? 's' : ''}
                </ThemedText>
              )}
            </TouchableOpacity>
          </ThemedView>
        </>
      )}
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
  section: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  clearButton: {
    color: '#ff4444',
    fontSize: 14,
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
  queuedItem: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 4,
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contextInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
    textAlignVertical: 'top',
  },
  resultItem: {
    flexDirection: 'row',
    marginBottom: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 4,
  },
  resultContent: {
    flex: 1,
    marginLeft: 12,
  },
  resultTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  errorTitle: {
    fontWeight: 'bold',
    color: '#ff4444',
    marginBottom: 4,
  },
  resultContext: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#ff4444',
    marginBottom: 4,
  },
  duplicateTitle: {
    fontWeight: 'bold',
    color: '#ff8800',
    marginBottom: 4,
  },
  duplicateText: {
    fontSize: 12,
    color: '#ff8800',
    marginBottom: 4,
  },
  resultTime: {
    fontSize: 10,
    color: '#999',
  },
  instagramItem: {
    backgroundColor: '#f0f0f0',
  },
  instagramInfo: {
    flexDirection: 'column',
    gap: 4,
  },
  instagramProfile: {
    fontWeight: 'bold',
  },
  instagramStats: {
    fontSize: 12,
    color: '#666',
  },
  sourceIndicator: {
    padding: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
  },
  sourceText: {
    fontSize: 10,
    color: '#666',
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    color: '#007AFF',
    fontSize: 14,
  },
  venueErrorTitle: {
    fontWeight: 'bold',
    color: '#ff4444',
    marginBottom: 4,
  },
  venueErrorText: {
    fontSize: 12,
    color: '#ff4444',
    marginBottom: 4,
  },
  venueHelpText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    fontStyle: 'italic',
  },
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
  tab: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
  },
  activeTab: {
    borderColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  activeTabText: {
    color: '#007AFF',
  },
  imagePreviewContainer: {
    alignItems: 'center',
    padding: 16,
  },
  imagePreview: {
    width: 200,
    height: 200,
    borderRadius: 8,
  },
  changeImageButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
  },
  changeImageText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  uploadImageButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
  },
  uploadImageText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  recurringTextInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
    textAlignVertical: 'top',
  },
  calendarContainer: {
    padding: 12,
  },
  monthContainer: {
    marginBottom: 16,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  monthTitle: {
    fontWeight: 'bold',
  },
  expandIcon: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  monthDays: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: 12,
  },
  calendarDay: {
    width: '14.28%',
    padding: 8,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 4,
    marginBottom: 4,
  },
  selectedDay: {
    backgroundColor: '#007AFF',
  },
  today: {
    backgroundColor: '#f0f0f0',
  },
  calendarDayText: {
    fontWeight: 'bold',
  },
  calendarDayLabel: {
    fontSize: 10,
    marginTop: 2,
  },
  selectedDayText: {
    color: '#fff',
  },
  todayText: {
    color: '#666',
  },
  processRecurringButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  disabledButton: {
    backgroundColor: '#ddd',
  },
  processButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  formField: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
  },
  pricingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceInput: {
    flex: 1,
  },
  currencyContainer: {
    width: 80,
  },
  currencyInput: {
    width: '100%',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  venueInput: {
    flex: 1,
  },
  validateVenueButton: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
  },
  validateVenueButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  venueSuccess: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
  },
  venueSuccessText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  venueError: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ff4444',
    borderRadius: 8,
  },
});