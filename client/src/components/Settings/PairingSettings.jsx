/**
 * Phase 2B #1 — Pairing & Device Management panel.
 *
 * Two modes:
 *   - HOST (loopback / server is on this machine): generate pairing codes
 *     for mobile/watch clients + list/revoke paired devices.
 *   - REMOTE (connecting to a server on another machine): enter a pairing
 *     code to authenticate, or disconnect.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, CardBody, Chip, Spinner, Input } from '@heroui/react';
import {
  Smartphone, Watch, Trash2, RefreshCw, ShieldCheck, ShieldAlert,
  KeyRound, Copy, Check, Monitor, Wifi,
} from 'lucide-react';
import {
  generatePairingCode, verifyPairingCode, listSessions, revokeSession,
  getDeviceFingerprint,
} from '../../api/pairing';
import {
  getApiBase, setAuthToken, getAuthToken, clearAuthToken,
  setOnUnauthorized, isRemoteMode,
} from '../../api/core';

const CODE_TTL_MS = 5 * 60 * 1000; // must match server's CODE_TTL_MS

export default function PairingSettings() {
  const remote = isRemoteMode();

  if (remote) {
    return <RemotePairingPanel />;
  }
  return <HostPairingPanel />;
}

// ============================================================================
// HOST MODE — server runs on this machine (loopback)
// ============================================================================

function HostPairingPanel() {
  const [pairingCode, setPairingCode] = useState(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState(null);
  const [countdown, setCountdown] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await listSessions();
      setSessions(res.sessions || []);
    } catch (e) {
      console.error('[Pairing] Failed to list sessions:', e);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleGenerateCode = async () => {
    setGenerating(true);
    try {
      const res = await generatePairingCode();
      setPairingCode(res.code);
      setCodeExpiresAt(Date.now() + (res.expiresIn || CODE_TTL_MS));
      setCopied(false);
    } catch (e) {
      console.error('[Pairing] Failed to generate code:', e);
    } finally {
      setGenerating(false);
    }
  };

  // Countdown timer
  useEffect(() => {
    if (!codeExpiresAt) return;
    const update = () => {
      const remaining = codeExpiresAt - Date.now();
      if (remaining <= 0) {
        setPairingCode(null);
        setCountdown('');
        return;
      }
      const s = Math.floor(remaining / 1000);
      setCountdown(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => clearInterval(timerRef.current);
  }, [codeExpiresAt]);

  const handleCopy = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id) => {
    try {
      await revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      console.error('[Pairing] Revoke failed:', e);
    }
  };

  const serverUrl = getApiBase();

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      {/* Generate Pairing Code */}
      <Card>
        <CardBody className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <KeyRound className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">配对码</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                在手机/手表上输入此码以连接本机服务器
              </p>
            </div>
          </div>

          {pairingCode ? (
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold tracking-[0.3em] font-mono text-primary">
                {pairingCode}
              </div>
              <Chip size="sm" color="warning" variant="flat">
                {countdown}
              </Chip>
              <Button
                size="sm" variant="flat" isIconOnly
                onPress={handleCopy}
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </Button>
              <Button size="sm" variant="flat" onPress={handleGenerateCode} isLoading={generating}>
                <RefreshCw className="w-4 h-4 mr-1" /> 刷新
              </Button>
            </div>
          ) : (
            <Button color="primary" onPress={handleGenerateCode} isLoading={generating}>
              <KeyRound className="w-4 h-4 mr-2" />
              生成配对码
            </Button>
          )}

          {serverUrl && (
            <div className="mt-3 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
              服务器地址: {serverUrl}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Paired Devices */}
      <Card>
        <CardBody className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                <ShieldCheck className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">已配对设备</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {sessions.length === 0 ? '暂无配对设备' : `${sessions.length} 台设备`}
                </p>
              </div>
            </div>
            <Button
              size="sm" variant="flat" isIconOnly
              onPress={fetchSessions} isLoading={loadingSessions}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {loadingSessions ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
              <Monitor className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>生成配对码后，在手机上输入即可完成配对</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(s => (
                <DeviceRow key={s.id} session={s} onRevoke={handleRevoke} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function DeviceRow({ session, onRevoke }) {
  const Icon = session.device_kind === 'watch' ? Watch : Smartphone;
  const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).toLocaleString('zh-CN') : '-';
  const isRevoked = session.revoked_at != null;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
      <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-700/50">
        <Icon className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{session.device_name}</span>
          {isRevoked ? (
            <Chip size="sm" color="danger" variant="flat">已撤销</Chip>
          ) : (
            <Chip size="sm" color="success" variant="flat">活跃</Chip>
          )}
        </div>
        <div className="text-xs text-zinc-400 dark:text-zinc-500">
          最后活跃: {lastSeen}
        </div>
      </div>
      {!isRevoked && (
        <Button
          size="sm" variant="flat" color="danger" isIconOnly
          onPress={() => onRevoke(session.id)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// REMOTE MODE — connecting to a server on another machine
// ============================================================================

function RemotePairingPanel() {
  const [token, setToken] = useState(getAuthToken());
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);

  const serverUrl = getApiBase();
  const fp = getDeviceFingerprint();

  // Set up 401 handler to show the pairing UI
  useEffect(() => {
    setOnUnauthorized(() => {
      setToken(null);
      clearAuthToken();
      setError('认证已过期，请重新配对');
    });
  }, []);

  const handlePair = async () => {
    if (!code || code.length !== 6) {
      setError('请输入 6 位配对码');
      return;
    }
    setPairing(true);
    setError(null);
    try {
      const name = deviceName || `${navigator.platform || 'Desktop'} — ${fp.slice(-6)}`;
      const res = await verifyPairingCode(code, name, fp);
      setAuthToken(res.token);
      setToken(res.token);
      setSessionInfo({ id: res.sessionId, name });
      setCode('');
    } catch (e) {
      setError(e.message || '配对失败');
    } finally {
      setPairing(false);
    }
  };

  const handleDisconnect = () => {
    clearAuthToken();
    setToken(null);
    setSessionInfo(null);
  };

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <Card>
        <CardBody className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              {token ? (
                <ShieldCheck className="w-5 h-5 text-success" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-warning" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold">
                {token ? '已认证' : '需要配对'}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                连接到: <code className="font-mono text-xs">{serverUrl}</code>
              </p>
            </div>
          </div>

          {token ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <Check className="w-4 h-4 text-success" />
                <span>已连接到远程服务器</span>
              </div>
              {sessionInfo && (
                <div className="text-xs text-zinc-400">
                  设备: {sessionInfo.name} (ID: {sessionInfo.id})
                </div>
              )}
              <Button color="danger" variant="flat" size="sm" onPress={handleDisconnect}>
                <Trash2 className="w-4 h-4 mr-1" /> 断开连接
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 text-danger text-sm">
                  {error}
                </div>
              )}
              <Input
                label="配对码"
                labelPlacement="outside"
                placeholder="输入服务器端显示的 6 位码"
                value={code}
                onValueChange={setCode}
                maxLength={6}
                className="font-mono text-2xl tracking-[0.3em] text-center"
                size="lg"
              />
              <Input
                label="设备名称（可选）"
                labelPlacement="outside"
                placeholder="如：我的 Ubuntu"
                value={deviceName}
                onValueChange={setDeviceName}
                size="sm"
              />
              <Button
                color="primary"
                onPress={handlePair}
                isLoading={pairing}
                isDisabled={!code || code.length !== 6}
              >
                <Wifi className="w-4 h-4 mr-2" />
                配对并连接
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
