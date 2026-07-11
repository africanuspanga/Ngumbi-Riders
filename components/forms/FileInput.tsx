'use client';

import { useState } from 'react';
import {
  validateFile,
  ACCEPT_ATTRIBUTE,
  type FileRejection,
} from '@/lib/applications/documents';

const REJECTION_MESSAGE: Record<FileRejection, string> = {
  type: 'Aina ya faili hairuhusiwi. Tumia PDF, JPG au PNG.',
  extension: 'Kiendelezi cha faili si sahihi.',
  size: 'Faili ni kubwa mno (kikomo 4MB).',
  empty: 'Faili ni tupu.',
};

/*
 * Client-side file selection with the same accept rules the server enforces
 * (spec §8.6). Stores the selected File in parent state; actual upload happens
 * through a server-issued signed URL at submit time.
 */
export function FileInput({
  label,
  file,
  onSelect,
  required,
}: {
  label: string;
  file: File | null;
  onSelect: (file: File | null) => void;
  required?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (!selected) {
      onSelect(null);
      setError(null);
      return;
    }
    const check = validateFile({
      name: selected.name,
      type: selected.type,
      size: selected.size,
    });
    if (!check.ok) {
      setError(REJECTION_MESSAGE[check.reason]);
      onSelect(null);
      e.target.value = '';
      return;
    }
    setError(null);
    onSelect(selected);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-overdue"> *</span>}
      </span>
      <input
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        onChange={handle}
        className="block w-full text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-[--radius-card] file:border-0 file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-dark"
      />
      {file && !error && (
        <span className="text-xs text-paid">✓ {file.name}</span>
      )}
      {error && (
        <span role="alert" className="text-xs font-medium text-overdue">
          {error}
        </span>
      )}
    </div>
  );
}
