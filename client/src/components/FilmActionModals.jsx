/**
 * FilmActionModals - 胶卷操作模态框
 * 
 * 玻璃态设计版�?
 * - LoadFilmModal: 装载胶卷到相�?
 * - UnloadFilmModal: 卸载胶卷（拍摄完成）
 * - DevelopFilmModal: 送洗/冲洗
 * - ArchiveFilmModal: 归档胶卷
 */

import React, { useState, useEffect } from 'react';
import { Button, Input, Select, SelectItem } from '@heroui/react';
import { Camera, Film, FlaskConical, Archive, Calendar, DollarSign, FileText, Send } from 'lucide-react';
import GlassModal, { GlassCard } from './ui/GlassModal';
import { updateFilmItem, getMetadataOptions } from '../api';
import EquipmentSelector from './EquipmentSelector';

// Input 样式配置
const inputClassNames = {
  inputWrapper: 'bg-zinc-100 dark:bg-zinc-700/50 border-none shadow-sm',
  input: 'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400'
};

const dateInputClassNames = {
  inputWrapper: 'bg-zinc-100 dark:bg-zinc-700/50 border-none shadow-sm',
  input: 'text-zinc-900 dark:text-zinc-100 [&::-webkit-calendar-picker-indicator]:dark:invert'
};

const selectClassNames = {
  trigger: 'bg-zinc-100 dark:bg-zinc-700/50 border-none shadow-sm data-[hover=true]:bg-zinc-200 dark:data-[hover=true]:bg-zinc-600',
  value: 'text-zinc-900 dark:text-zinc-100',
  selectorIcon: 'text-zinc-500 dark:text-zinc-400 absolute right-3',
  popoverContent: 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
};

const selectPopoverProps = {
  classNames: {
    content: 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
  }
};

// Listbox item 样式 - 用于 Select 下拉列表项
const selectListboxProps = {
  itemClasses: {
    base: 'text-zinc-900 dark:text-zinc-100 data-[hover=true]:bg-zinc-100 dark:data-[hover=true]:bg-zinc-700 data-[selected=true]:bg-primary/20 data-[selected=true]:text-primary data-[focus=true]:bg-zinc-100 dark:data-[focus=true]:bg-zinc-700'
  }
};

const PROCESS_OPTIONS = ['C-41', 'E-6', 'BW', 'ECN-2'];

/**
 * LoadFilmModal - 装载胶卷到相�?
 */
