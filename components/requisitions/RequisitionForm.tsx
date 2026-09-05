'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PlusIcon,
  Trash2Icon,
  InfoIcon,
  ShoppingCartIcon,
  PaperclipIcon,
  SendIcon,
  SaveIcon,
  ArrowLeftIcon,
} from 'lucide-react';
import {
  requisitionSchema,
  type RequisitionFormInput,
  type RequisitionInput,
} from '@/lib/requisitions/validation';
import {
  saveRequisition,
  submitRequisition,
  uploadRequisitionDocument,
  removeRequisitionDocument,
} from '@/lib/requisitions/actions';
import { lineAmount, requisitionTotal } from '@/lib/requisitions/compute';
import {
  BUDGET_COVER_LABELS,
  CURRENCY_LABEL,
  DEPARTMENT_LABELS,
  ITEM_CATEGORY_LABELS,
  MAX_REQUISITION_DOCUMENTS,
  MAX_REQUISITION_DOC_BYTES,
  REQUISITION_BUDGET_COVERS,
  REQUISITION_DEPARTMENTS,
  REQUISITION_DOC_ACCEPT,
  REQUISITION_ITEM_CATEGORIES,
  REQUISITION_UNITS,
  UNIT_LABELS,
} from '@/lib/requisitions/constants';
import { TextField, TextAreaField, SelectField } from '@/components/forms/Field';
import { formatTZS } from '@/lib/money/format';
import type { Approver, RequisitionDocumentRow } from '@/lib/requisitions/queries';

/*
 * New / edit purchase requisition (client feedback 2026-09-05).
 *
 * The order of operations mirrors the /apply wizard for the same reason
 * (D-030): the request is SAVED first, then each supporting document is
 * uploaded in its own request, because Vercel caps a request body at ~4.5 MB
 * and ten quotations in one submit would fail with an opaque 413.
 *
 * "Save as draft" and "Submit request" run the same save; submitting is one
 * extra explicit step afterwards, so a failed submit never loses the typing.
 */

const ERRORS: Record<string, string> = {
  forbidden: 'You do not have permission to raise purchase requests.',
  invalid_input: 'Something on the form is not valid — check the highlighted fields.',
  invalid_approver: 'Choose a Managing Director to approve this request.',
  future_date: 'The request date cannot be in the future.',
  not_draft: 'This request has already been submitted and can no longer be edited.',
  not_found: 'That request no longer exists — go back to the list.',
  no_items: 'Add at least one item before submitting.',
  items_failed: 'The items could not be saved. Nothing was recorded — try again.',
  too_large: 'That file is larger than 4MB.',
  too_many: `A request may carry at most ${MAX_REQUISITION_DOCUMENTS} documents.`,
  invalid_type: 'Only PDF, JPG, PNG or WebP files can be attached.',
  upload_failed: 'The file could not be uploaded. The request itself was saved.',
  insert_failed: 'The file could not be attached. The request itself was saved.',
  server_error: 'A server error occurred. Check the list before trying again.',
};

const message = (code: string | undefined) =>
  ERRORS[code ?? ''] ?? 'That could not be completed. Reload the page and try again.';

const EMPTY_ITEM = {
  description: '',
  category: 'motorcycle' as const,
  quantity: 1,
  unit: 'unit' as const,
  unitPrice: '' as unknown as number,
  budgetCover: 'collections' as const,
};

export type RequisitionFormDefaults = Partial<RequisitionFormInput> & { id?: string };

