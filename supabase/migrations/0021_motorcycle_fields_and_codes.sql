-- =========================================================================
-- 0021_motorcycle_fields_and_codes.sql — motorcycle data fields (2026-07-17)
--
-- Build-spec #16: registration number is issued AFTER purchase and may not be
-- available when a motorcycle first enters the system, so it becomes OPTIONAL.
-- Chassis number, engine number, colour and make/model are the identifying
-- fields (mandatory in the app layer; chassis/engine unique). Region/district
-- are stored so the motorcycle code (build-spec #7) can encode them.
--
-- The motorcycle_number column already exists (UNIQUE) and now holds the
-- auto-generated NGR-{REGION}-{DIST}-M-{SEQ} code.
-- =========================================================================

alter table public.motorcycles
  add column if not exists chassis_number text,
  add column if not exists engine_number text,
  add column if not exists colour text,
  add column if not exists region text,
  add column if not exists district text;

-- Registration number is no longer mandatory (issued later). It stays UNIQUE;
-- Postgres UNIQUE allows multiple NULLs, so many not-yet-registered bikes are OK.
alter table public.motorcycles alter column registration_number drop not null;

-- Chassis and engine numbers must be unique when present (multiple NULLs are
-- allowed by a standard UNIQUE constraint, so pre-existing rows are fine).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'motorcycles_chassis_number_key') then
    alter table public.motorcycles add constraint motorcycles_chassis_number_key unique (chassis_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'motorcycles_engine_number_key') then
    alter table public.motorcycles add constraint motorcycles_engine_number_key unique (engine_number);
  end if;
end $$;
