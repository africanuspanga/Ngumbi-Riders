'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRiderUser } from '@/lib/auth/provision';
import { generateTempPin } from '@/lib/auth/temp-pin';
import { validatePin } from '@/lib/auth/pin';
import { encryptOptionalPII } from '@/lib/security/crypto';
import { writeAudit } from '@/lib/audit/audit';
import { parseImportFile } from './parse';
import { validateRows } from './validate';
import { IMPORT_DEFS, isImportType, type ImportType } from './definitions';

/*
 * CSV/XLSX import (spec §21). dryRunImport parses + validates + detects
 * duplicates (in-batch and against the DB), then persists an import batch and
 * its rows WITHOUT touching live tables. commitImport inserts only the valid,
 * non-duplicate rows and produces a report. Every import has a batch id and the
 * original file is stored in a restricted bucket (§21.3).
 *
 * Activates when Supabase credentials are configured.
 */

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type DryRunResult =
  | {
      ok: true;
      batchId: string;
      summary: { total: number; valid: number; errors: number; duplicates: number };
      preview: { rowNumber: number; status: string; errors: string[] }[];
    }
  | { ok: false; error: string };

export async function dryRunImport(formData: FormData): Promise<DryRunResult> {
  const ownerId = await assertOwner();
  const type = formData.get('type');
  const file = formData.get('file');
  if (!isImportType(typeof type === 'string' ? type : null)) {
    return { ok: false, error: 'bad_type' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'no_file' };
  }
  const importType = type as ImportType;
  const def = IMPORT_DEFS[importType];

  let parsed;
  try {
    parsed = await parseImportFile(file);
  } catch {
    return { ok: false, error: 'parse_failed' };
  }

  const { rows: validated } = validateRows(importType, parsed.rows);

  const admin = createAdminClient();

  // DB duplicate detection for otherwise-valid rows.
  const candidateValues = validated
    .filter((r) => r.status === 'valid' && r.dupValue)
    .map((r) => r.dupValue!) as string[];
  const existing = new Set<string>();
  if (candidateValues.length > 0) {
    const { data } = await admin
      .from(def.dupTable)
      .select(def.dupField)
      .in(def.dupField, candidateValues);
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      existing.add(row[def.dupField]!);
    }
  }
  for (const r of validated) {
    if (r.status === 'valid' && r.dupValue && existing.has(r.dupValue)) {
      r.status = 'duplicate_in_batch';
      r.errors = [`Already exists in ${def.dupTable}: ${r.dupValue}`];
    }
  }

  const summary = {
    total: validated.length,
    valid: validated.filter((r) => r.status === 'valid').length,
    errors: validated.filter((r) => r.status === 'error').length,
    duplicates: validated.filter((r) => r.status === 'duplicate_in_batch').length,
  };

  // Persist the batch, store the original file, and record every row.
  const { data: batch, error: batchErr } = await admin
    .from('import_batches')
    .insert({ import_type: importType, status: 'validated', summary, created_by: ownerId })
    .select('id')
    .single();
  if (batchErr || !batch) return { ok: false, error: 'batch_failed' };
  const batchId = (batch as { id: string }).id;

  const ext = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
  await admin.storage
    .from('import-files')
    .upload(`${batchId}/original.${ext}`, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'text/csv',
      upsert: true,
    });
  await admin
    .from('import_batches')
    .update({ file_path: `${batchId}/original.${ext}` })
    .eq('id', batchId);

  await admin.from('import_rows').insert(
    validated.map((r) => ({
      batch_id: batchId,
      row_number: r.rowNumber,
      raw: r.raw,
      status: r.status === 'valid' ? 'valid' : r.status === 'error' ? 'error' : 'duplicate',
      errors: r.errors,
    })),
  );

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'import.dry_run',
    entityType: 'import_batch',
    entityId: batchId,
    metadata: { importType, ...summary },
  });

  revalidatePath('/owner/imports');
  return {
    ok: true,
    batchId,
    summary,
    preview: validated.slice(0, 25).map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      errors: r.errors,
    })),
  };
}

