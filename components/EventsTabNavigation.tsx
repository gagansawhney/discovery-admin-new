import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

interface EventsTabNavigationProps {
  activeTab: 'upload' | 'list';
}

export function EventsTabNavigation({ activeTab }: EventsTabNavigationProps) {
  const navigateToTab = (tab: 'upload' | 'list') => {
    if (tab !== activeTab) {
      router.push(`/(tabs)/events/${tab}` as any);
    }
  };

  return (
    <ThemedView style={styles.tabContainer}>
      <TouchableOpacity 
        style={[styles.tab, activeTab === 'upload' && styles.activeTab]}
        onPress={() => navigateToTab('upload')}
      >
        <ThemedText style={[styles.tabText, activeTab === 'upload' && styles.activeTabText]}>
          📤 Upload
        </ThemedText>
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={[styles.tab, activeTab === 'list' && styles.activeTab]}
        onPress={() => navigateToTab('list')}
      >
        <ThemedText style={[styles.tabText, activeTab === 'list' && styles.activeTabText]}>
          📋 Event List
        </ThemedText>
      </TouchableOpacity>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    margin: 16,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: '#fff',
    fontWeight: '600',
  },
}); 