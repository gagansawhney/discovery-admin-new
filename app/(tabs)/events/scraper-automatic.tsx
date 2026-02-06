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
import { ActivityIndicator, Alert, Dimensions, Image, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

const SCHEDULE_SCRAPE_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/scheduleScrape';
const MANUAL_POLL_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/manualPollApifyRuns';
const DELETE_SCHEDULE_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteSchedule';
const GET_RUNS_LIST_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunsList';
const DELETE_APIFY_RUN_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteApifyRun';
const CLASSIFY_RUN_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/classifyApifyRun';
const PROCESS_CLASSIFIED_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/processClassifiedRun';
const RETRY_ITEM_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/retryClassifyItem';
const DELETE_CLASS_ITEM_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteClassificationItem';
const GET_APIFY_RESULTS_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunResults';

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
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [classifiedStatsByRun, setClassifiedStatsByRun] = useState<Record<string, { processed: number; classified: number; skipped: number; errors: number }>>({});
  const [nonEvents, setNonEvents] = useState<any[]>([]);
  const [isLoadingNonEvents, setIsLoadingNonEvents] = useState<boolean>(true);
  const [nonEventsError, setNonEventsError] = useState<string | null>(null);
  const [runReviews, setRunReviews] = useState<Record<string, { loading: boolean; error: string | null; events: any[]; nonEvents: any[] }>>({});
  const [isReviewModalVisible, setIsReviewModalVisible] = useState(false);
  const [reviewList, setReviewList] = useState<any[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number>(0);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [reviewCategory, setReviewCategory] = useState<'events' | 'nonEvents'>('events');
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const screenHeight = Dimensions.get('window').height;
  const modalImageHeight = Math.max(400, Math.floor(screenHeight * 0.65));
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const toggleRunCard = (runId: string) => setExpandedRuns(prev => ({ ...prev, [runId]: !prev[runId] }));
  const [expandedSections, setExpandedSections] = useState<{ schedule: boolean; posts: boolean; stories: boolean }>({
    schedule: false,
    posts: false,
    stories: false,
  });
  const toggleSection = (section: keyof typeof expandedSections) =>
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));

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

  // New state for custom confirmation modal
  const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false);
  const [confirmModalScheduleId, setConfirmModalScheduleId] = useState<string | null>(null);

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

  const handleDeleteApifyRun = async (runId: string) => {
    const message = `Are you sure you want to delete this run and all its scraped data? This action cannot be undone.`;
    let shouldDelete = false;
    if (Platform.OS === 'web') {
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
    setClassifyingRunId(runId);
    try {
      const classifyResp = await fetch(CLASSIFY_RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId })
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

  const handleProcessClassifiedRun = async (runId: string) => {
    setProcessingRunId(runId);
    try {
      const processResp = await fetch(PROCESS_CLASSIFIED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId })
      });
      const processData = await processResp.json();
      if (!processResp.ok || !processData.success) {
        throw new Error(processData.error || 'Failed to process classified events');
      }
      Alert.alert('Success', 'Processing completed.');
      await fetchRunReview({ runId } as any);
      await ensureApifyRaw(runId);
      fetchApifyRuns();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to process classified events');
    } finally {
      setProcessingRunId(null);
    }
  };

  const pickImageUrl = (item: any): string | null => {
    const candidates = [item?.displayUrl, item?.thumbnailUrl, item?.thumbnail, item?.mediaUrl, item?.media, item?.image, item?.url];
    for (const c of candidates) {
      if (typeof c === 'string' && c && !c.includes('.mp4')) return c;
    }
    return null;
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
        <View style={styles.accordionHeaderContent}>{headerContent}</View>
        {expandedSections[section] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </TouchableOpacity>
      {expandedSections[section] && (
        <View style={styles.accordionContent}>{content}</View>
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

  const classifiedPostsRuns = completedRunsWithClassifications.filter(
    run => run.type !== 'stories' && !runHasProcessedEvents(run)
  );
  const processedPostsRuns = completedRunsWithClassifications.filter(
    run => run.type !== 'stories' && runHasProcessedEvents(run)
  );

  const classifiedStoriesRuns = completedRunsWithClassifications.filter(
    run => run.type === 'stories' && !runHasProcessedEvents(run)
  );
  const processedStoriesRuns = completedRunsWithClassifications.filter(
    run => run.type === 'stories' && runHasProcessedEvents(run)
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
          <View style={{ marginTop: 6 }}>
            <ThemedText>Status: {run.status}</ThemedText>
            <ThemedText>Initiated: {formatDate(run.initiatedAt)}</ThemedText>
            {run.completedAt && (<ThemedText>Completed: {formatDate(run.completedAt)}</ThemedText>)}
            {run.error && (<ThemedText style={{ color: '#DC2626' }}>Error: {run.error}</ThemedText>)}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
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
    const eventsCount = review?.events?.length ?? 0;
    const processedEventsCount = review?.events?.filter((event: any) => !!event.eventId)?.length ?? 0;
    const nonEventsCount = review?.nonEvents?.length ?? 0;
    const stats = classifiedStatsByRun[run.runId];
    return (
      <TouchableOpacity
        key={`classified-${run.runId}`}
        style={[styles.runItem, { paddingRight: 12 }]}
        onPress={async () => {
          const r = runReviews[run.runId];
          if (!r) {
            fetchRunReview(run);
            Alert.alert('Loading', 'Fetching run details. Please try again in a moment.');
            return;
          }
          const listToShow = (r.events && r.events.length > 0) ? r.events : r.nonEvents || [];
          if (listToShow.length === 0) {
            Alert.alert('No items', 'No classified items available for this run.');
            return;
          }
          await ensureApifyRaw(run.runId);
          setReviewList(listToShow);
          setReviewRunId(run.runId);
          setReviewCategory((r.events && r.events.length > 0) ? 'events' : 'nonEvents');
          setReviewIndex(0);
          setIsReviewModalVisible(true);
        }}
      >
        <View style={styles.runContent}>
          <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
          <ThemedText>
            Events: {eventsCount}  •  Processed: {processedEventsCount}  •  Non-Events: {nonEventsCount}
          </ThemedText>
          {stats ? (
            <ThemedText style={{ color: '#64748B', marginTop: 2 }}>
              Processed items: {stats.processed}  •  Classified: {stats.classified}  •  Skipped: {stats.skipped}  •  Errors: {stats.errors}
            </ThemedText>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {variant === 'classified' && (
            <MUIButton
              variant="contained"
              size="small"
              onClick={async (e: any) => {
                e?.stopPropagation?.();
                await handleProcessClassifiedRun(run.runId);
              }}
              disabled={processingRunId === run.runId}
            >
              {processingRunId === run.runId ? 'Processing...' : 'Process'}
            </MUIButton>
          )}
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
              const listToShow = r.events || [];
              if (listToShow.length === 0) {
                Alert.alert('No items', 'No events available for this run.');
                return;
              }
              setReviewList(listToShow);
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

  const renderClassifiedRunsSection = (type: 'posts' | 'stories') => {
    if (isLoadingEvents) {
      return <ActivityIndicator size="small" />;
    }
    if (fetchError) {
      return <ThemedText style={{ color: '#DC2626' }}>Error: {fetchError}</ThemedText>;
    }
    const runs = type === 'stories' ? classifiedStoriesRuns : classifiedPostsRuns;
    if (runs.length === 0) {
      return (
        <ThemedText style={{ color: '#64748B' }}>
          {type === 'stories' ? 'No classified stories runs.' : 'No classified posts runs.'}
        </ThemedText>
      );
    }
    return (
      <View style={{ gap: 8 }}>
        {runs.map(run => renderClassifiedRunRow(run, 'classified'))}
      </View>
    );
  };

  const renderProcessedRunsSection = (type: 'posts' | 'stories') => {
    if (isLoadingEvents) {
      return <ActivityIndicator size="small" />;
    }
    if (fetchError) {
      return <ThemedText style={{ color: '#DC2626' }}>Error: {fetchError}</ThemedText>;
    }
    const runs = type === 'stories' ? processedStoriesRuns : processedPostsRuns;
    if (runs.length === 0) {
      return (
        <ThemedText style={{ color: '#64748B' }}>
          {type === 'stories' ? 'No processed stories runs.' : 'No processed posts runs.'}
        </ThemedText>
      );
    }
    return (
      <View style={{ gap: 8 }}>
        {runs.map(run => renderClassifiedRunRow(run, 'processed'))}
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
      <ThemedView style={styles.section}>
        {renderAccordionSection(
          'posts',
          <ThemedText style={styles.accordionTitle}>Posts</ThemedText>,
          <>

            {renderScheduleCard('posts')}
            {/* Posts Group */}
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Pending Posts Runs</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {isLoadingRuns ? (
                <ActivityIndicator size="small" />
              ) : (
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
                  {pendingPostsRuns.length === 0 ? (
                    <ThemedText style={{ color: '#64748B' }}>No pending runs.</ThemedText>
                  ) : (
                    pendingPostsRuns.map(run => renderPendingRunCard(run, 'pending-post'))
                  )}
                </View>
              )}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Completed Posts Runs</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {isLoadingRuns ? (
                <ActivityIndicator size="small" />
              ) : completedPostsRuns.length === 0 ? (
                <ThemedText style={{ color: '#64748B' }}>No completed posts runs.</ThemedText>
              ) : (
                <View style={{ gap: 8 }}>
                  {completedPostsRuns.map(run => renderCompletedRunCard(run, 'completed-post'))}
                </View>
              )}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Classified Posts</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {renderClassifiedRunsSection('posts')}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Processed Posts</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {renderProcessedRunsSection('posts')}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={[styles.sectionCardTitle, { color: '#DC2626' }]}>Posts Errors</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {renderErrorLogsSection('posts')}
            </View>

          </>
        )}

        {renderAccordionSection(
          'stories',
          <ThemedText style={styles.accordionTitle}>Stories</ThemedText>,
          <>
            {renderScheduleCard('stories')}
            {/* Stories Group */}
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Pending Stories Runs</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {isLoadingRuns ? (
                <ActivityIndicator size="small" />
              ) : (
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
                  {pendingStoriesRuns.length === 0 ? (
                    <ThemedText style={{ color: '#64748B' }}>No pending runs.</ThemedText>
                  ) : (
                    pendingStoriesRuns.map(run => renderPendingRunCard(run, 'pending-story'))
                  )}
                </View>
              )}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Completed Stories Runs</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {isLoadingRuns ? (
                <ActivityIndicator size="small" />
              ) : completedStoriesRuns.length === 0 ? (
                <ThemedText style={{ color: '#64748B' }}>No completed stories runs.</ThemedText>
              ) : (
                <View style={{ gap: 8 }}>
                  {completedStoriesRuns.map(run => renderCompletedRunCard(run, 'completed-story'))}
                </View>
              )}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Classified Stories</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {renderClassifiedRunsSection('stories')}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={styles.sectionCardTitle}>Processed Stories</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {renderProcessedRunsSection('stories')}
            </View>
            <View style={styles.sectionCard}>
              <ThemedText type="subtitle" style={[styles.sectionCardTitle, { color: '#DC2626' }]}>Stories Errors</ThemedText>
              <Box sx={{ my: 1 }}><Divider /></Box>
              {renderErrorLogsSection('stories')}
            </View>

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
            <View style={styles.modalView}>
              {reviewList && reviewList.length > 0 && (
                <ScrollView>
                  <ThemedText style={styles.modalTitle}>Review</ThemedText>
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
                  {(() => {
                    const current = reviewList[reviewIndex] || {}; return current.caption ? (
                      <ThemedText style={{ marginTop: 8 }}>{current.caption}</ThemedText>
                    ) : null;
                  })()}
                  {/* Reasons moved to fixed section below the scroll */}
                </ScrollView>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <IconButton size="small" onClick={() => setReviewIndex(i => Math.max(0, i - 1))} disabled={reviewIndex === 0}>
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <ThemedText>{reviewList.length > 0 ? `${reviewIndex + 1} / ${reviewList.length}` : ''}</ThemedText>
                <IconButton size="small" onClick={() => setReviewIndex(i => Math.min(reviewList.length - 1, i + 1))} disabled={reviewIndex >= reviewList.length - 1}>
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </View>
              {(() => {
                const current = reviewList[reviewIndex] || {};
                return (
                  <View style={{ marginTop: 12 }}>
                    {Array.isArray(current.reasons) && current.reasons.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        <ThemedText style={{ fontWeight: 'bold' }}>Reasons</ThemedText>
                        <ThemedText style={{ color: '#64748B' }}>{current.reasons.join(', ')}</ThemedText>
                      </View>
                    )}
                    {current.model && (
                      <View style={{ marginBottom: 8 }}>
                        <ThemedText style={{ fontWeight: 'bold' }}>Model</ThemedText>
                        <ThemedText style={{ color: '#64748B' }}>{JSON.stringify(current.model)}</ThemedText>
                      </View>
                    )}
                    {current.signals && (
                      <View style={{ marginBottom: 8 }}>
                        <ThemedText style={{ fontWeight: 'bold' }}>Signals</ThemedText>
                        <ThemedText style={{ color: '#64748B' }}>{JSON.stringify(current.signals)}</ThemedText>
                      </View>
                    )}
                    {current.signals && (current.signals.dateFound === true || current.signals.venueFound === true) && (
                      <View style={{ marginBottom: 8 }}>
                        {current.signals.dateFound === true && (() => {
                          const s = current.signals || {};
                          const dateDetail = s.dateISONormalized || s.dateISO || s.date || s.dateText || s.dateString || null;
                          return (
                            <View style={{ marginBottom: 4 }}>
                              <ThemedText style={{ fontWeight: 'bold' }}>Date</ThemedText>
                              <ThemedText style={{ color: '#64748B' }}>
                                {typeof dateDetail === 'string' ? dateDetail : (dateDetail ? JSON.stringify(dateDetail) : 'Detected')}
                              </ThemedText>
                            </View>
                          );
                        })()}
                        {current.signals.venueFound === true && (() => {
                          const s = current.signals || {};
                          const venueDetail = s.matchedVenueName || s.matchedVenue?.name || s.venueName || s.venue?.name || s.venue || s.venueObject || null;
                          return (
                            <View style={{ marginBottom: 4 }}>
                              <ThemedText style={{ fontWeight: 'bold' }}>Venue</ThemedText>
                              <ThemedText style={{ color: '#64748B' }}>
                                {typeof venueDetail === 'string' ? venueDetail : (venueDetail ? JSON.stringify(venueDetail) : 'Detected')}
                              </ThemedText>
                            </View>
                          );
                        })()}
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      {typeof current.confidence === 'number' && (
                        <ThemedText><ThemedText style={{ fontWeight: 'bold' }}>Confidence:</ThemedText> {current.confidence.toFixed(2)}</ThemedText>
                      )}
                      {current.error && (
                        <>
                          <ThemedText style={{ color: '#DC2626' }}><ThemedText style={{ fontWeight: 'bold' }}>Error:</ThemedText> {current.error}</ThemedText>
                          <MUIButton
                            variant="outlined"
                            size="small"
                            color="error"
                            onClick={async () => {
                              if (!reviewRunId) return;
                              const itemId = current.itemId || current.id;
                              if (!itemId) return;
                              try {
                                setRetryingItemId(itemId);
                                const resp = await fetch(RETRY_ITEM_URL, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ runId: reviewRunId, itemId })
                                });
                                const data = await resp.json();
                                if (!resp.ok) throw new Error(data.error || 'Retry failed');
                                const updated = data.updated || {};
                                // Update local reviewList and runReviews
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
                                    const otherKey = reviewCategory === 'events' ? 'nonEvents' : 'events';
                                    // Decide where the item belongs after update
                                    const isEventNow = !!updated.isEvent;
                                    const updatedItem = { ...(runReviews[reviewRunId] as any)[listKey]?.[reviewIndex], ...updated };
                                    const next = { ...prev } as any;
                                    // Remove from both lists then add to correct list to avoid duplicates
                                    next[reviewRunId] = {
                                      ...cur,
                                      events: (cur.events || []).filter((it: any) => (it.itemId || it.id) !== (itemId)).concat(isEventNow ? [updatedItem] : []),
                                      nonEvents: (cur.nonEvents || []).filter((it: any) => (it.itemId || it.id) !== (itemId)).concat(!isEventNow ? [updatedItem] : []),
                                    };
                                    return next;
                                  });
                                }
                                // If the category changed, switch the view list
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
                            style={{ marginLeft: 8 }}
                          >
                            {retryingItemId === (current.itemId || current.id) ? 'Retrying…' : 'Retry classification'}
                          </MUIButton>
                        </>
                      )}
                      <MUIButton
                        variant="outlined"
                        size="small"
                        color="error"
                        onClick={async () => {
                          if (!reviewRunId) return;
                          const itemId = current.itemId || current.id;
                          if (!itemId) return;
                          const confirm = Platform.OS === 'web' ? window.confirm('Delete this classification entry?') : true;
                          if (!confirm) return;
                          try {
                            const resp = await fetch(DELETE_CLASS_ITEM_URL, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ runId: reviewRunId, itemId })
                            });
                            const data = await resp.json();
                            if (!resp.ok || !data.success) throw new Error(data.error || 'Delete failed');
                            // Update local lists
                            setReviewList(prev => prev.filter((x: any, idx: number) => idx !== reviewIndex));
                            setRunReviews(prev => {
                              const cur = prev[reviewRunId!];
                              if (!cur) return prev;
                              const listKey = reviewCategory === 'events' ? 'events' : 'nonEvents';
                              const otherKey = reviewCategory === 'events' ? 'nonEvents' : 'events';
                              const targetId = itemId;
                              const next = { ...prev } as any;
                              next[reviewRunId!] = {
                                ...cur,
                                events: (cur.events || []).filter((it: any) => (it.itemId || it.id) !== targetId),
                                nonEvents: (cur.nonEvents || []).filter((it: any) => (it.itemId || it.id) !== targetId),
                              };
                              return next;
                            });
                            // Adjust index if needed
                            setReviewIndex(i => Math.max(0, Math.min(i, (reviewList.length - 2))));
                            Alert.alert('Deleted', 'Classification entry deleted.');
                          } catch (e: any) {
                            Alert.alert('Error', e.message || 'Failed to delete entry');
                          }
                        }}
                      >
                        Delete item
                      </MUIButton>
                    </View>
                    <View style={{ marginTop: 12 }}>
                      <ThemedText style={{ fontWeight: 'bold' }}>Raw item (Apify)</ThemedText>
                      {(() => {
                        const runId = reviewRunId || '';
                        const itemKey = current.itemId || current.id;
                        const raw = (runId && itemKey && apifyRawByRun[runId]?.itemsById) ? apifyRawByRun[runId].itemsById[String(itemKey)] : null;
                        if (!raw && apifyRawByRun[runId]?.loading) {
                          return <ActivityIndicator size="small" />;
                        }
                        return (
                          <ScrollView style={{ maxHeight: 240, marginTop: 6, padding: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4 }}>
                            <ThemedText style={{ color: '#0F172A', fontSize: 12, ...(Platform.OS === 'web' ? { fontFamily: 'monospace', whiteSpace: 'pre-wrap' } as any : {}) }}>
                              {raw ? JSON.stringify(raw, null, 2) : 'Raw item not found.'}
                            </ThemedText>
                          </ScrollView>
                        );
                      })()}
                    </View>
                    <View style={{ marginTop: 12 }}>
                      <ThemedText style={{ fontWeight: 'bold' }}>Classification output</ThemedText>
                      <ScrollView style={{ maxHeight: 240, marginTop: 6, padding: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4 }}>
                        <ThemedText style={{ color: '#0F172A', fontSize: 12, ...(Platform.OS === 'web' ? { fontFamily: 'monospace', whiteSpace: 'pre-wrap' } as any : {}) }}>
                          {JSON.stringify(current, null, 2)}
                        </ThemedText>
                      </ScrollView>
                    </View>
                  </View>
                );
              })()}
              <MUIButton variant="outlined" size="small" onClick={() => setIsReviewModalVisible(false)} style={{ marginTop: 16 }}>
                Close
              </MUIButton>
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
});
