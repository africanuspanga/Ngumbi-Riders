-- =========================================================================
-- 0020_identity_type_and_single_guarantor.sql — onboarding changes (2026-07-17)
--
-- Build-spec #3: an applicant chooses a primary identity document — NIDA,
-- Driving Licence, or Voter ID — and driving licence is NEVER mandatory. We add
-- an identity_type enum and a voter_id_encrypted column alongside the existing
-- nida_number_encrypted / driving_licence_encrypted (both already nullable).
--
-- Build-spec #4 (only one guarantor required) is enforced entirely in the app /
-- validation layer — the guarantors table already supports 1..N per application,
-- so no schema change is needed there.
-- =========================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'identity_type') then
    create type public.identity_type as enum ('nida', 'driving_licence', 'voter_id');
  end if;
end $$;

alter table public.rider_applications
  add column if not exists identity_type public.identity_type,
  add column if not exists voter_id_encrypted text;

alter table public.rider_private_data
  add column if not exists identity_type public.identity_type,
  add column if not exists voter_id_encrypted text;

-- Existing applications all supplied a NIDA (it was mandatory), so classify them.
update public.rider_applications set identity_type = 'nida' where identity_type is null;
update public.rider_private_data set identity_type = 'nida'
  where identity_type is null and nida_number_encrypted is not null;
