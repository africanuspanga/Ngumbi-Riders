'use client';

import type { ReactNode } from 'react';
import type { FieldError } from 'react-hook-form';

export function FieldShell({
  label,
  error,
  required,
  children,
  hint,
}: {
  label: string;
  error?: FieldError;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-overdue"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs font-medium text-overdue">
          {error.message}
        </span>
      )}
    </label>
  );
}

type BaseProps = {
  label: string;
  error?: FieldError;
  required?: boolean;
  hint?: string;
};

export function TextField({
  label,
  error,
  required,
  hint,
  ...input
}: BaseProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} required={required} hint={hint}>
      <input className="input" aria-invalid={!!error} {...input} />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  required,
  hint,
  ...input
}: BaseProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} required={required} hint={hint}>
      <textarea className="input min-h-24" aria-invalid={!!error} {...input} />
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  required,
  hint,
  children,
  ...input
}: BaseProps &
  React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <FieldShell label={label} error={error} required={required} hint={hint}>
      <select className="input bg-white" aria-invalid={!!error} {...input}>
        {children}
      </select>
    </FieldShell>
  );
}
