import { Stack } from 'expo-router';
import React from 'react';

export default function EventsTabLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="upload">
      <Stack.Screen name="upload" />
      
      <Stack.Screen name="list" />
      <Stack.Screen name="scraper" />
    </Stack>
  );
} 