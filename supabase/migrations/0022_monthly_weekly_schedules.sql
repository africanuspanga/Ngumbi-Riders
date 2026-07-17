-- =========================================================================
-- 0022_monthly_weekly_schedules.sql — monthly + weekly instalments (spec #8/#13)
--
-- Extends the contract payment schedule beyond daily / selected-weekdays:
--   weekly  — ONE obligation per week on an owner-chosen weekday (stored as a
--             single element in the existing selected_weekdays array).
--   monthly — ONE obligation per month, due on an owner-set day-of-month
--             (due_day_of_month). Exactly duration_months obligations; the
--             first falls on the first occurrence of the due day within the
--             lease (owner decision 2026-07-17 — memory
--             `monthly-instalment-due-day-decision`). Store 31 for "last day of
--             month" (clamped to each month's real length by the schedule engine).
--
-- The obligation calendar is still computed by the tested TS engine
-- (lib/obligations/schedule.ts) and committed by
-- activate_contract_and_generate_obligations, which is schedule-type AGNOSTIC
-- (it inserts whatever obligations it is handed). Settlement
-- (record_completed_payment) operates per-obligation regardless of cadence, so
-- there are NO money-function changes here: a monthly obligation is simply an
-- obligation whose amount is that month's instalment, and the existing
-- cash / mobile-money settlement path already handles it (one obligation = one
-- month, so the owner records one cash payment per month by selecting it).
--
-- Additive + backfill-free: two new enum labels and one nullable column.
-- Existing daily / selected-weekday contracts are untouched (due_day_of_month
-- stays NULL). Note: ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction that adds it, so the labels are added ahead of any use; when
-- applied live via the Management API each statement below is sent separately.
-- =========================================================================

alter type public.schedule_type add value if not exists 'weekly';
alter type public.schedule_type add value if not exists 'monthly';

alter table public.contracts
  add column if not exists due_day_of_month smallint
    check (due_day_of_month is null or (due_day_of_month between 1 and 31));

comment on column public.contracts.due_day_of_month is
  'Monthly schedule only: owner-set day-of-month the instalment is due (1..31; 31 = last day of month, clamped to each month''s length by the schedule engine). NULL for daily / weekly / selected_weekdays contracts.';
