# Ng'umbi Riders — Owner / Admin Guide

A practical guide for the business owner (Mr. Ng'umbi) on running the fleet
through the app, day to day. The rider side is Swahili-first; the owner area
works in Swahili or English (toggle at the top of the login page).

---

## 1. Signing in

- **Owner sign-in page:** `/login/owner` (bookmark this — the main `/login`
  page is for riders and only shows phone + PIN).
- **Email:** `owner@ngumbi.co.tz`
- **Password:** the seed password is a temporary default (see
  `scripts/seed.ts`). **Change it before the pilot:**

  ```bash
  OWNER_NEW_PASSWORD='pick-a-strong-password' npm run owner:password
  ```

  (Run from the project folder; needs `.env.local`. You can also change it in
  the Supabase dashboard → Authentication → Users.)

Riders sign in at `/login` with their **phone number + 4-digit PIN**. New
riders get a temporary PIN and are forced to choose their own on first login.
If a rider forgets their PIN, there is currently no self-service reset — the
owner re-issues one (feature follow-up: a "reset PIN" button on the rider
page; until then it's done via the developer/Supabase dashboard).

## 2. The dashboard (`/owner`)

Your daily control panel:

- **Expected / Settled / Collected / Outstanding today** and the collection
  rate.
- **Who hasn't paid** — the list to chase before the deadline.
- **Arrears aging** — how old the debts are (1 day, 2–3, 4–7, 8–30, 31+).
- **Ending contracts** and **high-risk riders** to plan ahead.

You also receive **in-app notifications** addressed to you as things happen:
- **Payment needs manual review** (`payment_issue`) — a payment could not be
  settled automatically (amount didn't match, a reversal arrived from the
  provider, or a safety guard blocked it). It links to `/owner/reconciliation`
  and the full details are in the audit trail. **Act on these — they mean real
  money moved but was not credited.**
- **Overdue digest** — how many obligations became overdue at midnight.
- **Data quality alert** — the nightly self-check found an inconsistency
  (should never happen; contact the developer if it does).

The rider's own app shows the same numbers from their side (paid / due /
overdue state, progress bar, payment calendar).

## 3. Taking riders onboard

1. **Applications** (`/owner/applications`): candidates apply on the public
   form at `/apply` (13 documents, guarantors, signature — documents upload
   one at a time, so the form works on slow connections; a candidate whose
   upload was interrupted can simply retry). Review, move the status through
   *under review → interview → verification*, view documents (NIDA/licence
   are hidden behind a deliberate "reveal" click), and finally **approve +
   convert to rider** — this creates their login and a one-time temporary PIN
   to hand to them. An application may arrive with some documents missing if
   the applicant's connection died mid-upload — you'll see which ones on the
   review page; ask them to re-apply or bring the documents physically.
2. **Manual creation** (`/owner/riders` → new): for riders you already know;
   same temp-PIN handover.
3. **Bulk import** (`/owner/imports`): CSV/XLSX wizard for existing riders and
   motorcycles (used at go-live to load the current fleet). If your sheet
   provides a `temp_pin` column, weak PINs (1234, 0000, repeats, the phone's
   own digits…) are **replaced with a safe generated one** — always hand out
   the PINs from the import result screen, not from your spreadsheet.

## 4. Motorcycles & assignments

- Register motorcycles at `/owner/motorcycles` (registration number, model,
  status).
- Assign a motorcycle to a rider from the motorcycle or rider page; history
  is kept, and exceptional transfers are supported.
- The motorcycle detail page also shows its **expense ledger and margin**
  (see §8).

## 5. Contracts — the heart of the system

1. **Create** (`/owner/contracts` → new): pick rider + motorcycle, set the
   daily amount (TZS), schedule (daily or selected weekdays), start date and
   duration. The builder shows a live preview of the whole payment calendar.
2. **Sign**: both you and the rider sign on screen, or upload a signed
   physical copy. A PDF of the contract is generated and hashed.
3. **Activate**: activation generates every payment obligation for the whole
   contract in one transaction. From then on the rider sees exactly what is
   due and when.
4. **Lifecycle**: pause / resume / complete early / terminate from the
   contract page. Terminating cancels future unpaid days; paid history is
   never touched.

## 6. Payments

- **Mobile money (Snippe)**: the rider taps **Lipa Sasa** in their app,
  chooses how many days to pay (oldest debts are always paid first, whole
  days only), and confirms the USSD prompt on their phone. Settlement,
  receipt and dashboard updates are automatic.
- **Cash** (`/owner/payments` → record cash): when a rider hands you cash,
  record it against their oldest outstanding days. The same rules apply
  (whole obligations, oldest first) and a receipt is issued automatically.
  Two guards to know about:
  - If the rider has a **mobile payment in progress** for those same days, the
    form refuses (*reserved by pending payment*) — wait for it to complete or
    fail (stale attempts clear automatically within the hour), then record
    the cash. This prevents the same day being paid twice.
  - The payment date cannot be in the future.
- **Reconciliation** (`/owner/reconciliation`): compare provider totals with
  the app's records; pending payments older than 30 minutes are re-checked
  against Snippe automatically by the daily job. Anything the system refuses
  to settle automatically raises a **payment_issue** notification (see §2) —
  that page plus the audit trail is where you resolve it.
- Receipts are numbered `NGR-RCPT-YYYY-######` (one continuous sequence,
  starting at 000001) and verifiable by code.

**Never** mark a payment complete by hand — money state only changes through
the controlled settlement path (webhook, reconciliation, or the cash form).
The database itself enforces this: settlement is refused if the payment isn't
in a payable state, if a day is no longer owed (already paid, waived or
postponed), or if another payment has claimed it — such refusals surface as
payment_issue notifications rather than wrong numbers.

## 7. Exemptions & incidents

- **Exemptions** (`/owner/exemptions`): riders request a day off obligation
  (sickness, breakdown…). You **waive** (day is forgiven), **postpone**
  (obligation moves to a new date — history preserved), or **reject**. Guards:
  paid days can never be postponed; a day with a **mobile payment in
  progress** can't be decided until that payment resolves; an
  already-decided request can't be re-decided; and a rider can have only one
  open request per day.
- **Incidents** (`/owner/incidents`): rider-reported breakdowns, accidents,
  theft, police issues. Move them *open → in progress → resolved*.

## 8. Money insight

- **Expenses** (`/owner/expenses`): log motorcycle costs (maintenance,
  insurance, plates…). The motorcycle page shows its cash operating margin.
- **Reports** (`/owner/reports`): collections, arrears, payment performance
  and contract progress over any date range; export **CSV/XLSX** for your
  accountant.

## 9. Communication

- **Announcements** (`/owner/announcements`): broadcast a message to all
  riders (appears in their in-app notifications; push notification if they
  installed the app and allowed notifications).
- **Daily summary email**: sent to `OWNER_SUMMARY_EMAIL` once Resend is
  configured — expected vs collected, who paid, arrears, pending items. It
  arrives just after **midnight and covers the day that just ended** (the
  full business day, not the new one). If a send fails it is retried (up to 5
  attempts on later runs), and emails queued before Resend was configured are
  delivered once the key is in place — nothing is lost.

## 10. System health & audit

- **`/owner/system`**: last run of every scheduled job and data-quality
  counters (allocation mismatches etc. should always be zero).
- **`/owner/audit`**: append-only trail of every sensitive action (logins,
  money, contract changes, exemption decisions).

## 11. Scheduled jobs (Vercel Hobby plan)

All background work runs **once per day at midnight** Tanzania time
(21:00 UTC) through a single cron endpoint `/api/cron/daily` (up to 5 minutes
of runtime budget), which executes in order: obligation status flips
(due/overdue) → pending-payment reconciliation → reservation cleanup → risk
recalculation → data-quality checks → your daily summary email (for the day
that just ended) → message outbox.

Because the plan allows only daily crons:

- A missed payment webhook is caught by reconciliation **within a day** (the
  webhook itself is instant — this is only the fallback).
- Due/overdue statuses flip at midnight, not at the payment deadline hour.
- You can trigger any job manually at any time:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/daily
  ```

  (or an individual job, e.g. `/api/cron/obligation-status`). Upgrading to
  Vercel Pro later re-enables frequent schedules with no code changes.

## 12. Rules the system enforces (so you don't have to)

- Riders pay **whole days only**, **oldest first** — no partial payments.
- Money records are **immutable**: corrections are new events, never edits.
- Riders see only their own data (enforced in the database itself).
- All amounts are integer TZS; the minimum mobile-money payment is 500 TZS.

## 13. If something looks wrong

1. Check your **notifications** — a `payment_issue` alert tells you exactly
   which payment needs attention and why.
2. Check `/owner/system` — did last night's jobs succeed?
3. Check `/owner/reconciliation` — any pending/mismatched payments?
4. Check `/owner/audit` — what happened and who did it?
5. Nothing conclusive? Contact the developer with the payment reference
   (`SN…` for Snippe) — every event is stored in `payment_events`.

A note on trust: the app is built so that mistakes surface loudly rather than
silently corrupt the books. Payments only settle through one guarded path,
every day can only be paid once, waived/postponed days can't be accidentally
re-billed or re-collected, and anything the system refuses to do automatically
lands in front of you as a notification with an audit trail behind it.