export function LoadFilmModal({ item, isOpen, onClose, onLoaded }) {
  const [camera, setCamera] = useState('');
  const [cameraEquipId, setCameraEquipId] = useState(null);
  const [loadedDate, setLoadedDate] = useState(new Date().toISOString().split('T')[0]);
  const [, setOptions] = useState({ cameras: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMetadataOptions().then(o => {
      if (!cancelled) setOptions(o || { cameras: [] });
    });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    if (loading || !item) return;
    setLoading(true);
    const optimisticPatch = {
      status: 'loaded',
      loaded_camera: camera,
      camera_equip_id: cameraEquipId,
      loaded_date: loadedDate || null,
    };
    if (onLoaded && item) {
      onLoaded({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, { 
        status: 'loaded', 
        loaded_camera: camera,
        camera_equip_id: cameraEquipId,
        loaded_at: new Date().toISOString(),
        loaded_date: loadedDate || null
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');
      if (onLoaded) await onLoaded(res);
    } catch (err) {
      alert('Failed to load film: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassModal 
      isOpen={isOpen} 
      onClose={onClose}
      size="md"
      title="Load Film into Camera"
      icon={<Camera size={18} />}
      footer={
        <div className="flex gap-2 w-full justify-end">
          <Button variant="flat" onPress={onClose} size="sm" isDisabled={loading}>
            Cancel
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={loading} size="sm">
            Load Film
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <GlassCard className="p-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Load Date</label>
              <Input
                type="date"
                value={loadedDate}
                onValueChange={setLoadedDate}
                size="sm"
                variant="flat"
                classNames={dateInputClassNames}
                isRequired
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Camera (Optional)</label>
              <EquipmentSelector 
                type="camera" 
                mode="film"
                value={cameraEquipId} 
                onChange={(id, equipItem) => {
                  setCameraEquipId(id);
                  setCamera(equipItem ? `${equipItem.brand} ${equipItem.model}` : '');
                }}
                placeholder="Select camera..." 
                disabled={loading}
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </GlassModal>
  );
}

/**
 * UnloadFilmModal - 卸载胶卷（拍摄完成）
 */
export function UnloadFilmModal({ item, isOpen, onClose, onUnloaded }) {
  const [finishedDate, setFinishedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (loading || !item) return;
    setLoading(true);
    const optimisticPatch = {
      status: 'shot',
      finished_date: finishedDate,
    };
    if (onUnloaded && item) {
      onUnloaded({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, { 
        status: 'shot', 
        shot_at: new Date().toISOString(),
        finished_date: finishedDate
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');

      if (onUnloaded) await onUnloaded(res);
    } catch (err) {
      alert('Failed to unload film: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassModal 
      isOpen={isOpen} 
      onClose={onClose}
      size="sm"
      title="Unload Film (Finished)"
      icon={<Film size={18} />}
      footer={
        <div className="flex gap-2 w-full justify-end">
          <Button variant="flat" onPress={onClose} size="sm" isDisabled={loading}>
            Cancel
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={loading} size="sm">
            Mark as Shot
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <GlassCard className="p-4">
          <div>
            <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Finished Date</label>
            <Input
              type="date"
              value={finishedDate}
              onValueChange={setFinishedDate}
              size="sm"
              variant="flat"
              classNames={dateInputClassNames}
              isRequired
            />
          </div>
        </GlassCard>
      </div>
    </GlassModal>
  );
}

/**
 * DevelopFilmModal - 送洗/冲洗
 */
export function DevelopFilmModal({ item, isOpen, onClose, onDeveloped }) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [formData, setFormData] = useState({
    sent_date: todayStr,
    develop_lab: '',
    develop_process: '',
    develop_date: '',
    develop_price: '',
    develop_note: ''
  });
  const [loading, setLoading] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        sent_date: new Date().toISOString().split('T')[0],
        develop_lab: '',
        develop_process: '',
        develop_date: '',
        develop_price: '',
        develop_note: ''
      });
    }
  }, [isOpen]);

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (loading || !item) return;
    setLoading(true);
    const optimisticPatch = {
      status: 'sent_to_lab',
      sent_to_lab_at: formData.sent_date,
      develop_lab: formData.develop_lab,
      develop_process: formData.develop_process,
      develop_date: formData.develop_date,
      develop_price: formData.develop_price ? Number(formData.develop_price) : null,
      develop_note: formData.develop_note,
    };
    if (onDeveloped && item) {
      onDeveloped({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, {
        status: 'sent_to_lab',
        sent_to_lab_at: formData.sent_date || new Date().toISOString(),
        develop_lab: formData.develop_lab,
        develop_process: formData.develop_process,
        develop_date: formData.develop_date,
        develop_price: formData.develop_price ? Number(formData.develop_price) : null,
        develop_note: formData.develop_note
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');

      if (onDeveloped) await onDeveloped(res);
    } catch (err) {
      alert('Failed to update status: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassModal 
      isOpen={isOpen} 
      onClose={onClose}
      size="lg"
      title="Send to Lab / Develop"
      icon={<FlaskConical size={18} />}
      footer={
        <div className="flex gap-2 w-full justify-end">
          <Button variant="flat" onPress={onClose} size="sm" isDisabled={loading}>
            Cancel
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={loading} size="sm">
            Confirm
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <GlassCard className="p-4">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
                <Send size={12} className="inline mr-1" />
                Sent Date
              </label>
              <Input
                type="date"
                value={formData.sent_date}
                onValueChange={(v) => handleChange('sent_date', v)}
                size="sm"
                variant="flat"
                classNames={dateInputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Lab Name</label>
              <Input
                value={formData.develop_lab}
                onValueChange={(v) => handleChange('develop_lab', v)}
                placeholder="e.g. FilmNeverDie"
                size="sm"
                variant="flat"
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Process</label>
              <Select
                selectedKeys={formData.develop_process ? [formData.develop_process] : []}
                onSelectionChange={(keys) => handleChange('develop_process', Array.from(keys)[0] || '')}
                size="sm"
                variant="flat"
                placeholder="Select process"
                classNames={selectClassNames}
                popoverProps={selectPopoverProps}
                listboxProps={selectListboxProps}
              >
                {PROCESS_OPTIONS.map(p => (
                  <SelectItem key={p} textValue={p}>{p}</SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
                <Calendar size={12} className="inline mr-1" />
                Develop Date
              </label>
              <Input
                type="date"
                value={formData.develop_date}
                onValueChange={(v) => handleChange('develop_date', v)}
                size="sm"
                variant="flat"
                classNames={dateInputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
                <DollarSign size={12} className="inline mr-1" />
                Cost
              </label>
              <Input
                type="number"
                step="0.01"
                value={formData.develop_price}
                onValueChange={(v) => handleChange('develop_price', v)}
                placeholder="0.00"
                size="sm"
                variant="flat"
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
                <FileText size={12} className="inline mr-1" />
                Note
              </label>
              <Input
                value={formData.develop_note}
                onValueChange={(v) => handleChange('develop_note', v)}
                placeholder="Optional notes"
                size="sm"
                variant="flat"
                classNames={inputClassNames}
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </GlassModal>
  );
}

/**
 * ArchiveFilmModal - 归档胶卷
 */
export function ArchiveFilmModal({ item, isOpen, onClose, onArchived }) {
  const [archiveDate, setArchiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [archiveNote, setArchiveNote] = useState('');
  const [loading, setLoading] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setArchiveDate(new Date().toISOString().split('T')[0]);
      setArchiveNote('');
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (loading || !item) return;
    setLoading(true);
    const optimisticPatch = {
      status: 'archived',
      archived_at: archiveDate,
    };
    if (onArchived && item) {
      onArchived({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, { 
        status: 'archived', 
        archived_at: archiveDate || new Date().toISOString()
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');

      if (onArchived) await onArchived(res);
    } catch (err) {
      alert('Failed to archive film: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassModal 
      isOpen={isOpen} 
      onClose={onClose}
      size="sm"
      title="Archive Film"
      icon={<Archive size={18} />}
      footer={
        <div className="flex gap-2 w-full justify-end">
          <Button variant="flat" onPress={onClose} size="sm" isDisabled={loading}>
            Cancel
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={loading} size="sm">
            Archive
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Archive this film item to mark it as fully processed and stored.
        </p>
        <GlassCard className="p-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Archive Date</label>
              <Input
                type="date"
                value={archiveDate}
                onValueChange={setArchiveDate}
                size="sm"
                variant="flat"
                classNames={dateInputClassNames}
                isRequired
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Note (Optional)</label>
              <Input
                value={archiveNote}
                onValueChange={setArchiveNote}
                placeholder="Storage location, etc."
                size="sm"
                variant="flat"
                classNames={inputClassNames}
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </GlassModal>
  );
}
