import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, Button, Input, Chip } from '@heroui/react';
import { API_BASE } from '../../api';
import { 
  Laptop, 
  Globe, 
  Zap, 
  Server, 
  CheckCircle2, 
  XCircle, 
  Save, 
  RotateCw, 
  Info 
} from 'lucide-react';

/**
 * Server Connection Settings
 * Modes: Local, Remote, Hybrid
 * 支持三种模式：
 * 1. 本地服务器 (Electron 内置)
 * 2. 远程服务器 (如 NAS Docker)
 * 3. 混合模式 (远程数据 + 本地算力)
 */
export default function ServerSettings() {
  const isElectron = !!window.__electron;
  
  // Connection state
  const [serverMode, setServerMode] = useState('local'); // 'local' | 'remote' | 'hybrid'
  const [remoteUrl, setRemoteUrl] = useState('');
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'success' | 'error'
  const [serverInfo, setServerInfo] = useState(null);
  const [saving, setSaving] = useState(false);
  
  // Current connection info
  const currentApiBase = window.__electron?.API_BASE || API_BASE;
  const currentPort = window.__electron?.SERVER_PORT || 4000;
  
  // Load saved config
  useEffect(() => {
    (async () => {
      if (window.__electron?.getServerMode) {
        const modeConfig = await window.__electron.getServerMode();
        if (modeConfig) {
          setServerMode(modeConfig.mode || 'local');
          if (modeConfig.mode !== 'local' && modeConfig.apiBase) {
            setRemoteUrl(modeConfig.apiBase);
          }
        }
      } else if (window.__electron?.getConfig) {
        // Fallback to old config format
        const config = await window.__electron.getConfig();
        if (config.serverMode) {
          setServerMode(config.serverMode);
          if (config.apiBase) {
            setRemoteUrl(config.apiBase);
          }
        } else if (config.apiBase && config.apiBase !== `http://127.0.0.1:${currentPort}`) {
          setServerMode(config.useLocalCompute ? 'hybrid' : 'remote');
          setRemoteUrl(config.apiBase);
        }
      }
      // Fetch current server info
      try {
        const res = await fetch(`${currentApiBase}/api/discover`);
        if (res.ok) {
          const data = await res.json();
          setServerInfo(data);
        }
      } catch (e) {
        console.warn('Failed to fetch server info:', e);
      }
    })();
  }, [currentApiBase, currentPort]);

  // Test connection to a server
  const testConnection = useCallback(async (url) => {
    if (!url) return;
    setTestStatus('testing');
    try {
      const testUrl = url.replace(/\/+$/, '');
      const res = await fetch(`${testUrl}/api/discover`, { 
        timeout: 5000,
        mode: 'cors'
      });
      if (res.ok) {
        const data = await res.json();
        // Check for app identifier (server returns "app" not "name")
        if (data.app === 'FilmGallery' || data.name === 'filmgallery') {
          setServerInfo(data);
          setTestStatus('success');
          return true;
        }
      }
      setTestStatus('error');
      return false;
    } catch (e) {
      console.error('Connection test failed:', e);
      setTestStatus('error');
      return false;
    }
  }, []);

  // Save server configuration
  const saveServerConfig = async () => {
    if (!isElectron) return;
    setSaving(true);
    
    try {
      if (serverMode === 'local') {
        // Use local server
        const result = await window.__electron?.setServerMode?.('local', {
          useLocalCompute: true
        });
        if (result?.ok) {
          alert('已切换到本地服务器。需要重启应用以生效。');
        } else {
          alert('保存失败');
        }
      } else {
        // Use remote server (remote or hybrid mode)
        if (!remoteUrl) {
          alert('请输入远程服务器地址');
          setSaving(false);
          return;
        }
        // Test connection first
        const ok = await testConnection(remoteUrl);
        if (!ok) {
          alert('无法连接到远程服务器，请检查地址');
          setSaving(false);
          return;
        }
        
        const cleanUrl = remoteUrl.replace(/\/+$/, '');
        const result = await window.__electron?.setServerMode?.(serverMode, {
          remoteUrl: cleanUrl,
          useLocalCompute: serverMode === 'hybrid'
        });
        
        // Also update API base for immediate use
        await window.__electron?.setApiBase?.(cleanUrl);
        
        if (result?.ok) {
          alert('服务器设置已保存。需要重启应用以生效。');
        } else {
          alert('保存失败');
        }
      }
    } catch (e) {
      alert('保存出错: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  // Switch back to local server
  const switchToLocal = async () => {
    setServerMode('local');
    setRemoteUrl('');
    setServerInfo(null);
    
    if (isElectron) {
      // Use setServerMode API - it will clear apiBase automatically
      if (window.__electron?.setServerMode) {
        await window.__electron.setServerMode('local', { useLocalCompute: true });
      }
      // Note: Don't call setApiBase here - local mode uses dynamic port
      
      // Test local connection using current port
      const localUrl = `http://127.0.0.1:${currentPort}`;
      try {
        const res = await fetch(`${localUrl}/api/discover`);
        if (res.ok) {
          const data = await res.json();
          setServerInfo(data);
        }
      } catch (e) {
        console.warn('Local server not responding:', e);
      }
    }
  };


  const ModeCard = ({ mode, icon: Icon, title, description }) => (
    <Card 
      isPressable
      onPress={() => setServerMode(mode)}
      className={`
        cursor-pointer relative h-full transition-all duration-200
        ${serverMode === mode 
          ? 'border-2 border-primary bg-primary/5' 
          : 'border-2 border-transparent hover:border-default-300'}
      `}
    >
      <CardBody className="flex flex-col items-center text-center gap-3 p-5">
        <div className={`p-3 rounded-lg ${serverMode === mode ? 'bg-primary text-primary-foreground' : 'bg-zinc-100 dark:bg-zinc-800 text-default-500'}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h3 className={`font-semibold ${serverMode === mode ? 'text-primary' : 'text-foreground'}`}>
            {title}
          </h3>
          <p className="text-sm text-default-500 mt-2 leading-relaxed">
            {description}
          </p>
        </div>
        {serverMode === mode && (
          <div className="absolute top-3 right-3 text-primary">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        )}
      </CardBody>
    </Card>
  );

  return (
    <div className="space-y-8 w-full max-w-6xl mx-auto pb-12 animate-fade-in-up">
      
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Server className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Server Connection</h2>
          <p className="text-default-500 text-sm">Configure where your data is stored and processed</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full auto-rows-fr">
        <ModeCard 
          mode="local" 
          icon={Laptop} 
          title="Local Server" 
          description="Data stored on this computer. FilmLab uses local GPU for processing."
        />
        <ModeCard 
          mode="remote" 
          icon={Globe} 
          title="Remote Server" 
          description="Connect to NAS or remote server. All processing happens remotely."
        />
        <ModeCard 
          mode="hybrid" 
          icon={Zap} 
          title="Hybrid Mode" 
          description="Data on NAS, but uses this computer's GPU for faster processing. (Recommended)"
        />
      </div>

      {serverMode !== 'local' && (
        <Card className="animate-scale-in w-full">
          <CardBody className="p-6 space-y-4">
            <label className="block text-sm font-medium mb-2">Remote Server URL</label>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <Input
                value={remoteUrl}
                onValueChange={setRemoteUrl}
                placeholder="http://192.168.1.100:4000"
                startContent={<Globe className="w-4 h-4 text-default-400" />}
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-default-100 dark:bg-default-50/10 border-default-300 dark:border-default-200",
                  input: "text-foreground placeholder:text-default-400"
                }}
              />
              <Button 
                onPress={() => testConnection(remoteUrl)}
                isDisabled={!remoteUrl || testStatus === 'testing'}
                isLoading={testStatus === 'testing'}
                variant="bordered"
                className="min-w-[140px]"
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>

            {/* Test Status Feedback */}
            {testStatus === 'success' && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 p-3 rounded-lg border border-green-500/20">
                <CheckCircle2 className="w-4 h-4" />
                <span>Connection successful!</span>
                {serverInfo && (
                  <span className="text-xs opacity-80">
                    v{serverInfo.version} ({serverInfo.mode || 'standalone'})
                  </span>
                )}
              </div>
            )}
            {testStatus === 'error' && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                <XCircle className="w-4 h-4" />
                <span>Connection failed. Please check the URL and network.</span>
              </div>
            )}

            {serverMode === 'hybrid' && (
              <div className="flex gap-3 p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg text-sm text-orange-700 dark:text-orange-400">
                <Info className="w-5 h-5 flex-shrink-0" />
                <ul className="list-disc list-inside space-y-1 opacity-90">
                  <li>Photos are stored on your NAS/Server</li>
                  <li>Image processing uses your Local GPU</li>
                  <li>Requires NAS and PC to be on the same network</li>
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Current Status Footer */}
      <Card className="w-full">
        <CardBody className="p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            Current Status
            {serverInfo ? (
              <Chip color="success" variant="flat" size="sm">Connected</Chip>
            ) : (
              <Chip variant="flat" size="sm">Unknown</Chip>
            )}
          </h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm w-full">
            <div className="space-y-1">
              <span className="text-default-500 block text-xs uppercase tracking-wider">API Endpoint</span>
              <code className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-xs font-mono break-all block w-full">
                {currentApiBase}
              </code>
            </div>
            
            {serverInfo && (
              <>
                <div className="space-y-1">
                  <span className="text-default-500 block text-xs uppercase tracking-wider">Version</span>
                  <span className="font-medium">{serverInfo.version}</span>
                </div>
                <div className="space-y-1 col-span-full">
                  <span className="text-default-500 block text-xs uppercase tracking-wider">Capabilities</span>
                  <div className="flex gap-2 mt-1">
                    {serverInfo.capabilities?.database && (
                      <Chip color="primary" variant="flat" size="sm">Database</Chip>
                    )}
                    {serverInfo.capabilities?.files && (
                      <Chip color="warning" variant="flat" size="sm">File Storage</Chip>
                    )}
                    {serverInfo.capabilities?.compute && (
                      <Chip color="secondary" variant="flat" size="sm">GPU Compute</Chip>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row justify-end gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-700 w-full">
        {serverMode !== 'local' && (
          <Button
            onPress={switchToLocal}
            variant="bordered"
            startContent={<RotateCw className="w-4 h-4" />}
          >
            Reset to Local
          </Button>
        )}
        
        <Button
          onPress={saveServerConfig}
          isDisabled={saving || (serverMode !== 'local' && !remoteUrl)}
          isLoading={saving}
          color="primary"
          startContent={!saving && <Save className="w-4 h-4" />}
          className="shadow-lg shadow-primary/20"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
      
      <p className="text-center text-xs text-default-500 mt-4">
        Note: Application restart is required after changing server settings.
      </p>
    </div>
  );
}
