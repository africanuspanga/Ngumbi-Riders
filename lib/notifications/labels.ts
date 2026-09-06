/*
 * Wording for the notification list, shared by riders (Swahili) and staff
 * (English).
 *
 * In lib/, not beside the component: the pages that render it are Server
 * Components, and a constant exported from a 'use client' module reaches the
 * server as a throwing stub rather than the value. That is the boundary rule
 * enforced by tests/unit/rsc-boundary.test.ts — which caught this exact
 * mistake here before it shipped.
 */
export type NotificationListLabels = {
  markAll: string;
  empty: string;
  markReadFailed: string;
  networkError: string;
};

/** The rider area is Swahili-first (spec rule 11). */
export const NOTIFICATION_LABELS_SW: NotificationListLabels = {
  markAll: 'Soma zote',
  empty: 'Hakuna arifa.',
  markReadFailed: 'Haikuweza kuweka alama ya kusomwa. Jaribu tena.',
  networkError: 'Hitilafu ya mtandao. Jaribu tena.',
};

/** The back office is English throughout. */
export const NOTIFICATION_LABELS_EN: NotificationListLabels = {
  markAll: 'Mark all as read',
  empty: 'No notifications yet.',
  markReadFailed: 'Could not mark as read. Try again.',
  networkError: 'Network error. Try again.',
};
