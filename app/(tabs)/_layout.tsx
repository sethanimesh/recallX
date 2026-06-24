import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/src/utils/theme';
import { Platform, View, Text, StyleSheet, TVFocusGuideView } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TVFocusable } from '@/src/components/TVFocusable';

function TVTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useThemeColors();

  return (
    <TVFocusGuideView autoFocus style={[styles.tvTabBar, { backgroundColor: colors.card, borderRightColor: colors.border }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label =
          options.tabBarLabel !== undefined
            ? options.tabBarLabel
            : options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <TVFocusable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={(options as any).tabBarTestID}
            onPress={onPress}
            style={[styles.tvTabItem, isFocused && { backgroundColor: colors.primary + '20', borderLeftWidth: 3, borderLeftColor: colors.primary }]}
          >
            {options.tabBarIcon && options.tabBarIcon({ focused: isFocused, color: isFocused ? colors.primary! : colors.textSecondary!, size: 28 })}
            <Text style={[styles.tvTabLabel, { color: isFocused ? colors.primary : colors.textSecondary }]}>
              {label as string}
            </Text>
          </TVFocusable>
        );
      })}
    </TVFocusGuideView>
  );
}

export default function TabLayout() {
  const colors = useThemeColors();

  return (
    <Tabs 
      {...({
        tabBar: Platform.isTV ? (props: BottomTabBarProps) => <TVTabBar {...props} /> : undefined,
        sceneContainerStyle: Platform.isTV ? { marginLeft: 120 } : undefined,
      } as any)}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="book-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="practice"
        options={{
          title: 'Practice',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="school-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="story"
        options={{
          title: 'Story',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="library-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tvTabBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 120,
    borderRightWidth: 1,
    paddingTop: 60,
    alignItems: 'center',
    gap: 20,
    zIndex: 100,
  },
  tvTabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 80,
    borderRadius: 8,
  },
  tvTabLabel: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
  },
});
