'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeRiderPhoto, uploadRiderPhoto } from '@/lib/riders/photo';
import { MAX_PHOTO_BYTES, MAX_PHOTO_MB, PHOTO_ACCEPT_ATTR } from '@/lib/riders/photo-constants';

const ERRORS: Record<string, string> = {
  forbidden: 'You are not allowed to change this picture.',
  no_file: 'Choose an image first.',
  too_large: `That image is larger than ${MAX_PHOTO_MB} MB.`,
  invalid_type: 'Only JPG, PNG or WebP images are accepted.',
  not_found: 'Rider not found — reload and try again.',
  upload_failed: 'Upload failed. Check your connection and try again.',
  update_failed: 'Could not save the picture. Try again.',
  bad_request: 'Something went wrong — reload and try again.',
};

/**
 * Owner-side profile-picture upload / replace / remove (build spec #3).
 *
 * Every check here is a duplicate of a server-side one in lib/riders/photo.ts —
 * this exists to give fast feedback, not to enforce anything. Failures are
 * shown; nothing is swallowed (the silent-failure rule from the 2026-07-11
 * hardening sweep).
 */
export function RiderPhotoControls({
  riderId,
  hasPhoto,
}: {
  riderId: string;
  hasPhoto: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setError(ERRORS.too_large!);
      return;
    }
    const data = new FormData();
    data.set('riderId', riderId);
    data.set('photo', file);
    try {
      const res = await uploadRiderPhoto(data);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? 'Could not upload the picture.');
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      startTransition(() => router.refresh());
    } catch {
      setError('Network error — the picture was not saved.');
    }
  }

  async function onRemove() {
    setError(null);
    try {
      const res = await removeRiderPhoto(riderId);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? 'Could not remove the picture.');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError('Network error — the picture was not removed.');
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
        >
          {hasPhoto ? 'Replace picture' : 'Upload picture'}
        </button>
        {hasPhoto && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-surface disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <span className="text-xs text-muted-foreground">
        JPG, PNG or WebP · max {MAX_PHOTO_MB} MB
      </span>
      {error && (
        <p role="alert" className="text-xs font-medium text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}
