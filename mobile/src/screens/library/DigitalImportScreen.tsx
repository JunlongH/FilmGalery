// DigitalImportScreen — mobile-side digital photo upload.
//
// Two-phase import backed by /api/digital/import/{preview,execute,progress}:
//   1. preview() uploads the originals (multipart "files") — server hashes
//      them, parses EXIF, returns per-item shape with duplicate flags + an
//      exif_summary. We display the summary + a filename list.
//   2. execute() hands the non-duplicate items (they carry the server tmp
//      file.path) back to the server; returns a jobId we poll every 1s.
// On completion / failure we invalidate the relevant digital photo query keys
// so timeline / album / sessions views refresh on return.

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, Button, TextInput, ProgressBar, RadioButton } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { invalidateQueries } from '../../api/queryCache';
import { useT, getLanguage } from '../../i18n';
import { Icon } from '../../components/ui';

type Phase = 'idle' | 'previewing' | 'reviewing' | 'importing' | 'done' | 'error';

interface PreviewFile {
  path: string;
  originalname: string;
  size?: number;
}
interface PreviewItem {
  file: PreviewFile;
  hash: string;
  duplicate: boolean;
  isRaw?: boolean;
  exif?: any;
}
interface ExifSummary {
  dateRange?: { start: string; end: string } | null;
  cameras?: Array<{ name: string; count: number }>;
  hasGps?: boolean;
}
interface PreviewResponse {
  items: PreviewItem[];
  total: number;
  duplicates: number;
  raws: number;
  exif_summary?: ExifSummary;
}
interface ProgressResponse {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  done: number;
  failed: number;
  errors?: Array<{ file?: string; error?: string }>;
}

interface AlbumOption {
  id: number;
  title: string;
  parent_id?: number | null;
  photo_count?: number;
}

