import React, { useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Modal, Portal, Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useT } from '../i18n';

export interface NoteEditModalProps {
  visible: boolean;
  initialValue?: string;
  onCancel?: () => void;
  onSave?: (value: string) => void;
}

export default function NoteEditModal({ visible, initialValue = '', onCancel, onSave }: NoteEditModalProps) {
  const theme = useTheme();
  const t = useT();
  const [val, setVal] = useState<string>(initialValue || '');

  useEffect(() => {
    if (visible) setVal(initialValue || '');
  }, [visible, initialValue]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onCancel}
        contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}
      >
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>编辑备注</Text>
        <TextInput
          mode="outlined"
          multiline
          value={val}
          onChangeText={setVal}
          style={styles.input}
        />
        <Button mode="contained" onPress={() => onSave?.(val)}>
          保存
        </Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  title: {
    fontSize: 18,
    marginBottom: 12,
    fontWeight: 'bold' as const,
  },
  input: {
    minHeight: 100,
    marginBottom: 12,
  },
});