export function RequisitionForm({
  approvers,
  today,
  defaults,
  existingDocuments = [],
  requisitionNumber,
  backHref,
  listHref,
}: {
  approvers: Approver[];
  today: string;
  defaults?: RequisitionFormDefaults;
  existingDocuments?: RequisitionDocumentRow[];
  /** Shown greyed-out on a new request: the number is allocated on save. */
  requisitionNumber?: string;
  backHref: string;
  listHref: string;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | undefined>(defaults?.id);
  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<RequisitionDocumentRow[]>(existingDocuments);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RequisitionFormInput, unknown, RequisitionInput>({
    resolver: zodResolver(requisitionSchema),
    defaultValues: {
      title: '',
      description: '',
      department: undefined,
      requestDate: today,
      paymentInformation: '',
      approverId: approvers.length === 1 ? approvers[0]?.id : undefined,
      items: [EMPTY_ITEM],
      ...defaults,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  // Live totals: the accountant watches the amount build up as they type, and
  // the figure comes from the same pure function the server totals with, so
  // the preview can never disagree with what the Director approves.
  const watchedItems = useWatch({ control, name: 'items' });
  const lines = useMemo(
    () =>
      (watchedItems ?? []).map((i) => ({
        quantity: Number(i?.quantity ?? 0),
        unitPrice: Number(i?.unitPrice ?? 0),
      })),
    [watchedItems],
  );
  const total = requisitionTotal(lines);

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const room = MAX_REQUISITION_DOCUMENTS - docs.length - files.length;
    const accepted: File[] = [];
    for (const file of Array.from(selected).slice(0, Math.max(room, 0))) {
      if (file.size > MAX_REQUISITION_DOC_BYTES) {
        setError(`${file.name} is larger than 4MB and was not attached.`);
        continue;
      }
      accepted.push(file);
    }
    if (room <= 0) setError(message('too_many'));
    setFiles((current) => [...current, ...accepted]);
  }

  /** Save, upload any queued files, then optionally submit. */
  async function persist(values: RequisitionInput, mode: 'draft' | 'submit') {
    setBusy(mode);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveRequisition(values, id);
      if (!saved.ok) {
        setError(message(saved.error));
        return;
      }
      const requisitionId = saved.data!.id;
      setId(requisitionId);

      // One request per file (D-030). A failed upload never discards the
      // request that was already saved — it is reported and the rest continue.
      const uploaded: RequisitionDocumentRow[] = [];
      const failed: string[] = [];
      for (const file of files) {
        const body = new FormData();
        body.set('requisitionId', requisitionId);
        body.set('file', file);
        const res = await uploadRequisitionDocument(body);
        if (res.ok && res.data) {
          uploaded.push({
            id: res.data.id,
            fileName: res.data.fileName,
            mimeType: file.type,
            sizeBytes: file.size,
            createdAt: new Date().toISOString(),
          });
        } else {
          failed.push(`${file.name} (${message(res.ok ? undefined : res.error).toLowerCase()})`);
        }
      }
      setDocs((current) => [...current, ...uploaded]);
      setFiles([]);

      if (mode === 'submit') {
        const sent = await submitRequisition(requisitionId);
        if (!sent.ok) {
          setError(message(sent.error));
          router.refresh();
          return;
        }
        router.push(listHref);
        router.refresh();
        return;
      }

      setNotice(
        failed.length > 0
          ? `Saved as ${saved.data!.requisitionNumber}. These files were not attached: ${failed.join(', ')}.`
          : `Saved as draft ${saved.data!.requisitionNumber}. Submit it when you are ready.`,
      );
      router.refresh();
    } catch {
      setError('Network error — open the requests list to check whether it was saved before retrying.');
    } finally {
      setBusy(null);
    }
  }

  async function detachExisting(documentId: string) {
    const res = await removeRequisitionDocument(documentId);
    if (res.ok) {
      setDocs((current) => current.filter((d) => d.id !== documentId));
      router.refresh();
    } else {
      setError(message(res.error));
    }
  }

  return (
    <form className="flex flex-col gap-6">
      {/* ---- Request information ------------------------------------- */}
      <Section icon={<InfoIcon className="size-4" />} title="Request information">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField
            label="Request number"
            value={requisitionNumber ?? 'Allocated when you save'}
          />
          <TextField
            label="Request date"
            type="date"
            max={today}
            required
            error={errors.requestDate?.message}
            {...register('requestDate')}
          />
        </div>
        <TextField
          label="Title"
          placeholder="e.g. Purchase of 5 new motorcycles"
          required
          error={errors.title?.message}
          {...register('title')}
        />
        <TextAreaField
          label="Description"
          placeholder="Why this purchase is needed, and anything the Managing Director should know"
          error={errors.description?.message}
          {...register('description')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Department"
            required
            defaultValue=""
            error={errors.department?.message}
            {...register('department')}
          >
            <option value="" disabled>
              Select option
            </option>
            {REQUISITION_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </option>
            ))}
          </SelectField>
          <ReadOnlyField
            label="Fiscal year"
            value={String(new Date().getFullYear())}
            hint="Taken from the request date"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField
            label="Currency"
            value={CURRENCY_LABEL}
            hint="All amounts in this system are Tanzania Shillings"
          />
        </div>
        <TextAreaField
          label="Payment information"
          placeholder={'Enter bank account or mobile number for payment\ne.g. GESHON ENTERPRISES\nCRDB 0152421911200'}
          hint="All information needed to pay: account number, bank name, mobile number"
          error={errors.paymentInformation?.message}
          {...register('paymentInformation')}
        />
      </Section>

      {/* ---- Items ---------------------------------------------------- */}
      <Section
        icon={<ShoppingCartIcon className="size-4" />}
        title="Request items"
        action={
          <button
            type="button"
            onClick={() => append(EMPTY_ITEM)}
            className="inline-flex items-center gap-1.5 rounded-[--radius-card] bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            <PlusIcon className="size-4" /> Add item
          </button>
        }
      >
        {errors.items?.message && (
          <p role="alert" className="text-sm font-medium text-[color:var(--color-overdue)]">
            {errors.items.message}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase">
                <th className="px-2 pb-2 font-semibold">Item description</th>
                <th className="px-2 pb-2 font-semibold">Category</th>
                <th className="px-2 pb-2 font-semibold">Qty</th>
                <th className="px-2 pb-2 font-semibold">UOM</th>
                <th className="px-2 pb-2 font-semibold">Unit price</th>
                <th className="px-2 pb-2 text-right font-semibold">Amount</th>
                <th className="px-2 pb-2 font-semibold">Budget cover</th>
                <th className="px-2 pb-2 font-semibold">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const rowErrors = errors.items?.[index];
                const amount = lineAmount(lines[index] ?? { quantity: 0, unitPrice: 0 });
                return (
                  <tr key={field.id} className="align-top">
                    <td className="px-2 pb-3">
                      <input
                        className="input"
                        placeholder="e.g. Boxer BM 150"
                        aria-label={`Item ${index + 1} description`}
                        aria-invalid={!!rowErrors?.description}
                        {...register(`items.${index}.description`)}
                      />
                      <FieldError message={rowErrors?.description?.message} />
                    </td>
                    <td className="px-2 pb-3">
                      <select
                        className="input bg-white"
                        aria-label={`Item ${index + 1} category`}
                        {...register(`items.${index}.category`)}
                      >
                        {REQUISITION_ITEM_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {ITEM_CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                      <FieldError message={rowErrors?.category?.message} />
                    </td>
                    <td className="w-24 px-2 pb-3">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        aria-label={`Item ${index + 1} quantity`}
                        aria-invalid={!!rowErrors?.quantity}
                        {...register(`items.${index}.quantity`)}
                      />
                      <FieldError message={rowErrors?.quantity?.message} />
                    </td>
                    <td className="w-32 px-2 pb-3">
                      <select
                        className="input bg-white"
                        aria-label={`Item ${index + 1} unit`}
                        {...register(`items.${index}.unit`)}
                      >
                        {REQUISITION_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {UNIT_LABELS[u]}
                          </option>
                        ))}
                      </select>
                      <FieldError message={rowErrors?.unit?.message} />
                    </td>
                    <td className="w-36 px-2 pb-3">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        placeholder="0"
                        aria-label={`Item ${index + 1} unit price`}
                        aria-invalid={!!rowErrors?.unitPrice}
                        {...register(`items.${index}.unitPrice`)}
                      />
                      <FieldError message={rowErrors?.unitPrice?.message} />
                    </td>
                    <td className="px-2 pb-3 text-right font-mono text-sm tabular-nums">
                      <span className="inline-block min-h-11 py-3">{formatTZS(amount)}</span>
                    </td>
                    <td className="w-40 px-2 pb-3">
                      <select
                        className="input bg-white"
                        aria-label={`Item ${index + 1} budget cover`}
                        {...register(`items.${index}.budgetCover`)}
                      >
                        {REQUISITION_BUDGET_COVERS.map((b) => (
                          <option key={b} value={b}>
                            {BUDGET_COVER_LABELS[b]}
                          </option>
                        ))}
                      </select>
                      <FieldError message={rowErrors?.budgetCover?.message} />
                    </td>
                    <td className="px-2 pb-3">
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                        aria-label={`Remove item ${index + 1}`}
                        className="inline-flex size-11 items-center justify-center rounded-[--radius-card] border border-border text-[color:var(--color-overdue)] hover:bg-[color:var(--color-overdue)]/10 disabled:opacity-40"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="px-2 pt-2 text-right font-semibold">
                  Total amount
                </td>
                <td className="border-t-2 border-primary px-2 pt-2 text-right font-mono text-base font-bold tabular-nums text-primary-dark">
                  {formatTZS(total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      {/* ---- Documents ------------------------------------------------ */}
      <Section icon={<PaperclipIcon className="size-4" />} title="Supporting documents">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Upload documents (max {MAX_REQUISITION_DOCUMENTS} files)
          </span>
          <input
            type="file"
            multiple
            accept={REQUISITION_DOC_ACCEPT}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-[--radius-card] file:border-0 file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-dark"
          />
          <span className="text-xs text-muted-foreground">
            Allowed: PDF, JPG, PNG, WebP · max 4MB per file. Quotations and proformas
            are attached when you save.
          </span>
        </div>

        {(docs.length > 0 || files.length > 0) && (
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate">
                  {d.fileName}
                  <span className="text-muted-foreground"> · attached</span>
                </span>
                <button
                  type="button"
                  onClick={() => detachExisting(d.id)}
                  className="text-xs font-semibold text-[color:var(--color-overdue)] underline"
                >
                  Remove
                </button>
              </li>
            ))}
            {files.map((f, index) => (
              <li
                key={`${f.name}-${index}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="truncate">
                  {f.name}
                  <span className="text-muted-foreground"> · uploads when you save</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((c) => c.filter((_, i) => i !== index))}
                  className="text-xs font-semibold text-[color:var(--color-overdue)] underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---- Approver -------------------------------------------------- */}
      <section className="rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
        <h2 className="border-b-2 border-primary pb-2 font-semibold text-primary-dark">
          Managing Director
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Approver"
            required
            defaultValue=""
            error={errors.approverId?.message}
            {...register('approverId')}
          >
            <option value="" disabled>
              Select approver
            </option>
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
          <ReadOnlyField label="Approval date" value="To be filled upon approval" />
        </div>
      </section>

      {notice && (
        <p className="rounded-[--radius-card] border border-[color:var(--color-paid)]/30 bg-[color:var(--color-paid)]/10 px-4 py-3 text-sm font-medium text-[color:var(--color-paid)]">
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-[--radius-card] border border-[color:var(--color-overdue)]/30 bg-[color:var(--color-overdue)]/10 px-4 py-3 text-sm font-medium text-[color:var(--color-overdue)]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold hover:bg-surface"
        >
          <ArrowLeftIcon className="size-4" /> Back
        </Link>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleSubmit((v) => persist(v, 'draft'))}
            className="inline-flex items-center gap-2 rounded-[--radius-card] bg-primary-dark px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <SaveIcon className="size-4" />
            {busy === 'draft' ? 'Saving…' : 'Save as draft'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleSubmit((v) => persist(v, 'submit'))}
            className="inline-flex items-center gap-2 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            <SendIcon className="size-4" />
            {busy === 'submit' ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-primary">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <p className="input flex items-center bg-muted text-muted-foreground">{value}</p>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span role="alert" className="mt-1 block text-xs font-medium text-[color:var(--color-overdue)]">
      {message}
    </span>
  );
}