export default function DigitalImportScreen() {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const routeAlbumId: number | undefined = route.params?.albumId;

  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(
    typeof routeAlbumId === 'number' ? routeAlbumId : null,
  );
  const [sessionTitle, setSessionTitle] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [errorIsPartial, setErrorIsPartial] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const albumsKey = baseUrl ? `digitalAlbums@${baseUrl}` : null;
  const albumsQuery = useApiQuery<AlbumOption[]>(
    albumsKey,
    () => api.http.get('/api/albums', { include_deleted: false }),
  );
  const albums = useMemo(() => albumsQuery.data ?? [], [albumsQuery.data]);

  useEffect(() => {
    navigation.setOptions({ title: t('digital.import.title') });
  }, [navigation, t]);

  // ── Phase 1: pick + preview ──────────────────────────────────────────────

  const onUploadProgress = useCallback((pct: number) => {
    setUploadPct(Math.max(0, Math.min(100, Math.round(pct))));
  }, []);

  const handlePick = useCallback(async () => {
    if (phase === 'previewing' || phase === 'importing') return;
    setPreviewError(null);
    setPhase('previewing');
    setUploadPct(0);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) {
        setPhase(preview ? 'reviewing' : 'idle');
        return;
      }
      const form = new FormData();
      result.assets.forEach((asset, i) => {
        form.append('files', {
          uri: asset.uri,
          name: asset.fileName || `photo_${i + 1}.jpg`,
          type: asset.mimeType || 'image/jpeg',
        } as any);
      });
      const res: PreviewResponse = await api.digitalImport.preview(form, onUploadProgress);
      setPreview(res);
      setPreviewError(null);
      setPhase('reviewing');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? '');
      console.warn('[DigitalImport] preview failed:', msg || e);
      setPreviewError(msg || t('digital.import.errorPreview'));
      setPhase(preview ? 'reviewing' : 'idle');
    }
  }, [phase, preview, onUploadProgress, t]);

  // ── Phase 2: execute + poll ──────────────────────────────────────────────

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshDigitalQueries = useCallback(() => {
    invalidateQueries(`digitalPhotos@`);
    invalidateQueries(`digitalPhotosAggregate@`);
    invalidateQueries(`digitalAlbumPhotos@`);
    invalidateQueries(`digitalAlbums@`);
  }, []);

  const finishJob = useCallback(
    (finalState: ProgressResponse | null, errorBody?: string) => {
      stopPolling();
      if (cancelledRef.current) {
        // user-cancelled: bounce back to caller silently
        refreshDigitalQueries();
        if (navigation.canGoBack()) navigation.goBack();
        return;
      }
      const failedCount = finalState?.failed ?? 0;
      const doneCount = finalState?.done ?? 0;
      setImportedCount(doneCount);
      if (finalState?.status === 'completed' && failedCount === 0) {
        refreshDigitalQueries();
        setPhase('done');
      } else if (finalState?.status === 'completed' && failedCount > 0) {
        refreshDigitalQueries();
        setImportError(t('digital.import.partialBody', { done: doneCount, failed: failedCount }));
        setErrorIsPartial(true);
        setPhase('error');
      } else {
        setImportError(errorBody || t('digital.import.failedTitle'));
        setErrorIsPartial(false);
        setPhase('error');
      }
    },
    [navigation, refreshDigitalQueries, stopPolling, t],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const p: ProgressResponse = await api.digitalImport.progress(id);
          setProgress(p);
          if (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled') {
            finishJob(p);
          }
        } catch {
          // Network blip: keep polling — the next tick may recover.
        }
      }, 1000);
    },
    [finishJob, stopPolling],
  );

  const handleImport = useCallback(async () => {
    if (!preview) return;
    const items = preview.items.filter((i) => !i.duplicate);
    if (items.length === 0) {
      setPreviewError(t('digital.import.errorNoFiles'));
      return;
    }
    setPhase('importing');
    setImportError(null);
    setErrorIsPartial(false);
    setProgress(null);
    cancelledRef.current = false;
    try {
      const payload: { items: PreviewItem[]; album_id?: number; session_title?: string } = {
        items,
      };
      if (selectedAlbumId != null) payload.album_id = selectedAlbumId;
      if (sessionTitle.trim()) payload.session_title = sessionTitle.trim();
      const res: { jobId: string } = await api.digitalImport.execute(payload);
      setJobId(res.jobId);
      startPolling(res.jobId);
    } catch (e: any) {
      const msg = (e && (e as Error).message) || t('digital.import.errorExecute');
      setImportError(msg);
      setErrorIsPartial(false);
      setPhase('error');
    }
  }, [preview, selectedAlbumId, sessionTitle, startPolling, t]);

  const handleCancelJob = useCallback(async () => {
    if (!jobId) return;
    cancelledRef.current = true;
    stopPolling();
    try {
      await api.digitalImport.cancel(jobId);
    } catch {
      // best-effort
    }
    setImportError(t('digital.import.jobCancelled'));
    setErrorIsPartial(false);
    setPhase('error');
  }, [jobId, stopPolling, t]);

  // Cancel any in-flight job on unmount (back gesture / navigation pop).
  const jobIdRef = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    jobIdRef.current = jobId;
    phaseRef.current = phase;
  }, [jobId, phase]);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopPolling();
      // We can't reliably await inside cleanup; fire-and-forget the cancel.
      if (jobIdRef.current && phaseRef.current === 'importing') {
        api.digitalImport.cancel(jobIdRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived preview state ────────────────────────────────────────────────

  const nonDuplicateItems = useMemo(
    () => (preview?.items ?? []).filter((i) => !i.duplicate),
    [preview],
  );
  const duplicateCount = preview?.duplicates ?? 0;
  const dateRange = preview?.exif_summary?.dateRange ?? null;
  const importableCount = nonDuplicateItems.length;

  const busy = phase === 'previewing' || phase === 'importing';

  // ── Render ───────────────────────────────────────────────────────────────

  const surfaceBg = { backgroundColor: theme.colors.surface };
  const onSurface = { color: theme.colors.onSurface };
  const onSurfaceVariant = { color: theme.colors.onSurfaceVariant };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Icon name="upload" size={44} color={theme.colors.onSurfaceVariant} />
      <Text style={[styles.emptyTitle, onSurface]}>{t('digital.import.title')}</Text>
      <Text style={[styles.emptyBody, onSurfaceVariant]}>{t('digital.import.emptyHint')}</Text>
      {previewError ? (
        <Text style={[styles.previewErrorText, { color: theme.colors.error }]}>
          {previewError}
        </Text>
      ) : null}
      <Button
        mode="contained"
        icon="image"
        onPress={handlePick}
        loading={phase === 'previewing'}
        disabled={busy}
        style={styles.ctaBtn}
      >
        {t('digital.import.pick')}
      </Button>
    </View>
  );

  const renderAlbumSelector = () => (
    <View style={[styles.card, surfaceBg]}>
      <Text style={[styles.sectionLabel, onSurfaceVariant]}>{t('digital.import.albumLabel')}</Text>
      <TouchableOpacity
        style={styles.noAlbumRow}
        onPress={() => setSelectedAlbumId(null)}
      >
        <RadioButton.Android
          value="none"
          status={selectedAlbumId == null ? 'checked' : 'unchecked'}
          onPress={() => setSelectedAlbumId(null)}
          color={theme.colors.primary}
        />
        <Text style={[styles.albumRowTitle, onSurface]}>{t('digital.import.noAlbum')}</Text>
      </TouchableOpacity>
      {albums.map((album) => (
        <TouchableOpacity
          key={album.id}
          style={styles.albumRow}
          onPress={() => setSelectedAlbumId(album.id)}
        >
          <RadioButton.Android
            value={String(album.id)}
            status={selectedAlbumId === album.id ? 'checked' : 'unchecked'}
            onPress={() => setSelectedAlbumId(album.id)}
            color={theme.colors.primary}
          />
          <View style={styles.albumRowBody}>
            <Text style={[styles.albumRowTitle, onSurface]} numberOfLines={1}>
              {album.title}
            </Text>
            {typeof album.photo_count === 'number' && (
              <Text style={[styles.albumRowMeta, onSurfaceVariant]}>
                {t('digital.albumPhotosCount', { count: album.photo_count })}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderReviewing = () => (
    <KeyboardAvoidingView
      style={styles.body}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Preview error banner (e.g. re-pick failed while reviewing) */}
        {previewError ? (
          <View style={[styles.card, { backgroundColor: theme.colors.errorContainer }]}>
            <Text style={[styles.previewErrorText, { color: theme.colors.onErrorContainer }]}>
              {previewError}
            </Text>
          </View>
        ) : null}

        {/* Summary */}
        <View style={[styles.card, surfaceBg]}>
          <Text style={[styles.summaryTitle, onSurface]}>
            {t('digital.import.summaryTotal', { count: preview?.total ?? 0 })}
          </Text>
          {duplicateCount > 0 && (
            <Text style={[styles.summaryNote, { color: theme.colors.secondary }]}>
              {t('digital.import.duplicatesNote', { count: duplicateCount })}
            </Text>
          )}
          {dateRange ? (
            <Text style={[styles.summaryNote, onSurfaceVariant]}>
              {t('digital.import.dateRange', {
                start: formatDate(dateRange.start),
                end: formatDate(dateRange.end),
              })}
            </Text>
          ) : (
            <Text style={[styles.summaryNote, onSurfaceVariant]}>
              {t('digital.import.noExifDate')}
            </Text>
          )}
        </View>

        {/* File list */}
        <View style={[styles.card, surfaceBg, styles.fileListCard]}>
          <FlatList
            data={preview?.items ?? []}
            keyExtractor={(item, i) => `${item.hash || i}`}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={[styles.fileRow, { borderBottomColor: theme.colors.outline + '20' }]}>
                <Icon
                  name={item.duplicate ? 'check' : 'image'}
                  size={16}
                  color={item.duplicate ? theme.colors.secondary : theme.colors.onSurfaceVariant}
                />
                <Text
                  style={[styles.fileName, item.duplicate ? onSurfaceVariant : onSurface]}
                  numberOfLines={1}
                >
                  {item.file.originalname}
                </Text>
                {item.duplicate && (
                  <View style={[styles.dupBadge, { backgroundColor: theme.colors.secondaryContainer }]}>
                    <Text style={[styles.dupBadgeText, { color: theme.colors.secondary }]}>
                      {t('digital.import.duplicateBadge')}
                    </Text>
                  </View>
                )}
              </View>
            )}
          />
        </View>

        {/* Album + session */}
        {renderAlbumSelector()}

        <View style={[styles.card, surfaceBg]}>
          <Text style={[styles.sectionLabel, onSurfaceVariant]}>
            {t('digital.import.sessionTitle')}
          </Text>
          <TextInput
            mode="outlined"
            value={sessionTitle}
            onChangeText={setSessionTitle}
            placeholder={t('digital.import.sessionPlaceholder')}
            style={styles.sessionInput}
          />
        </View>

        {/* Actions */}
        <View style={styles.actionRow}>
          <Button
            mode="outlined"
            onPress={handlePick}
            disabled={busy}
            style={styles.secondaryBtn}
            contentStyle={styles.actionBtnContent}
          >
            {t('digital.import.pick')}
          </Button>
          <Button
            mode="contained"
            onPress={handleImport}
            disabled={busy || importableCount === 0}
            style={styles.primaryBtn}
            contentStyle={styles.actionBtnContent}
          >
            {t('digital.import.submit', { count: importableCount })}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderImporting = () => {
    const total = progress?.total ?? nonDuplicateItems.length;
    const done = progress?.done ?? 0;
    const pct = total > 0 ? done / total : 0;
    return (
      <View style={styles.centeredCard}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.statusTitle, onSurface, { marginTop: 16 }]}>
          {t('digital.import.importing')}
        </Text>
        <Text style={[styles.summaryNote, onSurfaceVariant, { marginTop: 4 }]}>
          {t('digital.import.importProgress', { done, total })}
        </Text>
        <ProgressBar
          progress={pct}
          color={theme.colors.primary}
          style={styles.progressBar}
        />
        <Button
          mode="text"
          onPress={handleCancelJob}
          textColor={theme.colors.error}
          style={{ marginTop: 16 }}
        >
          {t('digital.import.cancelJob')}
        </Button>
      </View>
    );
  };

  const renderPreviewing = () => (
    <View style={styles.centeredCard}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={[styles.statusTitle, onSurface, { marginTop: 16 }]}>
        {uploadPct > 0
          ? t('digital.import.uploading', { percent: uploadPct })
          : t('digital.import.previewing')}
      </Text>
      {uploadPct > 0 && (
        <ProgressBar
          progress={uploadPct / 100}
          color={theme.colors.primary}
          style={styles.progressBar}
        />
      )}
    </View>
  );

  const renderDone = () => (
    <View style={styles.centeredCard}>
      <Icon name="success" size={48} color={theme.colors.secondary} />
      <Text style={[styles.statusTitle, onSurface, { marginTop: 12 }]}>
        {t('digital.import.successTitle')}
      </Text>
      <Text style={[styles.summaryNote, onSurfaceVariant, { marginTop: 4 }]}>
        {t('digital.import.successBody', { count: importedCount })}
      </Text>
      <Button
        mode="contained"
        onPress={() => {
          if (navigation.canGoBack()) navigation.goBack();
        }}
        style={styles.ctaBtn}
      >
        {t('digital.import.done')}
      </Button>
    </View>
  );

  const renderError = () => (
    <View style={styles.centeredCard}>
      <Icon name="alert" size={48} color={theme.colors.error} />
      <Text style={[styles.statusTitle, onSurface, { marginTop: 12 }]}>
        {t(errorIsPartial ? 'digital.import.partialTitle' : 'digital.import.failedTitle')}
      </Text>
      <Text style={[styles.summaryNote, onSurfaceVariant, { marginTop: 4 }]}>
        {importError ?? ''}
      </Text>
      <Button
        mode="contained"
        onPress={() => {
          if (navigation.canGoBack()) navigation.goBack();
        }}
        style={styles.ctaBtn}
      >
        {t('digital.import.done')}
      </Button>
    </View>
  );

  let content: React.ReactNode;
  if (phase === 'previewing') content = renderPreviewing();
  else if (phase === 'importing') content = renderImporting();
  else if (phase === 'done') content = renderDone();
  else if (phase === 'error') content = renderError();
  else if (preview && phase === 'reviewing') content = renderReviewing();
  else content = renderEmpty();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {content}
    </View>
  );
}

function formatDate(value: string): string {
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
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 12,
    gap: 12,
    paddingBottom: 40,
  },
  centeredCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
  emptyBody: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
  previewErrorText: {
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  card: {
    borderRadius: 12,
    padding: 14,
  },
  fileListCard: {
    maxHeight: 280,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  summaryNote: {
    fontSize: 13,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    opacity: 0.7,
    marginBottom: 6,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileName: {
    flex: 1,
    fontSize: 13,
  },
  dupBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dupBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  noAlbumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  albumRowBody: {
    flex: 1,
    marginLeft: 4,
  },
  albumRowTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  albumRowMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  sessionInput: {
    backgroundColor: 'transparent',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 4,
  },
  primaryBtn: {
    flex: 1,
  },
  secondaryBtn: {
    flex: 1,
  },
  actionBtnContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtn: {
    marginTop: 24,
    width: 260,
    maxWidth: '80%',
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressBar: {
    width: '100%',
    marginTop: 14,
    height: 6,
    borderRadius: 3,
  },
});
