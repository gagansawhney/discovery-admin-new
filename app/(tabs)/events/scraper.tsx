import { EventsTabNavigation } from '@/components/EventsTabNavigation';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Modal, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

const START_SCRAPER_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/startInstagramScraper';
const GET_RUNS_LIST_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/getApifyRunsList';
const ADD_USERNAME_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/addUsername';
const DELETE_USERNAME_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteUsername';
const LIST_USERNAMES_URL = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/listUsernames';

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
          ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, v.stringValue || v.arrayValue?.values?.map((x:any) => x.stringValue || x.mapValue?.fields || x) || v.integerValue || v.doubleValue || v.booleanValue || v.timestampValue || null]))
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
              <TouchableOpacity
                key={run.runId}
                style={styles.runItem}
                onPress={() => { setSelectedRun(run); setModalVisible(true); }}
              >
                <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
                <ThemedText>Status: {run.status}</ThemedText>
                <ThemedText>Initiated: {new Date(run.initiatedAt).toLocaleString()}</ThemedText>
                {run.completedAt && <ThemedText>Completed: {new Date(run.completedAt).toLocaleString()}</ThemedText>}
                {run.error && <ThemedText style={styles.errorText}>Error: {run.error}</ThemedText>}
              </TouchableOpacity>
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
          <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 20, width: '90%', maxHeight: '80%' }}>
            <TouchableOpacity style={{ alignSelf: 'flex-end' }} onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            {selectedRun && (
              <ScrollView>
                <ThemedText style={styles.runIdText}>Run ID: {selectedRun.runId}</ThemedText>
                <ThemedText>Status: {selectedRun.status}</ThemedText>
                <ThemedText>Initiated: {new Date(selectedRun.initiatedAt).toLocaleString()}</ThemedText>
                {selectedRun.completedAt && <ThemedText>Completed: {new Date(selectedRun.completedAt).toLocaleString()}</ThemedText>}
                {selectedRun.error && <ThemedText style={styles.errorText}>Error: {selectedRun.error}</ThemedText>}
                <ThemedText style={{ marginTop: 10, fontWeight: 'bold' }}>Scraped Data:</ThemedText>
                {isScrapedDataLoading ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : scrapedData.length > 0 ? (
                  scrapedData.map((item, idx) => (
                    <View key={idx} style={styles.scrapedDataItem}>
                      <ThemedText style={styles.scrapedDataTitle}>{item.title || item.id || `Item ${idx + 1}`}</ThemedText>
                      <ThemedText>{JSON.stringify(item, null, 2)}</ThemedText>
                    </View>
                  ))
                ) : (
                  <ThemedText>No scraped data found.</ThemedText>
                )}
              </ScrollView>
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
});