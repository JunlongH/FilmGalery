import React, { useEffect, useState } from 'react';
import { getApiBase } from '../api';
import SettingsTabs from './Settings/SettingsTabs';
import GeneralSettings from './Settings/GeneralSettings';
import ServerSettings from './Settings/ServerSettings';
import MapSettings from './Settings/MapSettings';
import AISettings from './Settings/AISettings';
import PairingSettings from './Settings/PairingSettings';

export default function Settings() {
  const [config, setConfig] = useState({});
  const [actualPaths, setActualPaths] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('general');

  const isElectron = !!window.__electron;
  
  // Detect remote server (non-localhost)
  const isRemoteServer = (() => {
    try {
      const url = new URL(getApiBase());
      const host = url.hostname.toLowerCase();
      // Simple check, robust enough for typical scenarios
      return host !== 'localhost' && host !== '127.0.0.1';
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const apiBase = getApiBase();
        const cfg = await (window.__electron?.getConfig?.() || {});
        if (mounted) setConfig(cfg || {});
        
        // Fetch actual backend paths for verification
        try {
          const res = await fetch(`${apiBase}/api/health`);
          if (res.ok) {
            const data = await res.json();
            if (mounted && data.storage) setActualPaths(data.storage);
          }
        } catch {}

        // Fetch server info
        try {
          const infoRes = await fetch(`${apiBase}/api/discover`);
          if (infoRes.ok) {
            const info = await infoRes.json();
            if (mounted) setServerInfo(info);
          }
        } catch {}
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // --- Handlers for General Settings ---

  async function chooseUploadsRoot() {
    try {
      if (!isElectron) return;
      const dir = await window.__electron?.pickUploadsRoot?.();
      if (!dir) return; // cancelled
      
      const res = await window.__electron?.setUploadsRoot?.(dir);
      if (res && res.ok) {
        setConfig(res.config || {});
      } else {
        alert('Failed to save uploads root.');
      }
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  async function chooseDataRoot() {
    try {
      if (!isElectron) return;
      const dir = await window.__electron?.pickDataRoot?.();
      if (!dir) return; // cancelled
      
      const res = await window.__electron?.setDataRoot?.(dir);
      if (res && res.ok) {
        setConfig(res.config || {});
        // Refresh actual paths after restart
        setTimeout(async () => {
          try {
            const apiBase = getApiBase();
            const healthRes = await fetch(`${apiBase}/api/health`);
            if (healthRes.ok) {
              const data = await healthRes.json();
              if (data.storage) setActualPaths(data.storage);
            }
          } catch {}
        }, 1000);
        alert('Data location updated. The server has been restarted.');
      } else {
        alert('Failed to save data root.');
      }
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  async function toggleWriteThrough(next) {
    if (!window.__electron?.setWriteThrough) return;
    try {
      const res = await window.__electron.setWriteThrough(next);
      if (res && res.ok) {
        setConfig(res.config || {});
      } else {
        alert('Failed to update write-through mode.');
      }
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 animate-fade-in">
      <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
        <h2 className="text-3xl font-bold mb-8 tracking-tight">Settings</h2>
        
        <div className="mb-8">
          <SettingsTabs 
            activeTab={activeTab} 
            onTabChange={setActiveTab}
            showServerTab={true} // Always show for now, or use isElectron if specific logic needed
          />
        </div>

        <div className="min-h-[400px]">
           {activeTab === 'general' && (
             <GeneralSettings
               config={config}
               serverInfo={serverInfo}
               actualPaths={actualPaths}
               isElectron={isElectron}
               isRemoteServer={isRemoteServer}
               onChooseDataRoot={chooseDataRoot}
               onChooseUploadsRoot={chooseUploadsRoot}
               onToggleWriteThrough={toggleWriteThrough}
             />
           )}

           {activeTab === 'server' && (
             <ServerSettings />
           )}

           {activeTab === 'storage' && (
             <div className="p-12 text-center text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700 border-dashed">
               <p>Storage analysis coming soon...</p>
             </div>
           )}

           {activeTab === 'map' && (
             <MapSettings />
           )}

            {activeTab === 'ai' && (
              <AISettings />
            )}

            {activeTab === 'security' && (
              <PairingSettings />
            )}
        </div>
      </div>
    </div>
  );
}
