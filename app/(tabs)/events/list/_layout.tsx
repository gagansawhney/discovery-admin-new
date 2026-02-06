import { ThemedView } from '@/components/ThemedView';
import { Slot } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

export default function EventListLayout() {
  return (
    <ThemedView style={styles.wrapper}>
      <Slot />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
}); 