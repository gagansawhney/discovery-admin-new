import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Box, Chip, Divider, IconButton, Button as MUIButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Image, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

const SCHEDULE_SCRAPE_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/scheduleScrape';
const MANUAL_POLL_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/manualPollApifyRuns';
const DELETE_SCHEDULE_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteSchedule';
const GET_RUNS_LIST_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunsList';
const DELETE_APIFY_RUN_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteApifyRun';
const CLASSIFY_RUN_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/classifyApifyRun';
const PROCESS_CLASSIFIED_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/processClassifiedRun';
const RETRY_ITEM_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/retryClassifyItem';
const DELETE_CLASS_ITEM_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteClassificationItem';
const MANAGE_VENUES_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/manageVenues';
const GET_APIFY_RESULTS_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunResults';

interface Venue {
  id: string;
  name: string;
  nameVariations: string[];
  address: string;
  latitude: number;
  longitude: number;
  googleMapLink: string;
}

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

export default function ScraperAutomaticScreen() {
  console.log('--- SCRAPER AUTOMATIC RENDER ---');
  const [scheduleStartTimes, setScheduleStartTimes] = useState<Record<'posts' | 'stories', string>>({ posts: '', stories: '' });
  const [scheduleRepeats, setScheduleRepeats] = useState<Record<'posts' | 'stories', 'once' | 'daily'>>({ posts: 'once', stories: 'once' });
  const [schedulingType, setSchedulingType] = useState<'posts' | 'stories' | null>(null);
  const [isPollingPosts, setIsPollingPosts] = useState(false);
  const [isPollingStories, setIsPollingStories] = useState(false);
  const [classifiedEvents, setClassifiedEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pollingLogs, setPollingLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedRun, setSelectedRun] = useState<ApifyRun | null>(null);
  const [isRunModalVisible, setIsRunModalVisible] = useState(false);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(true);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [apifyRuns, setApifyRuns] = useState<ApifyRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [classifyingRunId, setClassifyingRunId] = useState<string | null>(null);
  const [reclassifyingRunId, setReclassifyingRunId] = useState<string | null>(null);
  const [reprocessingRunId, setReprocessingRunId] = useState<string | null>(null);
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [postsModel, setPostsModel] = useState<'openai' | 'gemini'>('openai');
  const [storiesModel, setStoriesModel] = useState<'openai' | 'gemini'>('gemini');
  const [filterDays, setFilterDays] = useState(7);
  const [venues, setVenues] = useState<Venue[]>([]);
  const sortedVenues = React.useMemo(() => [...venues].sort((a, b) => a.name.localeCompare(b.name)), [venues]);
  
  // Firestore REST value decoder (for apifyResults fetching)
  const decodeFsValue = (v: any): any => {
    if (!v || typeof v !== 'object') return v;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) {
      const obj: any = {};
      const fields = v.mapValue.fields || {};
      Object.keys(fields).forEach(k => { obj[k] = decodeFsValue(fields[k]); });
      return obj;
    }
    if ('arrayValue' in v) {
      const arr = v.arrayValue.values || [];
      return arr.map((x: any) => decodeFsValue(x));
    }
    return null;
  };

  const pickImageUrl = (item: any): string | null => {
    // 1. If it's a video, we MUST use the thumbnail for the UI/AI
    if (item.mediaType === 'video' || item.isVideo === true) {
      const thumb = item.thumbnailUrl || item.thumbnail;
      if (typeof thumb === 'string') return thumb;
    }

    // 2. Try the standard Instagram large media endpoint
    const shortcode = item.shortcode || item.shortCode || item.code || null;
    if (typeof shortcode === 'string' && shortcode.length > 0 && !item.mediaUrl?.includes('.mp4')) {
      return `https://www.instagram.com/p/${shortcode}/media/?size=l`;
    }

    const candidates = [item?.displayUrl, item?.thumbnailUrl, item?.thumbnail, item?.mediaUrl, item?.media, item?.image, item?.url];
    for (const c of candidates) {
      if (typeof c === 'string' && c && !c.includes('.mp4')) return c;
    }
    
    // Final fallback to thumbnail even if candidates had issues
    return item.thumbnailUrl || item.thumbnail || null;
  };

  const getItemId = (item: any, index: number) => item?.id || item?.shortcode || String(index);

  const formatDate = (input: any): string => {
    const d = new Date(input);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  };

  const loadVenues = async () => {
    try {
      const response = await fetch(MANAGE_VENUES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setVenues(data.venues || []);
        }
      }
    } catch (error) {
      console.error('🏢 Error loading venues:', error);
    }
  };

  const fetchSchedules = async () => {
    setIsLoadingSchedules(true);
    setSchedulesError(null);
    try {
      const response = await fetch('https://firestore.googleapis.com/v1/projects/discovery-1e94e/databases/(default)/documents/scrapeSchedules?orderBy=startAt desc');
      const data = await response.json();
      if (data.documents) {
        const fetchedSchedules = data.documents.map((doc: any) => {
          const fields = doc.fields || {};
          return {
            id: doc.name.split('/').pop(),
            startAt: fields.startAt?.stringValue,
            runTypes: fields.runTypes?.arrayValue?.values?.map((v: any) => v.stringValue) || [],
            status: fields.status?.stringValue,
            repeat: fields.repeat?.stringValue || 'once',
          };
        });
        setSchedules(fetchedSchedules);
      } else {
        setSchedules([]);
      }
    } catch (e: any) {
      setSchedulesError(e.message || 'An error occurred while fetching schedules.');
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  const fetchApifyRuns = async () => {
    setIsLoadingRuns(true);
    try {
      const response = await fetch(GET_RUNS_LIST_URL);
      const data = await response.json();
      if (response.ok && data.success) {
        setApifyRuns(data.runs || []);
      } else {
        setApifyRuns([]);
      }
    } catch (e) {
      setApifyRuns([]);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  useEffect(() => {
    loadVenues();
  }, []);

  const [isVenuePickerVisible, setIsVenuePickerVisible] = useState(false);
  const [matchingVenueId, setMatchingVenueId] = useState<string | null>(null);
  const [venueSearchQuery, setVenueSearchQuery] = useState('');
  const [isMatchingVenue, setIsMatchingVenue] = useState(false);

  const filteredVenues = sortedVenues.filter(v => 
    v.name.toLowerCase().includes(venueSearchQuery.toLowerCase()) ||
    v.nameVariations?.some(nv => nv.toLowerCase().includes(venueSearchQuery.toLowerCase()))
  );

  const handleManualVenueLink = async (targetVenue: Venue) => {
    const currentItem = reviewList[reviewIndex];
    let detectedVenueName = currentItem.detectedVenueName || currentItem?.signals?.matchedVenueName || currentItem?.signals?.venueName || currentItem?.signals?.venue || currentItem?.venue?.name || currentItem?.venueName;

    // Fallback: parse from error message
    if (!detectedVenueName && currentItem.error?.includes('Venue not found')) {
      const match = currentItem.error.match(/"([^"]+)"/);
      if (match) detectedVenueName = match[1];
    }

    if (!detectedVenueName || typeof detectedVenueName !== 'string') {
      Alert.alert('Error', 'No detected venue name to link.');
      return;
    }

    const confirm = (Platform.OS === 'web' && typeof window !== 'undefined') ? window.confirm(`Link "${detectedVenueName}" as an alias for "${targetVenue.name}" and process the event?`) : true;
    if (!confirm) return;

    setIsMatchingVenue(true);
    try {
      // 1. Add Alias to Venue
      const upVariations = Array.from(new Set([...(targetVenue.nameVariations || []), detectedVenueName]));
      const upRes = await fetch(MANAGE_VENUES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          venue: { ...targetVenue, nameVariations: upVariations }
        })
      });
      const upData = await upRes.json();
      if (!upRes.ok || !upData.success) throw new Error(upData.error || 'Failed to update venue aliases');

      // 2. Refresh local venues list
      await loadVenues();
      
      // 3. Trigger Reprocess/Retry for this item with the forced venue ID
      const itemId = currentItem.itemId || currentItem.id;
      const resp = await fetch(RETRY_ITEM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          runId: reviewRunId, 
          itemId, 
          model: extractionModel,
          forceVenueId: targetVenue.id 
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Retry failed');
      
      // Update UI
      const updated = data.updated || {};
      const updatedFields = {
        ...updated,
        id: updated.id || currentItem.id,
        itemId: updated.itemId || currentItem.itemId,
      };

      setReviewList(prev => {
        const copy = [...prev];
        copy[reviewIndex] = { ...copy[reviewIndex], ...updatedFields, error: null };
        return copy;
      });
      
      setIsVenuePickerVisible(false);
      Alert.alert('Success', `Linked "${detectedVenueName}" to ${targetVenue.name} and processed successfully.`);
      fetchApifyRuns();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to link venue');
    } finally {
      setIsMatchingVenue(false);
    }
  };
  const [classifiedStatsByRun, setClassifiedStatsByRun] = useState<Record<string, { processed: number; classified: number; skipped: number; errors: number }>>({});
  const [nonEvents, setNonEvents] = useState<any[]>([]);
  const [isLoadingNonEvents, setIsLoadingNonEvents] = useState<boolean>(true);
  const [nonEventsError, setNonEventsError] = useState<string | null>(null);
  const [runReviews, setRunReviews] = useState<Record<string, { loading: boolean; error: string | null; events: any[]; nonEvents: any[] }>>({});
  const [isReviewModalVisible, setIsReviewModalVisible] = useState(false);
  const [reviewList, setReviewList] = useState<any[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number>(0);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [reviewCategory, setReviewCategory] = useState<'events' | 'nonEvents' | 'processed'>('events');
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const screenHeight = Dimensions.get('window').height;
  const modalImageHeight = Math.max(400, Math.floor(screenHeight * 0.65));
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const toggleRunCard = (runId: string) => setExpandedRuns(prev => ({ ...prev, [runId]: !prev[runId] }));
  const [expandedSections, setExpandedSections] = useState<{ posts: boolean; stories: boolean }>({
    posts: false,
    stories: false,
  });
  const toggleSection = (section: keyof typeof expandedSections) =>
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));

  // Subsection collapsible state (for Schedule, Pending, Completed, Classified, Processed, Errors)
  const [expandedSubsections, setExpandedSubsections] = useState<Record<string, boolean>>({
    'posts-schedule': false,
    'posts-pending': false,
    'posts-completed': false,
    'posts-classified': false,
    'posts-processed': false,
    'posts-errors': false,
    'stories-schedule': false,
    'stories-pending': false,
    'stories-completed': false,
    'stories-classified': false,
    'stories-processed': false,
    'stories-errors': false,
  });
  const toggleSubsection = (id: string) =>
    setExpandedSubsections(prev => ({ ...prev, [id]: !prev[id] }));

  // Cache of raw Apify items per run for modal details
  const [apifyRawByRun, setApifyRawByRun] = useState<Record<string, { loading: boolean; error: string | null; itemsById: Record<string, any> }>>({});

  const ensureApifyRaw = async (runId: string) => {
    if (!runId) return;
    const existing = apifyRawByRun[runId];
    if (existing && (existing.loading === false) && existing.itemsById && Object.keys(existing.itemsById).length > 0) return;
    setApifyRawByRun(prev => ({ ...prev, [runId]: { loading: true, error: null, itemsById: prev[runId]?.itemsById || {} } }));
    try {
      // Try REST read of apifyResults to avoid normalization losing original ids
      const fsUrl = `https://firestore.googleapis.com/v1/projects/discovery-1e94e/databases/(default)/documents/apifyResults/${encodeURIComponent(runId)}`;
      const fsRes = await fetch(fsUrl);
      if (fsRes.ok) {
        const doc = await fsRes.json();
        const fields = doc.fields || {};
        const rawResults = decodeFsValue(fields.results) || [];
        const itemsById: Record<string, any> = {};
        for (const item of Array.isArray(rawResults) ? rawResults : []) {
          const key = item?.id || item?.shortcode || item?.code || item?.postId || item?.story_id || item?.media || item?.source;
          if (key) itemsById[String(key)] = item;
        }
        setApifyRawByRun(prev => ({ ...prev, [runId]: { loading: false, error: null, itemsById } }));
        return;
      }
      // Fallback to cloud function
      const resp = await fetch(GET_APIFY_RESULTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) });
      const data = await resp.json();
      if (!resp.ok || !data.success || !Array.isArray(data.data)) {
        setApifyRawByRun(prev => ({ ...prev, [runId]: { loading: false, error: data.error || 'Failed to load Apify results', itemsById: {} } }));
        return;
      }
      const itemsById2: Record<string, any> = {};
      for (const item of data.data) {
        const key = item?.id || item?.shortcode || item?.code || item?.postId;
        if (key) itemsById2[String(key)] = item;
      }
      setApifyRawByRun(prev => ({ ...prev, [runId]: { loading: false, error: null, itemsById: itemsById2 } }));
    } catch (e: any) {
      setApifyRawByRun(prev => ({ ...prev, [runId]: { loading: false, error: e?.message || 'Failed to load Apify results', itemsById: {} } }));
    }
  };

  // subsection collapsible state
  const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false);
  const [confirmModalScheduleId, setConfirmModalScheduleId] = useState<string | null>(null);

  const handleDeleteApifyRun = async (runId: string) => {
    const message = `Are you sure you want to delete this run and all its scraped data? This action cannot be undone.`;
    let shouldDelete = false;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      shouldDelete = window.confirm(message);
    } else {
      shouldDelete = true;
    }
    if (!shouldDelete) return;
    setDeletingRunId(runId);
    try {
      const response = await fetch(DELETE_APIFY_RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setApifyRuns(prev => prev.filter(run => run.runId !== runId));
        if (selectedRun && selectedRun.runId === runId) {
          setIsRunModalVisible(false);
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
  };

  const handleManualClassifyRun = async (runId: string) => {
    const run = apifyRuns.find(r => r.runId === runId);
    const model = run?.type === 'stories' ? storiesModel : postsModel;
    setClassifyingRunId(runId);
    try {
      const classifyResp = await fetch(CLASSIFY_RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, model })
      });
      const classifyData = await classifyResp.json();
      if (!classifyResp.ok || !classifyData.success) {
        throw new Error(classifyData.error || 'Failed to classify run');
      }
      const rawStats = classifyData.result?.results ?? classifyData.result;
      const stats = {
        processed: Number(rawStats?.processed) || 0,
        classified: Number(rawStats?.classified) || 0,
        skipped: Number(rawStats?.skipped) || 0,
        errors: Number(rawStats?.errors) || 0,
      };
      setClassifiedStatsByRun(prev => ({ ...prev, [runId]: stats }));
      Alert.alert('Success', 'Classification completed.');
      // Poll for classifications to appear (up to ~10s)
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const res = await fetchRunReview({ runId } as any);
        const counts = res ? ((res.events?.length || 0) + (res.nonEvents?.length || 0)) : 0;
        if (counts > 0) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      await ensureApifyRaw(runId);
      fetchApifyRuns();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to run classification');
    } finally {
      setClassifyingRunId(null);
    }
  };

  const handleReclassifyRun = async (runId: string) => {
    const confirm = (Platform.OS === 'web' && typeof window !== 'undefined') ? window.confirm('Reclassify all items in this run? This will re-run AI classification on every post.') : true;
    if (!confirm) return;

    setReclassifyingRunId(runId);
    try {
      const response = await fetch(CLASSIFY_RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, reclassify: true })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to reclassify run');
      }
      Alert.alert('Success', 'Run reclassification completed.');
      await fetchRunReview({ runId } as any);
      fetchApifyRuns();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to reclassify run');
    } finally {
      setReclassifyingRunId(null);
    }
  };

  const handleProcessClassifiedRun = async (runId: string, reprocess: boolean = false) => {
    const run = apifyRuns.find(r => r.runId === runId);
    const model = run?.type === 'stories' ? storiesModel : postsModel;
    const setBusy = reprocess ? setReprocessingRunId : setProcessingRunId;
    const isBusyId = reprocess ? reprocessingRunId : processingRunId;
    
    if (reprocess) {
      const confirm = (Platform.OS === 'web' && typeof window !== 'undefined') ? window.confirm('Reprocess all items? This will re-extract flyer info and update existing events.') : true;
      if (!confirm) return;
    }

    setBusy(runId);
    try {
      const processResp = await fetch(PROCESS_CLASSIFIED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, reprocess, model })
      });
      const processData = await processResp.json();
      if (!processResp.ok || !processData.success) {
        throw new Error(processData.error || 'Failed to process classified events');
      }
      Alert.alert('Success', reprocess ? 'Reprocessing completed.' : 'Processing completed.');
      await fetchRunReview({ runId } as any);
      await ensureApifyRaw(runId);
      fetchApifyRuns();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to process classified events');
    } finally {
      setBusy(null);
    }
  };

  const fetchRunReview = async (run: ApifyRun) => {
    const runId = run.runId;
    setRunReviews(prev => ({ ...prev, [runId]: { loading: true, error: null, events: [], nonEvents: [] } }));
    try {
      // Fetch classifications for this run (single source of truth)
      const clsResp = await fetch('https://firestore.googleapis.com/v1/projects/discovery-1e94e/databases/(default)/documents:runQuery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'apifyClassifications' }],
            where: { fieldFilter: { field: { fieldPath: 'runId' }, op: 'EQUAL', value: { stringValue: runId } } },
            limit: 1000
          }
        })
      });
      const clsRows = await clsResp.json();
      const clsDocs = Array.isArray(clsRows) ? clsRows.filter((r: any) => r.document) : [];
      const decodeValue = (v: any): any => {
        if (!v || typeof v !== 'object') return v;
        if ('stringValue' in v) return v.stringValue;
        if ('booleanValue' in v) return v.booleanValue;
        if ('integerValue' in v) return Number(v.integerValue);
        if ('doubleValue' in v) return v.doubleValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('mapValue' in v) {
          const obj: any = {};
          const fields = v.mapValue.fields || {};
          Object.keys(fields).forEach(k => { obj[k] = decodeValue(fields[k]); });
          return obj;
        }
        if ('arrayValue' in v) {
          const arr = v.arrayValue.values || [];
          return arr.map((x: any) => decodeValue(x));
        }
        return null;
      };
      const clsList = clsDocs.map((r: any) => {
        const f = r.document.fields || {};
        const confidence = typeof f.confidence?.doubleValue === 'number' ? f.confidence.doubleValue : (typeof f.confidence?.integerValue === 'string' ? Number(f.confidence.integerValue) : null);
        return {
          id: r.document.name.split('/').pop(),
          itemId: f.itemId?.stringValue || null,
          isEvent: !!f.isEvent?.booleanValue,
          imageUrl: f.imageUrl?.stringValue || null,
          caption: f.caption?.stringValue || null,
          reasons: f.reasons?.arrayValue?.values?.map((v: any) => v.stringValue) || [],
          timestamp: f.timestamp?.timestampValue || f.timestamp?.stringValue || null,
          model: decodeValue(f.model),
          signals: decodeValue(f.signals),
          confidence,
          eventId: f.eventId?.stringValue || null,
          path: f.path?.stringValue || null,
          error: f.error?.stringValue || null,
          detectedVenueName: f.detectedVenueName?.stringValue || null,
          detectedDate: f.detectedDate?.stringValue || null,
        };
      });
      const nonEventsForRun: any[] = clsList.filter(c => c.isEvent === false);
      const eventsForRun: any[] = clsList.filter(c => c.isEvent === true);

      setRunReviews(prev => ({ ...prev, [runId]: { loading: false, error: null, events: eventsForRun, nonEvents: nonEventsForRun } }));
      return { events: eventsForRun, nonEvents: nonEventsForRun };
    } catch (e: any) {
      setRunReviews(prev => ({ ...prev, [runId]: { loading: false, error: e.message || 'Failed to load review data', events: [], nonEvents: [] } }));
      return undefined;
    }
  };

  // Prefetch review counts for completed runs so we can show counts inline
  useEffect(() => {
    const completedRuns = apifyRuns.filter(run => ['COMPLETED', 'succeeded', 'failed'].includes(run.status));
    completedRuns.forEach(run => {
      if (!runReviews[run.runId]) {
        fetchRunReview(run);
      }
    });
  }, [apifyRuns]);

  const handleDeleteSchedule = async (scheduleId: string) => {
    console.log('handleDeleteSchedule called for ID:', scheduleId);
    setConfirmModalScheduleId(scheduleId);
    setIsConfirmModalVisible(true);
  };

  useEffect(() => {
    const fetchClassifiedData = async () => {
      try {
        const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/fetchEvents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'all' }), // Fetch all events
        });
        const data = await response.json();
        if (response.ok && data.success) {
          setClassifiedEvents(data.events);
        } else {
          setFetchError(data.error || 'Failed to fetch classified events.');
        }
      } catch (e: any) {
        setFetchError(e.message || 'An error occurred while fetching data.');
      } finally {
        setIsLoadingEvents(false);
      }
    };

    const fetchLogs = async () => {
      try {
        const response = await fetch('https://firestore.googleapis.com/v1/projects/discovery-1e94e/databases/(default)/documents/pollingLogs?pageSize=10&orderBy=timestamp desc');
        const data = await response.json();
        if (data.documents) {
          const logs = data.documents.map((doc: any) => ({
            id: doc.name.split('/').pop(),
            ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]: [string, any]) => [k, v.stringValue || v.arrayValue?.values?.map((x: any) => x.stringValue || x.mapValue?.fields || x) || v.integerValue || v.doubleValue || v.booleanValue || v.timestampValue || null]))
          }));
          setPollingLogs(logs);
        } else {
          setPollingLogs([]);
        }
      } catch (e: any) {
        setLogsError(e.message || 'An error occurred while fetching logs.');
      } finally {
        setIsLoadingLogs(false);
      }
    };

    const fetchNonEvents = async () => {
      setIsLoadingNonEvents(true);
      setNonEventsError(null);
      try {
        const response = await fetch('https://firestore.googleapis.com/v1/projects/discovery-1e94e/databases/(default)/documents:runQuery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'apifyClassifications' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'isEvent' },
                  op: 'EQUAL',
                  value: { booleanValue: false }
                }
              },
              orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
              limit: 50
            }
          })
        });
        const rows = await response.json();
        const docs = Array.isArray(rows) ? rows.filter((r: any) => r.document) : [];
        const mapped = docs.map((r: any) => {
          const f = r.document.fields || {};
          const ts = f.timestamp?.timestampValue || f.timestamp?.stringValue || f.timestamp?.integerValue || null;
          return {
            id: r.document.name.split('/').pop(),
            imageUrl: f.imageUrl?.stringValue,
            caption: f.caption?.stringValue,
            ownerUsername: f.ownerUsername?.stringValue,
            timestamp: ts,
            reasons: f.reasons?.arrayValue?.values?.map((v: any) => v.stringValue) || [],
          };
        });
        setNonEvents(mapped);
      } catch (e: any) {
        setNonEventsError(e.message || 'Failed to fetch non-events');
      } finally {
        setIsLoadingNonEvents(false);
      }
    };

    fetchClassifiedData();
    fetchLogs();
    fetchSchedules();
    fetchApifyRuns();
    fetchNonEvents();
  }, []);

  // Group events by date for display
  const groupedEvents = classifiedEvents.reduce((acc, event) => {
    const eventDate = new Date(event.date.start).toISOString().split('T')[0];
    if (!acc[eventDate]) {
      acc[eventDate] = [];
    }
    acc[eventDate].push(event);
    return acc;
  }, {} as Record<string, any[]>);

  const handleEventPress = (event: any) => {
    setSelectedEvent(event);
    setIsModalVisible(true);
  };

  const handleScheduleRunForType = async (type: 'posts' | 'stories') => {
    const startValue = scheduleStartTimes[type];
    const repeat = scheduleRepeats[type];
    if (!startValue) {
      Alert.alert('Error', 'Please select a start time');
      return;
    }
    setSchedulingType(type);
    try {
      const iso = (() => {
        if (repeat === 'daily') {
          const [hh, mm] = (startValue || '00:00').split(':').map(x => parseInt(x, 10));
          const now = new Date();
          const target = new Date(now);
          target.setSeconds(0, 0);
          target.setHours(isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm, 0, 0);
          if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
          }
          return target.toISOString();
        }
        return new Date(startValue).toISOString();
      })();
      const response = await fetch(SCHEDULE_SCRAPE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startAtISO: iso, runTypes: [type], repeat })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        Alert.alert('Error', data.error || 'Failed to schedule run');
      } else {
        Alert.alert('Scheduled', `Schedule ID: ${data.scheduleId}`);
        fetchSchedules();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to schedule run');
    } finally {
      setSchedulingType(null);
    }
  };

  const renderAccordionSection = (
    section: keyof typeof expandedSections,
    headerContent: React.ReactNode,
    content: React.ReactNode
  ) => (
    <View key={section} style={styles.accordionSection}>
      <TouchableOpacity
        style={styles.accordionHeader}
        onPress={() => toggleSection(section)}
        activeOpacity={0.8}
      >
        {headerContent}
      </TouchableOpacity>
      {expandedSections[section] && (
        <View style={styles.accordionContent}>{content}</View>
      )}
    </View>
  );

  const renderSubsectionCollapsible = (
    id: string,
    title: string,
    count: number,
    content: React.ReactNode
  ) => (
    <View key={id} style={styles.subsectionWrapper}>
      <TouchableOpacity
        style={styles.subsectionHeader}
        onPress={() => toggleSubsection(id)}
        activeOpacity={0.8}
      >
        <View style={styles.subsectionHeaderContent}>
          <ThemedText style={styles.subsectionTitle}>{title}</ThemedText>
          <View style={styles.countBadge}>
            <ThemedText style={styles.countBadgeText}>{count}</ThemedText>
          </View>
        </View>
        {expandedSubsections[id] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </TouchableOpacity>
      {expandedSubsections[id] && (
        <View style={styles.subsectionContent}>{content}</View>
      )}
    </View>
  );

  const pendingPostsRuns = apifyRuns.filter(
    run => run.type !== 'stories' && (run.status === 'initiated' || run.status === 'running')
  );
  const pendingStoriesRuns = apifyRuns.filter(
    run => run.type === 'stories' && (run.status === 'initiated' || run.status === 'running')
  );

  const runHasProcessedEvents = (run: ApifyRun) => {
    const review = runReviews[run.runId];
    if (!review) return false;
    const processed = (review.events || []).some((event: any) => !!event.eventId);
    return processed;
  };

  const isRunClassified = (run: ApifyRun) => {
    const review = runReviews[run.runId];
    const total = (review?.events?.length || 0) + (review?.nonEvents?.length || 0);
    if (total > 0) return true;
    return !!classifiedStatsByRun[run.runId];
  };

  const completedRunsWithClassifications = apifyRuns
    .filter(run => ['COMPLETED', 'succeeded', 'failed'].includes(run.status))
    .filter(run => isRunClassified(run));

  const completedPostsRuns = apifyRuns
    .filter(run => run.type !== 'stories')
    .filter(run => ['COMPLETED', 'succeeded', 'failed'].includes(run.status))
    .filter(run => !isRunClassified(run));

  const completedStoriesRuns = apifyRuns
    .filter(run => run.type === 'stories')
    .filter(run => ['COMPLETED', 'succeeded', 'failed'].includes(run.status))
    .filter(run => !isRunClassified(run));

  const isWithinFilterRange = (run: ApifyRun) => {
    if (filterDays === -1) return true; // Show all
    const runDate = new Date(run.completedAt || run.initiatedAt).getTime();
    const cutoff = Date.now() - (filterDays * 24 * 60 * 60 * 1000);
    return runDate > cutoff;
  };

  const classifiedPostsRuns = completedRunsWithClassifications.filter(
    run => run.type !== 'stories' && !runHasProcessedEvents(run)
  );
  const processedPostsRuns = completedRunsWithClassifications.filter(
    run => run.type !== 'stories' && runHasProcessedEvents(run) && isWithinFilterRange(run)
  );

  const classifiedStoriesRuns = completedRunsWithClassifications.filter(
    run => run.type === 'stories' && !runHasProcessedEvents(run)
  );
  const processedStoriesRuns = completedRunsWithClassifications.filter(
    run => run.type === 'stories' && runHasProcessedEvents(run) && isWithinFilterRange(run)
  );

  const getLogCategories = (log: any): string[] => {
    const categories = new Set<string>();
    const push = (value?: any) => {
      if (typeof value === 'string' && value.trim()) {
        categories.add(value.trim().toLowerCase());
      }
    };
    push(log.runType);
    push(log.type);
    push(log.category);
    if (Array.isArray(log.runTypes)) {
      log.runTypes.forEach((value: any) => push(value));
    }
    if (Array.isArray(log.types)) {
      log.types.forEach((value: any) => push(value));
    }
    return Array.from(categories);
  };

  const shouldIncludeLog = (log: any, type: 'posts' | 'stories') => {
    const categories = getLogCategories(log);
    if (categories.includes(type)) return true;
    if (categories.length === 0 && type === 'posts') return true;
    return false;
  };

  const triggerTypedPoll = async (type: 'posts' | 'stories') => {
    const setPolling = type === 'posts' ? setIsPollingPosts : setIsPollingStories;
    setPolling(true);
    try {
      const response = await fetch(MANUAL_POLL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        Alert.alert('Error', data.error || 'Failed to trigger polling.');
      } else {
        Alert.alert('Success', 'Polling triggered successfully.');
        fetchApifyRuns();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to trigger polling.');
    } finally {
      setPolling(false);
    }
  };

  const renderScheduleCard = (type: 'posts' | 'stories') => {
    const repeat = scheduleRepeats[type];
    const startValue = scheduleStartTimes[type];
    const typeLabel = type === 'posts' ? 'Posts' : 'Stories';
    const filteredSchedules = schedules.filter(schedule => (schedule.runTypes || []).includes(type));

    return (
      <View style={styles.sectionCard}>
        <ThemedText type="subtitle" style={styles.sectionCardTitle}>Schedule {typeLabel} Runs</ThemedText>
        <Box sx={{ my: 1 }}><Divider /></Box>
        {Platform.OS === 'web' ? (
          repeat === 'daily' ? (
            <input
              type="time"
              value={startValue}
              onChange={(e) => setScheduleStartTimes(prev => ({ ...prev, [type]: (e.target as HTMLInputElement).value }))}
              style={styles.webDatePicker as any}
            />
          ) : (
            <input
              type="datetime-local"
              value={startValue}
              onChange={(e) => setScheduleStartTimes(prev => ({ ...prev, [type]: (e.target as HTMLInputElement).value }))}
              style={styles.webDatePicker as any}
            />
          )
        ) : (
          <View style={[styles.datePickerButton, { opacity: 0.85 }]}>
            <ThemedText>
              {repeat === 'daily' ? 'Pick time (web only in this build)' : 'Pick start time (web only in this build)'}
            </ThemedText>
          </View>
        )}
        <View style={{ marginTop: 12 }}>
          {Platform.OS === 'web' ? (
            <ToggleButtonGroup
              value={repeat}
              onChange={(_, v) => v && setScheduleRepeats(prev => ({ ...prev, [type]: v }))}
              size="small"
              exclusive
            >
              <ToggleButton value="once">One-time</ToggleButton>
              <ToggleButton value="daily">Daily</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </View>
        <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
          <MUIButton
            variant="contained"
            size="small"
            onClick={() => handleScheduleRunForType(type)}
            disabled={schedulingType === type}
          >
            {schedulingType === type ? 'Scheduling...' : 'Schedule Run'}
          </MUIButton>
        </View>
        <ThemedText type="subtitle" style={{ marginTop: 20, textAlign: 'center' }}>Upcoming Scheduled Runs</ThemedText>
        <Box sx={{ my: 1 }}><Divider /></Box>
        {isLoadingSchedules ? (
          <ActivityIndicator size="small" />
        ) : schedulesError ? (
          <ThemedText style={{ color: '#DC2626' }}>Error: {schedulesError}</ThemedText>
        ) : filteredSchedules.length === 0 ? (
          <ThemedText style={{ color: '#64748B' }}>No scheduled runs found.</ThemedText>
        ) : (
          <View style={{ gap: 8 }}>
            {filteredSchedules.map(schedule => (
              <View key={schedule.id} style={styles.scheduleItem}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: 'bold' }}>
                    {schedule.startAt ? formatDate(schedule.startAt) : 'No date'}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: '#64748B' }}>
                    Types: {schedule.runTypes?.join(', ') || 'N/A'}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: '#64748B' }}>
                    Repeat: {schedule.repeat || 'once'}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: '#64748B' }}>
                    Status: {schedule.status || 'N/A'}
                  </ThemedText>
                </View>
                <MUIButton variant="outlined" color="error" size="small" onClick={() => handleDeleteSchedule(schedule.id)} disabled={schedule.status === 'processing'}>
                  Delete
                </MUIButton>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderPendingRunCard = (run: ApifyRun, keyPrefix: string) => {
    const isOpen = !!expandedRuns[run.runId];
    return (
      <View key={`${keyPrefix}-${run.runId}`} style={[styles.runItem, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }} onPress={() => toggleRunCard(run.runId)}>
          <View style={[styles.runContent, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
            {isOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </View>
        </TouchableOpacity>
        {isOpen && (
          <View style={{ marginTop: 6, width: '100%' }}>
            <TouchableOpacity onPress={() => { setSelectedRun(run); setIsRunModalVisible(true); }}>
              <View>
                <ThemedText>Status: {run.status}</ThemedText>
                <ThemedText>Initiated: {formatDate(run.initiatedAt)}</ThemedText>
                {run.error && (<ThemedText style={{ color: '#DC2626' }}>Error: {run.error}</ThemedText>)}
              </View>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Tooltip title="Delete run"><span>
                <IconButton color="error" size="small" onClick={() => handleDeleteApifyRun(run.runId)} disabled={deletingRunId === run.runId}>
                  {deletingRunId === run.runId ? (<ActivityIndicator size="small" color="#ff4444" />) : (<DeleteOutlineIcon fontSize="small" />)}
                </IconButton>
              </span></Tooltip>
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderCompletedRunCard = (run: ApifyRun, keyPrefix: string) => {
    const isOpen = !!expandedRuns[run.runId];
    
    return (
      <View key={`${keyPrefix}-${run.runId}`} style={[styles.runItem, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }} onPress={() => toggleRunCard(run.runId)}>
          <View style={[styles.runContent, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
            {isOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </View>
        </TouchableOpacity>
        {isOpen && (
          <View style={{ marginTop: 6, width: '100%' }}>
            <ThemedText>Status: {run.status}</ThemedText>
            <ThemedText>Initiated: {formatDate(run.initiatedAt)}</ThemedText>
            {run.completedAt && (<ThemedText>Completed: {formatDate(run.completedAt)}</ThemedText>)}
            {run.error && (<ThemedText style={{ color: '#DC2626' }}>Error: {run.error}</ThemedText>)}
            
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <MUIButton variant="outlined" size="small" onClick={() => handleManualClassifyRun(run.runId)} disabled={classifyingRunId === run.runId}>
                {classifyingRunId === run.runId ? 'Classifying...' : 'Classify'}
              </MUIButton>
              <Tooltip title="Delete run"><span>
                <IconButton color="error" size="small" onClick={() => handleDeleteApifyRun(run.runId)} disabled={deletingRunId === run.runId}>
                  {deletingRunId === run.runId ? (<ActivityIndicator size="small" color="#ff4444" />) : (<DeleteOutlineIcon fontSize="small" />)}
                </IconButton>
              </span></Tooltip>
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderClassifiedRunRow = (run: ApifyRun, variant: 'classified' | 'processed') => {
    const review = runReviews[run.runId];
    const totalEventsList = review?.events || [];
    const processedEventsList = totalEventsList.filter((ev: any) => !!ev.eventId);
    const pendingEventsList = totalEventsList.filter((ev: any) => !ev.eventId);

    const eventsCount = pendingEventsList.length;
    const processedEventsCount = processedEventsList.length;
    const nonEventsCount = review?.nonEvents?.length ?? 0;
    const stats = classifiedStatsByRun[run.runId];
    const screenWidth = Dimensions.get('window').width;
    const isMobileView = screenWidth < 768;

    return (
      <TouchableOpacity
        key={`classified-${run.runId}`}
        style={[styles.runItem, { paddingRight: 12, flexDirection: 'column', alignItems: 'stretch' }]}
        onPress={async () => {
          const r = runReviews[run.runId];
          if (!r) {
            fetchRunReview(run);
            Alert.alert('Loading', 'Fetching run details. Please try again in a moment.');
            return;
          }
          const listToShow = (pendingEventsList.length > 0) ? pendingEventsList : (processedEventsList.length > 0 ? processedEventsList : r.nonEvents || []);
          if (listToShow.length === 0) {
            Alert.alert('No items', 'No classified items available for this run.');
            return;
          }
          await ensureApifyRaw(run.runId);
          setReviewList(listToShow);
          setReviewRunId(run.runId);
          setReviewCategory(pendingEventsList.length > 0 ? 'events' : (processedEventsList.length > 0 ? 'processed' : 'nonEvents'));
          setReviewIndex(0);
          setIsReviewModalVisible(true);
        }}
      >
        <View style={styles.runContent}>
          <View>
            <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
            {variant === 'processed' && (
              <ThemedText style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>
                {formatDate(run.completedAt || run.initiatedAt)}
              </ThemedText>
            )}
          </View>
          
          <ThemedText style={{ marginTop: 4 }}>
            Pending: {eventsCount}  •  Processed: {processedEventsCount}  •  Non-Events: {nonEventsCount}
          </ThemedText>
          {stats ? (
            <ThemedText style={{ color: '#64748B', marginTop: 2 }}>
              Processed items: {stats.processed}  •  Classified: {stats.classified}  •  Skipped: {stats.skipped}  •  Errors: {stats.errors}
            </ThemedText>
          ) : null}
        </View>
        <View style={[styles.classifiedButtonsContainer, isMobileView && styles.classifiedButtonsContainerMobile]}>
          {(variant === 'classified' || (variant === 'processed' && (stats?.errors || 0) > 0)) && (
            <MUIButton
              variant="contained"
              size="small"
              onClick={async (e: any) => {
                e?.stopPropagation?.();
                await handleProcessClassifiedRun(run.runId, false);
              }}
              disabled={processingRunId === run.runId}
            >
              {processingRunId === run.runId ? 'Processing...' : (variant === 'processed' ? 'Retry Errors' : 'Process')}
            </MUIButton>
          )}

          {variant === 'processed' && (
            <MUIButton
              variant="outlined"
              size="small"
              color="secondary"
              onClick={async (e: any) => {
                e?.stopPropagation?.();
                await handleProcessClassifiedRun(run.runId, true);
              }}
              disabled={reprocessingRunId === run.runId}
            >
              {reprocessingRunId === run.runId ? 'Reprocessing...' : 'Reprocess'}
            </MUIButton>
          )}

          {variant === 'classified' && (
            <MUIButton
              variant="outlined"
              size="small"
              color="warning"
              onClick={async (e: any) => {
                e?.stopPropagation?.();
                await handleReclassifyRun(run.runId);
              }}
              disabled={reclassifyingRunId === run.runId}
            >
              {reclassifyingRunId === run.runId ? 'Reclassifying...' : 'Reclassify'}
            </MUIButton>
          )}
          <MUIButton
            variant="outlined"
            size="small"
            color="success"
            onClick={async (e: any) => {
              e?.stopPropagation?.();
              if (processedEventsList.length === 0) {
                Alert.alert('No items', 'No processed events available for this run.');
                return;
              }
              await ensureApifyRaw(run.runId);
              setReviewList(processedEventsList);
              setReviewRunId(run.runId);
              setReviewCategory('processed');
              setReviewIndex(0);
              setIsReviewModalVisible(true);
            }}
          >
            Processed
          </MUIButton>
          <MUIButton
            variant="outlined"
            size="small"
            onClick={async (e: any) => {
              e?.stopPropagation?.();
              if (pendingEventsList.length === 0) {
                Alert.alert('No items', 'No pending events available for this run.');
                return;
              }
              setReviewList(pendingEventsList);
              setReviewRunId(run.runId);
              setReviewCategory('events');
              setReviewIndex(0);
              setIsReviewModalVisible(true);
            }}
          >
            Events
          </MUIButton>
          <MUIButton
            variant="outlined"
            size="small"
            onClick={async (e: any) => {
              e?.stopPropagation?.();
              let r = runReviews[run.runId];
              if (!r || r.loading) {
                const fetched = await fetchRunReview(run);
                r = fetched ? { loading: false, error: null, events: fetched.events, nonEvents: fetched.nonEvents } as any : runReviews[run.runId];
              }
              if (!r) {
                Alert.alert('Loading', 'Fetching run details. Please try again in a moment.');
                return;
              }
              const listToShow = r.nonEvents || [];
              if (listToShow.length === 0) {
                Alert.alert('No items', 'No non-events available for this run.');
                return;
              }
              setReviewList(listToShow);
              setReviewRunId(run.runId);
              setReviewCategory('nonEvents');
              setReviewIndex(0);
              setIsReviewModalVisible(true);
            }}
          >
            Non-Events
          </MUIButton>
          <Tooltip title="Delete run"><span>
            <IconButton
              color="error"
              size="small"
              onClick={(e: any) => { e?.stopPropagation?.(); handleDeleteApifyRun(run.runId); }}
              disabled={deletingRunId === run.runId}
            >
              {deletingRunId === run.runId ? (
                <ActivityIndicator size="small" color="#ff4444" />
              ) : (
                <DeleteOutlineIcon fontSize="small" />
              )}
            </IconButton>
          </span></Tooltip>
        </View>
      </TouchableOpacity>
    );
  };

  const renderProcessedRunsSection = (type: 'posts' | 'stories') => {
    if (isLoadingEvents) {
      return <ActivityIndicator size="small" />;
    }
    if (fetchError) {
      return <ThemedText style={{ color: '#DC2626' }}>Error: {fetchError}</ThemedText>;
    }
    
    const runs = type === 'stories' 
      ? [...processedStoriesRuns, ...classifiedStoriesRuns] 
      : [...processedPostsRuns, ...classifiedPostsRuns];

    if (runs.length === 0) {
      return (
        <ThemedText style={{ color: '#64748B' }}>
          {type === 'stories' ? 'No processed stories runs.' : 'No processed posts runs.'}
        </ThemedText>
      );
    }
    
    const sortedRuns = runs.sort((a, b) => {
      const timeA = new Date(a.completedAt || a.initiatedAt).getTime();
      const timeB = new Date(b.completedAt || b.initiatedAt).getTime();
      return timeB - timeA;
    });

    return (
      <View style={{ gap: 8 }}>
        {sortedRuns.map(run => renderClassifiedRunRow(run, 'processed'))}
      </View>
    );
  };

  const renderErrorLogsSection = (type: 'posts' | 'stories') => {
    if (isLoadingLogs) {
      return <ActivityIndicator size="small" />;
    }
    if (logsError) {
      return <ThemedText style={{ color: '#DC2626' }}>Error loading logs: {logsError}</ThemedText>;
    }
    const relevantLogs = pollingLogs.filter(log => shouldIncludeLog(log, type));
    const logsWithErrors = relevantLogs.filter(log => {
      if (Array.isArray(log.errors)) {
        return log.errors.length > 0;
      }
      return !!log.errors;
    });
    if (logsWithErrors.length === 0) {
      return (
        <ThemedText style={{ color: '#64748B' }}>
          {type === 'stories' ? 'No stories errors found in recent polling logs.' : 'No posts errors found in recent polling logs.'}
        </ThemedText>
      );
    }
    return (
      <View style={{ gap: 8 }}>
        {logsWithErrors.map(log => {
          const errorsArray = Array.isArray(log.errors) ? log.errors : [log.errors];
          return (
            <View key={log.id} style={{ padding: 8, backgroundColor: '#FFFBEB', borderRadius: 4 }}>
              <ThemedText style={{ fontWeight: 'bold' }}>
                {formatDate(log.timestamp)}
              </ThemedText>
              {errorsArray.map((error: any, index: number) => (
                <ThemedText key={index} style={{ color: '#B45309', marginTop: 4 }}>
                  - {typeof error === 'object' ? JSON.stringify(error) : error}
                </ThemedText>
              ))}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#F1F5F9', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ThemedText style={{ fontSize: 13, color: '#64748B' }}>Show processed from last:</ThemedText>
        <ToggleButtonGroup
          value={filterDays}
          exclusive
          onChange={(_, v) => v !== null && setFilterDays(v)}
          size="small"
        >
          <ToggleButton value={1}>24h</ToggleButton>
          <ToggleButton value={7}>7d</ToggleButton>
          <ToggleButton value={30}>30d</ToggleButton>
          <ToggleButton value={-1}>All</ToggleButton>
        </ToggleButtonGroup>
      </View>

      <ThemedView style={styles.section}>
        {renderAccordionSection('posts',
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 4 }}> 
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ThemedText style={styles.accordionTitle}>Posts</ThemedText>
              <View style={{ width: 24 }} />
              <ToggleButtonGroup
                value={postsModel}
                exclusive
                onChange={(_, v) => v && setPostsModel(v)}
                size="small"
                onClick={(e) => e.stopPropagation()}
                sx={{ height: '26px', marginRight: '12px' }}
              >
                <ToggleButton value="openai" sx={{ fontSize: '10px', padding: '1px 6px', height: '26px' }}>GPT</ToggleButton>
                <ToggleButton value="gemini" sx={{ fontSize: '10px', padding: '1px 6px', height: '26px' }}>Gem</ToggleButton>
              </ToggleButtonGroup>
            </View>
            <ChevronRightIcon fontSize="small" style={{ color: '#64748B', transform: [{ rotate: expandedSections['posts'] ? '90deg' : '0deg' }] }} />
          </View>,
          <>
            {renderSubsectionCollapsible(
              'posts-schedule',
              'Schedule',
              schedules.filter(s => (s.runTypes || []).includes('posts')).length,
              renderScheduleCard('posts')
            )}

            {renderSubsectionCollapsible(
              'posts-pending',
              'Pending',
              pendingPostsRuns.length,
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <MUIButton
                    variant="outlined"
                    size="small"
                    startIcon={<PlayArrowIcon />}
                    onClick={() => triggerTypedPoll('posts')}
                    disabled={isPollingPosts}
                  >
                    {isPollingPosts ? 'Polling...' : 'Poll'}
                  </MUIButton>
                </View>
                {isLoadingRuns ? (
                  <ActivityIndicator size="small" />
                ) : pendingPostsRuns.length === 0 ? (
                  <ThemedText style={{ color: '#64748B' }}>No pending runs.</ThemedText>
                ) : (
                  pendingPostsRuns.map(run => renderPendingRunCard(run, 'pending-post'))
                )}
              </View>
            )}

            {renderSubsectionCollapsible(
              'posts-completed',
              'Ready for AI',
              completedPostsRuns.length,
              isLoadingRuns ? (
                <ActivityIndicator size="small" />
              ) : completedPostsRuns.length === 0 ? (
                <ThemedText style={{ color: '#64748B' }}>No runs waiting for AI.</ThemedText>
              ) : (
                <View style={{ gap: 8 }}>
                  {completedPostsRuns.map(run => renderCompletedRunCard(run, 'completed-post'))}
                </View>
              )
            )}

            {renderSubsectionCollapsible(
              'posts-processed',
              'AI Finished',
              processedPostsRuns.length + classifiedPostsRuns.length,
              renderProcessedRunsSection('posts')
            )}

            {renderSubsectionCollapsible(
              'posts-errors',
              'Errors',
              pollingLogs.filter(log => shouldIncludeLog(log, 'posts') && (Array.isArray(log.errors) ? log.errors.length > 0 : !!log.errors)).length,
              renderErrorLogsSection('posts')
            )}
          </>
        )}

        {renderAccordionSection('stories',
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 4 }}> 
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ThemedText style={styles.accordionTitle}>Stories</ThemedText>
              <View style={{ width: 24 }} />
              <ToggleButtonGroup
                value={storiesModel}
                exclusive
                onChange={(_, v) => v && setStoriesModel(v)}
                size="small"
                onClick={(e) => e.stopPropagation()}
                sx={{ height: '26px', marginRight: '12px' }}
              >
                <ToggleButton value="openai" sx={{ fontSize: '10px', padding: '1px 6px', height: '26px' }}>GPT</ToggleButton>
                <ToggleButton value="gemini" sx={{ fontSize: '10px', padding: '1px 6px', height: '26px' }}>Gem</ToggleButton>
              </ToggleButtonGroup>
            </View>
            <ChevronRightIcon fontSize="small" style={{ color: '#64748B', transform: [{ rotate: expandedSections['stories'] ? '90deg' : '0deg' }] }} />
          </View>,
          <>
            {renderSubsectionCollapsible(
              'stories-schedule',
              'Schedule',
              schedules.filter(s => (s.runTypes || []).includes('stories')).length,
              renderScheduleCard('stories')
            )}

            {renderSubsectionCollapsible(
              'stories-pending',
              'Pending',
              pendingStoriesRuns.length,
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <MUIButton
                    variant="outlined"
                    size="small"
                    startIcon={<PlayArrowIcon />}
                    onClick={() => triggerTypedPoll('stories')}
                    disabled={isPollingStories}
                  >
                    {isPollingStories ? 'Polling...' : 'Poll'}
                  </MUIButton>
                </View>
                {isLoadingRuns ? (
                  <ActivityIndicator size="small" />
                ) : pendingStoriesRuns.length === 0 ? (
                  <ThemedText style={{ color: '#64748B' }}>No pending runs.</ThemedText>
                ) : (
                  pendingStoriesRuns.map(run => renderPendingRunCard(run, 'pending-story'))
                )}
              </View>
            )}

            {renderSubsectionCollapsible(
              'stories-completed',
              'Ready for AI',
              completedStoriesRuns.length,
              isLoadingRuns ? (
                <ActivityIndicator size="small" />
              ) : completedStoriesRuns.length === 0 ? (
                <ThemedText style={{ color: '#64748B' }}>No runs waiting for AI.</ThemedText>
              ) : (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <MUIButton
                      variant="outlined"
                      size="small"
                      onClick={async () => {
                        for (const run of completedStoriesRuns) {
                          await handleManualClassifyRun(run.runId);
                        }
                      }}
                    >
                      Classify All Stories
                    </MUIButton>
                  </View>
                  {completedStoriesRuns.map(run => renderCompletedRunCard(run, 'completed-story'))}
                </View>
              )
            )}

            {renderSubsectionCollapsible(
              'stories-processed',
              'AI Finished',
              processedStoriesRuns.length + classifiedStoriesRuns.length,
              renderProcessedRunsSection('stories')
            )}

            {renderSubsectionCollapsible(
              'stories-errors',
              'Errors',
              pollingLogs.filter(log => shouldIncludeLog(log, 'stories') && (Array.isArray(log.errors) ? log.errors.length > 0 : !!log.errors)).length,
              renderErrorLogsSection('stories')
            )}
          </>
        )}

        <Modal
          animationType="slide"
          transparent={true}
          visible={isModalVisible}
          onRequestClose={() => {
            setIsModalVisible(!isModalVisible);
          }}>
          <View style={styles.modalContainer}>
            <View style={styles.modalView}>
              {selectedEvent && (
                <ScrollView>
                  <ThemedText style={styles.modalTitle}>{selectedEvent.name}</ThemedText>
                  {selectedEvent.photoUrl && (
                    <Image source={{ uri: selectedEvent.photoUrl }} style={styles.modalImage} />
                  )}
                  <ThemedText style={styles.modalSectionTitle}>Venue</ThemedText>
                  <ThemedText>{selectedEvent.venue?.name}</ThemedText>
                  <ThemedText style={styles.modalMutedText}>{selectedEvent.venue?.address}</ThemedText>

                  <ThemedText style={styles.modalSectionTitle}>Date & Time</ThemedText>
                  <ThemedText>Starts: {formatDate(selectedEvent.date.start)}</ThemedText>
                  {selectedEvent.date.end && (
                    <ThemedText>Ends: {formatDate(selectedEvent.date.end)}</ThemedText>
                  )}

                  {selectedEvent.pricing && (
                    <>
                      <ThemedText style={styles.modalSectionTitle}>Pricing</ThemedText>
                      <ThemedText>{selectedEvent.pricing}</ThemedText>
                    </>
                  )}

                  {selectedEvent.tags?.length > 0 && (
                    <>
                      <ThemedText style={styles.modalSectionTitle}>Tags</ThemedText>
                      <View style={styles.tagsContainer}>
                        {selectedEvent.tags.map((tag: string, index: number) => (
                          <Chip key={index} label={tag} size="small" style={styles.tag} />
                        ))}
                      </View>
                    </>
                  )}

                  <ThemedText style={styles.modalSectionTitle}>Source</ThemedText>
                  <ThemedText>Platform: {selectedEvent.source?.platform}</ThemedText>
                  {selectedEvent.source?.url && (
                    <ThemedText style={styles.modalMutedText}>{selectedEvent.source.url}</ThemedText>
                  )}

                </ScrollView>
              )}
              <MUIButton variant="outlined" size="small" onClick={() => setIsModalVisible(false)} style={{ marginTop: 16 }}>
                Close
              </MUIButton>
            </View>
          </View>
        </Modal>

        {/* Completed Run Details Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={isRunModalVisible}
          onRequestClose={() => {
            setIsRunModalVisible(false);
          }}>
          <View style={styles.modalContainer}>
            <View style={styles.modalView}>
              {selectedRun && (
                <ScrollView>
                  <ThemedText style={styles.modalTitle}>Run Details</ThemedText>
                  <ThemedText style={{ fontWeight: 'bold' }}>Run ID: {selectedRun.runId}</ThemedText>
                  <ThemedText>Status: {selectedRun.status}</ThemedText>
                  <ThemedText>Initiated: {formatDate(selectedRun.initiatedAt)}</ThemedText>
                  {selectedRun.completedAt && (
                    <ThemedText>Completed: {formatDate(selectedRun.completedAt)}</ThemedText>
                  )}
                  {selectedRun.error && (
                    <ThemedText style={{ color: '#DC2626' }}>Error: {selectedRun.error}</ThemedText>
                  )}
                </ScrollView>
              )}
              <MUIButton variant="outlined" size="small" onClick={() => setIsRunModalVisible(false)} style={{ marginTop: 16 }}>
                Close
              </MUIButton>
            </View>
          </View>
        </Modal>

        {/* Review Item Modal */
        }
        <Modal
          animationType="slide"
          transparent={true}
          visible={isReviewModalVisible}
          onRequestClose={() => setIsReviewModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            <View style={[styles.modalView, { flexDirection: 'column', maxHeight: '95%' }]}>
              {/* Fixed Header with Close Button */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingBottom: 12 }}>
                <ThemedText style={styles.modalTitle}>
                  Review {reviewCategory === 'events' ? 'Pending Events' : (reviewCategory === 'processed' ? 'Processed Events' : 'Non-Events')}
                </ThemedText>
                <MUIButton
                  variant="text"
                  size="small"
                  onClick={() => setIsReviewModalVisible(false)}
                  sx={{ minWidth: '32px', width: '32px', height: '32px', padding: '0px' }}
                >
                  ✕
                </MUIButton>
              </View>

              {/* Single Unified Scroll */}
              {reviewList && reviewList.length > 0 && (
                <ScrollView style={{ flex: 1, marginBottom: 12 }}>
                  {/* Image */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    const rawUrl = current.imageUrl || pickImageUrl(current) || null;
                    if (!rawUrl) return null;
                    const proxied = `https://us-central1-discovery-admin-f87ce.cloudfunctions.net/proxyInstagramImage?imageUrl=${encodeURIComponent(rawUrl)}`;
                    const desiredHeight = Math.min(modalImageHeight, 320);
                    return (
                      <Image source={{ uri: proxied }} style={[styles.reviewImage, { height: desiredHeight }]} resizeMode="contain" />
                    );
                  })()}

                  {/* Caption */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {}; return current.caption ? (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Caption</ThemedText>
                        <ThemedText style={{ marginTop: 0 }}>{current.caption}</ThemedText>
                      </View>
                    ) : null;
                  })()}

                  {/* Reasons */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    return Array.isArray(current.reasons) && current.reasons.length > 0 ? (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Reasons</ThemedText>
                        <ThemedText style={{ color: '#64748B' }}>{current.reasons.join(', ')}</ThemedText>
                      </View>
                    ) : null;
                  })()}

                  {/* Model */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    return current.model ? (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Model</ThemedText>
                        <ThemedText style={{ color: '#64748B', fontSize: 11 }}>{JSON.stringify(current.model)}</ThemedText>
                      </View>
                    ) : null;
                  })()}

                  {/* Signals */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    return current.signals ? (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Signals</ThemedText>
                        <ThemedText style={{ color: '#64748B', fontSize: 11 }}>{JSON.stringify(current.signals)}</ThemedText>
                      </View>
                    ) : null;
                  })()}

                  {/* Detected Date & Venue */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    return current.signals && (current.signals.dateFound === true || current.signals.venueFound === true) ? (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Detected Information</ThemedText>
                        {current.signals.dateFound === true && (() => {
                          const s = current.signals || {};
                          const dateDetail = s.dateISONormalized || s.dateISO || s.date || s.dateText || s.dateString || null;
                          return (
                            <View style={{ marginBottom: 6 }}>
                              <ThemedText style={{ fontSize: 11, color: '#475569' }}>📅 <ThemedText style={{ fontWeight: 'bold' }}>Date:</ThemedText> {typeof dateDetail === 'string' ? dateDetail : (dateDetail ? JSON.stringify(dateDetail) : 'Detected')}</ThemedText>
                            </View>
                          );
                        })()}
                        {current.signals.venueFound === true && (() => {
                          const s = current.signals || {};
                          const venueDetail = current.detectedVenueName || s.matchedVenueName || s.matchedVenue?.name || s.venueName || s.venue?.name || s.venue || s.venueObject || null;
                          const hasError = !!current.error && current.error.includes('Venue not found');
                          return (
                            <View style={{ marginBottom: 0 }}>
                              <ThemedText style={{ fontSize: 11, color: '#475569' }}>📍 <ThemedText style={{ fontWeight: 'bold' }}>Venue:</ThemedText> {typeof venueDetail === 'string' ? venueDetail : (venueDetail ? JSON.stringify(venueDetail) : 'Detected')}</ThemedText>
                              {hasError && (
                                <MUIButton 
                                  variant="outlined" 
                                  size="small" 
                                  onClick={() => { 
                                    let query = typeof venueDetail === 'string' ? venueDetail : '';
                                    if (!query && current.error?.includes('Venue not found')) {
                                      const match = current.error.match(/"([^"]+)"/);
                                      if (match) query = match[1];
                                    }
                                    setVenueSearchQuery(query); 
                                    setIsVenuePickerVisible(true); 
                                  }}
                                  sx={{ mt: 1, textTransform: 'none', fontSize: '10px', py: 0 }}
                                >
                                  Link to Existing Venue
                                </MUIButton>
                              )}
                            </View>
                          );
                        })()}
                      </View>
                    ) : null;
                  })()}

                  {/* Confidence & Status */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    return (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Status</ThemedText>
                        {typeof current.confidence === 'number' && (
                          <ThemedText style={{ color: '#64748B', marginBottom: 6 }}>✓ <ThemedText style={{ fontWeight: 'bold' }}>Confidence:</ThemedText> {(current.confidence * 100).toFixed(0)}%</ThemedText>
                        )}
                        {current.error && (
                          <ThemedText style={{ color: '#DC2626', marginBottom: 6 }}>✗ <ThemedText style={{ fontWeight: 'bold' }}>Error:</ThemedText> {current.error}</ThemedText>
                        )}
                        {!current.error && !current.eventId && (
                          <ThemedText style={{ color: '#F59E0B' }}>⏳ Pending processing</ThemedText>
                        )}
                        {current.eventId && (
                          <ThemedText style={{ color: '#10B981' }}>✓ <ThemedText style={{ fontWeight: 'bold' }}>Processed</ThemedText> (Event ID: {current.eventId})</ThemedText>
                        )}
                      </View>
                    );
                  })()}

                  {/* Raw Apify Item */}
                  {(() => {
                    const runId = reviewRunId || '';
                    const itemKey = (reviewList[reviewIndex] || {}).itemId || (reviewList[reviewIndex] || {}).id;
                    const raw = (runId && itemKey && apifyRawByRun[runId]?.itemsById) ? apifyRawByRun[runId].itemsById[String(itemKey)] : null;
                    return raw ? (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Raw Item (Apify)</ThemedText>
                        <ScrollView style={{ maxHeight: 200, padding: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4 }}>
                          <ThemedText style={{ color: '#0F172A', fontSize: 10, ...(Platform.OS === 'web' ? { fontFamily: 'monospace', whiteSpace: 'pre-wrap' } as any : {}) }}>
                            {JSON.stringify(raw, null, 2)}
                          </ThemedText>
                        </ScrollView>
                      </View>
                    ) : null;
                  })()}

                  {/* Classification Output */}
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    return (
                      <View style={{ marginBottom: 12 }}>
                        <ThemedText style={{ fontWeight: 'bold', fontSize: 12, color: '#64748B', marginBottom: 4 }}>Full Classification Data</ThemedText>
                        <ScrollView style={{ maxHeight: 200, padding: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4 }}>
                          <ThemedText style={{ color: '#0F172A', fontSize: 10, ...(Platform.OS === 'web' ? { fontFamily: 'monospace', whiteSpace: 'pre-wrap' } as any : {}) }}>
                            {JSON.stringify(current, null, 2)}
                          </ThemedText>
                        </ScrollView>
                      </View>
                    );
                  })()}
                </ScrollView>
              )}

              {/* Fixed Bottom Navigation & Actions */}
              <View style={{ borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 12 }}>
                {/* Navigation */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <IconButton size="small" onClick={() => setReviewIndex(i => Math.max(0, i - 1))} disabled={reviewIndex === 0}>
                    <ChevronLeftIcon fontSize="small" />
                  </IconButton>
                  <ThemedText style={{ fontSize: 12, color: '#64748B' }}>{reviewList.length > 0 ? `Item ${reviewIndex + 1} of ${reviewList.length}` : ''}</ThemedText>
                  <IconButton size="small" onClick={() => setReviewIndex(i => Math.min(reviewList.length - 1, i + 1))} disabled={reviewIndex >= reviewList.length - 1}>
                    <ChevronRightIcon fontSize="small" />
                  </IconButton>
                </View>
                {/* Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {(() => {
                    const current = reviewList[reviewIndex] || {};
                    if (current.error) {
                      return (
                        <MUIButton
                          variant="contained"
                          size="small"
                          onClick={async () => {
                            if (!reviewRunId) return;
                            const itemId = current.itemId || current.id;
                            if (!itemId) return;
                            try {
                              setRetryingItemId(itemId);
                              const resp = await fetch(RETRY_ITEM_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ runId: reviewRunId, itemId, model: extractionModel })
                              });
                              const data = await resp.json();
                              if (!resp.ok) throw new Error(data.error || 'Retry failed');
                              const updated = data.updated || {};
                              setReviewList(prev => {
                                const copy = [...prev];
                                const idx = reviewIndex;
                                copy[idx] = { ...copy[idx], ...updated, error: null };
                                return copy;
                              });
                              if (reviewRunId && runReviews[reviewRunId]) {
                                setRunReviews(prev => {
                                  const cur = prev[reviewRunId];
                                  const listKey = reviewCategory === 'events' ? 'events' : 'nonEvents';
                                  const isEventNow = !!updated.isEvent;
                                  const updatedItem = { ...(runReviews[reviewRunId] as any)[listKey]?.[reviewIndex], ...updated };
                                  const next = { ...prev } as any;
                                  next[reviewRunId] = {
                                    ...cur,
                                    events: (cur.events || []).filter((it: any) => (it.itemId || it.id) !== (itemId)).concat(isEventNow ? [updatedItem] : []),
                                    nonEvents: (cur.nonEvents || []).filter((it: any) => (it.itemId || it.id) !== (itemId)).concat(!isEventNow ? [updatedItem] : []),
                                  };
                                  return next;
                                });
                              }
                              if ((updated.isEvent && reviewCategory === 'nonEvents') || (!updated.isEvent && reviewCategory === 'events')) {
                                const r = runReviews[reviewRunId];
                                const newList = updated.isEvent ? r?.events || [] : r?.nonEvents || [];
                                setReviewList(newList);
                                setReviewCategory(updated.isEvent ? 'events' : 'nonEvents');
                                setReviewIndex(Math.max(0, newList.findIndex((x: any) => (x.itemId || x.id) === (itemId))));
                              }
                              Alert.alert('Success', 'Classification retried.');
                            } catch (e: any) {
                              Alert.alert('Error', e.message || 'Failed to retry classification');
                            } finally {
                              setRetryingItemId(null);
                            }
                          }}
                          disabled={retryingItemId === (current.itemId || current.id)}
                        >
                          {retryingItemId === (current.itemId || current.id) ? 'Retrying…' : '🔄 Retry'}
                        </MUIButton>
                      );
                    }
                    return null;
                  })()}
                  <MUIButton
                    variant="outlined"
                    size="small"
                    color="error"
                    onClick={async () => {
                      if (!reviewRunId) return;
                      const current = reviewList[reviewIndex] || {};
                      const itemId = current.itemId || current.id;
                      if (!itemId) return;
                      const confirm = (Platform.OS === 'web' && typeof window !== 'undefined') ? window.confirm('Delete this classification entry?') : true;
                      if (!confirm) return;
                      try {
                        const resp = await fetch(DELETE_CLASS_ITEM_URL, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ runId: reviewRunId, itemId })
                        });
                        const data = await resp.json();
                        if (!resp.ok || !data.success) throw new Error(data.error || 'Delete failed');
                        setReviewList(prev => prev.filter((x: any, idx: number) => idx !== reviewIndex));
                        setRunReviews(prev => {
                          const cur = prev[reviewRunId!];
                          if (!cur) return prev;
                          const listKey = reviewCategory === 'events' ? 'events' : 'nonEvents';
                          const targetId = itemId;
                          const next = { ...prev } as any;
                          next[reviewRunId!] = {
                            ...cur,
                            events: (cur.events || []).filter((it: any) => (it.itemId || it.id) !== targetId),
                            nonEvents: (cur.nonEvents || []).filter((it: any) => (it.itemId || it.id) !== targetId),
                          };
                          return next;
                        });
                        setReviewIndex(i => Math.max(0, Math.min(i, (reviewList.length - 2))));
                        Alert.alert('Deleted', 'Classification entry deleted.');
                      } catch (e: any) {
                        Alert.alert('Error', e.message || 'Failed to delete entry');
                      }
                    }}
                  >
                    🗑️ Delete
                  </MUIButton>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        {/* Custom Confirmation Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={isConfirmModalVisible}
          onRequestClose={() => setIsConfirmModalVisible(false)}>
          <View style={styles.modalContainer}>
            <View style={styles.modalView}>
              <ThemedText style={styles.modalTitle}>Confirm Deletion</ThemedText>
              <ThemedText>Are you sure you want to delete schedule {confirmModalScheduleId}?</ThemedText>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 }}>
                <MUIButton variant="outlined" onClick={() => setIsConfirmModalVisible(false)}>
                  Cancel
                </MUIButton>
                <MUIButton
                  variant="contained"
                  color="error"
                  onClick={async () => {
                    setIsConfirmModalVisible(false); // Close modal immediately
                    console.log('Confirm Modal Delete button pressed. Attempting fetch...');
                    try {
                      const response = await fetch(DELETE_SCHEDULE_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ scheduleId: confirmModalScheduleId }),
                      });
                      const data = await response.json();
                      if (!response.ok || !data.success) {
                        Alert.alert('Error', data.error || 'Failed to delete schedule.');
                      } else {
                        Alert.alert('Success', 'Schedule deleted successfully.');
                        fetchSchedules(); // Refresh list
                      }
                    } catch (e: any) {
                      console.error('Error during delete fetch:', e);
                      Alert.alert('Error', e.message || 'An error occurred while deleting the schedule.');
                    }
                  }}>
                  Delete
                </MUIButton>
              </View>
            </View>
          </View>
        </Modal>

        {/* Venue Picker Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={isVenuePickerVisible}
          onRequestClose={() => setIsVenuePickerVisible(false)}
        >
          <View style={styles.modalContainer}>
            <View style={[styles.modalView, { maxHeight: '90%' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <ThemedText style={styles.modalTitle}>Link to Venue</ThemedText>
                <TouchableOpacity onPress={() => setIsVenuePickerVisible(false)}>
                  <ThemedText style={{ color: '#007AFF' }}>Close</ThemedText>
                </TouchableOpacity>
              </View>

              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: '#ddd',
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 16,
                  fontSize: 16
                }}
                placeholder="Search venues..."
                value={venueSearchQuery}
                onChangeText={setVenueSearchQuery}
              />

              {isMatchingVenue ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="large" />
                  <ThemedText style={{ marginTop: 10 }}>Updating and processing...</ThemedText>
                </View>
              ) : (
                <FlatList
                  data={filteredVenues}
                  keyExtractor={item => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      onPress={() => handleManualVenueLink(item)}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: '#f0f0f0'
                      }}
                    >
                      <ThemedText style={{ fontWeight: 'bold' }}>{item.name}</ThemedText>
                      <ThemedText style={{ fontSize: 12, color: '#666' }} numberOfLines={1}>
                        {item.address}
                      </ThemedText>
                      {item.nameVariations?.length > 0 && (
                        <ThemedText style={{ fontSize: 10, color: '#999', fontStyle: 'italic' }}>
                          Aliases: {item.nameVariations.join(', ')}
                        </ThemedText>
                      )}
                    </TouchableOpacity>
                  )}
                  style={{ maxHeight: 400 }}
                  ListEmptyComponent={<ThemedText style={{ textAlign: 'center', padding: 20, color: '#999' }}>No venues found</ThemedText>}
                />
              )}
            </View>
          </View>
        </Modal>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  accordionSection: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
  },
  accordionHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accordionTitle: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  accordionContent: {
    padding: 16,
    gap: 12,
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
  datePickerButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  eventItem: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#f9f9f9',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#eee',
  },
  eventImage: {
    width: 50,
    height: 50,
    borderRadius: 4,
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
  runIdText: {
    fontWeight: 'bold',
  },
  sectionCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#FAFAFA',
    gap: 8,
  },
  sectionCardTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scheduleItem: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalImage: {
    width: '100%',
    height: 200,
    borderRadius: 4,
    resizeMode: 'cover',
    marginBottom: 12,
  },
  reviewImage: {
    width: '100%',
    maxHeight: 320,
    borderRadius: 4,
    marginBottom: 12,
  },
  modalSectionTitle: {
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  modalMutedText: {
    fontSize: 12,
    color: '#64748B',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    backgroundColor: '#E2E8F0',
    color: '#2D3748',
  },
  classifiedButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  classifiedButtonsContainerMobile: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subsectionWrapper: {
    marginBottom: 12,
  },
  subsectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
  },
  subsectionHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  countBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  subsectionContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FAFAFA',
    gap: 8,
  },
});
