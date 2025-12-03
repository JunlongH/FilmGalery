import React, { useState, useEffect, useContext } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, TextInput, Chip, Button, IconButton } from 'react-native-paper';
import axios from 'axios';
import { ApiContext } from '../context/ApiContext';

export default function TagEditModal({ visible, onDismiss, photo, onSave }) {
  const { baseUrl } = useContext(ApiContext);
  const [input, setInput] = useState('');
  const [currentTags, setCurrentTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    if (visible && photo) {
      // Initialize tags from photo
      // Photo tags might be objects {id, name} or strings
      const tags = photo.tags ? photo.tags.map(t => (typeof t === 'object' ? t.name : t)) : [];
      setCurrentTags(tags);
      fetchTags();
    }
  }, [visible, photo]);

  const fetchTags = async () => {
    if (!baseUrl) return;
    try {
      const res = await axios.get(`${baseUrl}/api/tags`);
      setAllTags(res.data);
    } catch (err) {
      console.error('Failed to fetch tags', err);
    }
  };

  useEffect(() => {
    const lower = input.toLowerCase().trim();
    let filtered = allTags.filter(t => !currentTags.includes(t.name));
    if (lower) filtered = filtered.filter(t => t.name.toLowerCase().includes(lower));
    setSuggestions(filtered);
  }, [input, allTags, currentTags]);

  const addTag = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (currentTags.includes(trimmed)) return;
    setCurrentTags([...currentTags, trimmed]);
    setInput('');
  };

  const removeTag = (name) => {
    setCurrentTags(currentTags.filter(t => t !== name));
  };

  const handleSave = async () => {
    if (!baseUrl || !photo) return;
    
    // If there is text in input, add it as a tag first
    let finalTags = [...currentTags];
    if (input.trim() && !finalTags.includes(input.trim())) {
      finalTags.push(input.trim());
    }

    console.log('[TagEditModal] Saving tags:', finalTags, 'for photo:', photo.id);

    try {
      const response = await axios.put(`${baseUrl}/api/photos/${photo.id}`, { tags: finalTags });
      console.log('[TagEditModal] Save response:', response.data);
      onSave(finalTags); // Update parent
      onDismiss();
    } catch (err) {
      console.error('[TagEditModal] Failed to save tags:', err);
      console.error('[TagEditModal] Error details:', err.response?.data || err.message);
      alert(`Failed to save tags: ${err.response?.data?.error || err.message}`);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modalContent}>
        <Text style={styles.title}>Edit Tags</Text>
        
        <View style={styles.tagContainer}>
          {currentTags.map(tag => (
            <Chip 
              key={tag} 
              onClose={() => removeTag(tag)} 
              style={styles.chip}
              textStyle={{ color: '#2e7d32' }}
              closeIcon="close"
            >
              {tag}
            </Chip>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            mode="outlined"
            label="Add a tag..."
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => addTag(input)}
            style={[styles.input, { flex: 1 }]}
            activeOutlineColor="#5a4632"
          />
          <IconButton 
            icon="plus" 
            mode="contained" 
            containerColor="#5a4632" 
            iconColor="#fff"
            size={24}
            onPress={() => addTag(input)}
            style={{ marginLeft: 8, marginTop: 0 }}
          />
        </View>

        <Text style={styles.sectionTitle}>Choose from existing</Text>
        <ScrollView style={styles.suggestions} keyboardShouldPersistTaps="handled">
          {suggestions.length === 0 ? (
            <View style={styles.emptyBox}><Text style={{ color: '#888' }}>No matching tags</Text></View>
          ) : (
            suggestions.map(s => (
              <TouchableOpacity key={s.id} onPress={() => addTag(s.name)} style={styles.suggestionItem}>
                <Text>{s.name}</Text>
                <Text style={{ color: '#2e7d32', fontWeight: 'bold' }}>+</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Button onPress={onDismiss} textColor="#666">Cancel</Button>
          <Button mode="contained" onPress={handleSave} buttonColor="#5a4632">Save</Button>
        </View>
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
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#5a4632',
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  chip: {
    margin: 4,
    backgroundColor: '#eef8ee',
  },
  input: {
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  suggestions: {
    maxHeight: 150,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 4,
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 6,
    color: '#666',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  suggestionItem: {
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  emptyBox: {
    padding: 12,
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
});
