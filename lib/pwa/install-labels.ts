/*
 * Wording for the "add to home screen" bar.
 *
 * In lib/ for the same reason as lib/notifications/labels.ts: the layouts that
 * render <InstallPrompt> are Server Components, and a constant exported from a
 * 'use client' module is a throwing stub on the server, not a string.
 */
export type InstallPromptLabels = {
  title: string;
  body: string;
  install: string;
  iosBody: string;
  iosHint: string;
  dismiss: string;
};

export const INSTALL_LABELS_SW: InstallPromptLabels = {
  title: 'Weka programu kwenye simu yako',
  body: 'Fungua moja kwa moja bila kupitia Chrome kila mara.',
  install: 'Weka sasa',
  iosBody: 'Bonyeza kitufe cha Share kisha "Add to Home Screen".',
  iosHint: 'Share → Add to Home Screen',
  dismiss: 'Funga',
};

export const INSTALL_LABELS_EN: InstallPromptLabels = {
  title: 'Add Ng’umbi Riders to your home screen',
  body: 'Open it straight from your phone instead of through Chrome each time.',
  install: 'Install',
  iosBody: 'Tap the Share button, then “Add to Home Screen”.',
  iosHint: 'Share → Add to Home Screen',
  dismiss: 'Dismiss',
};
