import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Animated } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../../components/ui';
import DatePickerField from '../../components/DatePickerField';
import EquipmentPicker from '../../components/EquipmentPicker';
import { parseISODate, toISODateString } from '../../utils/date';
import { getFilmItem, updateFilmItem, deleteFilmItem } from '../../api/filmItems';
import { FILM_ITEM_STATUSES } from '../../constants/filmItemStatus';
import { spacing } from '../../theme';

const FILM_ITEM_STATUS_LABELS_ZH: Record<string, string> = {
  in_stock: '库存中',
  loaded: '已装卷',
  shot: '已拍完',
  sent_to_lab: '已送冲',
  developed: '已冲洗',
  archived: '已归档',
};

export default function FilmItemDetailScreen({ route, navigation }: any) {
  const theme = useTheme();
  const { itemId, filmName } = route.params;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [item, setItem] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [editMode, setEditMode] = useState(false);
  const todayStr = toISODateString(new Date());
  const [actionDate, setActionDate] = useState(todayStr);
  const [loadCameraId, setLoadCameraId] = useState<any>(null);
  const [loadCameraName, setLoadCameraName] = useState('');
  
  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );

  useEffect(() => {
    navigation.setOptions({ title: filmName || `胶卷 #${itemId}` });
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
          label: base.label || '',
          // Purchase info
          purchase_price: base.purchase_price != null ? String(base.purchase_price) : '',
          purchase_shipping_share: base.purchase_shipping_share != null ? String(base.purchase_shipping_share) : '',
          purchase_date: base.purchase_date || '',
          expiry_date: base.expiry_date || '',
          batch_number: base.batch_number || '',
          purchase_channel: base.purchase_channel || '',
          purchase_vendor: base.purchase_vendor || '',
          purchase_order_id: base.purchase_order_id || '',
          purchase_note: base.purchase_note || '',
          // Usage info
          loaded_date: base.loaded_date || '',
          finished_date: base.finished_date || '',
          // Develop info
          develop_lab: base.develop_lab || '',
          develop_process: base.develop_process || '',
          develop_price: base.develop_price != null ? String(base.develop_price) : '',
          develop_shipping: base.develop_shipping != null ? String(base.develop_shipping) : '',
          develop_channel: base.develop_channel || '',
          sent_to_lab_at: base.sent_to_lab_at || '',
          develop_date: base.develop_date || '',
          scan_date: base.scan_date || '',
          develop_note: base.develop_note || '',
        });
      } catch (err) {
        console.log('Failed to load film item', err);
        if (mounted) setError('加载胶卷信息失败');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [itemId]);

  const updateField = (key: any, value: any) => {
    setForm((prev: any) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      const patch = {
        status: form.status,
        label: form.label || null,
        // Purchase info
        purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
        purchase_shipping_share: form.purchase_shipping_share === '' ? null : Number(form.purchase_shipping_share),
        purchase_date: form.purchase_date || null,
        expiry_date: form.expiry_date || null,
        batch_number: form.batch_number || null,
        purchase_channel: form.purchase_channel || null,
        purchase_vendor: form.purchase_vendor || null,
        purchase_order_id: form.purchase_order_id || null,
        purchase_note: form.purchase_note || null,
        // Usage info
        loaded_date: form.loaded_date || null,
        finished_date: form.finished_date || null,
        // Develop info
        develop_lab: form.develop_lab || null,
        develop_process: form.develop_process || null,
        develop_price: form.develop_price === '' ? null : Number(form.develop_price),
        develop_shipping: form.develop_shipping === '' ? null : Number(form.develop_shipping),
        develop_channel: form.develop_channel || null,
        sent_to_lab_at: form.sent_to_lab_at || null,
        develop_date: form.develop_date || null,
        scan_date: form.scan_date || null,
        develop_note: form.develop_note || null,
      };
      const updated = await updateFilmItem(itemId, patch);
      setItem(updated.item || updated);
    } catch (err) {
      console.log('Failed to update film item', err);
      setError('保存失败');
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
      setError('删除失败');
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
        <Text>未找到该胶卷。</Text>
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
            {filmName || '胶卷'} (#{item.id})
          </Text>
          <Text variant="bodySmall" numberOfLines={1}>
            {(FILM_ITEM_STATUS_LABELS_ZH as any)[item.status] || item.status}
            {item.expiry_date ? ` • 有效期 ${item.expiry_date}` : ''}
          </Text>
        </View>
        <Button mode="outlined" onPress={() => setEditMode(v => !v)}>
          {editMode ? '完成' : '编辑'}
        </Button>
      </View>

      {/* Status-specific actions */}
      <View style={styles.actionsBox}>
        {item.status === 'in_stock' && (
          <View style={styles.actionColumn}>
            <DatePickerField 
              label="装卷日期" 
              value={parseISODate(actionDate) || new Date()} 
              onChange={(d) => setActionDate(toISODateString(d))} 
            />
            <EquipmentPicker cameraId={undefined}
              type="camera"
              value={loadCameraId}
              onChange={(id: any, cam: any) => {
                setLoadCameraId(id);
                setLoadCameraName(cam ? `${cam.brand} ${cam.model}` : '');
              }}
              label="相机（可选）"
              placeholder="选择相机..."
            />
            <Button
              mode="contained"
              onPress={async () => {
                try {
                  setSaving(true);
                  const patch = { 
                    status: 'loaded', 
                    loaded_date: actionDate || todayStr,
                    loaded_camera: loadCameraName || null,
                    camera_equip_id: loadCameraId || null,
                    loaded_at: new Date().toISOString()
                  };
                  const updated = await updateFilmItem(itemId, patch);
                  setItem(updated.item || updated);
                } finally { setSaving(false); }
              }}
            >装卷</Button>
          </View>
        )}
        {item.status === 'loaded' && (
          <View style={styles.actionRow}>
            <DatePickerField label="退卷日期" value={parseISODate(actionDate) || new Date()} onChange={(d) => setActionDate(toISODateString(d))} />
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
            >退卷</Button>
          </View>
        )}
        {item.status === 'shot' && (
          <View style={styles.actionRow}>
            <DatePickerField label="送冲日期" value={parseISODate(actionDate) || new Date()} onChange={(d) => setActionDate(toISODateString(d))} />
            <Button
              mode="contained"
              onPress={async () => {
                try {
                  setSaving(true);
                  const patch = { status: 'sent_to_lab', sent_to_lab_at: actionDate || todayStr };
                  const updated = await updateFilmItem(itemId, patch);
                  setItem(updated.item || updated);
                } finally { setSaving(false); }
              }}
            >送冲</Button>
          </View>
        )}
        {/* Note: exclude create-roll for sent_to_lab on mobile */}
      </View>

      {editMode && (
      <TextInput
        label="状态"
        mode="outlined"
        value={(FILM_ITEM_STATUS_LABELS_ZH as any)[form.status] || form.status}
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
      <TextInput
        label="标签"
        mode="outlined"
        value={form.label}
        onChangeText={v => updateField('label', v)}
        style={styles.input}
      />)}

      {/* Purchase Info Section */}
      {editMode && (
      <Text style={{ marginTop: spacing.md, marginBottom: spacing.sm }} variant="titleSmall">
        购买信息
      </Text>)}

      {editMode && (
      <TextInput
        label="购买价格"
        mode="outlined"
        keyboardType="numeric"
        value={form.purchase_price}
        onChangeText={v => updateField('purchase_price', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="分摊运费"
        mode="outlined"
        keyboardType="numeric"
        value={form.purchase_shipping_share}
        onChangeText={v => updateField('purchase_shipping_share', v)}
        style={styles.input}
      />)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="购买日期"
          value={parseISODate(form.purchase_date) || new Date()}
          onChange={(d) => updateField('purchase_date', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="过期日期"
          value={parseISODate(form.expiry_date) || new Date()}
          onChange={(d) => updateField('expiry_date', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <TextInput
        label="批次号"
        mode="outlined"
        value={form.batch_number}
        onChangeText={v => updateField('batch_number', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="订单号"
        mode="outlined"
        value={form.purchase_order_id}
        onChangeText={v => updateField('purchase_order_id', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="购买渠道"
        mode="outlined"
        value={form.purchase_channel}
        onChangeText={v => updateField('purchase_channel', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="商家"
        mode="outlined"
        value={form.purchase_vendor}
        onChangeText={v => updateField('purchase_vendor', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="购买备注"
        mode="outlined"
        multiline
        value={form.purchase_note}
        onChangeText={v => updateField('purchase_note', v)}
        style={styles.input}
      />)}

      {/* Usage Info Section */}
      {editMode && (
      <Text style={{ marginTop: spacing.md, marginBottom: spacing.sm }} variant="titleSmall">
        使用信息
      </Text>)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="装卷日期"
          value={parseISODate(form.loaded_date) || new Date()}
          onChange={(d) => updateField('loaded_date', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="拍完日期"
          value={parseISODate(form.finished_date) || new Date()}
          onChange={(d) => updateField('finished_date', toISODateString(d))}
        />
      </View>)}

      {/* Development Section */}
      {editMode && (
      <Text style={{ marginTop: spacing.md, marginBottom: spacing.sm }} variant="titleSmall">
        冲洗信息
      </Text>)}

      {editMode && (
      <TextInput
        label="冲印店"
        mode="outlined"
        value={form.develop_lab}
        onChangeText={v => updateField('develop_lab', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="冲洗工艺"
        mode="outlined"
        value={form.develop_process}
        onChangeText={v => updateField('develop_process', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="冲洗价格"
        mode="outlined"
        keyboardType="numeric"
        value={form.develop_price}
        onChangeText={v => updateField('develop_price', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="冲洗运费"
        mode="outlined"
        keyboardType="numeric"
        value={form.develop_shipping}
        onChangeText={v => updateField('develop_shipping', v)}
        style={styles.input}
      />)}

      {editMode && (
      <TextInput
        label="冲洗渠道"
        mode="outlined"
        value={form.develop_channel}
        onChangeText={v => updateField('develop_channel', v)}
        style={styles.input}
      />)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="送冲日期"
          value={parseISODate(form.sent_to_lab_at) || new Date()}
          onChange={(d) => updateField('sent_to_lab_at', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="冲洗日期"
          value={parseISODate(form.develop_date) || new Date()}
          onChange={(d) => updateField('develop_date', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <View style={styles.input}>
        <DatePickerField
          label="扫描日期"
          value={parseISODate(form.scan_date) || new Date()}
          onChange={(d) => updateField('scan_date', toISODateString(d))}
        />
      </View>)}

      {editMode && (
      <TextInput
        label="冲洗备注"
        mode="outlined"
        multiline
        value={form.develop_note}
        onChangeText={v => updateField('develop_note', v)}
        style={styles.input}
      />)}

      {editMode && (
      <View style={styles.buttonRow}>
        <Button mode="contained" onPress={onSave} loading={saving} disabled={saving}>
          保存
        </Button>
      </View>)}

      {/* Shot Log only for loaded */}
      {item.status === 'loaded' && (
        <View style={[styles.buttonRow, { marginTop: spacing.sm }]}> 
          <Button mode="outlined" onPress={() => navigation.navigate('ShotLog', { itemId, filmName })}>
            拍摄记录
          </Button>
        </View>
      )}

      <View style={[styles.buttonRow, { marginTop: spacing.sm }]}>
        <Button mode="text" textColor={theme.colors.error} onPress={onDelete}>
          删除（软删除）
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
  actionColumn: { flexDirection: 'column', gap: 8 },
});
