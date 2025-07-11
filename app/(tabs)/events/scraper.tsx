import { EventsTabNavigation } from '@/components/EventsTabNavigation';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Button, Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const START_SCRAPER_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/startInstagramScraper';
const GET_RUNS_LIST_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunsList';
const ADD_USERNAME_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/addUsername';
const DELETE_USERNAME_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteUsername';
const LIST_USERNAMES_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/listUsernames';
const DELETE_APIFY_RUN_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteApifyRun';

interface ApifyRun {
  runId: string;
  datasetId: string;
  status: 'initiated' | 'running' | 'succeeded' | 'failed';
  initiatedAt: string;
  completedAt?: string;
  instagramUsernames: string;
  numberOfPosts: number;
  error?: string;
  scrapedData?: any[];
}

// Polyfill EventSource for React Native and web
let EventSourceImpl: any = undefined;
if (typeof window !== 'undefined' && window.EventSource) {
  EventSourceImpl = window.EventSource;
} else {
  try {
    EventSourceImpl = require('react-native-event-source');
  } catch (e) {
    // Not available, will error if used on native without install
  }
}

export default function ScraperScreen() {
  const [instagramUsernames, setInstagramUsernames] = useState('');
  const [numberOfPosts, setNumberOfPosts] = useState('10');
  const [startDate, setStartDate] = useState(''); // This will store the formatted date string
  const [selectedDate, setSelectedDate] = useState(new Date()); // Actual Date object for picker
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [apifyRuns, setApifyRuns] = useState<ApifyRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernames, setUsernames] = useState<string[]>([]); // List of IG usernames
  const [isAddingUsername, setIsAddingUsername] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [selectedRun, setSelectedRun] = useState<ApifyRun | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [pollingLogs, setPollingLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isManualPollLoading, setIsManualPollLoading] = useState(false);
  const [isPollingLogsExpanded, setIsPollingLogsExpanded] = useState(false);
  const [scrapedData, setScrapedData] = useState<any[]>([]);
  const [isScrapedDataLoading, setIsScrapedDataLoading] = useState(false);
  const [currentPostIndex, setCurrentPostIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [postDecisions, setPostDecisions] = useState<{[key: number]: 'accept' | 'reject' | null}>({});
  const [processingResults, setProcessingResults] = useState<any>(null);
  const [postErrors, setPostErrors] = useState<{[key: number]: string}>({});
  const [imageLoadErrors, setImageLoadErrors] = useState<{[key: string]: boolean | string}>({});
  const [imageLoadSuccess, setImageLoadSuccess] = useState<{[key: string]: boolean}>({});
  const [isPostDecisionLoading, setIsPostDecisionLoading] = useState(false);
  const [isProcessingPostsLoading, setIsProcessingPostsLoading] = useState(false);
  const [liveProcessingStatus, setLiveProcessingStatus] = useState<any[]>([]); // For SSE events
  const [liveSummary, setLiveSummary] = useState<any>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  const fetchApifyRuns = useCallback(async () => {
    setIsLoadingRuns(true);
    try {
      const response = await fetch(GET_RUNS_LIST_URL);
      const data = await response.json();
      if (response.ok && data.success) {
        setApifyRuns(data.runs);
      } else {
        console.error('Failed to fetch Apify runs:', data.error);
        Alert.alert('Error', data.error || 'Failed to fetch Apify runs.');
      }
    } catch (error: any) {
      console.error('Network error fetching Apify runs:', error);
      Alert.alert('Error', `Network error fetching Apify runs: ${error.message}`);
    } finally {
      setIsLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    fetchApifyRuns();
  }, [fetchApifyRuns]);

  // Fetch usernames from backend
  const fetchUsernames = useCallback(async () => {
    try {
      const response = await fetch(LIST_USERNAMES_URL);
      const data = await response.json();
      if (response.ok && data.success) {
        setUsernames(data.usernames);
      } else {
        setUsernames([]);
      }
    } catch (e) {
      setUsernames([]);
    }
  }, []);

  useEffect(() => {
    fetchUsernames();
  }, [fetchUsernames]);

  // Add username via backend
  const handleAddUsername = async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    if (usernames.includes(trimmed)) {
      Alert.alert('Duplicate', 'This username is already added.');
      return;
    }
    setIsAddingUsername(true);
    try {
      const response = await fetch(ADD_USERNAME_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setUsernameInput('');
        fetchUsernames();
      } else {
        Alert.alert('Error', data.error || 'Failed to add username.');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to add username.');
    } finally {
      setIsAddingUsername(false);
    }
  };

  // Remove username via backend
  const handleDeleteUsername = async (username: string) => {
    try {
      const response = await fetch(DELETE_USERNAME_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        fetchUsernames();
      } else {
        Alert.alert('Error', data.error || 'Failed to delete username.');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to delete username.');
    }
  };

  // Delete Apify run and its contents
  const handleDeleteApifyRun = async (runId: string) => {
    const message = `Are you sure you want to delete this run and all its scraped data? This action cannot be undone.`;
    
    let shouldDelete = false;
    
    if (Platform.OS === 'web') {
      shouldDelete = window.confirm(message);
    } else {
      // For native platforms, we'll need to implement a different approach
      // For now, let's just proceed without confirmation on native
      shouldDelete = true;
    }

    if (shouldDelete) {
      setDeletingRunId(runId);
      try {
        const response = await fetch(DELETE_APIFY_RUN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        });
        const data = await response.json();
        if (response.ok && data.success) {
          // Remove the run from the local state
          setApifyRuns(prev => prev.filter(run => run.runId !== runId));
          
          // If the deleted run was the selected run, close the modal
          if (selectedRun && selectedRun.runId === runId) {
            setModalVisible(false);
            setSelectedRun(null);
          }
          
          Alert.alert('Success', 'Run deleted successfully.');
        } else {
          Alert.alert('Error', data.error || 'Failed to delete run.');
        }
      } catch (e) {
        Alert.alert('Error', 'Failed to delete run.');
      } finally {
        setDeletingRunId(null);
      }
    }
  };

  // Helper to get ISO string for 25 hours ago
  function get25HoursAgoISOString() {
    const now = new Date();
    now.setHours(now.getHours() - 25);
    return now.toISOString().slice(0, 19) + 'Z';
  }

  // On Start Scraper, send all usernames as comma-separated string
  const handleScrape = async () => {
    if (usernames.length === 0) {
      Alert.alert('Error', 'Please add at least one Instagram username.');
      return;
    }
    setIsScraping(true);
    setScrapeResult(null);
    setScrapeError(null);
    const payload = {
      instagramUsernames: usernames.join(','),
      startDate: get25HoursAgoISOString(),
    };
    console.log('Sending to startInstagramScraper:', payload);
    try {
      const response = await fetch(START_SCRAPER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      console.log('Received from startInstagramScraper:', data);
      if (response.ok && data.success) {
        setScrapeResult(`Scraping initiated! Run ID: ${data.runId}`);
        Alert.alert('Success', `Scraping initiated! Run ID: ${data.runId}`);
        fetchApifyRuns();
      } else {
        setScrapeError(data.error || 'Failed to initiate scraping.');
        Alert.alert('Error', data.error || 'Failed to initiate scraping.');
      }
    } catch (error: any) {
      setScrapeError(`Network error: ${error.message}`);
      Alert.alert('Error', `Network error: ${error.message}`);
    } finally {
      setIsScraping(false);
    }
  };

  // Split runs into pending and completed
  const pendingRuns = apifyRuns.filter(run => run.status === 'initiated' || run.status === 'running');
  const completedRuns = apifyRuns.filter(run => ['COMPLETED', 'succeeded', 'failed'].includes(run.status));

  // Fetch polling logs from Firestore
  const fetchPollingLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const response = await fetch('https://firestore.googleapis.com/v1/projects/discovery-1e94e/databases/(default)/documents/pollingLogs?pageSize=10&orderBy=timestamp desc');
      const data = await response.json();
      if (data.documents) {
        setPollingLogs(data.documents.map((doc: any) => ({
          id: doc.name.split('/').pop(),
          ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]: [string, any]) => [k, v.stringValue || v.arrayValue?.values?.map((x:any) => x.stringValue || x.mapValue?.fields || x) || v.integerValue || v.doubleValue || v.booleanValue || v.timestampValue || null]))
        })));
      } else {
        setPollingLogs([]);
      }
    } catch (e) {
      setPollingLogs([]);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    fetchPollingLogs();
  }, [fetchPollingLogs]);

  useFocusEffect(
    useCallback(() => {
      fetchPollingLogs();
    }, [fetchPollingLogs])
  );

  // Function to manually trigger polling
  const handleManualPoll = async () => {
    setIsManualPollLoading(true);
    try {
      // Call a new HTTPS endpoint to trigger polling (to be implemented in backend)
      const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/manualPollApifyRuns', {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        Alert.alert('Error', data.error || 'Failed to trigger polling.');
      } else {
        Alert.alert('Success', 'Polling triggered successfully.');
        fetchPollingLogs();
        fetchApifyRuns();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to trigger polling.');
    } finally {
      setIsManualPollLoading(false);
    }
  };

  // Function to delete a polling log entry
  const handleDeletePollLog = async (logId: string) => {
    try {
      const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deletePollingLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        Alert.alert('Error', data.error || 'Failed to delete polling log.');
      } else {
        fetchPollingLogs();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to delete polling log.');
    }
  };

  const fetchScrapedData = async (runId: string, datasetId: string) => {
    setIsScrapedDataLoading(true);
    try {
      const response = await fetch(
        'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunResults',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, datasetId }),
        }
      );
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setScrapedData(data.data);
        // Reset all state when fetching new data
        setCurrentPostIndex(0);
        setCurrentImageIndex(0);
        setPostDecisions({});
        setPostErrors({});
        setImageLoadErrors({});
        setImageLoadSuccess({});
        setProcessingResults(null);
      } else {
        setScrapedData([]);
      }
    } catch (e) {
      setScrapedData([]);
    } finally {
      setIsScrapedDataLoading(false);
    }
  };

  useEffect(() => {
    if (modalVisible && selectedRun && selectedRun.runId && selectedRun.datasetId) {
      fetchScrapedData(selectedRun.runId, selectedRun.datasetId);
    } else {
      setScrapedData([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalVisible, selectedRun]);

  // Filter out error/no-data entries from scrapedData before using it
  const filteredScrapedData = scrapedData.filter(
    post => !post.error && (post.id || post.shortcode)
  );

  // Map from filtered index to originalIndex for backend
  const filteredOriginalIndexes = filteredScrapedData.map(post => post.originalIndex);

  // Helper functions for post navigation
  const goToNextPost = () => {
    if (currentPostIndex < filteredScrapedData.length - 1) {
      setCurrentPostIndex(currentPostIndex + 1);
      setCurrentImageIndex(0);
    }
  };

  const goToPreviousPost = () => {
    if (currentPostIndex > 0) {
      setCurrentPostIndex(currentPostIndex - 1);
      setCurrentImageIndex(0);
    }
  };

  const goToNextImage = () => {
    const currentPost = filteredScrapedData[currentPostIndex];
    const images = getPostImages(currentPost);
    if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };

  const goToPreviousImage = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  const getPostImages = (post: any): string[] => {
    const images: string[] = [];
    if (post.displayUrl) images.push(post.displayUrl);
    if (post.thumbnailUrl && !images.includes(post.thumbnailUrl)) images.push(post.thumbnailUrl);
    if (post.images && Array.isArray(post.images)) {
      post.images.forEach((img: any) => {
        if (img.url && !images.includes(img.url)) images.push(img.url);
      });
    }
    return images;
  };

  const handlePostDecision = (decision: 'accept' | 'reject') => {
    setIsPostDecisionLoading(true);
    setPostDecisions(prev => {
      const updated = { ...prev, [currentPostIndex]: decision };
      if (currentPostIndex < filteredScrapedData.length - 1) {
        setTimeout(() => {
          setCurrentPostIndex(currentPostIndex + 1);
          setIsPostDecisionLoading(false);
        }, 300);
      } else {
        setTimeout(() => setIsPostDecisionLoading(false), 300);
      }
      return updated;
    });
  };

  const handleProcessPosts = async () => {
    console.log('🎯 handleProcessPosts function called!');
    const acceptedPosts = filteredScrapedData.filter((_, index) => postDecisions[index] === 'accept');
    const rejectedPosts = filteredScrapedData.filter((_, index) => postDecisions[index] === 'reject');
    const unprocessedPosts = filteredScrapedData.filter((_, index) => !postDecisions[index]);
    const message = `Accepted: ${acceptedPosts.length}\nRejected: ${rejectedPosts.length}\nUnprocessed: ${unprocessedPosts.length}\n\nWould you like to process the accepted posts?`;
    let shouldProcess = false;
    if (Platform.OS === 'web') {
      shouldProcess = window.confirm(message);
    } else {
      shouldProcess = true;
    }
    if (!shouldProcess) return;
    setIsProcessingPostsLoading(true);
    setLiveProcessingStatus([]);
    setLiveSummary(null);
    try {
      // Prepare decisions array in order of scrapedData
      const decisionsArr = filteredScrapedData.map((_, idx) =>
        postDecisions[idx] === 'accept' ? 'accept' : postDecisions[idx] === 'reject' ? 'reject' : null
      );
      // Send originalIndex with each post
      const postsWithIndex = filteredScrapedData.map((post, idx) => ({ ...post, originalIndex: post.originalIndex }));
      const requestPayload = { posts: postsWithIndex, decisions: decisionsArr };
      const backendUrl = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/processInstagramPosts';
      if (Platform.OS === 'web') {
        // Web: Use fetch/POST, no SSE
        const response = await fetch(backendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
        const result = await response.json();
        setLiveSummary(result.results);
        setIsProcessingPostsLoading(false);
      } else {
        // Native: Use SSE
        const eventSource = new EventSourceImpl(backendUrl, {
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify(requestPayload),
          method: 'POST',
        });
        let statusUpdates: any[] = [];
        eventSource.onmessage = (event: any) => {
          // Default event
          console.log('SSE message:', event.data);
        };
        eventSource.addEventListener('rejected', (event: any) => {
          const data = JSON.parse(event.data);
          statusUpdates.push({ type: 'rejected', ...data });
          setLiveProcessingStatus([...statusUpdates]);
        });
        eventSource.addEventListener('processed', (event: any) => {
          const data = JSON.parse(event.data);
          statusUpdates.push({ type: 'processed', ...data });
          setLiveProcessingStatus([...statusUpdates]);
        });
        eventSource.addEventListener('error', (event: any) => {
          const data = JSON.parse(event.data);
          statusUpdates.push({ type: 'error', ...data });
          setLiveProcessingStatus([...statusUpdates]);
        });
        eventSource.addEventListener('summary', (event: any) => {
          const data = JSON.parse(event.data);
          setLiveSummary(data);
          setIsProcessingPostsLoading(false);
          eventSource.close();
        });
      }
    } catch (err) {
      setIsProcessingPostsLoading(false);
      let msg = 'Error during processing.';
      if (err && typeof err === 'object' && 'message' in err) {
        msg = (err as any).message;
      }
      alert('Error during processing: ' + msg);
    }
  };

  const handleSummaryOk = () => {
    if (liveSummary && liveSummary.errors) {
      // Get failed post indexes
      const failedIndexes = (liveSummary.errors || []).map((e: { postIndex: number }) => e.postIndex);
      // Keep posts that failed OR were not processed (no decision)
      const remainingPosts = filteredScrapedData.filter((_, idx) =>
        failedIndexes.includes(idx) || !postDecisions[idx]
      );
      // Store error messages for failed posts
      const newPostErrors: {[key: number]: string} = {};
      (liveSummary.errors || []).forEach((error: { postIndex: number, error: string }) => {
        newPostErrors[error.postIndex] = error.error;
      });
      setPostErrors(newPostErrors);
      setScrapedData(remainingPosts);
      // Clear decisions for remaining posts and reset navigation
      const newDecisions: {[key: number]: 'accept' | 'reject' | null} = {};
      remainingPosts.forEach((_, idx) => {
        newDecisions[idx] = null;
      });
      setPostDecisions(newDecisions);
      setCurrentPostIndex(0);
      setCurrentImageIndex(0);
    }
    setLiveSummary(null);
  };

  return (
    <ScrollView style={styles.container}>
      <EventsTabNavigation activeTab="scraper" />

      <ThemedView style={styles.header}>
        <ThemedText type="title">Instagram Scraper</ThemedText>
        <ThemedText style={styles.subtitle}>
          Scrape public Instagram posts using Apify.
        </ThemedText>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText style={styles.fieldLabel}>Instagram Usernames</ThemedText>
        {/* List usernames with delete icon */}
        {usernames.length > 0 && (
          <View style={{ marginBottom: 8 }}>
            {usernames.map((username) => (
              <View key={username} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <ThemedText style={{ flex: 1 }}>{username}</ThemedText>
                <TouchableOpacity onPress={() => handleDeleteUsername(username)}>
                  <Ionicons name="close-circle" size={20} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        {/* Username input and Add Now button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <TextInput
            value={usernameInput}
            onChangeText={setUsernameInput}
            placeholder="Instagram username"
            style={[styles.input, { flex: 1 }]}
            editable={!isAddingUsername}
          />
          <TouchableOpacity
            onPress={handleAddUsername}
            style={[styles.addButton, { backgroundColor: '#007AFF' }]}
            disabled={isAddingUsername}
          >
            {isAddingUsername ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <ThemedText style={{ color: '#fff' }}>Add Now</ThemedText>
            )}
          </TouchableOpacity>
        </View>
      </ThemedView>

      {/* Remove or hide Start Date and Time input section */}
      {/* <ThemedView style={styles.section}>
        <ThemedText style={styles.fieldLabel}>Start Date and Time</ThemedText>
        {Platform.OS === 'web' ? (
          <input
            type="datetime-local"
            value={selectedDate.toISOString().slice(0, 16)}
            disabled
            style={styles.webDatePicker as any}
          />
        ) : (
          <TouchableOpacity style={[styles.datePickerButton, { opacity: 0.5 }]} disabled>
            <ThemedText>{selectedDate.toLocaleString()}</ThemedText>
          </TouchableOpacity>
        )}
        <DateTimePickerModal
          isVisible={false} // Always hidden
          mode="datetime"
          onConfirm={() => {}}
          onCancel={() => {}}
          date={selectedDate}
        />
      </ThemedView> */}

      <ThemedView style={styles.section}>
        <ThemedText style={styles.fieldLabel}>Number of Posts</ThemedText>
        <TextInput
          value={numberOfPosts}
          onChangeText={setNumberOfPosts}
          placeholder="Number of posts"
          style={styles.formInput}
          keyboardType="numeric"
        />
      </ThemedView>

      <ThemedView style={styles.section}>
        <Button
          title={isScraping ? "Scraping..." : "Start Scraper"}
          onPress={handleScrape}
          disabled={isScraping}
        />
        {scrapeResult && <ThemedText style={styles.resultText}>Result: {scrapeResult}</ThemedText>}
        {scrapeError && <ThemedText style={styles.errorText}>Error: {scrapeError}</ThemedText>}
      </ThemedView>

      <ThemedView style={styles.section}>
        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'pending' && styles.activeTabButton]}
            onPress={() => setActiveTab('pending')}
          >
            <ThemedText style={activeTab === 'pending' ? styles.activeTabText : undefined}>Pending Scraping Runs</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'completed' && styles.activeTabButton]}
            onPress={() => setActiveTab('completed')}
          >
            <ThemedText style={activeTab === 'completed' ? styles.activeTabText : undefined}>Completed Scraper Runs</ThemedText>
          </TouchableOpacity>
        </View>
        {activeTab === 'pending' ? (
          isLoadingRuns ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : pendingRuns.length === 0 ? (
            <ThemedText>No pending runs.</ThemedText>
          ) : (
            pendingRuns.map(run => (
              <View key={run.runId} style={styles.runItem}>
                <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
                <ThemedText>Status: {run.status}</ThemedText>
                <ThemedText>Initiated: {new Date(run.initiatedAt).toLocaleString()}</ThemedText>
                {run.error && <ThemedText style={styles.errorText}>Error: {run.error}</ThemedText>}
              </View>
            ))
          )
        ) : (
          isLoadingRuns ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : completedRuns.length === 0 ? (
            <ThemedText>No completed runs.</ThemedText>
          ) : (
            completedRuns.map(run => (
              <View key={run.runId} style={styles.runItem}>
                <TouchableOpacity
                  style={styles.runContent}
                  onPress={() => { setSelectedRun(run); setModalVisible(true); }}
                >
                  <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
                  <ThemedText>Status: {run.status}</ThemedText>
                  <ThemedText>Initiated: {new Date(run.initiatedAt).toLocaleString()}</ThemedText>
                  {run.completedAt && <ThemedText>Completed: {new Date(run.completedAt).toLocaleString()}</ThemedText>}
                  {run.error && <ThemedText style={styles.errorText}>Error: {run.error}</ThemedText>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteApifyRun(run.runId)}
                  disabled={deletingRunId === run.runId}
                >
                  {deletingRunId === run.runId ? (
                    <ActivityIndicator size="small" color="#ff4444" />
                  ) : (
                    <Ionicons name="trash-outline" size={20} color="#ff4444" />
                  )}
                </TouchableOpacity>
              </View>
            ))
          )
        )}
        <Button title="Refresh Runs" onPress={fetchApifyRuns} />
      </ThemedView>

      {/* Modal for completed run details */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 20, width: '90%', maxHeight: '90%' }}>
            <TouchableOpacity style={{ alignSelf: 'flex-end' }} onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            { (isPostDecisionLoading || isProcessingPostsLoading) ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
                <ActivityIndicator size="large" color="#007AFF" />
                <ThemedText style={{ marginTop: 10 }}>
                  {isProcessingPostsLoading ? 'Processing posts...' : 'Loading next post...'}
                </ThemedText>
              </View>
            ) : selectedRun && (
              <View style={{ flex: 1 }}>
                {/* Run Info Header */}
                <View style={{ marginBottom: 20 }}>
                  <ThemedText style={styles.runIdText}>Run ID: {selectedRun.runId}</ThemedText>
                  <ThemedText>Status: {selectedRun.status}</ThemedText>
                  <ThemedText>Initiated: {new Date(selectedRun.initiatedAt).toLocaleString()}</ThemedText>
                  {selectedRun.completedAt && <ThemedText>Completed: {new Date(selectedRun.completedAt).toLocaleString()}</ThemedText>}
                  {selectedRun.error && <ThemedText style={styles.errorText}>Error: {selectedRun.error}</ThemedText>}
                </View>

                {/* Post Navigation and Content */}
                {isScrapedDataLoading ? (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <ThemedText style={{ marginTop: 10 }}>Loading scraped data...</ThemedText>
                  </View>
                ) : filteredScrapedData.length > 0 ? (
                  <View style={{ flex: 1 }}>
                    {/* Post Counter */}
                    <ThemedText style={{ textAlign: 'center', marginBottom: 10, fontWeight: 'bold' }}>
                      Post {currentPostIndex + 1} of {filteredScrapedData.length}
                    </ThemedText>

                    {/* Post Navigation Arrows */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                      <TouchableOpacity
                        onPress={goToPreviousPost}
                        disabled={currentPostIndex === 0}
                        style={[styles.navButton, currentPostIndex === 0 && styles.disabledButton]}
                      >
                        <Ionicons name="chevron-back" size={24} color={currentPostIndex === 0 ? "#ccc" : "#007AFF"} />
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        onPress={goToNextPost}
                        disabled={currentPostIndex === filteredScrapedData.length - 1}
                        style={[styles.navButton, currentPostIndex === filteredScrapedData.length - 1 && styles.disabledButton]}
                      >
                        <Ionicons name="chevron-forward" size={24} color={currentPostIndex === filteredScrapedData.length - 1 ? "#ccc" : "#007AFF"} />
                      </TouchableOpacity>
                    </View>

                    {/* Current Post Content */}
                    <ScrollView style={{ flex: 1, marginBottom: 10 }}>
                      {(() => {
                        const currentPost = filteredScrapedData[currentPostIndex];
                        const images = getPostImages(currentPost);
                        
                        return (
                          <View>
                            {/* Image Carousel */}
                            {images.length > 0 && (
                              <View style={styles.imageContainer}>
                                <View style={styles.imageWrapper}>
                                  {imageLoadErrors[images[currentImageIndex]] ? (
                                    <View style={styles.imageErrorContainer}>
                                      <Ionicons name="image-outline" size={48} color="#ccc" />
                                      <ThemedText style={styles.imageErrorText}>
                                        Image not available
                                      </ThemedText>
                                      <ThemedText style={styles.imageErrorSubtext}>
                                        {typeof imageLoadErrors[images[currentImageIndex]] === 'string' && imageLoadErrors[images[currentImageIndex]]}
                                        {typeof imageLoadErrors[images[currentImageIndex]] !== 'string' && '(CORS restricted or failed to load)'}
                                      </ThemedText>
                                    </View>
                                  ) : !imageLoadSuccess[images[currentImageIndex]] ? (
                                    // Show loader while image is loading
                                    <ImageLoaderWithTimeout
                                      imageUrl={images[currentImageIndex]}
                                      onLoad={() => setImageLoadSuccess(prev => ({ ...prev, [images[currentImageIndex]]: true }))}
                                      onError={(errMsg) => setImageLoadErrors(prev => ({ ...prev, [images[currentImageIndex]]: errMsg || true }))}
                                    >
                                      {Platform.OS === 'web' ? (
                                        <img
                                          src={`https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(images[currentImageIndex])}`}
                                          alt="Instagram post"
                                          style={styles.image}
                                          onError={() => setImageLoadErrors(prev => ({ ...prev, [images[currentImageIndex]]: 'Failed to load image' }))}
                                          onLoad={() => setImageLoadSuccess(prev => ({ ...prev, [images[currentImageIndex]]: true }))}
                                        />
                                      ) : (
                                        <Image
                                          source={{
                                            uri: `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(images[currentImageIndex])}`
                                          }}
                                          style={styles.image}
                                          onError={(e) => setImageLoadErrors(prev => ({ ...prev, [images[currentImageIndex]]: (e?.nativeEvent?.error || 'Failed to load image') }))}
                                          onLoad={() => setImageLoadSuccess(prev => ({ ...prev, [images[currentImageIndex]]: true }))}
                                        />
                                      )}
                                    </ImageLoaderWithTimeout>
                                  ) : (
                                    <View style={styles.imageDisplayContainer}>
                                      {Platform.OS === 'web' ? (
                                        <img
                                          src={`https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(images[currentImageIndex])}`}
                                          alt="Instagram post"
                                          style={styles.image}
                                        />
                                      ) : (
                                        <Image
                                          source={{
                                            uri: `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(images[currentImageIndex])}`
                                          }}
                                          style={styles.image}
                                        />
                                      )}
                                    </View>
                                  )}
                                </View>
                                
                                {/* Image Navigation */}
                                {images.length > 1 && (
                                  <View style={styles.imageNavigation}>
                                    <TouchableOpacity
                                      onPress={goToPreviousImage}
                                      disabled={currentImageIndex === 0}
                                      style={[styles.imageNavButton, currentImageIndex === 0 && styles.disabledButton]}
                                    >
                                      <Ionicons name="chevron-back" size={20} color={currentImageIndex === 0 ? "#ccc" : "#007AFF"} />
                                    </TouchableOpacity>
                                    
                                    {/* Image Dots */}
                                    <View style={styles.imageDots}>
                                      {images.map((_, index) => (
                                        <View
                                          key={index}
                                          style={[
                                            styles.dot,
                                            index === currentImageIndex && styles.activeDot
                                          ]}
                                        />
                                      ))}
                                    </View>
                                    
                                    <TouchableOpacity
                                      onPress={goToNextImage}
                                      disabled={currentImageIndex === images.length - 1}
                                      style={[styles.imageNavButton, currentImageIndex === images.length - 1 && styles.disabledButton]}
                                    >
                                      <Ionicons name="chevron-forward" size={20} color={currentImageIndex === images.length - 1 ? "#ccc" : "#007AFF"} />
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            )}

                            {/* Show post id for debugging */}
                            <View style={{ alignItems: 'center', marginVertical: 6 }}>
                              <ThemedText style={{ color: '#888', fontSize: 14 }}>
                                post id: {currentPost.id || currentPost.shortcode || 'N/A'}
                              </ThemedText>
                            </View>

                            {/* Post Text */}
                            <View style={styles.postTextContainer}>
                              <ThemedText style={styles.postText}>
                                {currentPost.caption || currentPost.text || 'No text content'}
                              </ThemedText>
                            </View>

                            {/* Post Metadata */}
                            <View style={styles.postMetadata}>
                              <ThemedText style={styles.metadataText}>
                                Username: {currentPost.ownerUsername || 'Unknown'}
                              </ThemedText>
                              <ThemedText style={styles.metadataText}>
                                Posted: {currentPost.timestamp ? new Date(currentPost.timestamp).toLocaleString() : 'Unknown date'}
                              </ThemedText>
                              {currentPost.likesCount && (
                                <ThemedText style={styles.metadataText}>
                                  Likes: {currentPost.likesCount}
                                </ThemedText>
                              )}
                              {currentPost.commentsCount && (
                                <ThemedText style={styles.metadataText}>
                                  Comments: {currentPost.commentsCount}
                                </ThemedText>
                              )}
                            </View>
                            
                            {/* Error message for failed posts */}
                            {postErrors[currentPostIndex] && (
                              <View style={styles.errorContainer}>
                                <Text style={styles.errorTitle}>❌ Processing Failed</Text>
                                <Text style={styles.errorMessage}>{postErrors[currentPostIndex]}</Text>
                              </View>
                            )}
                          </View>
                        );
                      })()}
                    </ScrollView>

                    {/* Fixed Decision Buttons */}
                    <View style={styles.decisionButtons}>
                      <TouchableOpacity
                        style={[
                          styles.decisionButton,
                          styles.rejectButton,
                          postDecisions[currentPostIndex] === 'reject' && styles.selectedRejectButton
                        ]}
                        onPress={() => handlePostDecision('reject')}
                      >
                        <Ionicons 
                          name="close-circle" 
                          size={20} 
                          color={postDecisions[currentPostIndex] === 'reject' ? '#ff4444' : '#fff'} 
                        />
                        <ThemedText 
                          style={[
                            styles.decisionButtonText,
                            { color: postDecisions[currentPostIndex] === 'reject' ? '#ff4444' : '#fff' }
                          ]}
                        >
                          Reject
                        </ThemedText>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={[
                          styles.decisionButton,
                          styles.acceptButton,
                          postDecisions[currentPostIndex] === 'accept' && styles.selectedAcceptButton
                        ]}
                        onPress={() => handlePostDecision('accept')}
                      >
                        <Ionicons 
                          name="checkmark-circle" 
                          size={20} 
                          color={postDecisions[currentPostIndex] === 'accept' ? '#007AFF' : '#fff'} 
                        />
                        <ThemedText 
                          style={[
                            styles.decisionButtonText,
                            { color: postDecisions[currentPostIndex] === 'accept' ? '#007AFF' : '#fff' }
                          ]}
                        >
                          Accept
                        </ThemedText>
                      </TouchableOpacity>
                    </View>

                    {/* Process Posts Button */}
                    <View style={styles.processButtonContainer}>
                      <TouchableOpacity
                        style={styles.processButton}
                        onPress={handleProcessPosts}
                      >
                        <ThemedText style={styles.processButtonText}>Process Posts</ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ThemedText>No scraped data found.</ThemedText>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Polling Logs Section */}
      <ThemedView style={styles.section}>
        <TouchableOpacity onPress={() => setIsPollingLogsExpanded(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <ThemedText type="subtitle" style={{ flex: 1 }}>Polling History (Last 10 Polls)</ThemedText>
          <ThemedText style={{ color: '#007AFF', fontWeight: 'bold' }}>{isPollingLogsExpanded ? 'Collapse' : 'Expand'}</ThemedText>
        </TouchableOpacity>
        {isPollingLogsExpanded && (
          isLoadingLogs ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : pollingLogs.length === 0 ? (
            <ThemedText>No polling logs found.</ThemedText>
          ) : (
            pollingLogs.map(log => (
              <View key={log.id} style={styles.pollLogItem}>
                <ThemedText style={{ fontWeight: 'bold' }}>{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown time'}</ThemedText>
                <ThemedText>Checked: {log.checkedRunIds ? log.checkedRunIds.length : 0}</ThemedText>
                <ThemedText>Completed: {log.completedRunIds ? log.completedRunIds.length : 0}</ThemedText>
                <ThemedText>Failed: {log.failedRunIds ? log.failedRunIds.length : 0}</ThemedText>
                {log.errors && log.errors.length > 0 && (
                  <ThemedText style={{ color: 'red' }}>Errors: {JSON.stringify(log.errors)}</ThemedText>
                )}
                <TouchableOpacity
                  style={{ marginTop: 6, alignSelf: 'flex-end', backgroundColor: '#ff4444', padding: 6, borderRadius: 6 }}
                  onPress={() => handleDeletePollLog(log.id)}
                >
                  <ThemedText style={{ color: '#fff' }}>Delete</ThemedText>
                </TouchableOpacity>
              </View>
            ))
          )
        )}
        <Button title="Refresh Polling Logs" onPress={fetchPollingLogs} />
        <View style={{ marginTop: 10 }}>
          <Button
            title={isManualPollLoading ? 'Triggering Poll...' : 'Trigger Poll Now'}
            onPress={handleManualPoll}
            disabled={isManualPollLoading}
          />
        </View>
      </ThemedView>

      {/* Live Processing Status and Summary Modal */}
      <Modal
        visible={isProcessingPostsLoading || liveSummary !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={handleSummaryOk}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 20, width: '90%', maxHeight: '90%' }}>
            <TouchableOpacity style={{ alignSelf: 'flex-end' }} onPress={handleSummaryOk}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <ThemedText style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 10 }}>Processing Status</ThemedText>
            {isProcessingPostsLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#007AFF" />
                <ThemedText style={{ marginTop: 10 }}>Processing posts...</ThemedText>
              </View>
            ) : liveSummary ? (
              <ScrollView style={{ maxHeight: '70%' }}>
                <View style={{ marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 10 }}>Processing Summary</ThemedText>
                  <ThemedText>Total Posts: {(liveSummary.processed || 0) + (liveSummary.deleted || 0) + (liveSummary.failed || 0)}</ThemedText>
                  <ThemedText>Accepted: {liveSummary.successful || 0}</ThemedText>
                  <ThemedText>Rejected: {liveSummary.deleted || 0}</ThemedText>
                  <ThemedText>Failed to Process: {liveSummary.failed || 0}</ThemedText>
                  <ThemedText>Total Errors: {(liveSummary.errors && liveSummary.errors.length) || 0}</ThemedText>
                  {/* Optionally, show error details */}
                  {liveSummary.errors && liveSummary.errors.length > 0 && (
                    <View style={{ marginTop: 10 }}>
                      <ThemedText style={{ fontWeight: 'bold' }}>Errors:</ThemedText>
                      {liveSummary.errors.map((e: any, idx: number) => (
                        <ThemedText key={idx} style={{ color: 'red' }}>• {e.error}</ThemedText>
                      ))}
                    </View>
                  )}
                  <TouchableOpacity
                    style={{ marginTop: 20, alignSelf: 'center', backgroundColor: '#007AFF', padding: 12, borderRadius: 8 }}
                    onPress={handleSummaryOk}
                  >
                    <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>OK</ThemedText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function ImageLoaderWithTimeout({ imageUrl, onLoad, onError, children }: {
  imageUrl: string;
  onLoad: () => void;
  onError: (errMsg: string) => void;
  children: React.ReactElement;
}) {
  const timeoutRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    timeoutRef.current = window.setTimeout(() => {
      onError && onError('Image load timed out');
    }, 10000); // 10 seconds
    return () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    };
  }, [imageUrl, onError]);
  // If image loads or errors, clear the timeout
  const handleLoad = () => {
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    onLoad && onLoad();
  };
  const handleError = (e: any) => {
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    // Try to extract error message from event
    let errMsg = 'Failed to load image';
    if (e && typeof e === 'object') {
      if (e.nativeEvent && e.nativeEvent.error) errMsg = e.nativeEvent.error;
      else if (e.type === 'error') errMsg = 'Image failed to load (event)';
    }
    onError && onError(errMsg);
  };
  // For <img> (web), inject only valid props (onload/onerror, cast as any)
  if (Platform.OS === 'web' && children.type === 'img') {
    return React.cloneElement(children as React.ReactElement<HTMLImageElement>, {
      onload: handleLoad as any,
      onerror: handleError as any,
    });
  }
  // For <Image> (native), inject only valid props
  if (Platform.OS !== 'web' && typeof children.type === 'function' && children.type.name === 'Image') {
    return React.cloneElement(children, {
      onLoad: handleLoad,
      onError: handleError,
    } as any);
  }
  return children;
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
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  section: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
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
  datePickerButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  resultText: {
    marginTop: 10,
    color: 'green',
  },
  errorText: {
    marginTop: 10,
    color: 'red',
  },
  runItem: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  runContent: {
    flex: 1,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 10,
  },
  runIdText: {
    fontWeight: 'bold',
  },
  scrapedDataContainer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
  },
  scrapedDataItem: {
    marginBottom: 5,
  },
  scrapedDataTitle: {
    fontWeight: 'bold',
  },
  webDatePicker: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
    width: '100%',
    boxSizing: 'border-box',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
  },
  addButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  tabButton: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabButton: {
    borderBottomColor: '#007AFF',
    backgroundColor: '#f0f8ff',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  pollLogItem: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fafbfc',
  },
  navButton: {
    padding: 10,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  imageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  imageNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
  },
  imageNavButton: {
    padding: 10,
  },
  disabledButton: {
    opacity: 0.5,
  },
  imageDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ccc',
    margin: 4,
  },
  activeDot: {
    backgroundColor: '#007AFF',
  },
  postTextContainer: {
    padding: 10,
  },
  postText: {
    fontSize: 16,
  },
  postMetadata: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  metadataText: {
    fontSize: 14,
    color: '#666',
  },
  decisionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    gap: 15,
  },
  decisionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 8,
    borderWidth: 2,
    minHeight: 50,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  rejectButton: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
  },
  selectedRejectButton: {
    backgroundColor: '#fff',
    borderColor: '#ff4444',
  },
  acceptButton: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  selectedAcceptButton: {
    backgroundColor: '#fff',
    borderColor: '#007AFF',
  },
  decisionButtonText: {
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  processButtonContainer: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#f8f9fa',
  },
  processButton: {
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#28a745',
    borderWidth: 2,
    borderColor: '#28a745',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  processButtonText: {
    fontWeight: 'bold',
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  imageErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageErrorText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  imageErrorSubtext: {
    fontSize: 14,
    color: '#666',
  },
  imageDebugContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugTitle: {
    fontWeight: 'bold',
    marginBottom: 10,
  },
  debugUrl: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  debugInfo: {
    color: '#666',
  },
  imageDisplayContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 300,
    resizeMode: 'contain',
  },
  caption: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorContainer: {
    padding: 10,
    borderWidth: 1,
    borderColor: 'red',
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'red',
    marginBottom: 5,
  },
  errorMessage: {
    fontSize: 14,
    color: 'red',
  },
});