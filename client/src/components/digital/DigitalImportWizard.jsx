import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Progress, Input } from '@heroui/react';
import { Upload, Check, AlertCircle, FileImage, X, FolderPlus, MapPin } from 'lucide-react';
import {
  digitalPreviewImport, digitalExecuteImport, getDigitalImportProgress, cancelDigitalImport,
  getAlbums,
} from '../../api';
import { getCacheStrategy } from '../../lib';

const STEPS = ['Select Files', 'Preview', 'Importing'];
const ACCEPTED = '.jpg,.jpeg,.png,.tif,.tiff,.cr2,.cr3,.nef,.arw,.rw2,.raf,.dng';

export default function DigitalImportWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState([]);
  const [previewResult, setPreviewResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [albumId, setAlbumId] = useState(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const albumIdRef = useRef(albumId);
  useEffect(() => { albumIdRef.current = albumId; }, [albumId]);

  const { data: albums = [] } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    ...getCacheStrategy('digitalAlbums'),
  });

  // File selection
  const handleFiles = useCallback(async (selectedFiles) => {
    const arr = Array.from(selectedFiles);
    if (arr.length === 0) return;
    setFiles(arr);
    setError(null);
    setUploading(true);
    setStep(1);
    try {
      const result = await digitalPreviewImport(arr);
      setPreviewResult(result);
    } catch (err) {
      setError(err.message || 'Preview failed');
      setStep(0);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // Execute import
  async function handleExecute() {
    setUploading(true);
    setError(null);
    try {
      const items = (previewResult.items || []).filter(i => !i.duplicate);
      const res = await digitalExecuteImport({
        items,
        session_title: sessionTitle || undefined,
        album_id: albumId,
      });
      setJobId(res.jobId);
      setStep(2);
      setUploading(false);
    } catch (err) {
      setError(err.message || 'Import failed to start');
      setUploading(false);
    }
  }

  // Poll progress
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const p = await getDigitalImportProgress(jobId);
        if (cancelled) return;
        setProgress(p);
        if (p.status === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['albums'] });
          queryClient.invalidateQueries({ queryKey: ['library-photos'] });
          if ((p.failed || 0) === 0) {
            setTimeout(() => navigate(albumIdRef.current ? `/albums/${albumIdRef.current}` : '/library'), 1500);
            return;
          }
          const errs = Array.isArray(p.errors) ? p.errors : [];
          const first = errs
            .slice(0, 3)
            .map((e) => (e.file ? `${e.file}: ${e.error}` : e.error))
            .filter(Boolean)
            .join('; ');
          setError(
            `Import partially failed: ${p.failed} of ${p.total} file(s) could not be imported.` +
              (first ? ` First errors: ${first}` : ''),
          );
          return;
        }
        if (p.status === 'failed') {
          const errs = Array.isArray(p.errors) ? p.errors : [];
          const last = errs.length > 0 ? errs[errs.length - 1] : null;
          setError(last?.error || 'Import failed');
          return;
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
        return;
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId]);

  async function handleCancel() {
    if (!jobId) return;
    try { await cancelDigitalImport(jobId); } catch {}
    navigate('/library');
  }

  function handleReset() {
    setFiles([]);
    setPreviewResult(null);
    setStep(0);
    setError(null);
    setSessionTitle('');
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8 max-w-4xl mx-auto w-full">
      <h2 className="text-3xl font-bold tracking-tight mb-2">Import Digital Photos</h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <React.Fragment key={i}>
            <div className={`flex items-center gap-2 ${i === step ? 'text-primary font-medium' : i < step ? 'text-green-500' : 'text-zinc-400'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${i === step ? 'bg-primary text-white' : i < step ? 'bg-green-500 text-white' : 'bg-zinc-200 dark:bg-zinc-700'}`}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className="text-sm">{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />}
          </React.Fragment>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Step 0: File selection */}
      {step === 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl p-12 cursor-pointer hover:border-primary hover:bg-primary/5 transition-all"
        >
          <Upload className="w-16 h-16 text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-lg font-medium mb-1">Drop photos here or click to browse</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            JPEG, PNG, TIFF, or RAW (CR2/CR3/NEF/ARW/RW2/RAF/DNG)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* Step 1: Preview */}
      {step === 1 && (
        <div className="flex-1">
          {uploading ? (
            <div className="flex items-center justify-center py-20">
              <Progress size="sm" isIndeterminate className="max-w-xs" />
              <span className="ml-3 text-sm text-zinc-500">Analyzing {files.length} files...</span>
            </div>
          ) : previewResult ? (
            <>
              <PreviewTable result={previewResult} />
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Input
                  className="max-w-xs"
                  size="sm"
                  variant="bordered"
                  label="Session title (optional)"
                  placeholder="e.g. 2026 Qingdao trip"
                  value={sessionTitle}
                  onValueChange={setSessionTitle}
                />
                <select
                  className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm"
                  value={albumId ?? ''}
                  onChange={e => setAlbumId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No album (library only)</option>
                  {albums.map(a => (
                    <option key={a.id} value={a.id}>{a.title}</option>
                  ))}
                </select>
              </div>
              <div className="mt-6 flex items-center gap-2">
                <Button variant="flat" onPress={handleReset}>Back</Button>
                <Button
                  color="primary"
                  onPress={handleExecute}
                  isDisabled={(previewResult.items || []).filter(i => !i.duplicate).length === 0}
                >
                  <FolderPlus className="w-4 h-4" /> Import {(previewResult.items || []).filter(i => !i.duplicate).length} photos
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Step 2: Progress */}
      {step === 2 && (
        <div className="flex-1 flex flex-col items-center justify-center">
          {progress ? (
            <>
              <div className="w-full max-w-md mb-6">
                <Progress
                  value={(progress.done || 0) / Math.max(progress.total, 1) * 100}
                  color={progress.status === 'failed' ? 'danger' : 'primary'}
                  size="lg"
                />
                <div className="flex justify-between mt-2 text-sm text-zinc-500">
                  <span>{progress.done || 0} / {progress.total}</span>
                  <span>{progress.status}</span>
                </div>
              </div>
              {progress.status === 'completed' && (progress.failed || 0) === 0 && (
                <p className="text-green-500 flex items-center gap-2">
                  <Check className="w-5 h-5" /> Import complete! Redirecting...
                </p>
              )}
              {progress.status === 'completed' && (progress.failed || 0) > 0 && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-amber-500 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" /> Import finished with {progress.failed} failure(s).
                  </p>
                  <Button
                    variant="flat"
                    color="primary"
                    onPress={() => navigate(albumIdRef.current ? `/albums/${albumIdRef.current}` : '/library')}
                  >
                    Go to library
                  </Button>
                </div>
              )}
              {progress.status === 'failed' && (
                <Button
                  variant="flat"
                  color="primary"
                  onPress={() => navigate(albumIdRef.current ? `/albums/${albumIdRef.current}` : '/library')}
                >
                  Back to library
                </Button>
              )}
              {progress.status !== 'completed' && progress.status !== 'failed' && (
                <Button variant="flat" color="danger" onPress={handleCancel}>Cancel Import</Button>
              )}
            </>
          ) : (
            <p className="text-zinc-500">Starting import...</p>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewTable({ result }) {
  const items = result.items || [];
  const total = result.total ?? items.length;
  const dupes = result.duplicates ?? items.filter(i => i.duplicate).length;
  const raws = result.raws ?? items.filter(i => i.isRaw).length;
  const summary = result.exif_summary;

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatBox label="Total" value={total} />
        <StatBox label="RAW" value={raws} icon={<FileImage className="w-4 h-4" />} />
        <StatBox label="Duplicates" value={dupes} warning={dupes > 0} />
      </div>
      {summary && (
        <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-sm">
          {summary.dateRange && (
            <p className="text-zinc-600 dark:text-zinc-300">
              Date taken: {summary.dateRange.start?.slice(0, 10)} → {summary.dateRange.end?.slice(0, 10)}
            </p>
          )}
          {summary.cameras?.length > 0 && (
            <p className="text-zinc-600 dark:text-zinc-300 mt-1">
              Cameras: {summary.cameras.map(c => `${c.name} × ${c.count}`).join(', ')}
            </p>
          )}
          {summary.hasGps && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 text-xs">
              <MapPin className="w-3 h-3" /> Has GPS
            </span>
          )}
        </div>
      )}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="text-left p-2 font-medium">Filename</th>
              <th className="text-left p-2 font-medium hidden sm:table-cell">Camera</th>
              <th className="text-left p-2 font-medium hidden md:table-cell">Date</th>
              <th className="text-left p-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="p-2 truncate max-w-48">{item.file?.originalname || '—'}</td>
                <td className="p-2 hidden sm:table-cell text-zinc-500">
                  {[item.exif?.make, item.exif?.model].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="p-2 hidden md:table-cell text-zinc-500">{item.exif?.dateTimeOriginal?.slice(0, 10) || '—'}</td>
                <td className="p-2">
                  {item.duplicate ? (
                    <span className="text-xs text-amber-500">Duplicate</span>
                  ) : item.isRaw ? (
                    <span className="text-xs text-blue-500">RAW</span>
                  ) : (
                    <span className="text-xs text-green-500">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value, icon, warning }) {
  return (
    <div className={`rounded-lg p-3 ${warning ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-zinc-50 dark:bg-zinc-800/50'}`}>
      <div className="flex items-center gap-1 text-xs text-zinc-500">{icon}{label}</div>
      <div className={`text-xl font-bold ${warning ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  );
}
