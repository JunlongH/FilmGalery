import React, { useEffect, useState } from 'react';

export default function Settings() {
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);
  const [savingWriteThrough, setSavingWriteThrough] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await (window.__electron?.getConfig?.() || {});
        if (mounted) setConfig(cfg || {});
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  async function chooseUploadsRoot() {
    try {
      const dir = await window.__electron?.pickUploadsRoot?.();
      if (!dir) return;
      setSaving(true);
      const res = await window.__electron?.setUploadsRoot?.(dir);
      if (res && res.ok) {
        setConfig(res.config || {});
      } else {
        alert('Failed to save.');
      }
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function chooseDataRoot() {
    try {
      const dir = await window.__electron?.pickDataRoot?.();
      if (!dir) return;
      setSaving(true);
      const res = await window.__electron?.setDataRoot?.(dir);
      if (res && res.ok) {
        setConfig(res.config || {});
        alert('Data location updated. The server has been restarted.');
      } else {
        alert('Failed to save.');
      }
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleWriteThrough(next) {
    if (!window.__electron?.setWriteThrough) return alert('This option is only available in Electron.');
    try {
      setSavingWriteThrough(true);
      const res = await window.__electron.setWriteThrough(next);
      if (res && res.ok) {
        setConfig(res.config || {});
        alert('Write-through mode updated. Backend restarted.');
      } else {
        alert('Failed to update write-through mode.');
      }
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    } finally {
      setSavingWriteThrough(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3>Data Location (Database & Uploads)</h3>
        <p style={{ color: '#555' }}>Choose where the database (film.db) and uploads are stored. Useful for OneDrive/Dropbox syncing.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <code style={{ background: '#f2efe8', padding: '6px 8px', borderRadius: 4 }}>
            {config.dataRoot || '(default) %APPDATA%/FilmGallery'}
          </code>
          <button disabled={saving} onClick={chooseDataRoot}>
            {saving ? 'Saving…' : 'Change...'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3>Database Write-through (OneDrive即时同步)</h3>
        <p style={{ color: '#555' }}>
          When enabled, commits go straight to film.db (journal_mode=TRUNCATE, synchronous=FULL). Helpful for multi-device OneDrive sync; may be slightly slower than WAL.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!!config.writeThrough}
            disabled={savingWriteThrough}
            onChange={(e) => toggleWriteThrough(e.target.checked)}
          />
          <span>{savingWriteThrough ? 'Updating…' : 'Enable write-through mode'}</span>
        </label>
        <div style={{ marginTop: 8, color: '#777', fontSize: 13 }}>
          Applies immediately and restarts backend. Disable to return to WAL mode (better throughput).
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3>Legacy: Image Storage Root</h3>
        <p style={{ color: '#555' }}>Override only the uploads folder (not recommended if using Data Location).</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <code style={{ background: '#f2efe8', padding: '6px 8px', borderRadius: 4 }}>
            {config.uploadsRoot || '(default)'}
          </code>
          <button disabled={saving} onClick={chooseUploadsRoot}>
            {saving ? 'Saving…' : 'Change...'}
          </button>
        </div>
        <div style={{ marginTop: 8, color: '#777', fontSize: 13 }}>
          Changes apply immediately to the local server. Existing files are not moved automatically.
        </div>
      </div>
    </div>
  );
}
