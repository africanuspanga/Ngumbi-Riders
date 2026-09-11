import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type {
  EmploymentStatus,
  StaffCertificateKind,
  StaffReviewStatus,
} from './profile-constants';

/*
 * Staff-profile reads.
 *
 * RLS decides who sees what (0035): the Director reads everything, an employee
 * reads their own row, and an accountant has NO policy on a colleague's record
 * — deliberately, because it is HR data, not finance data, and `is_staff()`
 * would have handed it over.
 *
 * Name, email and role come from `profiles`, which is where they live. They are
 * not duplicated into staff_profiles: two copies guarantee two answers the
 * first time somebody is renamed.
 */

export type StaffCertificateRow = {
  id: string;
  kind: StaffCertificateKind;
  title: string;
  issuer: string | null;
  issuedOn: string | null;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

export type StaffProfileRow = {
  /** The auth/profiles id — the address for every action in profile.ts. */
  profileId: string;
  /** The staff_profiles row id, null when the record has never been opened. */
  staffProfileId: string | null;
  fullName: string;
  email: string | null;
  role: string;
  /** System access (profiles.is_active) — NOT the employment status. */
  hasAccess: boolean;
  phone: string | null;
  jobTitle: string | null;
  employmentStatus: EmploymentStatus;
  startDate: string | null;
  endDate: string | null;
  education: string | null;
  workExperience: string | null;
  notes: string | null;
  reviewStatus: StaffReviewStatus;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  certificates: StaffCertificateRow[];
};

type RawStaff = {
  id: string;
  profile_id: string;
  phone: string | null;
  job_title: string | null;
  employment_status: EmploymentStatus;
  start_date: string | null;
  end_date: string | null;
  education: string | null;
  work_experience: string | null;
  notes: string | null;
  review_status: StaffReviewStatus;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

const STAFF_SELECT =
  'id, profile_id, phone, job_title, employment_status, start_date, end_date, education, ' +
  'work_experience, notes, review_status, submitted_at, reviewed_by, reviewed_at, review_note';

type Supa = Awaited<ReturnType<typeof createServerSupabase>>;

async function certificatesFor(
  supabase: Supa,
  staffProfileIds: string[],
): Promise<Map<string, StaffCertificateRow[]>> {
  const out = new Map<string, StaffCertificateRow[]>();
  if (staffProfileIds.length === 0) return out;
  const { data } = await supabase
    .from('staff_certificates')
    .select('id, staff_profile_id, kind, title, issuer, issued_on, file_name, size_bytes, created_at')
    .in('staff_profile_id', staffProfileIds)
    .order('created_at', { ascending: false });
  for (const c of (data ?? []) as {
    id: string;
    staff_profile_id: string;
    kind: string;
    title: string;
    issuer: string | null;
    issued_on: string | null;
    file_name: string;
    size_bytes: number;
    created_at: string;
  }[]) {
    const list = out.get(c.staff_profile_id) ?? [];
    list.push({
      id: c.id,
      kind: c.kind as StaffCertificateKind,
      title: c.title,
      issuer: c.issuer,
      issuedOn: c.issued_on,
      fileName: c.file_name,
      sizeBytes: c.size_bytes,
      createdAt: c.created_at,
    });
    out.set(c.staff_profile_id, list);
  }
  return out;
}

/** Defaults for a staff member who has never opened their record. */
function emptyRecord(p: {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean | null;
}): StaffProfileRow {
  return {
    profileId: p.id,
    staffProfileId: null,
    fullName: p.full_name || p.email || 'Staff',
    email: p.email,
    role: p.role,
    hasAccess: p.is_active ?? true,
    phone: null,
    jobTitle: null,
    // Matches the column default in 0035 — a new hire starts on probation.
    employmentStatus: 'probation',
    startDate: null,
    endDate: null,
    education: null,
    workExperience: null,
    notes: null,
    reviewStatus: 'draft',
    submittedAt: null,
    reviewedByName: null,
    reviewedAt: null,
    reviewNote: null,
    certificates: [],
  };
}

/**
 * Every staff account and its HR record, for the Director's list.
 *
 * Driven from `profiles`, not from `staff_profiles`: a colleague who has never
 * filled their record in must still appear, with empty fields, or the Director
 * cannot tell "nothing to review" from "never asked".
 */
export async function listStaffProfiles(): Promise<StaffProfileRow[]> {
  const supabase = await createServerSupabase();

  const { data: profileRows, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .in('role', ['owner', 'accountant'])
    .order('role', { ascending: true });
  if (error) throw new Error(`listStaffProfiles failed: ${error.message}`);
  const people = (profileRows ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    role: string;
    is_active: boolean | null;
  }[];
  if (people.length === 0) return [];

  const { data: staffRows } = await supabase
    .from('staff_profiles')
    .select(STAFF_SELECT)
    .in('profile_id', people.map((p) => p.id));
  const staff = (staffRows ?? []) as unknown as RawStaff[];
  const byProfile = new Map(staff.map((s) => [s.profile_id, s]));

  const [certificates, reviewerNames] = await Promise.all([
    certificatesFor(supabase, staff.map((s) => s.id)),
    (async () => {
      const ids = [...new Set(staff.map((s) => s.reviewed_by).filter((v): v is string => Boolean(v)))];
      if (ids.length === 0) return new Map<string, string>();
      const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
      return new Map(
        ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map(
          (p) => [p.id, p.full_name || p.email || 'Staff'],
        ),
      );
    })(),
  ]);

  return people.map((p) => {
    const s = byProfile.get(p.id);
    if (!s) return emptyRecord(p);
    return {
      profileId: p.id,
      staffProfileId: s.id,
      fullName: p.full_name || p.email || 'Staff',
      email: p.email,
      role: p.role,
      hasAccess: p.is_active ?? true,
      phone: s.phone,
      jobTitle: s.job_title,
      employmentStatus: s.employment_status,
      startDate: s.start_date,
      endDate: s.end_date,
      education: s.education,
      workExperience: s.work_experience,
      notes: s.notes,
      reviewStatus: s.review_status,
      submittedAt: s.submitted_at,
      reviewedByName: s.reviewed_by ? (reviewerNames.get(s.reviewed_by) ?? null) : null,
      reviewedAt: s.reviewed_at,
      reviewNote: s.review_note,
      certificates: certificates.get(s.id) ?? [],
    };
  });
}

/** One staff record. Returns an empty one when it has never been filled in. */
export async function getStaffProfile(profileId: string): Promise<StaffProfileRow | null> {
  const supabase = await createServerSupabase();

  const { data: p } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .eq('id', profileId)
    .maybeSingle();
  const person = p as {
    id: string;
    full_name: string | null;
    email: string | null;
    role: string;
    is_active: boolean | null;
  } | null;
  if (!person) return null;

  const { data: s } = await supabase
    .from('staff_profiles')
    .select(STAFF_SELECT)
    .eq('profile_id', profileId)
    .maybeSingle();
  const staff = s as unknown as RawStaff | null;
  if (!staff) return emptyRecord(person);

  const [certificates, reviewer] = await Promise.all([
    certificatesFor(supabase, [staff.id]),
    (async () => {
      if (!staff.reviewed_by) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', staff.reviewed_by)
        .maybeSingle();
      const r = data as { full_name: string | null; email: string | null } | null;
      return r ? r.full_name || r.email || 'Staff' : null;
    })(),
  ]);

  return {
    profileId: person.id,
    staffProfileId: staff.id,
    fullName: person.full_name || person.email || 'Staff',
    email: person.email,
    role: person.role,
    hasAccess: person.is_active ?? true,
    phone: staff.phone,
    jobTitle: staff.job_title,
    employmentStatus: staff.employment_status,
    startDate: staff.start_date,
    endDate: staff.end_date,
    education: staff.education,
    workExperience: staff.work_experience,
    notes: staff.notes,
    reviewStatus: staff.review_status,
    submittedAt: staff.submitted_at,
    reviewedByName: reviewer,
    reviewedAt: staff.reviewed_at,
    reviewNote: staff.review_note,
    certificates: certificates.get(staff.id) ?? [],
  };
}
