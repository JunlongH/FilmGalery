import React, { useState } from 'react';
import { Card, CardBody, Button, Switch, Select, SelectItem } from '@heroui/react';
import { Database, Folder, Shield, Smartphone, HardDrive, Info, AlertTriangle, LayoutGrid } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAppConfig, updateAppConfig } from '../../api';
import { WORKSPACE_EVENT } from '../Onboarding';

const MODE_KEY = 'fg-workspace-mode';

export default function GeneralSettings({ 
  config, 
  serverInfo, 
  actualPaths, 
  isElectron, 
  isRemoteServer,
  onChooseDataRoot,
  onChooseUploadsRoot,
  onToggleWriteThrough
}) {
  const [savingDir, setSavingDir] = useState(false);
  const [savingWrite, setSavingWrite] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const queryClient = useQueryClient();

  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: getAppConfig,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const workspace = appConfig?.default_source_filter === 'digital' ? 'digital' : 'film';

  const handleWorkspaceChange = async (next) => {
    if (!next || next === workspace) return;
    setSavingWorkspace(true);
    try {
      await updateAppConfig({ default_source_filter: next, photography_mode: next });
      queryClient.invalidateQueries({ queryKey: ['app-config'] });
      try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: next }));
    } catch { /* ignore */ }
    setSavingWorkspace(false);
  };

  // Wrap handlers to manage local loading state
  const handleChooseDataRoot = async () => {
    setSavingDir(true);
    await onChooseDataRoot();
    setSavingDir(false);
  };

  const handleChooseUploadsRoot = async () => {
    setSavingDir(true);
    await onChooseUploadsRoot();
    setSavingDir(false);
  };

  const handleToggleWriteThrough = async (checked) => {
    setSavingWrite(true);
    await onToggleWriteThrough(checked);
    setSavingWrite(false);
  };

  // Section Component using HeroUI Card
  const Section = ({ title, icon: Icon, children, variant = "default", className = "" }) => {
    const variants = {
      default: "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700",
      primary: "bg-primary/5 border-primary/20",
      warning: "bg-warning/5 border-warning/20"
    };
    
    return (
      <Card className={`${variants[variant]} ${className}`} shadow="sm">
        <CardBody className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-3">
            {Icon && (
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <Icon className="w-4 h-4 text-primary" />
              </div>
            )}
            {title}
          </h3>
          {children}
        </CardBody>
      </Card>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">

      {/* 默认工作区 */}
      <Section title="Default workspace" icon={LayoutGrid}>
        <div className="flex items-start justify-between gap-4 p-4 bg-zinc-100/50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <div className="flex-1">
            <h4 className="font-medium text-foreground">Workspace on startup</h4>
            <p className="text-sm text-default-500 mt-1">
              Choose Film or Digital as the default workspace. You can switch anytime with Ctrl+Shift+M.
            </p>
          </div>
          <Select
            size="sm"
            variant="bordered"
            aria-label="Default workspace"
            selectedKeys={[workspace]}
            onSelectionChange={(keys) => handleWorkspaceChange(Array.from(keys)[0])}
            isDisabled={savingWorkspace || !appConfig}
            className="w-36"
          >
            <SelectItem key="film" textValue="Film">Film</SelectItem>
            <SelectItem key="digital" textValue="Digital">Digital</SelectItem>
          </Select>
        </div>
      </Section>

      {/* Mobile/Watch Connection Info (Electron Only) */}
      {isElectron && (
        <Section title="Mobile & Watch Connection" icon={Smartphone} variant="primary">
          <p className="text-default-500 mb-4 text-sm">
            Use the following information to connect your Mobile or Watch app to this PC.
          </p>
          <div className="flex flex-wrap gap-4">
            <Card shadow="none" className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 min-w-[120px]">
              <CardBody className="p-3">
                <div className="text-xs text-default-500 uppercase tracking-wider mb-1">Port</div>
                <div className="text-xl font-bold font-mono">
                  {window.__electron?.SERVER_PORT || 4000}
                </div>
              </CardBody>
            </Card>
            <Card shadow="none" className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex-1 min-w-[200px]">
              <CardBody className="p-3">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">API Address</div>
                <code className="text-sm font-mono text-zinc-900 dark:text-zinc-100 break-all">
                  {window.__electron?.API_BASE || 'http://127.0.0.1:4000'}
                </code>
              </CardBody>
            </Card>
          </div>
          <div className="mt-4 flex gap-2 text-sm text-primary/80 bg-zinc-50/50 dark:bg-zinc-900/50 p-3 rounded-lg border border-primary/10">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>On your mobile device, enter this computer's IP address. The app will automatically discover the service port.</p>
          </div>
        </Section>
      )}

      {!isElectron && (
        <Card shadow="sm" className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <CardBody className="p-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Storage path settings are managed by the host environment (Docker/Server).
          </CardBody>
        </Card>
      )}

      {/* Remote Server Storage Info (Read Only) */}
      {isRemoteServer && (
        <Section title="Remote Storage" icon={HardDrive}>
          <div className="mb-4 text-sm text-default-500">
            Connected to remote server. Storage paths are managed by the server configuration.
          </div>
          
          {actualPaths && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="text-xs text-default-500 mb-1">Database Location</div>
                <code className="text-xs font-mono break-all">{actualPaths.databasePath}</code>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="text-xs text-default-500 mb-1">Photos Location</div>
                <code className="text-xs font-mono break-all">{actualPaths.uploadsDir}</code>
              </div>
            </div>
          )}
          
          {serverInfo && (
            <div className="mt-4 flex gap-6 text-sm text-default-600 border-t border-zinc-200 dark:border-zinc-700 pt-4">
              <div>
                <span className="text-default-400 mr-2">Mode:</span>
                <span className="font-medium">{serverInfo.serverMode || 'unknown'}</span>
              </div>
              <div>
                <span className="text-default-400 mr-2">Version:</span>
                <span className="font-medium">{serverInfo.version || 'unknown'}</span>
              </div>
            </div>
          )}
          
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-600 dark:text-yellow-400 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>To change storage paths, please edit the <code>docker-compose.yml</code> volume configuration on your NAS/Server.</p>
          </div>
        </Section>
      )}

      {/* Local Data Location */}
      {!isRemoteServer && (
        <Section title="Data Storage Location" icon={Database}>
          <p className="text-default-500 text-sm mb-4">
            Choose where the database (film.db) and uploaded photos are stored. 
            Moving this to a <strong>OneDrive</strong> or <strong>Dropbox</strong> folder enables syncing across devices.
          </p>
          
          <Card shadow="none" className="bg-zinc-100/50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
            <CardBody className="p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-default-500 mb-1">Current Root Path</div>
                <code className="text-sm font-mono block truncate" title={config.dataRoot}>
                  {config.dataRoot || '(Default) %APPDATA%/FilmGallery'}
                </code>
              </div>
              <Button 
                onPress={handleChooseDataRoot}
                isDisabled={savingDir}
                isLoading={savingDir}
                variant="bordered"
                size="sm"
              >
                {savingDir ? 'Moving...' : 'Change Location...'}
              </Button>
            </CardBody>
          </Card>

          {actualPaths && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-default-500">
              <div className="flex gap-2">
                <span className="font-medium">DB:</span> 
                <span className="truncate" title={actualPaths.databasePath}>{actualPaths.databasePath}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-medium">Files:</span> 
                <span className="truncate" title={actualPaths.uploadsDir}>{actualPaths.uploadsDir}</span>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Write-Through Mode */}
      {!isRemoteServer && (
        <Section title="Cloud Sync Optimization" icon={Shield}>
          <div className="flex items-start justify-between gap-4 p-4 bg-zinc-100/50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex-1">
              <h4 className="font-medium text-foreground">Database Write-through</h4>
              <p className="text-sm text-default-500 mt-1">
                Enable this if you are syncing your database via OneDrive/Dropbox. 
                It forces safer file operations (TRUNCATE mode) to prevent sync conflicts, 
                though it may be slightly slower.
              </p>
            </div>
            <Switch
              isSelected={!!config.writeThrough}
              onValueChange={handleToggleWriteThrough}
              isDisabled={savingWrite}
              color="primary"
              size="lg"
              classNames={{
                wrapper: "group-data-[selected=true]:bg-primary"
              }}
            />
          </div>
        </Section>
      )}

      {/* Legacy Uploads Root */}
      {!isRemoteServer && (
        <Section title="Legacy Images Location" icon={Folder} className="opacity-80">
          <div className="flex justify-between items-center">
             <div>
                <p className="text-sm text-default-500">
                  Override only the uploads folder. Not recommended if you are using the Data Storage Location setting above.
                </p>
             </div>
             <Button 
                onPress={handleChooseUploadsRoot}
                isDisabled={savingDir}
                variant="bordered"
                size="sm"
              >
                Change Path
              </Button>
          </div>
          <div className="mt-2">
             <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-default-500">
                {config.uploadsRoot || '(Default)'}
             </code>
          </div>
        </Section>
      )}

    </div>
  );
}