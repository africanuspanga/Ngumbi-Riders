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
   same temp-PIN handover. **Region and district are dropdowns** here too, and
   picking a motorcycle **fills the rider's region and district automatically**
   from that bike's operating area — you don't type the same location twice.
   If the rider actually lives somewhere else, just change the fields; your
   edit is kept and won't be overwritten if you later change the motorcycle.
3. **Bulk import** (`/owner/imports`): CSV/XLSX wizard for existing riders and
   motorcycles (used at go-live to load the current fleet). If your sheet
   provides a `temp_pin` column, weak PINs (1234, 0000, repeats, the phone's
   own digits…) are **replaced with a safe generated one** — always hand out
   the PINs from the import result screen, not from your spreadsheet.

### 3.1 Finding riders (`/owner/riders`)

The rider register is a searchable directory, not one long list.

- **Search** by rider name, phone number (type it any way — `0712 345 678`,
  `+255712345678` or `712345678` all match), rider code, motorcycle
  registration, motorcycle code or contract number.
- **Quick filters**: all riders · active riders · active contracts ·
  completed contracts · overdue payments · fully paid · no motorcycle
  assigned.
- **More filters**: region, district, a specific motorcycle, and a
  registration-date range.
- **Sort** by name (A–Z / Z–A), date registered (newest / oldest), contract
  start date, contract end date, payment status (worst first) or outstanding
  balance (highest first).
- **Card view or table view** — switch with the two buttons top-right. Your
  choice is remembered for next time.
- Long lists are paged 25 at a time.

Click a rider's card, row, name or picture to open their profile.

### 3.2 The rider profile

Each rider has one complete profile, shown to you at
`/owner/riders/<rider>` and to the rider themselves under the person icon in
their app header. It gathers:

- profile picture, full name, rider code, phone, email, date of birth,
  identification type and whether an ID number is on file, account status;
- region, district, ward, street and address — with a note saying whether the
  location came from the rider or from their motorcycle;
- assigned motorcycle (code, registration, make, model, colour, assigned
  since);
- contract details and status, the payment-plan summary, amount paid,
  outstanding amount, progress bar and **next payment date**;
- guarantor details and uploaded documents.

**Profile pictures.** A rider's photo from their application is used
automatically. To change it, open their profile and use **Upload picture** /
**Replace picture** / **Remove**. JPG, PNG or WebP up to 4 MB; the file type is
verified from the file's actual contents, not its name. Where there's no photo
you see a clean initials placeholder. Only you can set a rider's picture —
riders cannot change their own or anyone else's, and a rider can only ever open
their own profile.

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
   **instalment amount** (TZS), the **payment frequency**, the start date and
   the **contract length**. The builder shows a live preview of the whole
   payment calendar (number of payments, total value, end date) as you type.
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

### 5.1 Contract length — any combination of units

Set the term in **years, months, weeks and days**, in any combination:
3 months · 12 weeks · 90 days · 3 months and 2 weeks · 6 months, 1 week and
4 days · 1 year and 3 months. The end date is calculated for you and shown
under the fields as you type.

- Months are **real calendar months**, never a flat 30 days, and leap years
  are handled (a term through February gets 28 or 29 days as appropriate).
- If you need the term to end on a **specific day**, switch *Set the end date
  by* to **Exact end date** and type it. That date then wins over any
  calculation — useful for a month-end lease that must run to the last day of
  the month.
