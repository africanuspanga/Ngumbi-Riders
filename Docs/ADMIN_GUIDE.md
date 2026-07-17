# Ng'umbi Riders — Owner / Admin Guide

A practical guide for the business owner (Mr. Ng'umbi) on running the fleet
through the app, day to day. The rider side is Swahili-first; the owner area
works in Swahili or English (toggle at the top of the login page).

---

## 1. Signing in

- **Owner sign-in page:** `/login/owner` (bookmark this — the main `/login`
  page is for riders and only shows phone + PIN).
- **Sign in with either** the email `owner@ngumbi.co.tz` **or the phone
  number** `+255 753 522 155` (any format works — 0753…, +255753…), plus your
  password.
- To change the password (or the sign-in phone) later:

  ```bash
  OWNER_NEW_PASSWORD='pick-a-strong-password' npm run owner:password
  OWNER_NEW_PASSWORD='...' OWNER_PHONE='+2557...' npm run owner:password
  ```

  (Run from the project folder; needs `.env.local`. You can also change it in
  the Supabase dashboard → Authentication → Users.)

Riders sign in at `/login` with their **phone number + 4-digit PIN**. New
riders join through the public application form at `/apply` (you approve and
convert them, §3) or you create them directly — either way they receive a
temporary PIN and are forced to choose their own on first login.

**If a rider forgets their PIN:** open their page under `/owner/riders` →
**Sign-in / PIN → Reset PIN**. You get a new temporary PIN (shown once) to
hand to them; their old PIN stops working immediately and they must choose a
new one at next sign-in. Every reset is recorded in the audit trail.

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
   form at `/apply`. Each applicant picks **one identity document** — NIDA,
   Driving Licence, or Voter ID — and the required documents follow that
   choice; **a driving licence is never mandatory** (many riders don't have
   one). They give **one guarantor** (who receives a confirmation SMS once SMS
   is configured, §9), pick their **region and district** from dropdowns, and
   sign on screen. Documents upload one at a time so the form works on slow
   connections; a candidate whose upload was interrupted can simply retry.
   **You are notified the moment an application arrives** (in-app, plus an SMS
   to your number if that's configured). Review it, move the status through
   *under review → interview → verification*, view documents (NIDA / licence /
   Voter ID are hidden behind a deliberate "reveal" click), and finally
   **approve + convert to rider** — this creates their login and a one-time
   temporary PIN to hand to them, and copies their identity details onto the
   rider record. An application may arrive with some documents missing if the
   applicant's connection died mid-upload — you'll see which ones on the review
   page; ask them to re-apply or bring the documents physically.
2. **Manual creation** (`/owner/riders` → new): for riders you already know;
   same temp-PIN handover.
3. **Bulk import** (`/owner/imports`): CSV/XLSX wizard for existing riders and
   motorcycles (used at go-live to load the current fleet). If your sheet
   provides a `temp_pin` column, weak PINs (1234, 0000, repeats, the phone's
   own digits…) are **replaced with a safe generated one** — always hand out
   the PINs from the import result screen, not from your spreadsheet.

## 4. Motorcycles & assignments

- Register motorcycles at `/owner/motorcycles`. **Make, model, colour, chassis
  number and engine number are required** (chassis + engine must be unique — no
  two bikes can share them); the **registration (number) plate is optional** at
  registration, since a new bike often doesn't have one yet — add or correct it
  later on the motorcycle's detail page.
- Each motorcycle gets an **automatic internal code** like `NGR-DSM-KIN-M-0001`
  (built from the region and district codes). This code is the bike's primary
  identifier across the app — use it on paperwork; the plate can come later.
- Assign a motorcycle to a rider from the motorcycle or rider page; history
  is kept, and exceptional transfers are supported.
- The motorcycle detail page also shows its **expense ledger and margin**
  (see §8).

## 5. Contracts — the heart of the system

1. **Create** (`/owner/contracts` → new): pick rider + motorcycle, set the
   **instalment amount** (TZS), the **schedule**, the start date and the
   duration in months. The builder shows a live preview of the whole payment
   calendar (number of payments, total value, end date) as you type.
2. **Sign**: both you and the rider sign on screen, or upload a signed
   physical copy. A PDF of the contract is generated and hashed.
3. **Activate**: activation generates every payment obligation for the whole
   contract in one transaction. From then on the rider sees exactly what is
   due and when.
4. **Lifecycle**: pause / resume / complete early / terminate from the
   contract page. Terminating cancels future unpaid instalments; paid history
   is never touched.

**Choosing a schedule.** The instalment amount is the amount due *each time* a
payment falls due — so pick the amount to match the schedule:

- **Every day** — one payment for every calendar day of the contract.
- **Weekly** — one payment per week, on a weekday you choose (it defaults to
  the contract's start weekday). Set the instalment to the *weekly* amount.
- **Selected weekdays** — payments only on the days you tick (e.g. Mon/Wed/Fri).
- **Monthly** — **one payment per month**, on a **due day you set** (e.g. the
  5th; enter **31** for "last day of the month"). A 6-month contract makes 6
  monthly payments. The first payment lands on the first time your chosen due
  day occurs during the contract (this month if it hasn't passed yet on the
  start date, otherwise next month). Set the instalment to the *monthly* amount.

  A monthly rider is **not** shown as overdue every day like a daily rider —
  their payment only becomes due, then overdue, around the due day you set. You
  record their monthly cash the same way as any payment (§6): pick the rider and
  tick the month that's due.

## 6. Payments

- **Mobile money (Snippe)**: the rider taps **Lipa Sasa** in their app,
  chooses how many instalments to pay (oldest debts are always paid first,
  whole instalments only), and confirms the USSD prompt on their phone.
  Settlement, receipt and dashboard updates are automatic. (For a monthly
  contract each instalment is a whole month; for a daily contract, a day.)
- **Cash** (`/owner/payments` → record cash): when a rider hands you cash,
  pick the rider and tick their oldest outstanding instalments — days for a
  daily/weekly contract, or **the month** for a monthly contract. The same
  rules apply (whole obligations, oldest first) and a receipt is issued
  automatically. Two guards to know about:
  - If the rider has a **mobile payment in progress** for those same
    obligations, the form refuses (*reserved by pending payment*) — wait for it
    to complete or fail (stale attempts clear automatically within the hour),
    then record the cash. This prevents the same obligation being paid twice.
  - The payment date cannot be in the future.
- **Reconciliation** (`/owner/reconciliation`): compare provider totals with
  the app's records; pending payments older than 30 minutes are re-checked
  against Snippe automatically by the daily job. Anything the system refuses
  to settle automatically raises a **payment_issue** notification (see §2) —
  that page plus the audit trail is where you resolve it.
- Receipts are numbered `NGR-RCPT-YYYY-######` and verifiable by a code on the
  receipt. Each number is unique, but the sequence **may skip values** — that
  is normal and not a sign of a missing receipt.

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
- **SMS** (via Mobishastra, once its credentials are configured): the app sends
  a **guarantor confirmation SMS** when someone is named as a guarantor on an
  application, and a **new-application alert** to your number
  (`OWNER_NOTIFY_PHONE`). Until SMS is configured everything else works
  normally — SMS messages simply wait and nothing is lost.
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

- Riders pay **whole instalments only** (a day, week or month depending on the
  contract), **oldest first** — no partial payments.
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
