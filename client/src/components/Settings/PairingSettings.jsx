/**
 * Security / access-key settings — shared-secret auth.
 *
 * Two modes:
 *   - HOST (loopback): display the server's access secret so the user can
 *     enter it on mobile/watch clients. Includes copy + regenerate.
 *   - REMOTE (connecting to a server on another machine): enter the secret
 *     to authenticate, or disconnect.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardBody, Chip, Spinner, Input } from '@heroui/react';
import {
  KeyRound, Copy, Check, RefreshCw, ShieldCheck, ShieldAlert,
  Eye, EyeOff, Wifi,
} from 'lucide-react';
import { getServerSecret, regenerateSecret, checkAuth } from '../../api/auth';
import {
  getApiBase, setAuthToken, getAuthToken, clearAuthToken,
  setOnUnauthorized, isRemoteMode,
} from '../../api/core';

export default function PairingSettings() {
  const remote = isRemoteMode();
  if (remote) return <RemoteAuthPanel />;
  return <HostAuthPanel />;
}

// ============================================================================
// HOST MODE — server runs on this machine (loopback)
// ============================================================================

function HostAuthPanel() {
  const [secret, setSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const fetchSecret = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getServerSecret();
      setSecret(res.secret);
    } catch (e) {
      console.error('[Auth] Failed to fetch secret:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSecret(); }, [fetchSecret]);

  const handleCopy = () => {
    if (!secret) return;
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!window.confirm('重新生成密钥会使所有已连接的设备断开，它们需要重新输入新密钥。确定继续？')) return;
    setRegenerating(true);
    try {
      const res = await regenerateSecret();
      setSecret(res.secret);
    } catch (e) {
      console.error('[Auth] Regenerate failed:', e);
    } finally {
      setRegenerating(false);
    }
  };

  const masked = secret ? `${secret.slice(0, 8)}${'•'.repeat(16)}${secret.slice(-8)}` : '';

  const serverUrl = getApiBase();

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <Card>
        <CardBody className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <KeyRound className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">访问密钥</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                在手机/手表上输入此密钥以连接本机服务器
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : secret ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg px-3 py-2 break-all">
                  {revealed ? secret : masked}
                </code>
                <Button size="sm" variant="flat" isIconOnly onPress={() => setRevealed(v => !v)}>
                  {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button size="sm" variant="flat" isIconOnly onPress={handleCopy}>
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <Button size="sm" variant="flat" color="warning" onPress={handleRegenerate} isLoading={regenerating}>
                <RefreshCw className="w-4 h-4 mr-1" /> 重新生成
              </Button>
            </div>
          ) : (
            <div className="text-danger text-sm">无法读取密钥</div>
          )}

          {serverUrl && (
            <div className="mt-3 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
              服务器地址: {serverUrl}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ============================================================================
// REMOTE MODE — connecting to a server on another machine
// ============================================================================

function RemoteAuthPanel() {
  const [token, setToken] = useState(getAuthToken());
  const [input, setInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const serverUrl = getApiBase();

  useEffect(() => {
    setOnUnauthorized(() => {
      setToken(null);
      clearAuthToken();
      setError('认证已失效，请重新输入密钥');
    });
  }, []);

  const handleConnect = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError('请输入访问密钥');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      setAuthToken(trimmed);
      const res = await checkAuth();
      if (res.authenticated) {
        setToken(trimmed);
        setInput('');
      } else {
        clearAuthToken();
        setError('密钥无效（服务器可能在软模式下，请确认密钥正确）');
      }
    } catch (e) {
      clearAuthToken();
      setError(e.message || '连接失败');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    clearAuthToken();
    setToken(null);
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
                {token ? '已认证' : '需要密钥'}
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
              <Button color="danger" variant="flat" size="sm" onPress={handleDisconnect}>
                断开连接
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
                label="访问密钥"
                labelPlacement="outside"
                placeholder="粘贴服务器端显示的密钥"
                value={input}
                onValueChange={setInput}
                className="font-mono text-sm"
                size="lg"
              />
              <Button
                color="primary"
                onPress={handleConnect}
                isLoading={connecting}
                isDisabled={!input.trim()}
              >
                <Wifi className="w-4 h-4 mr-2" />
                连接
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
