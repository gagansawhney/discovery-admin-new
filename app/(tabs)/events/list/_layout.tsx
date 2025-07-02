import { Stack } from 'expo-router';
import React from 'react';

export default function EventListTabLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="upcoming">
      <Stack.Screen name="upcoming" />
      <Stack.Screen name="past" />
    </Stack>
  );
} 