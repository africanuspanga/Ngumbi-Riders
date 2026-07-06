import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type { ApplicationStatus } from '@/lib/supabase/types';

/*
 * Owner-side application reads. These run through the request-scoped server
 * client, so RLS confirms the caller is the owner before any row is returned
 * (spec §23.1). Sensitive identifiers are returned only as ciphertext here;
 * decryption is a separate, deliberate owner action (see actions.ts / §25.1).
 */

export type ApplicationListItem = {
  id: string;
  reference: string;
  status: ApplicationStatus;
  first_name: string;
  last_name: string;
  primary_phone: string;
  duplicate_flags: string[];
  converted_rider_id: string | null;
  submitted_at: string | null;
  created_at: string;
};

export type GuarantorRow = {
  id: string;
  full_name: string;
  phone: string;
  residential_address: string | null;
  relationship: string | null;
  occupation: string | null;
  employer: string | null;
  nida_number_encrypted: string | null;
};

export type DocumentRow = {
  id: string;
  doc_type: string;
  storage_path: string;
};

export type ApplicationDetail = ApplicationListItem & {
  middle_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  email: string | null;
  alternative_phone: string | null;
  region: string | null;
  district: string | null;
  ward: string | null;
  street: string | null;
  full_address: string | null;
  previous_experience: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  nida_number_encrypted: string | null;
  driving_licence_encrypted: string | null;
  guarantors: (GuarantorRow & { documents: DocumentRow[] })[];
  documents: DocumentRow[];
};

const LIST_COLUMNS =
  'id, reference, status, first_name, last_name, primary_phone, duplicate_flags, converted_rider_id, submitted_at, created_at';

export async function listApplications(
  status?: ApplicationStatus,
): Promise<ApplicationListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from('rider_applications')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as unknown as ApplicationListItem[];
}

export async function countByStatus(): Promise<
  Partial<Record<ApplicationStatus, number>>
> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from('rider_applications').select('status');
  const counts: Partial<Record<ApplicationStatus, number>> = {};
  for (const row of (data ?? []) as { status: ApplicationStatus }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

export async function getApplication(
  id: string,
): Promise<ApplicationDetail | null> {
  const supabase = await createServerSupabase();

  const { data: app } = await supabase
    .from('rider_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!app) return null;

  const { data: guarantors } = await supabase
    .from('guarantors')
    .select('id, full_name, phone, residential_address, relationship, occupation, employer, nida_number_encrypted')
    .eq('application_id', id);

  const { data: appDocs } = await supabase
    .from('application_documents')
    .select('id, doc_type, storage_path')
    .eq('application_id', id);

  const guarantorList = (guarantors ?? []) as unknown as GuarantorRow[];
  const guarantorIds = guarantorList.map((g) => g.id);

  const { data: gDocs } = guarantorIds.length
    ? await supabase
        .from('guarantor_documents')
        .select('id, doc_type, storage_path, guarantor_id')
        .in('guarantor_id', guarantorIds)
    : { data: [] };

  const gDocRows = (gDocs ?? []) as unknown as (DocumentRow & {
    guarantor_id: string;
  })[];

  return {
    ...(app as unknown as ApplicationDetail),
    guarantors: guarantorList.map((g) => ({
      ...g,
      documents: gDocRows.filter((d) => d.guarantor_id === g.id),
    })),
    documents: (appDocs ?? []) as unknown as DocumentRow[],
  };
}
