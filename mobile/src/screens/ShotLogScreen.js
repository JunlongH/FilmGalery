import React, { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { ActivityIndicator, Button, HelperText, IconButton, Text, TextInput, useTheme } from 'react-native-paper';
import DatePickerField from '../components/DatePickerField';
import { parseISODate, toISODateString } from '../utils/date';
import { LinearGradient } from 'expo-linear-gradient';
import { getFilmItem, updateFilmItem, getMetadataOptions } from '../api/filmItems';
import { spacing, radius } from '../theme';

function parseShotLog(raw) {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data)) return [];
    return data.map(entry => ({
      date: entry.date,
      count: Number(entry.count || entry.shots || 0) || 0,
      lens: entry.lens || ''
    })).filter(e => e.date && e.count > 0);
  } catch {
    return [];
  }
}

const FALLBACK_LENSES = [
  '50mm f/1.8',
  '35mm f/1.4',
  '28mm f/2.8',
  '85mm f/1.8',
  '24-70mm f/2.8',
  '70-200mm f/2.8'
];

const dedupeAndSort = (list) => Array.from(new Set((list || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));

export default function ShotLogScreen({ route, navigation }) {
  const theme = useTheme();
  const { itemId, filmName } = route.params;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState([]);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newShots, setNewShots] = useState('1');
  const [newLens, setNewLens] = useState('');
  const [lensOptions, setLensOptions] = useState(FALLBACK_LENSES);

  useEffect(() => {
    navigation.setOptions({ title: filmName ? `${filmName} Shot Log` : 'Shot Log' });
  }, [navigation, filmName]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getFilmItem(itemId);
        if (!mounted) return;
        const base = data.item || data;
        setEntries(parseShotLog(base.shot_logs));
      } catch (err) {
        console.log('Failed to load shot log', err);
        if (mounted) setError('Failed to load shot log');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [itemId]);

  useEffect(() => {
    let mounted = true;
    getMetadataOptions()
      .then((opts) => {
        if (!mounted) return;
        const base = Array.isArray(opts?.lenses) && opts.lenses.length ? opts.lenses : FALLBACK_LENSES;
        setLensOptions(dedupeAndSort(base));
      })
      .catch(() => setLensOptions(dedupeAndSort(FALLBACK_LENSES)));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setLensOptions((prev) => dedupeAndSort([...prev, ...entries.map(e => e.lens).filter(Boolean)]));
  }, [entries]);

  const totalShots = entries.reduce((sum, e) => sum + e.count, 0);

  const upsertEntry = () => {
    if (!newDate) return;
    const count = Number(newShots || 0) || 0;
    if (!count) return;
    const lensVal = newLens.trim();
    setEntries(prev => {
      const next = [...prev, { date: newDate, count, lens: lensVal }];
      return next.sort((a, b) => a.date.localeCompare(b.date));
    });
    if (lensVal) setLensOptions(prev => dedupeAndSort([...prev, lensVal]));
    setNewShots('1');
  };

  const removeEntryAt = (idx) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = entries
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(e => ({ date: e.date, count: e.count, lens: e.lens || '' }));
      await updateFilmItem(itemId, { shot_logs: JSON.stringify(payload) });
      navigation.goBack();
    } catch (err) {
      console.log('Failed to save shot log', err);
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator animating size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        <View style={styles.statsRow}>
          <LinearGradient
            colors={['#667eea', '#764ba2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <Text style={styles.statLabel}>Total Shots</Text>
            <Text style={styles.statValue}>{totalShots}</Text>
          </LinearGradient>

          <LinearGradient
            colors={['#f093fb', '#f5576c']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <Text style={styles.statLabel}>Days Logged</Text>
            <Text style={styles.statValue}>{entries.length}</Text>
          </LinearGradient>
        </View>
      </View>

      <FlatList
        data={entries.map((entry, idx) => ({ ...entry, _idx: idx })).sort((a, b) => b.date.localeCompare(a.date) || b._idx - a._idx)}
        keyExtractor={item => `${item.date}-${item._idx}`}
        contentContainerStyle={{ padding: spacing.lg }}
        renderItem={({ item }) => (
          <View style={[styles.row, { backgroundColor: theme.colors.surface }]}>
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium">{item.date}</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                {item.count} shots
              </Text>
              {item.lens ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Lens: {item.lens}
                </Text>
              ) : null}
            </View>
            <IconButton icon="delete" onPress={() => removeEntryAt(item._idx)} />
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', marginVertical: spacing.xl, color: theme.colors.onSurfaceVariant }}>
            No shot logs yet.
          </Text>
        }
      />

      <View style={styles.footer}>
        <Text variant="titleSmall" style={{ marginBottom: spacing.sm }}>Add Log Entry</Text>
        <View style={styles.inputRow}>
          <View style={{ flex: 2 }}>
            <DatePickerField
              label="Date"
              value={parseISODate(newDate) || new Date()}
              onChange={(d) => setNewDate(toISODateString(d))}
            />
          </View>
          <TextInput
            label="Shots"
            mode="outlined"
            keyboardType="numeric"
            value={newShots}
            onChangeText={setNewShots}
            style={[styles.input, { flex: 1 }]}
            dense
          />
          <Button 
            mode="contained" 
            onPress={upsertEntry} 
            disabled={!newDate}
            style={styles.addButton}
          >
            Add
          </Button>
        </View>

        <TextInput
          label="Lens (custom or pick below)"
          mode="outlined"
          value={newLens}
          onChangeText={setNewLens}
          style={[styles.input, { marginBottom: spacing.sm }]}
          dense
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
          {lensOptions.map(l => (
            <Button
              key={l}
              mode={newLens === l ? 'contained' : 'outlined'}
              onPress={() => setNewLens(l)}
              compact
              style={{ marginRight: 4 }}
            >
              {l}
            </Button>
          ))}
        </View>

        <Button 
          mode="contained" 
          onPress={onSave} 
          loading={saving} 
          disabled={saving}
          style={styles.saveButton}
          buttonColor={theme.colors.primary}
        >
          Save Changes
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statCard: { flex: 1, padding: spacing.md, borderRadius: radius.md, elevation: 2 },
  statLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginBottom: 4 },
  statValue: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  row: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: spacing.md, 
    marginBottom: spacing.sm, 
    borderRadius: radius.md,
    elevation: 1 
  },
  footer: { 
    padding: spacing.lg, 
    backgroundColor: '#fff', 
    borderTopWidth: 1, 
    borderTopColor: '#eee',
    elevation: 8
  },
  inputRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  input: { backgroundColor: '#fff' },
  addButton: { justifyContent: 'center', marginTop: 6 },
  saveButton: { marginTop: 0 },
});
