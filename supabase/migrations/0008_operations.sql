-- =========================================================================
-- 0008_operations.sql — incidents, exemptions, notifications, messaging (§16-19)
-- =========================================================================

create table public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  category incident_category not null,
  occurred_at timestamptz not null,
  description text not null,
  location_text text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_incidents_rider on public.incident_reports(rider_id);
create trigger trg_incidents_updated
  before update on public.incident_reports
  for each row execute function public.set_updated_at();

-- Exemption requests preserve the original due date in history (spec §16.2).
create table public.exemption_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  obligation_id uuid not null references public.payment_obligations(id) on delete cascade,
  reason text not null,
  status exemption_status not null default 'submitted',
  decision_note text,
  postponed_to_date date,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_exemptions_rider on public.exemption_requests(rider_id);
create trigger trg_exemptions_updated
  before update on public.exemption_requests
  for each row execute function public.set_updated_at();

-- Complete the obligation → exemption back-reference from 0007.
alter table public.payment_obligations
  add constraint obligations_exemption_fk
  foreign key (exemption_id)
  references public.exemption_requests(id) on delete set null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  deep_link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient
  on public.notifications(recipient_profile_id, read_at);
-- Deduplicate reminders per obligation/stage (spec §17.3).
create unique index uq_notifications_dedupe
  on public.notifications(recipient_profile_id, dedupe_key)
  where dedupe_key is not null;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index idx_push_profile on public.push_subscriptions(profile_id);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id),
  title text not null,
  body text not null,
  audience text not null default 'all_active',  -- all_active | selected | arrears | contracts
  created_at timestamptz not null default now()
);

create table public.announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  rider_id uuid not null references public.riders(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (announcement_id, rider_id)
);

-- Delivery outbox for email/SMS/WhatsApp (adapters disabled until configured).
create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null,        -- in_app | email | sms | whatsapp
  recipient text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',   -- pending | sent | failed
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_outbox_status on public.message_outbox(status);
create trigger trg_outbox_updated
  before update on public.message_outbox
  for each row execute function public.set_updated_at();

-- Idempotent daily owner summary (spec §18.1).
create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_date date not null unique,
  metrics jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.risk_snapshots (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  level risk_level not null,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);
create index idx_risk_rider on public.risk_snapshots(rider_id, computed_at);