export type CommitResult =
  | {
      ok: true;
      inserted: number;
      skipped: number;
      riderPins: { riderNumber: string; phone: string; tempPin: string }[];
    }
  | { ok: false; error: string };

export async function commitImport(batchId: string): Promise<CommitResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const { data: batch } = await admin
    .from('import_batches')
    .select('import_type, status')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) return { ok: false, error: 'not_found' };
  const b = batch as { import_type: ImportType; status: string };
  if (b.status === 'committed') return { ok: false, error: 'already_committed' };

  const def = IMPORT_DEFS[b.import_type];
  const { data: rows } = await admin
    .from('import_rows')
    .select('id, raw')
    .eq('batch_id', batchId)
    .eq('status', 'valid');

  const validRows = (rows ?? []) as { id: string; raw: Record<string, string> }[];
  let inserted = 0;
  let skipped = 0;
  const riderPins: { riderNumber: string; phone: string; tempPin: string }[] = [];

  // Seed rider numbering once.
  let riderSeq = 0;
  if (b.import_type === 'riders') {
    const { count } = await admin.from('riders').select('*', { count: 'exact', head: true });
    riderSeq = count ?? 0;
  }

  for (const row of validRows) {
    const result = def.validateRow(row.raw);
    if (!result.ok) {
      skipped++;
      continue;
    }

    if (b.import_type === 'motorcycles') {
      const d = result.data;
      const { error } = await admin.from('motorcycles').insert({
        motorcycle_number: d.motorcycle_number,
        registration_number: d.registration_number,
        make: d.make,
        model: d.model,
        status: 'available',
      });
      if (error) {
        skipped++;
        continue;
      }
    } else {
      const d = result.data;
      riderSeq++;
      const riderNumber = `NGR-R-${String(riderSeq).padStart(4, '0')}`;
      // A spreadsheet-supplied PIN must pass the same weak-PIN rules as every
      // other credential path (no 1234/0000/phone-derived PINs via import).
      const tempPin =
        d.temp_pin && /^\d{4}$/.test(d.temp_pin) && validatePin(d.temp_pin, d.phone).ok
          ? d.temp_pin
          : generateTempPin(d.phone);
      let created;
      try {
        created = await createRiderUser({
          phone: d.phone,
          pin: tempPin,
          riderNumber,
          firstName: d.first_name,
          middleName: d.middle_name ?? undefined,
          lastName: d.last_name,
          mustChangePin: true,
        });
      } catch {
        skipped++;
        continue;
      }
      await admin
        .from('riders')
        .update({
          email: d.email,
          date_of_birth: d.date_of_birth,
          gender: d.gender,
          region: d.region,
          district: d.district,
          ward: d.ward,
          street: d.street,
          full_address: d.full_address,
        })
        .eq('id', created.riderId);
      if (d.nida_number || d.driving_licence_number) {
        await admin.from('rider_private_data').insert({
          rider_id: created.riderId,
          nida_number_encrypted: encryptOptionalPII(
            d.nida_number ? d.nida_number.replace(/[\s-]/g, '') : null,
          ),
          driving_licence_encrypted: encryptOptionalPII(d.driving_licence_number),
        });
      }
      riderPins.push({ riderNumber, phone: d.phone, tempPin });
    }

    inserted++;
    await admin.from('import_rows').update({ status: 'inserted' }).eq('id', row.id);
  }

  await admin
    .from('import_batches')
    .update({ status: 'committed', summary: { inserted, skipped } })
    .eq('id', batchId);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'import.committed',
    entityType: 'import_batch',
    entityId: batchId,
    metadata: { importType: b.import_type, inserted, skipped },
  });

  revalidatePath('/owner/imports');
  revalidatePath(b.import_type === 'riders' ? '/owner/riders' : '/owner/motorcycles');
  // Imported riders/motorcycles feed the contract builder's dropdowns.
  revalidatePath('/owner/contracts/new');
  return { ok: true, inserted, skipped, riderPins };
}
