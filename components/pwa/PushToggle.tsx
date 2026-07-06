'use client';

import { useState } from 'react';

// Enable web push (spec §17.2). Best-effort — push is supplementary to the
// in-app notification. Hidden gracefully when push isn't configured/supported.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushToggle() {
  const [status, setStatus] = useState<'idle' | 'enabling' | 'enabled' | 'error'>('idle');

  async function enable() {
    setStatus('enabling');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('error');
        return;
      }
      const keyRes = await fetch('/api/push/subscribe');
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        setStatus('error');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('error');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      setStatus(res.ok ? 'enabled' : 'error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'enabled') return <p className="text-sm text-paid">Arifa za simu zimewashwa ✓</p>;

  return (
    <button
      type="button"
      onClick={enable}
      disabled={status === 'enabling'}
      className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-medium text-primary-dark hover:bg-surface disabled:opacity-60"
    >
      {status === 'enabling' ? '…' : status === 'error' ? 'Imeshindikana — jaribu tena' : 'Washa arifa za simu'}
    </button>
  );
}
