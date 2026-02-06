import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Ionicons } from '@expo/vector-icons';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HistoryIcon from '@mui/icons-material/History';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import { IconButton, Button as MUIButton, Tooltip } from '@mui/material';
import { useFocusEffect } from '@react-navigation/native';
import { useGlobalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const START_SCRAPER_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/startInstagramScraper';
const START_STORIES_SCRAPER_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/startInstagramStoriesScraper';
const GET_RUNS_LIST_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunsList';
// Username endpoints removed; scraper pulls from venues now
const DELETE_APIFY_RUN_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteApifyRun';
// Automatic scheduling moved to sibling page `scraper-automatic`

interface ApifyRun {
  runId: string;
  datasetId: string;
  status: 'initiated' | 'running' | 'succeeded' | 'failed' | 'COMPLETED' | string;
  initiatedAt: string;
  completedAt?: string;
  instagramUsernames: string;
  numberOfPosts: number;
  error?: string;
  scrapedData?: any[];
  type?: 'posts' | 'stories';
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
  // Username management moved to Venues
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [apifyRuns, setApifyRuns] = useState<ApifyRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [isStoriesScraping, setIsStoriesScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [storiesScrapeResult, setStoriesScrapeResult] = useState<string | null>(null);
  const [storiesScrapeError, setStoriesScrapeError] = useState<string | null>(null);

  const [selectedRun, setSelectedRun] = useState<ApifyRun | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [pollingLogs, setPollingLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isManualPollLoading, setIsManualPollLoading] = useState(false);
  const [isPollingLogsExpanded, setIsPollingLogsExpanded] = useState(false);
  const [scrapedData, setScrapedData] = useState<any[]>([]);
  const [isScrapedDataLoading, setIsScrapedDataLoading] = useState(false);
  const [currentPostIndex, setCurrentPostIndex] = useState(0);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
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
  const [isUsernamesExpanded, setIsUsernamesExpanded] = useState(false);
  const { type: initialTypeParam } = useGlobalSearchParams<{ type?: string }>();
  const [scraperTab, setScraperTab] = useState<'posts' | 'stories'>(
    initialTypeParam === 'stories' ? 'stories' : 'posts'
  );

  // Run list display controls
  const [pendingShownCount, setPendingShownCount] = useState<number>(5);
  const [completedShownCount, setCompletedShownCount] = useState<number>(5);
  const [isClearingLogs, setIsClearingLogs] = useState<boolean>(false);
 
  useEffect(() => {
    setScraperTab(initialTypeParam === 'stories' ? 'stories' : 'posts');
  }, [initialTypeParam]);
 
  // URL is updated only on tab button press to avoid render loops

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

  // Username add/delete removed

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
    setIsScraping(true);
    setScrapeResult(null);
    setScrapeError(null);
    const payload = {
      // instagramUsernames omitted -> backend will load from venues
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

  // Start Stories scraper
  const handleScrapeStories = async () => {
    setIsStoriesScraping(true);
    setStoriesScrapeResult(null);
    setStoriesScrapeError(null);
    const payload = {
      // instagramUsernames omitted -> backend will load from venues
    };
    console.log('Sending to startInstagramStoriesScraper:', payload);
    try {
      const response = await fetch(START_STORIES_SCRAPER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      console.log('Received from startInstagramStoriesScraper:', data);
      if (response.ok && data.success) {
        setStoriesScrapeResult(`Stories scraping initiated! Run ID: ${data.runId}`);
        Alert.alert('Success', `Stories scraping initiated! Run ID: ${data.runId}`);
        fetchApifyRuns();
      } else {
        setStoriesScrapeError(data.error || 'Failed to initiate stories scraping.');
        Alert.alert('Error', data.error || 'Failed to initiate stories scraping.');
      }
    } catch (error: any) {
      setStoriesScrapeError(`Network error: ${error.message}`);
      Alert.alert('Error', `Network error: ${error.message}`);
    } finally {
      setIsStoriesScraping(false);
    }
  };

  // Split runs into pending and completed
  const runsForTab = apifyRuns.filter(run => scraperTab === 'stories' ? run.type === 'stories' : (run.type !== 'stories'));
  const pendingRuns = runsForTab.filter(run => run.status === 'initiated' || run.status === 'running');
  const completedRuns = runsForTab.filter(run => ['COMPLETED', 'succeeded', 'failed'].includes(run.status));

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

  // Automatic scheduling moved to sibling page `scraper-automatic`

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
        setCurrentMediaIndex(0);
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
      setCurrentMediaIndex(0);
    }
  };

  const goToPreviousPost = () => {
    if (currentPostIndex > 0) {
      setCurrentPostIndex(currentPostIndex - 1);
      setCurrentMediaIndex(0);
    }
  };

  const goToNextMedia = () => {
    const currentPost = filteredScrapedData[currentPostIndex];
    const media = getPostMedia(currentPost);
    if (currentMediaIndex < media.length - 1) {
      setCurrentMediaIndex(currentMediaIndex + 1);
    }
  };

  const goToPreviousMedia = () => {
    if (currentMediaIndex > 0) {
      setCurrentMediaIndex(currentMediaIndex - 1);
    }
  };

  function getPostMedia(post: any): Array<{ type: 'image' | 'video'; url: string; thumb?: string }> {
    const mediaItems: Array<{ type: 'image' | 'video'; url: string; thumb?: string }> = [];
    const seen = new Set<string>();
    const add = (type: 'image' | 'video', url?: string, thumb?: string) => {
      if (!url) return;
      if (seen.has(url)) return;
      seen.add(url);
      mediaItems.push({ type, url, thumb });
    };

    const displayUrl: string | undefined = post?.displayUrl;
    const thumbnailUrl: string | undefined = post?.thumbnailUrl || post?.thumbnail;
    const mediaField: string | undefined = post?.media || post?.mediaUrl;
    const mediaType: string | undefined = (post?.mediaType || '').toString().toLowerCase();

    // Images array (common in posts)
    if (Array.isArray(post?.images)) {
      post.images.forEach((img: any) => add('image', img?.url));
    }

    const isDisplayVideo = typeof displayUrl === 'string' && displayUrl.includes('.mp4');
    const isMediaFieldVideo = typeof mediaField === 'string' && mediaField.includes('.mp4');
    const isVideoByType = mediaType === 'video';

    // Prefer explicit video entries
    if (isDisplayVideo) add('video', displayUrl, thumbnailUrl);
    if (isMediaFieldVideo || isVideoByType) add('video', mediaField, thumbnailUrl);

    // Add images only if not mp4
    if (displayUrl && !isDisplayVideo) add('image', displayUrl);
    if (thumbnailUrl && !thumbnailUrl.includes('.mp4')) add('image', thumbnailUrl);
    if (mediaField && !isMediaFieldVideo) add('image', mediaField);

    // Fallback: infer from any known url fields
    if (mediaItems.length === 0) {
      const candidates = [post?.url, post?.image, post?.source];
      candidates.forEach((c: any) => {
        if (typeof c === 'string') add(c.includes('.mp4') ? 'video' : 'image', c);
      });
    }

    return mediaItems;
  }

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
      setCurrentMediaIndex(0);
    }
    setLiveSummary(null);
  };

  return (
    <ScrollView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Instagram Scraper</ThemedText>
        <ThemedText style={styles.subtitle}>
          Scrape public Instagram posts using Apify.
        </ThemedText>
      </ThemedView>

      <>
          {scraperTab === 'posts' ? (
            <>
              <ThemedView style={styles.section}>
                <MUIButton
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={<PlayArrowIcon />}
                  onClick={handleScrape}
                  disabled={isScraping}
                >
                  {isScraping ? 'Scraping...' : 'Start Scraper'}
                </MUIButton>
                {scrapeResult && <ThemedText style={styles.resultText}>Result: {scrapeResult}</ThemedText>}
                {scrapeError && <ThemedText style={styles.errorText}>Error: {scrapeError}</ThemedText>}
              </ThemedView>

              {/* Pending and Completed Runs Section */}
              <ThemedView style={styles.section}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <ThemedText type="subtitle" style={{ flex: 1 }}>Pending Scraping Runs</ThemedText>
                  <Tooltip title="Trigger poll now">
                    <span>
                      <MUIButton
                        variant="outlined"
                        size="small"
                        startIcon={<PlayArrowIcon />}
                        onClick={handleManualPoll}
                        disabled={isManualPollLoading}
                      >
                        {isManualPollLoading ? 'Polling...' : 'Poll'}
                      </MUIButton>
                    </span>
                  </Tooltip>
                </View>
                {isLoadingRuns ? (
                    <ActivityIndicator size="small" color="#007AFF" />
                  ) : pendingRuns.length === 0 ? (
                    <ThemedText>No pending runs.</ThemedText>
                  ) : (
                  pendingRuns.slice(0, pendingShownCount).map(run => (
                      <View key={run.runId} style={styles.runItem}>
                      <TouchableOpacity
                        style={styles.runContent}
                        onPress={() => { setSelectedRun(run); setModalVisible(true); }}
                      >
                        <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
                        <ThemedText>Status: {run.status}</ThemedText>
                        <ThemedText>Initiated: {new Date(run.initiatedAt).toLocaleString()}</ThemedText>
                        {run.error && <ThemedText style={styles.errorText}>Error: {run.error}</ThemedText>}
                      </TouchableOpacity>
                      </View>
                    ))
                )}
                {pendingRuns.length > pendingShownCount && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <TouchableOpacity onPress={() => setPendingShownCount(c => c + 5)}>
                      <ThemedText style={{ color: '#007AFF' }}>Show more</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}
              </ThemedView>

              <ThemedView style={styles.section}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <ThemedText type="subtitle" style={{ flex: 1 }}>Completed Scraper Runs</ThemedText>
                  <Tooltip title="Refresh runs">
                    <IconButton color="primary" size="small" onClick={fetchApifyRuns}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </View>
                {isLoadingRuns ? (
                    <ActivityIndicator size="small" color="#007AFF" />
                  ) : completedRuns.length === 0 ? (
                    <ThemedText>No completed runs.</ThemedText>
                  ) : (
                  completedRuns.slice(0, completedShownCount).map(run => (
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
                      <Tooltip title="Delete run">
                        <span>
                          <IconButton
                            color="error"
                            size="small"
                            onClick={() => handleDeleteApifyRun(run.runId)}
                          disabled={deletingRunId === run.runId}
                        >
                          {deletingRunId === run.runId ? (
                            <ActivityIndicator size="small" color="#ff4444" />
                          ) : (
                              <DeleteOutlineIcon fontSize="small" />
                          )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      </View>
                    ))
                )}
                {completedRuns.length > completedShownCount && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <TouchableOpacity onPress={() => setCompletedShownCount(c => c + 5)}>
                      <ThemedText style={{ color: '#007AFF' }}>Show more</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}
              </ThemedView>

              {/* Polling History Section */}
              <ThemedView style={styles.section}>
                <TouchableOpacity onPress={() => setIsPollingLogsExpanded(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <ThemedText type="subtitle" style={{ flex: 1 }}>Polling History (Last 10 Polls)</ThemedText>
                  <Tooltip title="Refresh logs">
                    <IconButton color="primary" size="small" onClick={fetchPollingLogs}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
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
                        <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
                          <Tooltip title="Delete log">
                            <IconButton color="error" size="small" onClick={() => handleDeletePollLog(log.id)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </View>
                      </View>
                    ))
                  )
                )}
              </ThemedView>
            </>
          ) : (
            <>
            <ThemedView style={styles.section}>
                <MUIButton
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={<PlayArrowIcon />}
                  onClick={handleScrapeStories}
                  disabled={isStoriesScraping}
                >
                  {isStoriesScraping ? 'Scraping...' : 'Start Stories Scraper'}
                </MUIButton>
                {storiesScrapeResult && <ThemedText style={styles.resultText}>Result: {storiesScrapeResult}</ThemedText>}
                {storiesScrapeError && <ThemedText style={styles.errorText}>Error: {storiesScrapeError}</ThemedText>}
            </ThemedView>

              {/* Pending and Completed Runs Section (Stories) */}
              <ThemedView style={styles.section}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <ThemedText type="subtitle" style={{ flex: 1 }}>Pending Stories Runs</ThemedText>
                  <Tooltip title="Trigger poll now">
                    <span>
                      <MUIButton
                        variant="outlined"
                        size="small"
                        startIcon={<PlayArrowIcon />}
                        onClick={handleManualPoll}
                        disabled={isManualPollLoading}
                      >
                        {isManualPollLoading ? 'Polling...' : 'Poll'}
                      </MUIButton>
                    </span>
                  </Tooltip>
                </View>
                {isLoadingRuns ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : pendingRuns.length === 0 ? (
                  <ThemedText>No pending runs.</ThemedText>
                ) : (
                  pendingRuns.slice(0, pendingShownCount).map(run => (
                    <View key={run.runId} style={styles.runItem}>
                      <TouchableOpacity
                        style={styles.runContent}
                        onPress={() => { setSelectedRun(run); setModalVisible(true); }}
                      >
                        <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
                        <ThemedText>Status: {run.status}</ThemedText>
                        <ThemedText>Initiated: {new Date(run.initiatedAt).toLocaleString()}</ThemedText>
                        {run.error && <ThemedText style={styles.errorText}>Error: {run.error}</ThemedText>}
                      </TouchableOpacity>
                    </View>
                  ))
                )}
                {pendingRuns.length > pendingShownCount && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <TouchableOpacity onPress={() => setPendingShownCount(c => c + 5)}>
                      <ThemedText style={{ color: '#007AFF' }}>Show more</ThemedText>
                    </TouchableOpacity>
                  </View>
            )}
          </ThemedView>

              <ThemedView style={styles.section}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <ThemedText type="subtitle" style={{ flex: 1 }}>Completed Stories Runs</ThemedText>
                  <Tooltip title="Refresh runs">
                    <IconButton color="primary" size="small" onClick={fetchApifyRuns}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </View>
                {isLoadingRuns ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : completedRuns.length === 0 ? (
                  <ThemedText>No completed runs.</ThemedText>
                ) : (
                  completedRuns.slice(0, completedShownCount).map(run => (
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
                      <Tooltip title="Delete run">
                        <span>
                          <IconButton
                            color="error"
                            size="small"
                            onClick={() => handleDeleteApifyRun(run.runId)}
                            disabled={deletingRunId === run.runId}
                          >
                            {deletingRunId === run.runId ? (
                              <ActivityIndicator size="small" color="#ff4444" />
                            ) : (
                              <DeleteOutlineIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </View>
                  ))
                )}
                {completedRuns.length > completedShownCount && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <TouchableOpacity onPress={() => setCompletedShownCount(c => c + 5)}>
                      <ThemedText style={{ color: '#007AFF' }}>Show more</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}
              </ThemedView>

              {/* Polling History Section */}
              <ThemedView style={styles.section}>
                <TouchableOpacity onPress={() => setIsPollingLogsExpanded(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <ThemedText type="subtitle" style={{ flex: 1 }}>Polling History (Last 10 Polls)</ThemedText>
                  <Tooltip title="Refresh logs">
                    <IconButton color="primary" size="small" onClick={fetchPollingLogs}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
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
                        <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
                          <Tooltip title="Delete log">
                            <IconButton color="error" size="small" onClick={() => handleDeletePollLog(log.id)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </View>
                      </View>
                    ))
                  )
                )}
              </ThemedView>
            </>
          )}
        </>

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
                        const media = getPostMedia(currentPost);
                        
                        return (
                          <View>
                            {/* Media Carousel (images/videos) */}
                            {media.length > 0 && (
                              <View style={styles.imageContainer}>
                                <View style={styles.imageWrapper}>
                                  {(() => {
                                    const item = media[currentMediaIndex];
                                    const proxiedUrl = `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(item.url)}`;
                                    if (item.type === 'video') {
                                      if (Platform.OS === 'web') {
                                        return (
                                          <video
                                            src={proxiedUrl}
                                            controls
                                            style={styles.image as any}
                                          />
                                        );
                                      } else {
                                        return (
                                          <View style={styles.imageDisplayContainer}>
                                            <ThemedText>Video preview not supported on this platform.</ThemedText>
                                            <ThemedText style={{ color: '#007AFF' }}>{item.url}</ThemedText>
                                          </View>
                                        );
                                      }
                                    }
                                    // Image branch
                                    return (
                                      imageLoadErrors[item.url] ? (
                                        <View style={styles.imageErrorContainer}>
                                          <Ionicons name="image-outline" size={48} color="#ccc" />
                                          <ThemedText style={styles.imageErrorText}>Image not available</ThemedText>
                                          <ThemedText style={styles.imageErrorSubtext}>
                                            {typeof imageLoadErrors[item.url] === 'string' && imageLoadErrors[item.url]}
                                            {typeof imageLoadErrors[item.url] !== 'string' && '(CORS restricted or failed to load)'}
                                          </ThemedText>
                                        </View>
                                      ) : !imageLoadSuccess[item.url] ? (
                                        <ImageLoaderWithTimeout
                                          imageUrl={item.url}
                                          onLoad={() => setImageLoadSuccess(prev => ({ ...prev, [item.url]: true }))}
                                          onError={(errMsg) => setImageLoadErrors(prev => ({ ...prev, [item.url]: errMsg || true }))}
                                        >
                                          {Platform.OS === 'web' ? (
                                            <img
                                              src={proxiedUrl}
                                              alt="Instagram media"
                                              style={styles.image as any}
                                              onError={() => setImageLoadErrors(prev => ({ ...prev, [item.url]: 'Failed to load image' }))}
                                              onLoad={() => setImageLoadSuccess(prev => ({ ...prev, [item.url]: true }))}
                                            />
                                          ) : (
                                            <Image
                                              source={{ uri: proxiedUrl }}
                                              style={styles.image}
                                              onError={(e) => setImageLoadErrors(prev => ({ ...prev, [item.url]: (e?.nativeEvent?.error || 'Failed to load image') }))}
                                              onLoad={() => setImageLoadSuccess(prev => ({ ...prev, [item.url]: true }))}
                                            />
                                          )}
                                        </ImageLoaderWithTimeout>
                                      ) : (
                                        <View style={styles.imageDisplayContainer}>
                                          {Platform.OS === 'web' ? (
                                            <img src={proxiedUrl} alt="Instagram media" style={styles.image as any} />
                                          ) : (
                                            <Image source={{ uri: proxiedUrl }} style={styles.image} />
                                          )}
                                        </View>
                                      )
                                    );
                                  })()}
                                </View>
                                
                                {/* Media Navigation */}
                                {media.length > 1 && (
                                  <View style={styles.imageNavigation}>
                                    <TouchableOpacity
                                      onPress={goToPreviousMedia}
                                      disabled={currentMediaIndex === 0}
                                      style={[styles.imageNavButton, currentMediaIndex === 0 && styles.disabledButton]}
                                    >
                                      <Ionicons name="chevron-back" size={20} color={currentMediaIndex === 0 ? "#ccc" : "#007AFF"} />
                                    </TouchableOpacity>

                                    {/* Dots */}
                                    <View style={styles.imageDots}>
                                      {media.map((_, index) => (
                                        <View
                                          key={index}
                                          style={[styles.dot, index === currentMediaIndex && styles.activeDot]}
                                        />
                                      ))}
                                    </View>
                                    
                                    <TouchableOpacity
                                      onPress={goToNextMedia}
                                      disabled={currentMediaIndex === media.length - 1}
                                      style={[styles.imageNavButton, currentMediaIndex === media.length - 1 && styles.disabledButton]}
                                    >
                                      <Ionicons name="chevron-forward" size={20} color={currentMediaIndex === media.length - 1 ? "#ccc" : "#007AFF"} />
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            )}

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
  // For <img> (web), inject only valid props (camelCase), cast to any to satisfy TS
  if (Platform.OS === 'web' && (children as any).type === 'img') {
    return React.cloneElement(children as any, {
      onLoad: handleLoad,
      onError: handleError,
    } as any);
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
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});