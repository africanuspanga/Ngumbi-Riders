-- =========================================================================
-- seed.sql — non-auth reference data for local development.
-- Auth users (owner + test riders) are seeded separately via
-- `scripts/seed.ts`, which uses the Supabase Admin API and the server-side PIN
-- derivation. We never put real NIDA numbers or real personal data here
-- (spec §36.19).
-- =========================================================================

-- Business defaults (row already created in 0003; update the demo values).
update public.app_settings
set default_installment_amount = 5000,   -- TZS 5,000/day demo obligation
    payment_deadline_time = '18:00',
    daily_summary_time = '22:00'
where id = true;

-- A first contract template version.
insert into public.contract_templates (version, name, body)
values (1, 'Mkataba wa Kukodi Pikipiki (v1)',
  'Mkataba huu ni kati ya Ng''umbi Riders na mwendeshaji kwa masharti ya kukodi pikipiki kwa muda maalum.')
on conflict (version) do nothing;

-- Demo motorcycles (fictional Tanzanian plates).
insert into public.motorcycles (motorcycle_number, registration_number, make, model, status)
values
  ('NGR-M-0001', 'MC 123 ABC', 'Bajaj', 'Boxer', 'available'),
  ('NGR-M-0002', 'MC 456 DEF', 'TVS',   'HLX 125', 'available'),
  ('NGR-M-0003', 'MC 789 GHI', 'Honda', 'Ace 125', 'available')
on conflict (registration_number) do nothing;
