import { ThemedView } from '@/components/ThemedView';
import { Slot } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function EventsLayout() {
  return (
    <ThemedView style={styles.page}>
      <View style={styles.content}>
        <Slot />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
}); 