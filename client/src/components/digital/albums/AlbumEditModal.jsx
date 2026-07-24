import React, { useState, useEffect } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Textarea,
} from '@heroui/react';
import { createAlbum, updateAlbum, getAlbums } from '../../../api';

export default function AlbumEditModal({ album, parentAlbum, isOpen, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState(null);
  const [parentOptions, setParentOptions] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(album?.title || '');
      setDescription(album?.description || '');
      setParentId(album?.parent_id ?? parentAlbum?.id ?? null);
    }
  }, [isOpen, album, parentAlbum]);

  useEffect(() => {
    if (!isOpen) return;
    getAlbums({ includeDeleted: false })
      .then(list => {
        const filtered = (Array.isArray(list) ? list : []).filter(a => a.id !== album?.id);
        setParentOptions(filtered);
      })
      .catch(() => {});
  }, [isOpen, album]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const data = { title: title.trim(), description: description.trim(), parent_id: parentId };
      if (album?.id) {
        await updateAlbum(album.id, data);
      } else {
        await createAlbum(data);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[AlbumEdit] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>{album ? 'Edit Album' : 'New Album'}</ModalHeader>
        <ModalBody>
          <Input
            label="Title"
            value={title}
            onValueChange={setTitle}
            placeholder="Album name"
            isRequired
            className="mb-3"
          />
          <Textarea
            label="Description"
            value={description}
            onValueChange={setDescription}
            placeholder="Optional description"
            minRows={2}
            className="mb-3"
          />
          {parentOptions.length > 0 && (
            <select
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm"
              value={parentId ?? ''}
              onChange={e => setParentId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">No parent (top-level)</option>
              {parentOptions.map(a => (
                <option key={a.id} value={a.id}>{a.title}</option>
              ))}
            </select>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button color="primary" isLoading={saving} isDisabled={!title.trim()} onPress={handleSave}>
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
