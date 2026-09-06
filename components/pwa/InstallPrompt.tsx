'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DownloadIcon, ShareIcon, XIcon } from 'lucide-react';
import type { InstallPromptLabels } from '@/lib/pwa/install-labels';

/*
 * "Add to home screen" (client feedback 2026-09-06: riders, accountants and
 * the owner should not have to open Chrome and type the address every time).
 *
 * The manifest already makes the app installable — what was missing is anyone
 * ever being TOLD. Browsers only surface their own install affordance in a
 * menu most users never open, so this asks.
 *
 * Two paths, because the platforms genuinely differ:
 *
 *   Android / Chrome / Edge  fire `beforeinstallprompt`, which we capture and
 *                            replay from a real button. prompt() is rejected
 *                            outside a user gesture, so the event is stored
 *                            and used only from the click handler.
 *   iOS Safari               has no such event and no programmatic install at
 *                            all. The only route is Share → Add to Home
 *                            Screen, so there we show that instruction rather
 *                            than a button that could not work.
 *
 * Install availability is an EXTERNAL SYSTEM — a browser event that fires when
 * the browser decides, plus a display mode and a stored dismissal — so it is
 * read through `useSyncExternalStore` rather than copied into state inside an
 * effect. Doing the latter is what the React Compiler flags as a cascading
 * render, and it is the same reason the dashboard clock is written this way.
 */

/** The non-standard event Chromium fires; not in lib.dom. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'ngr_install_dismissed';

/* ------------------------------------------------------------------ *
 * The external store
 * ------------------------------------------------------------------ */

/*
 * Module-level, not per-component: `beforeinstallprompt` fires ONCE per page
 * load, and it may well fire before this component mounts. Holding the event
 * here means a late mount still sees it, where per-instance state would have
 * missed it entirely and the bar would never appear.
 */
let deferredEvent: BeforeInstallPromptEvent | null = null;
let dismissed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's own flag, which predates the standard media query.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private mode with storage denied: treat it as "not dismissed" so the bar
    // simply asks again later, rather than the click doing nothing at all.
    return false;
  }
}

function onBeforeInstall(event: Event): void {
  // Suppress Chrome's own mini-infobar so there is one ask, not two.
  event.preventDefault();
  deferredEvent = event as BeforeInstallPromptEvent;
  emit();
}

function onInstalled(): void {
  deferredEvent = null;
  emit();
}

function subscribe(onChange: () => void): () => void {
  if (listeners.size === 0) {
    dismissed = readDismissed();
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    }
  };
}

/** What the bar should show right now. A plain string, so React's identity
 *  check is stable and a re-render is never triggered by a fresh object. */
type InstallState = 'hidden' | 'ios' | 'prompt';

function getSnapshot(): InstallState {
  if (dismissed || isStandalone()) return 'hidden';
  if (isIos()) return 'ios';
  return deferredEvent ? 'prompt' : 'hidden';
}

/** Nothing is offered during SSR: every input is browser-only, and rendering
 *  the bar on the server would flash it for users who cannot install. */
function getServerSnapshot(): InstallState {
  return 'hidden';
}

/* ------------------------------------------------------------------ *
 * The component
 * ------------------------------------------------------------------ */

export function InstallPrompt({ labels }: { labels: InstallPromptLabels }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dismiss = useCallback(() => {
    dismissed = true;
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* see readDismissed */
    }
    emit();
  }, []);

  const install = useCallback(async () => {
    const event = deferredEvent;
    if (!event) return;
    // The event is single-use; clear it before awaiting so a double click
    // cannot call prompt() twice on the same one.
    deferredEvent = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A declined install should not nag on the next page either.
    if (outcome === 'dismissed') dismiss();
    else emit();
  }, [dismiss]);

  if (state === 'hidden') return null;
  const ios = state === 'ios';

  return (
    <div className="flex items-start gap-3 rounded-[--radius-card] border border-border bg-white px-4 py-3 text-sm shadow-sm">
      <DownloadIcon className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="font-semibold">{labels.title}</p>
          <p className="text-muted-foreground">{ios ? labels.iosBody : labels.body}</p>
        </div>
        {ios ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <ShareIcon className="size-3.5 shrink-0" aria-hidden />
            {labels.iosHint}
          </p>
        ) : (
          <button
            type="button"
            onClick={install}
            className="min-h-11 self-start rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover"
          >
            {labels.install}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={labels.dismiss}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
