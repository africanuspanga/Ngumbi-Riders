'use client';

import { useEffect } from 'react';

// Registers the service worker (spec §26.1). Runs once on mount; failures are
// non-fatal (the app works without it).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW registration is best-effort */
    });
  }, []);
  return null;
}
