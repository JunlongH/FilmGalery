import React, { useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Modal, Portal, Text, TextInput, Button } from 'react-native-paper';

export interface NoteEditModalProps {
  visible: boolean;
  initialValue?: string;
  onCancel?: () => void;
  onSave?: (value: string) => void;
}

export default function NoteEditModal({ visible, initialValue = '', onCancel, onSave }: NoteEditModalProps) {
  const [val, setVal] = useState<string>(initialValue || '');

  useEffect(() => {
    if (visible) setVal(initialValue || '');
  }, [visible, initialValue]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onCancel} contentContainerStyle={styles.modalContent}>
        <Text style={styles.title}>Edit Note</Text>
        <TextInput
          mode="outlined"
          multiline
          value={val}
          onChangeText={setVal}
          style={styles.input}
          activeOutlineColor="#5a4632"
        />
        <Button mode="contained" onPress={() => onSave?.(val)} buttonColor="#5a4632">
          Save
        </Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  title: {
    fontSize: 18,
    marginBottom: 12,
    color: '#5a4632',
    fontWeight: 'bold' as const,
  },
  input: {
    minHeight: 100,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
});
