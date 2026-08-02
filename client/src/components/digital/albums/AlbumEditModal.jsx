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
  const [initialParentId, setInitialParentId] = useState(null);
  const [parentOptions, setParentOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(album?.title || '');
      setDescription(album?.description || '');
      const initial = album?.parent_id ?? parentAlbum?.id ?? null;
      setParentId(initial);
      setInitialParentId(initial);
      setError(null);
    }
  }, [isOpen, album, parentAlbum]);

  useEffect(() => {
    if (!isOpen) return;
    getAlbums({ includeDeleted: false })
      .then(list => {
        const arr = Array.isArray(list) ? list : [];
        const excluded = new Set();
        if (album?.id) {
          const byParent = new Map();
          for (const a of arr) {
            const pid = a.parent_id;
            if (pid == null) continue;
            const l = byParent.get(pid) || [];
            l.push(a.id);
            byParent.set(pid, l);
          }
          const stack = [album.id];
          while (stack.length) {
            const cur = stack.pop();
            if (excluded.has(cur)) continue;
            excluded.add(cur);
            const kids = byParent.get(cur);
            if (kids) for (const k of kids) stack.push(k);
          }
        }
        const remaining = arr.filter(a => !excluded.has(a.id));
        const byId = new Map(remaining.map(a => [a.id, a]));
        const children = new Map();
        const roots = [];
        for (const a of remaining) {
          const pid = a.parent_id;
          if (pid != null && byId.has(pid)) {
            const l = children.get(pid) || [];
            l.push(a);
            children.set(pid, l);
          } else {
            roots.push(a);
          }
        }
        const ordered = [];
        const walk = (node, depth) => {
          ordered.push({ ...node, _depth: depth });
          const kids = children.get(node.id);
          if (kids) for (const k of kids) walk(k, depth + 1);
        };
        for (const r of roots) walk(r, 0);
        setParentOptions(ordered);
      })
      .catch(() => {});
  }, [isOpen, album]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const norm = (v) => (v == null || v === '' ? null : Number(v));
      const data = { title: title.trim(), description: description.trim() };
      if (album?.id) {
        const payload = { ...data };
        if (norm(parentId) !== norm(initialParentId)) {
          payload.parent_id = norm(parentId);
        }
        await updateAlbum(album.id, payload);
      } else {
        await createAlbum({ ...data, parent_id: norm(parentId) });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[AlbumEdit] Save failed:', err);
      setError(err?.message || 'Failed to save album');
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
                <option key={a.id} value={a.id}>
                  {a._depth > 0 ? '\u00A0\u00A0'.repeat(a._depth) + '└ ' + a.title : a.title}
                </option>
              ))}
            </select>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
