import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

interface EventListTabNavigationProps {
  activeTab: 'upcoming' | 'past';
}

export function EventListTabNavigation({ activeTab }: EventListTabNavigationProps) {
  const navigateToTab = (tab: 'upcoming' | 'past') => {
    if (tab !== activeTab) {
      router.push(`/(tabs)/events/list/${tab}` as any);
    }
  };

  return (
    <ThemedView style={styles.tabContainer}>
      <TouchableOpacity 
        style={[styles.tab, activeTab === 'upcoming' && styles.activeTab]}
        onPress={() => navigateToTab('upcoming')}
      >
        <ThemedText style={[styles.tabText, activeTab === 'upcoming' && styles.activeTabText]}>
          🔮 Ongoing/Upcoming
        </ThemedText>
      </TouchableOpacity>
      <TouchableOpacity 
        style={[styles.tab, activeTab === 'past' && styles.activeTab]}
        onPress={() => navigateToTab('past')}
      >
        <ThemedText style={[styles.tabText, activeTab === 'past' && styles.activeTabText]}>
          📅 Past
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