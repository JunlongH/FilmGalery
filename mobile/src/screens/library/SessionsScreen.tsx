/**
 * SessionsScreen — digital import sessions list.
 *
 * Backed by GET /api/digital-sessions. Reached from the digital-mode "More"
 * tab as a simple list of import batches (label / camera / date). Tapping a
 * row currently has no detail destination (sessions are read-only here); a
 * future iteration can navigate to a filtered photo grid via
 * /api/digital-sessions/:id/photos.
 */

import React, { useContext, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT, getLanguage } from '../../i18n';
import { Icon } from '../../components/ui';
import CachedImage from '../../components/CachedImage';

interface SessionRow {
  id: number;
  label?: string;
  notes?: string;
  session_date?: string;
  import_batch?: string;
  camera_name?: string;
  cover_thumb?: string;
  photo_count?: number;
  [key: string]: any;
}

export default function SessionsScreen() {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const sessionsKey = baseUrl ? `digitalSessions@${baseUrl}` : null;
  const sessionsQuery = useApiQuery<SessionRow[]>(
    sessionsKey,
    () => api.http.get('/api/digital-sessions'),
  );
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);

  const loading = sessionsQuery.loading && sessions.length === 0;
  const error = sessionsQuery.error && sessions.length === 0 ? sessionsQuery.error : undefined;

  const coverUrl = (s: SessionRow): string | null => {
    if (!baseUrl || !s.cover_thumb) return null;
    return `${baseUrl}/uploads/${s.cover_thumb}`;
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Icon name="alert" size={40} color={theme.colors.onSurfaceVariant} />
        <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant, marginTop: 12 }]}>
          {t('sessions.loadFailed')}
        </Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: SessionRow }) => {
    const cover = coverUrl(item);
    const title = item.label || t('digital.sessionFallback', { id: item.id });
    const meta =
      item.camera_name || (item.session_date ? formatSessionDate(item.session_date) : '');
    return (
      <View style={[styles.row, { backgroundColor: theme.colors.surface }]}>
        <View style={[styles.cover, { backgroundColor: theme.colors.surfaceVariant }]}>
          {cover ? (
            <CachedImage uri={cover} style={styles.coverImg} contentFit="cover" />
          ) : (
            <View style={[styles.coverImg, styles.coverPlaceholder]}>
              <Icon name="image" size={22} color={theme.colors.onSurfaceVariant} />
            </View>
          )}
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text
              style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={1}
            >
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={sessionsQuery.refreshing}
            onRefresh={sessionsQuery.refresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="image" size={40} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
              {t('sessions.emptyTitle')}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              {t('sessions.emptyBody')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function formatSessionDate(value: string): string {
  // useT() in the calling component subscribes to language changes, so
  // getLanguage() reflects the active locale on each render pass.
  const locale = getLanguage() === 'en' ? 'en-US' : 'zh-CN';
  try {
    return new Date(value).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  coverImg: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  meta: {
    fontSize: 12,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    marginTop: 12,
  },
  emptyBody: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
});
