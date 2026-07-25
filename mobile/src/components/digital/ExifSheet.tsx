import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Modal, useTheme } from 'react-native-paper';
import { Icon } from '../ui';
import { useT } from '../../i18n';

export interface ExifSheetProps {
  visible: boolean;
  onDismiss: () => void;
  photo: any;
}

function formatDate(value: any): string | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function formatFileSize(bytes: any): string | null {
  if (bytes == null || bytes === '') return null;
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ExifSheet({ visible, onDismiss, photo }: ExifSheetProps) {
  const theme = useTheme();
  const t = useT();

  const rows = useMemo(() => {
    const list: { label: string; value: string | null }[] = [
      { label: t('digital.exif.camera'), value: photo?.camera || null },
      { label: t('digital.exif.lens'), value: photo?.lens || null },
      {
        label: t('digital.exif.focalLength'),
        value: photo?.focal_length != null && photo.focal_length !== ''
          ? `${photo.focal_length} mm`
          : null,
      },
      {
        label: t('digital.exif.aperture'),
        value: photo?.aperture != null && photo.aperture !== ''
          ? `f/${photo.aperture}`
          : null,
      },
      {
        label: t('digital.exif.shutter'),
        value: photo?.shutter_speed ? `${photo.shutter_speed} s` : null,
      },
      {
        label: t('digital.exif.iso'),
        value: photo?.iso != null && photo.iso !== '' ? `ISO ${photo.iso}` : null,
      },
      { label: t('digital.exif.dateTaken'), value: formatDate(photo?.date_taken) },
      {
        label: t('digital.exif.gps'),
        value:
          photo?.latitude != null && photo?.longitude != null
            ? `${Number(photo.latitude).toFixed(6)}, ${Number(photo.longitude).toFixed(6)}`
            : null,
      },
      { label: t('digital.exif.filename'), value: photo?.filename || null },
      { label: t('digital.exif.fileSize'), value: formatFileSize(photo?.file_size) },
    ];
    return list.filter((r) => r.value !== null && r.value !== '');
  }, [photo, t]);

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>
          {t('digital.exif.title')}
        </Text>
        <TouchableOpacity onPress={onDismiss} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="x" size={22} color={theme.colors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {rows.length === 0 ? (
          <Text style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>
            —
          </Text>
        ) : (
          rows.map((row, idx) => (
            <View
              key={`${row.label}-${idx}`}
              style={[styles.row, { borderBottomColor: theme.colors.outline + '20' }]}
            >
              <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
                {row.label}
              </Text>
              <Text style={[styles.value, { color: theme.colors.onSurface }]}>
                {row.value}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    borderRadius: 14,
    paddingVertical: 12,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    maxHeight: 420,
    paddingHorizontal: 16,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
  },
  empty: {
    paddingVertical: 32,
    textAlign: 'center',
    fontSize: 13,
  },
});
