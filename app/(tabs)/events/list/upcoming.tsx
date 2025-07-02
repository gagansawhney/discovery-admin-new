import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { EventListTabNavigation } from '../../../../components/EventListTabNavigation';
import { EventsTabNavigation } from '../../../../components/EventsTabNavigation';
import { ThemedText } from '../../../../components/ThemedText';
import { ThemedView } from '../../../../components/ThemedView';
import { Colors } from '../../../../constants/Colors';
import { useColorScheme } from '../../../../hooks/useColorScheme';

interface Event {
  id: string;
  name: string;
  date: {
    start: string;
    end?: string;
  };
  venue: {
    name: string;
    address?: string;
  };
  pricing?: {
    min: number;
    max: number;
    currency: string;
  };
  tags: string[];
  source: {
    platform: string;
    url?: string;
  };
  imageUrl?: string;
  imageHash?: string;
  context?: string;
  searchText?: string;
  rawText?: string;
  extractedText?: string;
  path?: string;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
  isMultiDayEvent?: boolean;
  dayOfEvent?: number;
}

interface GroupedEvents {
  date: string;
  dateLabel: string;
  events: Event[];
  isExpanded: boolean;
  ongoingCount: number;
  upcomingCount: number;
}

export default function UpcomingEventsScreen() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [groupedEvents, setGroupedEvents] = useState<GroupedEvents[]>([]);
  const colorScheme = useColorScheme() || 'light';

  // Calculate ongoing and upcoming counts
  const now = new Date();
  const ongoingEvents = events.filter(event => {
    const startDate = new Date(event.date.start);
    const endDate = event.date.end ? new Date(event.date.end) : new Date(event.date.start);
    return startDate <= now && endDate > now;
  });
  
  const upcomingEvents = events.filter(event => {
    const startDate = new Date(event.date.start);
    return startDate > now;
  });

  // Group events by date
  const groupEventsByDate = (eventList: Event[]) => {
    const grouped: { [key: string]: Event[] } = {};
    
    eventList.forEach(event => {
      const startDate = new Date(event.date.start);
      const dateKey = startDate.toDateString();
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    
    // Convert to array and sort by date
    const sortedGroups = Object.entries(grouped)
      .map(([dateKey, events]) => {
        const date = new Date(dateKey);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        let dateLabel = '';
        if (date.toDateString() === today.toDateString()) {
          dateLabel = 'Today';
        } else if (date.toDateString() === tomorrow.toDateString()) {
          dateLabel = 'Tomorrow';
        } else {
          dateLabel = date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });
        }
        
        // Calculate ongoing and upcoming counts for this date
        const now = new Date();
        const ongoingEvents = events.filter(event => {
          const startDate = new Date(event.date.start);
          const endDate = event.date.end ? new Date(event.date.end) : new Date(event.date.start);
          return startDate <= now && endDate > now;
        });
        
        const upcomingEvents = events.filter(event => {
          const startDate = new Date(event.date.start);
          return startDate > now;
        });
        
        return {
          date: dateKey,
          dateLabel,
          events: events.sort((a, b) => new Date(a.date.start).getTime() - new Date(b.date.start).getTime()),
          isExpanded: date.toDateString() === today.toDateString(), // Expand today's events by default
          ongoingCount: ongoingEvents.length,
          upcomingCount: upcomingEvents.length
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    return sortedGroups;
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    const grouped = groupEventsByDate(events);
    setGroupedEvents(grouped);
  }, [events]);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/fetchEvents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'upcoming' }),
      });

      const data = await response.json();
      
      if (data.success) {
        console.log('Full event data returned from database:', data.events);
        setEvents(data.events);
      } else {
        setError(data.error || 'Failed to fetch events');
      }
    } catch (err) {
      console.error('Error fetching events:', err);
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const deleteEvent = async (eventId: string, eventName: string) => {
    setEventToDelete({ id: eventId, name: eventName });
    setDeleteModalVisible(true);
  };

  const confirmDelete = async () => {
    if (!eventToDelete) return;
    
    setDeleteLoading(true);
    try {
      const response = await fetch('https://us-central1-discovery-admin-f87ce.cloudfunctions.net/deleteEvent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eventId: eventToDelete.id }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Remove the event from the local state
        setEvents(prevEvents => prevEvents.filter(event => event.id !== eventToDelete.id));
        setDeleteModalVisible(false);
        setEventToDelete(null);
      } else {
        console.error('Failed to delete event:', data.error);
      }
    } catch (err) {
      console.error('Error deleting event:', err);
    } finally {
      setDeleteLoading(false);
    }
  };

  const cancelDelete = () => {
    setDeleteModalVisible(false);
    setEventToDelete(null);
    setDeleteLoading(false);
  };

  const toggleAccordion = (dateKey: string) => {
    setGroupedEvents(prev => 
      prev.map(group => 
        group.date === dateKey 
          ? { ...group, isExpanded: !group.isExpanded }
          : group
      )
    );
  };

  const formatDate = (dateString: string, endDate?: string) => {
    const startDate = new Date(dateString);
    
    // If there's an end date and it's different from start date, show range
    if (endDate) {
      const end = new Date(endDate);
      const startDay = startDate.getDate();
      const endDay = end.getDate();
      const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
      const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
      const year = startDate.getFullYear();
      
      // If same month, show "24-30 Dec 2024"
      if (startDate.getMonth() === end.getMonth() && startDate.getFullYear() === end.getFullYear()) {
        return `${startDay}-${endDay} ${startMonth} ${year}`;
      }
      // If different months, show "24 Dec - 2 Jan 2024"
      else if (startDate.getFullYear() === end.getFullYear()) {
        return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${year}`;
      }
      // If different years, show "24 Dec 2024 - 2 Jan 2025"
      else {
        return `${startDay} ${startMonth} ${startDate.getFullYear()} - ${endDay} ${endMonth} ${end.getFullYear()}`;
      }
    }
    
    // Single day event - show full date
    return startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPrice = (pricing: Event['pricing']) => {
    if (!pricing) return 'Price not specified';
    if (pricing.min === pricing.max) {
      return `${pricing.currency} ${pricing.min}`;
    }
    return `${pricing.currency} ${pricing.min} - ${pricing.max}`;
  };

  const renderEvent = ({ item }: { item: Event }) => (
    <View style={[styles.eventCard, { backgroundColor: Colors[colorScheme].background }]}>
      <View style={styles.eventHeader}>
        <View style={styles.eventHeaderTop}>
          <Text style={[styles.eventName, { color: Colors[colorScheme].text }]}>{item.name}</Text>
          <TouchableOpacity
            style={[styles.deleteButton, { backgroundColor: Colors[colorScheme].tint }]}
            onPress={() => deleteEvent(item.id, item.name)}
          >
            <Text style={[styles.deleteButtonText, { color: Colors[colorScheme].background }]}>Delete</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.eventDate, { color: Colors[colorScheme].tint }]}>
          {formatDate(item.date.start, item.date.end)}
          {item.isMultiDayEvent && (
            <Text style={[styles.multiDayIndicator, { color: Colors[colorScheme].tint }]}>
              {' '}(Day {item.dayOfEvent})
            </Text>
          )}
        </Text>
      </View>

      <View style={styles.eventDetails}>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: Colors[colorScheme].text }]}>Venue:</Text>
          <Text style={[styles.detailValue, { color: Colors[colorScheme].text }]}>
            {item.venue.name}
            {item.venue.address && ` - ${item.venue.address}`}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: Colors[colorScheme].text }]}>Price:</Text>
          <Text style={[styles.detailValue, { color: Colors[colorScheme].text }]}>
            {formatPrice(item.pricing)}
          </Text>
        </View>

        {item.tags && item.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            <Text style={[styles.detailLabel, { color: Colors[colorScheme].text }]}>Tags:</Text>
            <View style={styles.tagsList}>
              {item.tags.map((tag, index) => (
                <View key={index} style={[styles.tag, { backgroundColor: Colors[colorScheme].tint }]}>
                  <Text style={[styles.tagText, { color: Colors[colorScheme].background }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {item.searchText && (
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: Colors[colorScheme].text }]}>Search Text:</Text>
            <Text style={[styles.detailValue, { color: Colors[colorScheme].text }]} numberOfLines={2}>
              {item.searchText}
            </Text>
          </View>
        )}

        {item.rawText && (
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: Colors[colorScheme].text }]}>Raw Text:</Text>
            <ScrollView style={styles.rawTextContainer}>
              <Text style={[styles.detailValue, { color: Colors[colorScheme].text }]} numberOfLines={5}>
                {item.rawText}
              </Text>
            </ScrollView>
          </View>
        )}

        {item.photoUrl && (
          <View style={styles.photoContainer}>
            <Image source={{ uri: item.photoUrl }} style={styles.eventPhoto} resizeMode="cover" />
          </View>
        )}

        <View style={styles.sourceInfo}>
          <Text style={[styles.sourceText, { color: Colors[colorScheme].tabIconDefault }]}>
            Source: {item.source.platform}
            {item.source.url && ` - ${item.source.url}`}
          </Text>
          <Text style={[styles.sourceText, { color: Colors[colorScheme].tabIconDefault }]}>
            Created: {new Date(item.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <EventsTabNavigation activeTab="list" />
        <EventListTabNavigation activeTab="upcoming" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors[colorScheme].tint} />
          <ThemedText style={styles.loadingText}>Loading ongoing/upcoming events...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.container}>
        <EventsTabNavigation activeTab="list" />
        <EventListTabNavigation activeTab="upcoming" />
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>Error: {error}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <EventsTabNavigation activeTab="list" />
      <EventListTabNavigation activeTab="upcoming" />
      
      {/* Event Count Header */}
      <View style={styles.countHeader}>
        <Text style={[styles.countText, { color: Colors[colorScheme].text }]}>
          Ongoing Events: {ongoingEvents.length}
        </Text>
        <Text style={[styles.countText, { color: Colors[colorScheme].text }]}>
          Upcoming Events: {upcomingEvents.length}
        </Text>
      </View>
      
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {groupedEvents.map((group) => (
          <View key={group.date} style={styles.accordionGroup}>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => toggleAccordion(group.date)}
              activeOpacity={0.7}
            >
              <View style={styles.accordionHeaderContent}>
                <Text style={[styles.accordionDate, { color: Colors[colorScheme].text }]}>
                  {group.dateLabel}
                </Text>
                <View style={styles.accordionCounts}>
                  {group.ongoingCount > 0 && (
                    <Text style={[styles.accordionCount, { color: '#FF6B35' }]}>
                      {group.ongoingCount} ongoing
                    </Text>
                  )}
                  {group.upcomingCount > 0 && (
                    <Text style={[styles.accordionCount, { color: Colors[colorScheme].tint }]}>
                      {group.upcomingCount} upcoming
                    </Text>
                  )}
                  {group.ongoingCount === 0 && group.upcomingCount === 0 && (
                    <Text style={[styles.accordionCount, { color: Colors[colorScheme].tint }]}>
                      {group.events.length} event{group.events.length !== 1 ? 's' : ''}
                    </Text>
                  )}
                </View>
              </View>
              <Text style={[styles.accordionIcon, { color: Colors[colorScheme].tint }]}>
                {group.isExpanded ? '▼' : '▶'}
              </Text>
            </TouchableOpacity>
            
            {group.isExpanded && (
              <View style={styles.accordionContent}>
                {group.events.map((item) => renderEvent({ item }))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      
      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={cancelDelete}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Colors[colorScheme].background }]}>
            <Text style={[styles.modalTitle, { color: Colors[colorScheme].text }]}>Delete Event</Text>
            <Text style={[styles.modalMessage, { color: Colors[colorScheme].text }]}>
              Are you sure you want to delete "{eventToDelete?.name}"?
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={cancelDelete}
                disabled={deleteLoading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.deleteButtonModal, { backgroundColor: Colors[colorScheme].tint }]}
                onPress={confirmDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? (
                  <ActivityIndicator size="small" color={Colors[colorScheme].background} />
                ) : (
                  <Text style={[styles.deleteButtonTextModal, { color: Colors[colorScheme].background }]}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    padding: 16,
  },
  accordionGroup: {
    marginBottom: 16,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
  },
  accordionHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionDate: {
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 8,
  },
  accordionCounts: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionCount: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  accordionIcon: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  accordionContent: {
    padding: 12,
  },
  eventCard: {
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  eventHeader: {
    marginBottom: 12,
  },
  eventHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 14,
    fontWeight: '500',
  },
  eventDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 80,
  },
  detailValue: {
    fontSize: 14,
    flex: 1,
  },
  tagsContainer: {
    marginTop: 4,
  },
  tagsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  rawTextContainer: {
    maxHeight: 100,
    flex: 1,
  },
  photoContainer: {
    marginTop: 8,
    alignItems: 'center',
  },
  eventPhoto: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  sourceInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  sourceText: {
    fontSize: 12,
    marginBottom: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
  deleteButton: {
    padding: 8,
    borderRadius: 8,
  },
  deleteButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  multiDayIndicator: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    width: '80%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalMessage: {
    fontSize: 14,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalButton: {
    padding: 12,
    borderRadius: 8,
  },
  cancelButton: {
    backgroundColor: '#6c757d',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  deleteButtonModal: {
    backgroundColor: '#dc3545',
  },
  deleteButtonTextModal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  countHeader: {
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  countText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
}); 