/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const brandPrimary = '#2563EB';
const brandPrimaryDark = '#60A5FA';
const surface = '#0B1020';
const surfaceLight = '#F7F8FB';
const textDark = '#0F172A';
const textLight = '#F1F5F9';
const muted = '#64748B';

export const Colors = {
  light: {
    text: textDark,
    background: '#FFFFFF',
    surface: surfaceLight,
    border: '#E5E7EB',
    tint: brandPrimary,
    icon: muted,
    tabIconDefault: muted,
    tabIconSelected: brandPrimary,
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
  dark: {
    text: textLight,
    background: surface,
    surface: '#12182A',
    border: '#1F2937',
    tint: brandPrimaryDark,
    icon: '#94A3B8',
    tabIconDefault: '#94A3B8',
    tabIconSelected: brandPrimaryDark,
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#F87171',
  },
};
