/**
 * LUT Library Component
 * Manages LUT files upload, delete, and preview with a modern UI.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardBody, Button, Chip } from '@heroui/react';
import { Upload, Trash2, FileType } from 'lucide-react';
import { listLuts, uploadLut, deleteLut } from '../../api';

// Helper to format file size
function formatFileSize(bytes) {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Helper to format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

// Generate a deterministic gradient based on string hash
function generatePreviewGradient(lutName) {
  const hash = lutName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash * 2) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 40%, 20%) 0%, hsl(${(hue1 + hue2) / 2}, 50%, 40%) 50%, hsl(${hue2}, 40%, 60%) 100%)`;
}

export default function LutLibrary() {
  const [luts, setLuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Fetch LUT list
  const fetchLuts = async () => {
    setLoading(true);
    try {
      const data = await listLuts();
      // API might return array or object with luts array
      const list = Array.isArray(data) ? data : (data.luts || []);
      setLuts(list);
    } catch (err) {
      console.error('Failed to load LUTs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLuts();
  }, []);

  // Handle file upload (supports multiple)
  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let errorCount = 0;

    for (const file of Array.from(files)) {
      const ext = file.name.toLowerCase().split('.').pop();
      if (!['cube', '3dl', 'csp', 'lut'].includes(ext)) {
        errorCount++;
        continue;
      }

      try {
        await uploadLut(file);
        successCount++;
      } catch (err) {
        console.error('Upload error:', file.name, err);
        errorCount++;
      }
    }

    if (errorCount > 0) {
      alert(`Upload complete: ${successCount} success, ${errorCount} failed`);
    }

    await fetchLuts();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle delete
  const handleDelete = async (lutName) => {
    const isBuiltIn = lutName.startsWith('FilmGallery_');
    const message = isBuiltIn 
      ? `"${lutName}" is a built-in LUT. Are you sure you want to delete it?`
      : `Are you sure you want to delete "${lutName}"?`;

    if (!window.confirm(message)) return;
    
    try {
      const success = await deleteLut(lutName);
      if (success !== false) { // Assuming API returns truthy on success
        setLuts(prev => prev.filter(l => l.name !== lutName));
      } else {
        alert('Delete failed');
      }
    } catch (err) {
      console.error('Delete error:', err);
      // Optimistic update fallback or refresh
      fetchLuts();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">LUT Library</h2>
          <p className="text-default-500 text-sm mt-1">
            Manage 3D LUT files (.cube, .3dl, .csp) for film simulation.
          </p>
        </div>
        <div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUpload}
            accept=".cube,.3dl,.csp,.lut"
            multiple
            className="hidden"
          />
          <Button
            onPress={() => fileInputRef.current?.click()}
            isDisabled={uploading}
            isLoading={uploading}
            color="primary"
            startContent={!uploading && <Upload className="w-4 h-4" />}
          >
            Upload LUTs
          </Button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : luts.length === 0 ? (
        <Card className="bg-white dark:bg-zinc-800">
          <CardBody className="text-center py-24">
            <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileType className="w-8 h-8 text-default-400" />
            </div>
            <h3 className="text-lg font-medium">No LUTs found</h3>
            <p className="text-default-500 mt-2 max-w-sm mx-auto">
              Upload .cube, .3dl, or .csp files to add film simulation presets.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {luts.map((lut) => (
            <div 
              key={lut.name} 
              className="group relative overflow-hidden rounded-xl cursor-pointer"
              style={{ paddingBottom: '100%' }} // 1:1 aspect ratio
            >
              {/* Background gradient */}
              <div 
                className="absolute inset-0"
                style={{ background: generatePreviewGradient(lut.name) }}
              />
              
              {/* Bottom gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              
              {/* Delete button - top right */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <Button
                  isIconOnly
                  size="sm"
                  onPress={() => handleDelete(lut.name)}
                  className="bg-black/50 text-white hover:bg-red-500 backdrop-blur-sm"
                  title="Delete LUT"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              
              {/* Built-in badge - top left */}
              {lut.name.startsWith('FilmGallery_') && (
                <Chip 
                  size="sm" 
                  variant="flat" 
                  className="absolute top-2 left-2 bg-black/40 backdrop-blur-md text-white border border-white/10 z-10"
                >
                  BUILT-IN
                </Chip>
              )}
              
              {/* Info overlay - bottom */}
              <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                <h4 className="font-medium text-sm text-white truncate mb-1" title={lut.name}>
                  {lut.name}
                </h4>
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <span className="uppercase font-semibold tracking-wider">
                    {lut.type || lut.name.split('.').pop()}
                  </span>
                  <span>·</span>
                  <span>{formatFileSize(lut.size)}</span>
                </div>
                {lut.modifiedAt && (
                  <span className="text-[10px] text-white/50 block mt-1">
                    Updated {formatDate(lut.modifiedAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
