import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Checkbox, Spinner,
} from '@heroui/react';
import { Download } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUnregisteredDevices, registerFromPhotos } from '../../api/equipment';

function formatResult(kind, r) {
  if (!r) return null;
  const parts = [];
  if (r.created) parts.push(`${r.created} 新建`);
  if (r.reused) parts.push(`${r.reused} 复用`);
  if (r.linked) parts.push(`${r.linked} 关联`);
  if (!parts.length) return null;
  return `${kind}: ${parts.join('、')}`;
}

export default function EquipmentImportModal({ isOpen, onClose, onInvalidate }) {
  const queryClient = useQueryClient();
  const [cameraSel, setCameraSel] = useState(() => new Map());
  const [lensSel, setLensSel] = useState(() => new Map());
  const [cameraNames, setCameraNames] = useState(() => new Map());
  const [lensNames, setLensNames] = useState(() => new Map());
  const [resultLine, setResultLine] = useState(null);
  const [error, setError] = useState(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['unregistered-devices'],
    queryFn: getUnregisteredDevices,
    enabled: isOpen,
    staleTime: 0,
  });

  const cameras = data?.cameras || [];
  const lenses = data?.lenses || [];

  useEffect(() => {
    if (!isOpen) return;
    setCameraSel(new Map());
    setLensSel(new Map());
    setCameraNames(new Map());
    setLensNames(new Map());
    setResultLine(null);
    setError(null);
  }, [isOpen]);

  const selectedCameraCount = useMemo(
    () => cameras.reduce((n, c) => n + (cameraSel.get(c.name) !== false ? 1 : 0), 0),
    [cameras, cameraSel],
  );
  const selectedLensCount = useMemo(
    () => lenses.reduce((n, l) => n + (lensSel.get(l.name) !== false ? 1 : 0), 0),
    [lenses, lensSel],
  );
  const selectedTotal = selectedCameraCount + selectedLensCount;
  const hasAny = cameras.length > 0 || lenses.length > 0;

  const mutation = useMutation({
    mutationFn: (payload) => registerFromPhotos(payload),
    onSuccess: (res) => {
      const lines = [
        formatResult('相机', res?.cameras),
        formatResult('镜头', res?.lenses),
      ].filter(Boolean);
      setResultLine(lines.join('　·　') || '已处理');
      setError(null);
      onInvalidate?.();
      queryClient.invalidateQueries({ queryKey: ['unregistered-devices'] });
    },
    onError: (err) => {
      setError(err?.message || '注册失败');
    },
  });

  function toggleCamera(name, checked) {
    setCameraSel(prev => {
      const next = new Map(prev);
      if (checked) next.delete(name);
      else next.set(name, false);
      return next;
    });
  }

  function toggleLens(name, checked) {
    setLensSel(prev => {
      const next = new Map(prev);
      if (checked) next.delete(name);
      else next.set(name, false);
      return next;
    });
  }

  function setCameraName(orig, value) {
    setCameraNames(prev => {
      const next = new Map(prev);
      next.set(orig, value);
      return next;
    });
  }

  function setLensName(orig, value) {
    setLensNames(prev => {
      const next = new Map(prev);
      next.set(orig, value);
      return next;
    });
  }

  function handleSubmit() {
    const camPayload = cameras
      .filter(c => cameraSel.get(c.name) !== false)
      .map(c => ({
        name: cameraNames.get(c.name) ?? c.name,
        brand: c.brand,
        model: c.model,
        raw: c.raw,
      }));
    const lensPayload = lenses
      .filter(l => lensSel.get(l.name) !== false)
      .map(l => ({
        name: lensNames.get(l.name) ?? l.name,
        brand: l.brand,
        model: l.model,
        raw: l.raw,
      }));
    mutation.mutate({ cameras: camPayload, lenses: lensPayload });
  }

  function renderRow(item, kind) {
    const isSel = kind === 'camera'
      ? cameraSel.get(item.name) !== false
      : lensSel.get(item.name) !== false;
    const name = kind === 'camera'
      ? cameraNames.get(item.name) ?? item.name
      : lensNames.get(item.name) ?? item.name;
    const onToggle = kind === 'camera'
      ? (checked) => toggleCamera(item.name, checked)
      : (checked) => toggleLens(item.name, checked);
    const onName = kind === 'camera'
      ? (v) => setCameraName(item.name, v)
      : (v) => setLensName(item.name, v);

    return (
      <div
        key={`${kind}-${item.name}`}
        className="flex items-center gap-3 py-2 border-b border-zinc-100 dark:border-zinc-700/60 last:border-b-0"
      >
        <Checkbox isSelected={isSel} onValueChange={onToggle} size="sm" />
        <div className="flex-1 min-w-0">
          <Input
            size="sm"
            value={name}
            onValueChange={onName}
            variant="bordered"
            isDisabled={!isSel}
          />
          {item.brand && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{item.brand}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-medium whitespace-nowrap">
            {item.photoCount} 张照片
          </span>
          {item.existingId && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium whitespace-nowrap">
              已有同名
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>从照片导入设备</ModalHeader>
        <ModalBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner />
            </div>
          ) : !hasAny ? (
            <div className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              所有相机与镜头都已在设备库中，无需导入。
            </div>
          ) : (
            <>
              {cameras.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-1">相机</h4>
                  {cameras.map(c => renderRow(c, 'camera'))}
                </div>
              )}
              {lenses.length > 0 && (
                <div className="mb-2">
                  <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-1">镜头</h4>
                  {lenses.map(l => renderRow(l, 'lens'))}
                </div>
              )}
            </>
          )}
          {resultLine && (
            <p className="text-sm text-green-600 dark:text-green-400">{resultLine}</p>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>取消</Button>
          {isFetching && !isLoading && <Spinner size="sm" />}
          <Button
            color="primary"
            isDisabled={!hasAny || selectedTotal === 0 || !!resultLine || isFetching}
            isLoading={mutation.isPending}
            startContent={!mutation.isPending && <Download className="w-4 h-4" />}
            onPress={handleSubmit}
          >
            注册所选{selectedTotal > 0 ? ` · ${selectedTotal}` : ''}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
