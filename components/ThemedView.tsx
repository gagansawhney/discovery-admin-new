import { View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/useThemeColor';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  colorName?: 'background' | 'surface';
};

export function ThemedView({ style, lightColor, darkColor, colorName = 'surface', ...otherProps }: ThemedViewProps) {
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, colorName as any);

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
