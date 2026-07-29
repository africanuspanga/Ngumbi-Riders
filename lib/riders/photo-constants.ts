/*
 * Rider profile-picture constraints (build spec #3).
 *
 * Kept out of `lib/riders/photo.ts` because that file is `'use server'` and
 * such a file may only export async functions — exporting a constant from it
 * fails the production build ("A 'use server' file can only export async
 * functions, found object"). The client controls import the limit from here so
 * the message they show matches what the server actually enforces.
 */

/** 4 MiB — the same per-file cap the public application uploads use (D-030). */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export const MAX_PHOTO_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));

/** Images only — a PDF is a document, not a profile picture. */
export const ALLOWED_PHOTO_TYPES = ['jpeg', 'png', 'webp'] as const;

export const PHOTO_ACCEPT_ATTR = 'image/jpeg,image/png,image/webp';
