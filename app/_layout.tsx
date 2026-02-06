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
        logError('window.onerror', String(message), (err as any)?.stack, { source, lineno, colno });
      };
      window.onunhandledrejection = (event) => {
        const err = (event as any).reason;
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

  // Apply global font-family for web and load Roboto via Google Fonts
  React.useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Inject Google Fonts links if not present
      const hasRoboto = !!document.querySelector('link[data-roboto-font]');
      if (!hasRoboto) {
        const linkPreconnect1 = document.createElement('link');
        linkPreconnect1.rel = 'preconnect';
        linkPreconnect1.href = 'https://fonts.googleapis.com';
        linkPreconnect1.setAttribute('data-roboto-font', 'true');
        document.head.appendChild(linkPreconnect1);

        const linkPreconnect2 = document.createElement('link');
        linkPreconnect2.rel = 'preconnect';
        linkPreconnect2.href = 'https://fonts.gstatic.com';
        linkPreconnect2.crossOrigin = 'anonymous';
        linkPreconnect2.setAttribute('data-roboto-font', 'true');
        document.head.appendChild(linkPreconnect2);

        const linkStylesheet = document.createElement('link');
        linkStylesheet.rel = 'stylesheet';
        linkStylesheet.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap';
        linkStylesheet.setAttribute('data-roboto-font', 'true');
        document.head.appendChild(linkStylesheet);
      }

      // Inject global font-family CSS
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-global-roboto', 'true');
      styleEl.innerHTML = `
        html, body, #root { font-family: Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif; }
      `;
      document.head.appendChild(styleEl);
      return () => { document.head.removeChild(styleEl); };
    }
  }, []);

  if (!loaded) {
    return null;
  }

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