- The saved contract shows both the readable term ("6 months, 1 week and
  4 days") and whether the end date came from the duration or was typed.

### 5.2 Building the payment plan in one go

Instead of picking dates one at a time, use **Generate schedule** in the
contract builder:

1. The start and end dates come from the contract term you set above.
2. Enter the **amount per payment** and choose the **frequency** — Daily,
   Weekly, Monthly, or Custom (specific weekdays).
3. Press **Generate schedule**. Every payment date in the period appears at
   once — e.g. 01/08/2026 → 29/09/2026, daily, TZS 10,000 produces all
   60 dates.
4. Adjust anything you need:
   - untick a date to **exclude** it (public holiday, agreed rest day),
   - **Select all / Deselect all** to work in bulk,
   - change an individual **date** or **amount** directly in the row.
5. The running **count and total** update as you edit, so you can check the
   plan before saving.

The plan you approve is exactly what gets created when you activate the
contract. If you'd rather use the plain repeating schedule, press **Discard
plan** and the contract falls back to the frequency you chose.

Two things the system will not let you do: save a payment dated outside the
contract term, and create two payments on the same date (a duplicate is
flagged and only one is kept).

### 5.3 Contract status is automatic

You never have to mark a contract finished. Every night the system checks
every running contract and completes the ones whose end date has passed. The
status you see is:

| Status | Meaning |
| --- | --- |
| **Upcoming** | Signed and activated, but the term hasn't started yet |
| **Active** | Running now |
| **Suspended** | You paused it |
| **Contract Completed** | Term finished and nothing is owed |
| **Contract Ended — Outstanding Balance** | Term finished but payments are still unpaid |
| **Terminated / Cancelled** | You ended it early |

A finished contract that still has unpaid days is **never** shown as settled —
it reads "Contract Ended — Outstanding Balance", on the rider's profile, the
contract page, the rider list and the reports, with the amount still owed.

The status also updates on screen the moment the end date passes, without
waiting for the nightly job. No payment dates are ever created past the
contract's end date.

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
  that page plus the audit trail is where you resolve it. A payment stuck at
  *pending* for over an hour can be **cancelled** there — that frees its
  reserved days so you can record cash for them; if the provider later reports
  it paid after all, the system refuses to settle the cancelled payment and
  alerts you instead (never a silent double-charge).
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

## 9.1 Your accountant (`/owner/staff`)

You can give a bookkeeper their own login instead of sharing yours.

**Creating one.** Go to **Staff** (bottom of the sidebar) → *Add an
accountant*: name, email, and an initial password (at least 10 characters with
an uppercase letter, a lowercase letter and a number). Hand them the password
directly; they sign in at the same page you do, `/login/owner`, and land in
their own area at `/accountant`.

**What an accountant can do**

- See the financial dashboard, payment schedules, completed payments, overdue
  payments and outstanding balances
- **Record an authorised manual payment** (same rules as yours: whole
  instalments, oldest first, amount computed by the system)
- View receipts and payment history
- Generate reports for any date range — daily, weekly, monthly or custom — and
  export them to CSV or Excel
- View rider, motorcycle and contract information needed for accounting, and
  contract financial summaries
- Add **internal financial notes** (visible to you and other accountants;
  notes can't be edited or deleted once added)

**What an accountant cannot do**

- Touch your account, change system ownership or anyone's role
- Create or deactivate other staff
- Change system settings or see payment credentials
- Modify or create contracts, riders or motorcycles
- Reveal NIDA / licence / Voter ID numbers, or see guarantors and application
  documents
- See the audit trail, login history, imports or system internals
- Delete anything at all

These limits are enforced in the database itself, not just by hiding buttons —
an accountant who typed an owner-only address directly would still be refused.

**Controlling access.** On the Staff page each accountant has **Deactivate /
Activate**, **Reset password** and **Remove access**. Deactivating signs them
out immediately and blocks the next login; their history stays in the audit
trail (which is why the account is disabled rather than deleted — financial
records must keep naming who did what). "Remove access" also scrambles the old
password, so re-activating requires you to set a new one.

## 9.2 Dates and places

- **Every date in the app is DD/MM/YYYY** — 29/07/2026 — on profiles,
  motorcycles, contracts, payment plans, payment history, receipts, reports,
  tables, filters and notifications.
- **Region and district dropdowns cover all 31 Tanzanian regions** — the 26
  mainland regions plus the 5 Zanzibar regions (Kaskazini Unguja, Kusini
  Unguja, Mjini Magharibi, Kaskazini Pemba, Kusini Pemba). Choosing a region
  filters the district list to that region's districts. The same list is used
  everywhere — riders, motorcycles, applications and search filters — so a
  place always spells the same way.
- Records created before the dropdowns existed keep whatever location was
  typed then; you'll see it listed as "(existing record)" and can leave it or
  pick a proper value.

## 10. System health & audit

- **`/owner/system`**: last run of every scheduled job and data-quality
  counters (allocation mismatches etc. should always be zero).
- **`/owner/audit`**: append-only trail of every sensitive action (logins,
  money, contract changes, exemption decisions).

## 11. Scheduled jobs (Vercel Hobby plan)

All background work runs **once per day at midnight** Tanzania time
(21:00 UTC) through a single cron endpoint `/api/cron/daily` (up to 5 minutes
of runtime budget), which executes in order: obligation status flips
(due/overdue) → **contract completion** → pending-payment reconciliation →
reservation cleanup → risk recalculation → data-quality checks → your daily
summary email (for the day that just ended) → message outbox.

**Contract completion** is the job that closes finished leases automatically:
any running contract whose end date has passed becomes *Completed*, you get a
summary notification (including how many ended still owing money), and the
rider is told. It never touches paused contracts, and never touches money.

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
