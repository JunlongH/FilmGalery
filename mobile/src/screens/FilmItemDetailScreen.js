import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput, useTheme } from 'react-native-paper';
import DatePickerField from '../components/DatePickerField';
import { parseISODate, toISODateString } from '../utils/date';
import { getFilmItem, updateFilmItem, deleteFilmItem } from '../api/filmItems';
import { FILM_ITEM_STATUSES, FILM_ITEM_STATUS_LABELS } from '../constants/filmItemStatus';
import { spacing } from '../theme';

export default function FilmItemDetailScreen({ route, navigation }) {
  const theme = useTheme();
  const { itemId, filmName } = route.params;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [item, setItem] = useState(null);
  const [form, setForm] = useState({});
  const [editMode, setEditMode] = useState(false);
  const todayStr = toISODateString(new Date());
  const [actionDate, setActionDate] = useState(todayStr);

  useEffect(() => {
    navigation.setOptions({ title: filmName || `Film Item #${itemId}` });
  }, [navigation, filmName, itemId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getFilmItem(itemId);
        if (!mounted) return;
        setItem(data.item || data);
        const base = data.item || data;
        setForm({
          status: base.status || 'in_stock',
          expiry_date: base.expiry_date || '',
          purchase_channel: base.purchase_channel || '',
          purchase_vendor: base.purchase_vendor || '',
          purchase_price: base.purchase_price != null ? String(base.purchase_price) : '',
          purchase_shipping_share: base.purchase_shipping_share != null ? String(base.purchase_shipping_share) : '',
          batch_number: base.batch_number || '',
          label: base.label || '',
          purchase_note: base.purchase_note || '',
          develop_lab: base.develop_lab || '',
          develop_process: base.develop_process || '',
          develop_price: base.develop_price != null ? String(base.develop_price) : '',
        });
      } catch (err) {
        console.log('Failed to load film item', err);
        if (mounted) setError('Failed to load film item');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [itemId]);

  const updateField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      const patch = {
        status: form.status,
        expiry_date: form.expiry_date || null,
        purchase_channel: form.purchase_channel || null,
        purchase_vendor: form.purchase_vendor || null,
        purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
        purchase_shipping_share: form.purchase_shipping_share === '' ? null : Number(form.purchase_shipping_share),
        batch_number: form.batch_number || null,
        label: form.label || null,
        purchase_note: form.purchase_note || null,
        develop_lab: form.develop_lab || null,
        develop_process: form.develop_process || null,
        develop_price: form.develop_price === '' ? null : Number(form.develop_price),
      };
      const updated = await updateFilmItem(itemId, patch);
      setItem(updated.item || updated);
    } catch (err) {
      console.log('Failed to update film item', err);
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    try {
      await deleteFilmItem(itemId, { hard: false });
      navigation.goBack();
    } catch (err) {
      console.log('Delete failed', err);
      setError('Delete failed');
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator animating size="large" />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text>Film item not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      {/* Compact header info */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" numberOfLines={1}>
            {filmName || 'Film Item'} (#{item.id})
          </Text>
          <Text variant="bodySmall" numberOfLines={1}>
            {FILM_ITEM_STATUS_LABELS[item.status] || item.status}
            {item.expiry_date ? ` • Exp ${item.expiry_date}` : ''}
          </Text>
        </View>
        <Button mode="outlined" onPress={() => setEditMode(v => !v)}>
          {editMode ? 'Done' : 'Edit'}
        </Button>
      </View>

      {/* Status-specific actions */}
      <View style={styles.actionsBox}>
        {item.status === 'in_stock' && (
          <View style={styles.actionRow}>
            <DatePickerField label="Loaded date" value={parseISODate(actionDate) || new Date()} onChange={(d) => setActionDate(toISODateString(d))} />
            <Button
              mode="contained"
              onPress={async () => {
                try {
                  setSaving(true);
                  const patch = { status: 'loaded', loaded_date: actionDate || todayStr };
                  const updated = await updateFilmItem(itemId, patch);
                  setItem(updated.item || updated);
                } finally { setSaving(false); }
              }}
            >Load</Button>
          </View>
        )}
        {item.status === 'loaded' && (
          <View style={styles.actionRow}>
            <DatePickerField label="Unload date" value={parseISODate(actionDate) || new Date()} onChange={(d) => setActionDate(toISODateString(d))} />
            <Button
              mode="contained"
              onPress={async () => {
                try {
                  setSaving(true);
                  const patch = { status: 'shot', unloaded_date: actionDate || todayStr };
                  const updated = await updateFilmItem(itemId, patch);
                  setItem(updated.item || updated);
                } finally { setSaving(false); }
              }}
            >Unload</Button>
          </View>
        )}
        {item.status === 'shot' && (
          <View style={styles.actionRow}>
            <DatePickerField label="Develop date" value={parseISODate(actionDate) || new Date()} onChange={(d) => setActionDate(toISODateString(d))} />
            <Button
              mode="contained"
              onPress={async () => {
                try {
                  setSaving(true);
                  const patch = { status: 'sent_to_lab', develop_date: actionDate || todayStr };
                  const updated = await updateFilmItem(itemId, patch);
                  setItem(updated.item || updated);
                } finally { setSaving(false); }
              }}
            >Develop</Button>
          </View>
        )}
        {/* Note: exclude create-roll for sent_to_lab on mobile */}
      </View>

      {editMode && (
      <TextInput
        label="Status"
        mode="outlined"
        value={FILM_ITEM_STATUS_LABELS[form.status] || form.status}
        right={<TextInput.Icon icon="chevron-down" />}
        onPressIn={() => {
          // Simple status cycle for now; can be replaced with proper picker
          const idx = FILM_ITEM_STATUSES.indexOf(form.status || 'in_stock');
          const next = FILM_ITEM_STATUSES[(idx + 1) % FILM_ITEM_STATUSES.length];
          updateField('status', next);
        }}
        editable={false}
        style={styles.input}
      />)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="Expiry date"
          value={parseISODate(form.expiry_date) || new Date()}
          onChange={(d) => updateField('expiry_date', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <TextInput
        label="Purchase channel"
        mode="outlined"
        value={form.purchase_channel}
        onChangeText={v => updateField('purchase_channel', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Vendor"
        mode="outlined"
        value={form.purchase_vendor}
        onChangeText={v => updateField('purchase_vendor', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Purchase price"
        mode="outlined"
        keyboardType="numeric"
        value={form.purchase_price}
        onChangeText={v => updateField('purchase_price', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Shipping share"
        mode="outlined"
        keyboardType="numeric"
        value={form.purchase_shipping_share}
        onChangeText={v => updateField('purchase_shipping_share', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Batch number"
        mode="outlined"
        value={form.batch_number}
        onChangeText={v => updateField('batch_number', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Label"
        mode="outlined"
        value={form.label}
        onChangeText={v => updateField('label', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Purchase note"
        mode="outlined"
        multiline
        value={form.purchase_note}
        onChangeText={v => updateField('purchase_note', v)}
        style={styles.input}
      />)}

      {editMode && (
      <Text style={{ marginTop: spacing.md, marginBottom: spacing.sm }} variant="titleSmall">
        Development
      </Text>)}

      {editMode && (
      <TextInput
        label="Lab"
        mode="outlined"
        value={form.develop_lab}
        onChangeText={v => updateField('develop_lab', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Process"
        mode="outlined"
        value={form.develop_process}
        onChangeText={v => updateField('develop_process', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="Develop price"
        mode="outlined"
        keyboardType="numeric"
        value={form.develop_price}
        onChangeText={v => updateField('develop_price', v)}
        style={styles.input}
      />)}

      {editMode && (
      <View style={styles.buttonRow}>
        <Button mode="contained" onPress={onSave} loading={saving} disabled={saving}>
          Save
        </Button>
      </View>)}

      {/* Shot Log only for loaded */}
      {item.status === 'loaded' && (
        <View style={[styles.buttonRow, { marginTop: spacing.sm }]}> 
          <Button mode="outlined" onPress={() => navigation.navigate('ShotLog', { itemId, filmName })}>
            Shot Log
          </Button>
        </View>
      )}

      <View style={[styles.buttonRow, { marginTop: spacing.sm }]}>
        <Button mode="text" textColor={theme.colors.error} onPress={onDelete}>
          Delete (soft)
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  input: { marginBottom: spacing.sm },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  actionsBox: { paddingVertical: spacing.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
