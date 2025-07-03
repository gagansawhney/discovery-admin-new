import { EventsTabNavigation } from '@/components/EventsTabNavigation';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePickerModal from "react-native-modal-datetime-picker";

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
    try {
      const response = await fetch(START_SCRAPER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instagramUsernames: usernames.join(','),
          startDate: get25HoursAgoISOString(), // Always 25 hours ago
        }),
      });
      const data = await response.json();
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

      <ThemedView style={styles.section}>
        <ThemedText style={styles.fieldLabel}>Start Date and Time</ThemedText>
        {/* Date picker is now disabled, but not deleted */}
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
        <ThemedText type="subtitle">Initiated Scraper Runs</ThemedText>
        {isLoadingRuns ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : apifyRuns.length === 0 ? (
          <ThemedText>No runs initiated yet.</ThemedText>
        ) : (
          apifyRuns.map(run => (
            <View key={run.runId} style={styles.runItem}>
              <ThemedText style={styles.runIdText}>Run ID: {run.runId}</ThemedText>
              <ThemedText>Status: {run.status}</ThemedText>
              <ThemedText>Initiated: {new Date(run.initiatedAt).toLocaleString()}</ThemedText>
              {run.status === 'succeeded' && run.scrapedData && (
                <ThemedText>Scraped {run.scrapedData.length} items.</ThemedText>
              )}
              {run.error && <ThemedText style={styles.errorText}>Error: {run.error}</ThemedText>}
            </View>
          ))
        )}
        <Button title="Refresh Runs" onPress={fetchApifyRuns} />
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
});