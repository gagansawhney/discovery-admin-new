import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { router, Slot, useGlobalSearchParams, usePathname } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function AppShellLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const { type: scraperTypeParam, tab: uploadTabParam, mode: venuesModeParam } = useGlobalSearchParams<{ type?: string; tab?: string; mode?: string }>();

  const isEvents = pathname?.startsWith('/events');
  const isVenues = pathname?.startsWith('/venues');
  const isUpload = pathname?.startsWith('/events/upload');
  const isList = pathname?.startsWith('/events/list');
  const isListUpcoming = pathname?.startsWith('/events/list/upcoming');
  const isListPast = pathname?.startsWith('/events/list/past');
  const isScraper = pathname?.startsWith('/events/scraper');
  const isScraperAutomatic = pathname?.startsWith('/events/scraper-automatic');

  const isUploadOneTime = isUpload && (uploadTabParam !== 'recurring');
  const isUploadRecurring = isUpload && uploadTabParam === 'recurring';

  const scraperType = typeof scraperTypeParam === 'string' ? scraperTypeParam : undefined;
  const isScraperPosts = isScraper && (scraperType === 'posts' || scraperType === undefined);
  const isScraperStories = isScraper && scraperType === 'stories';
  const venuesMode = typeof venuesModeParam === 'string' ? venuesModeParam : undefined;
  const isVenuesAdd = isVenues && venuesMode === 'add';
  const isVenuesView = isVenues && (venuesMode === 'view' || venuesMode === undefined);
  const isVenuesBulkAdd = isVenues && venuesMode === 'bulk';

  const [addExpanded, setAddExpanded] = React.useState(true);
  const [viewExpanded, setViewExpanded] = React.useState(true);
  const [venuesAddExpanded, setVenuesAddExpanded] = React.useState(true);
  const [eventsExpanded, setEventsExpanded] = React.useState(true);
  const [venuesExpanded, setVenuesExpanded] = React.useState(true);
  const [venuesViewExpanded, setVenuesViewExpanded] = React.useState(true);

  return (
    <ThemedView style={[styles.root, { backgroundColor: Colors[colorScheme ?? 'light'].surface }]}> 
      <ThemedView style={styles.sidebar}>
        <Image source={require('../../assets/images/Logo Admin.png')} style={styles.brandLogo} resizeMode="contain" />
        <View style={styles.navGroup}>
          <View style={[styles.navItemRow, isEvents && styles.navItemActive]}>
            <TouchableOpacity onPress={() => router.push('/events/upload?tab=oneTime')} style={styles.navItemLabel}>
              <ThemedText style={[styles.navText, isEvents && styles.navTextActive]}>Events</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEventsExpanded(v => !v)} style={styles.navToggle}>
              <ThemedText style={styles.sectionToggle}>{eventsExpanded ? '-' : '+'}</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Events → Add */}
          {eventsExpanded && (
          <View style={styles.subNavGroup}>
            <TouchableOpacity style={styles.sectionHeader} onPress={() => setAddExpanded((v) => !v)}>
              <ThemedText style={styles.sectionLabel}>Add</ThemedText>
              <ThemedText style={styles.sectionToggle}>{addExpanded ? '-' : '+'}</ThemedText>
            </TouchableOpacity>

            {addExpanded && (
              <>
                {/* Upload and its modes */}
                <TouchableOpacity
                  onPress={() => router.push('/events/upload?tab=oneTime')}
                  style={[styles.subNavItem, isUpload && styles.subNavItemActive]}
                >
                  <ThemedText style={[styles.subNavText, isUpload && styles.subNavTextActive]}>Upload</ThemedText>
                </TouchableOpacity>
                <View style={styles.subSubNavGroup}>
                  <TouchableOpacity
                    onPress={() => router.push('/events/upload?tab=oneTime')}
                    style={[styles.subSubNavItem, isUploadOneTime && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isUploadOneTime && styles.subSubNavTextActive]}>One-time</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push('/events/upload?tab=recurring')}
                    style={[styles.subSubNavItem, isUploadRecurring && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isUploadRecurring && styles.subSubNavTextActive]}>Recurring</ThemedText>
                  </TouchableOpacity>
                </View>

                {/* Scraper and its modes */}
                <TouchableOpacity
                  onPress={() => router.push('/events/scraper?type=posts')}
                  style={[styles.subNavItem, isScraper && styles.subNavItemActive]}
                >
                  <ThemedText style={[styles.subNavText, isScraper && styles.subNavTextActive]}>Scraper</ThemedText>
                </TouchableOpacity>
                <View style={styles.subSubNavGroup}>
                  <TouchableOpacity
                    onPress={() => router.push('/events/scraper?type=posts')}
                    style={[styles.subSubNavItem, isScraperPosts && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isScraperPosts && styles.subSubNavTextActive]}>Posts</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push('/events/scraper?type=stories')}
                    style={[styles.subSubNavItem, isScraperStories && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isScraperStories && styles.subSubNavTextActive]}>Stories</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push('/events/scraper-automatic' as any)}
                    style={[styles.subSubNavItem, isScraperAutomatic && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isScraperAutomatic && styles.subSubNavTextActive]}>Automatic</ThemedText>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Events → View */}
            <TouchableOpacity style={[styles.sectionHeader, { marginTop: 8 }]} onPress={() => setViewExpanded((v) => !v)}>
              <ThemedText style={styles.sectionLabel}>View</ThemedText>
              <ThemedText style={styles.sectionToggle}>{viewExpanded ? '-' : '+'}</ThemedText>
            </TouchableOpacity>

            {viewExpanded && (
              <>
                <TouchableOpacity
                  onPress={() => router.push('/events/list/upcoming')}
                  style={[styles.subNavItem, isList && styles.subNavItemActive]}
                >
                  <ThemedText style={[styles.subNavText, isList && styles.subNavTextActive]}>Event List</ThemedText>
                </TouchableOpacity>
                <View style={styles.subSubNavGroup}>
                  <TouchableOpacity
                    onPress={() => router.push('/events/list/upcoming')}
                    style={[styles.subSubNavItem, isListUpcoming && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isListUpcoming && styles.subSubNavTextActive]}>Upcoming/Ongoing</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push('/events/list/past')}
                    style={[styles.subSubNavItem, isListPast && styles.subSubNavItemActive]}
                  >
                    <ThemedText style={[styles.subSubNavText, isListPast && styles.subSubNavTextActive]}>Past</ThemedText>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
          )}

          <View style={[styles.navItemRow, isVenues && styles.navItemActive]}>
            <TouchableOpacity onPress={() => router.push('/venues?mode=view')} style={styles.navItemLabel}>
              <ThemedText style={[styles.navText, isVenues && styles.navTextActive]}>Venues</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVenuesExpanded(v => !v)} style={styles.navToggle}>
              <ThemedText style={styles.sectionToggle}>{venuesExpanded ? '-' : '+'}</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Venues → Add (collapsible) and View */}
          {venuesExpanded && (
          <View style={styles.subNavGroup}>
            <TouchableOpacity style={styles.sectionHeader} onPress={() => setVenuesAddExpanded(v => !v)}>
              <ThemedText style={styles.sectionLabel}>Add</ThemedText>
              <ThemedText style={styles.sectionToggle}>{venuesAddExpanded ? '-' : '+'}</ThemedText>
            </TouchableOpacity>
            {venuesAddExpanded && (
              <>
                <TouchableOpacity
                  onPress={() => router.push('/venues?mode=add')}
                  style={[styles.subNavItem, isVenuesAdd && styles.subNavItemActive]}
                >
                  <ThemedText style={[styles.subNavText, isVenuesAdd && styles.subNavTextActive]}>Add Venue</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/venues?mode=bulk')}
                  style={[styles.subNavItem, isVenuesBulkAdd && styles.subNavItemActive]}
                >
                  <ThemedText style={[styles.subNavText, isVenuesBulkAdd && styles.subNavTextActive]}>Bulk Add</ThemedText>
                </TouchableOpacity>
              </>
            )}

            {/* Venues → View */}
            <TouchableOpacity style={[styles.sectionHeader, { marginTop: 8 }]} onPress={() => setVenuesViewExpanded(v => !v)}>
              <ThemedText style={styles.sectionLabel}>View</ThemedText>
              <ThemedText style={styles.sectionToggle}>{venuesViewExpanded ? '-' : '+'}</ThemedText>
            </TouchableOpacity>

            {venuesViewExpanded && (
              <TouchableOpacity
                onPress={() => router.push('/venues?mode=view')}
                style={[styles.subNavItem, isVenuesView && styles.subNavItemActive]}
              >
                <ThemedText style={[styles.subNavText, isVenuesView && styles.subNavTextActive]}>Venue Listing</ThemedText>
              </TouchableOpacity>
            )}
          </View>
          )}
        </View>
      </ThemedView>

      <View style={styles.content}>
        <Slot />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 280,
    paddingTop: 24,
    paddingHorizontal: 16,
    borderRightWidth: 1,
    borderRightColor: Colors.light.border,
    gap: 8,
  },
  brandLogo: {
    width: 180,
    height: 48,
    marginBottom: 16,
  },
  navGroup: {
    gap: 4,
  },
  navItemRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  navItemActive: {
    // No background highlight; underline handled on text styles
  },
  navText: {
    fontSize: 16,
  },
  navTextActive: {
    fontWeight: '600',
    color: Colors.light.tint,
    textDecorationLine: 'underline',
  },
  navItemLabel: {
    flex: 1,
  },
  navToggle: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  sectionLabel: {
    fontSize: 12,
    color: Colors.light.icon,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginLeft: 8,
  },
  sectionToggle: {
    fontSize: 16,
    color: Colors.light.icon,
  },
  subNavGroup: {
    marginLeft: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(0,0,0,0.06)',
    gap: 2,
  },
  subNavItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: 8,
  },
  subNavItemActive: {
    // No background highlight; underline handled on text styles
  },
  subNavText: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  subNavTextActive: {
    fontWeight: '600',
    color: Colors.light.tint,
    textDecorationLine: 'underline',
  },
  subSubNavGroup: {
    marginLeft: 16,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,0,0,0.05)',
    gap: 2,
  },
  subSubNavItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: 8,
  },
  subSubNavItemActive: {
    // No background highlight; underline handled on text styles
  },
  subSubNavText: {
    fontSize: 13,
    color: Colors.light.icon,
  },
  subSubNavTextActive: {
    fontWeight: '600',
    color: Colors.light.tint,
    textDecorationLine: 'underline',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
});


