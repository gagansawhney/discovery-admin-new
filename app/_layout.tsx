import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';

// Root layout for theming and navigation

function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    return null;
  }
  // Global JS error handler (reports to logError endpoint)
  React.useEffect(() => {
    const logError = (source: string, message: string, stack?: string, extra?: any) => {
      fetch('https://logerror-f3zapaqx6a-uc.a.run.app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, message, stack, extra }),
      }).catch(() => {});
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.onerror = (message, source, lineno, colno, err) => {
        logError('window.onerror', String(message), err?.stack, { source, lineno, colno });
      };
      window.onunhandledrejection = (event) => {
        const err = event.reason;
        logError('unhandledrejection', err?.message || String(err), err?.stack);
      };
    } else if ((global as any).ErrorUtils) {
      const defaultHandler = (global as any).ErrorUtils.getGlobalHandler();
      (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal: boolean) => {
        logError('ErrorUtils', error.message, error.stack, { isFatal });
        defaultHandler(error, isFatal);
      });
    }
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
export default RootLayout;
