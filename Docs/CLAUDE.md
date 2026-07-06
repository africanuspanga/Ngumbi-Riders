# Ng’umbi Riders — Complete Product and Engineering Build Specification

**Domain:** ngumbi.co.tz  
**Product type:** Single-business fleet contract and rider payment management system  
**Primary users:** Mr. Ng’umbi (Owner) and contracted riders  
**Target fleet size:** Fewer than 100 motorcycles  
**Primary market:** Tanzania  
**Primary device:** Low-cost Android phone  
**Application form:** Public web link  
**Application delivery:** Responsive Progressive Web App (PWA)  
**Core stack:** Next.js 16.2 App Router, TypeScript, Tailwind CSS, Supabase Auth/Postgres/Storage/Realtime, Snippe, Resend

---

## 1. Product mission

Build a reliable, mobile-first system that removes the need for Mr. Ng’umbi to call every rider every day. The system must make each rider’s contractual payment obligation clear, allow riders to initiate their own mobile-money payments, automatically confirm payments through Snippe, track every paid and unpaid obligation, and give Mr. Ng’umbi accurate daily, weekly, monthly, rider, motorcycle, contract and reconciliation reports.

The product must also handle public rider applications, NIDA and driving-licence uploads, two guarantors, rider approval, motorcycle assignment, contract generation and signing, incidents, payment exemptions, web notifications, reports, imports and downloadable records.

The application is for Ng’umbi Riders only. Do not build multi-tenancy, subscriptions, SaaS billing, organisation switching or public fleet-owner registration.

### 1.1 Recommended implementation libraries

Use stable, actively maintained packages and lock exact versions in the package manager lockfile:

- `@supabase/supabase-js` and `@supabase/ssr`
- Official Snippe JavaScript/TypeScript SDK where its Next.js runtime support is verified
- `resend` and React Email components
- Tailwind CSS and accessible headless UI primitives
- `zod` for shared validation
- `react-hook-form` for complex client forms
- `next-intl` for Swahili and English
- `@react-pdf/renderer` or an equivalent server-safe PDF renderer
- `exceljs` for XLSX exports/imports and a safe CSV parser
- A lightweight chart library loaded only on owner report screens
- `web-push` for PWA push delivery
- Sentry for error monitoring

Do not add a separate Node/NestJS backend. For this fleet size, use Next.js server boundaries, Supabase Postgres functions, Supabase Cron and narrowly scoped Edge Functions where needed.

---

## 2. Source-of-truth product decisions

Implement the following decisions as hard requirements:

1. The commercial arrangement is a fixed-term motorcycle lease.
2. Some contracts transfer motorcycle ownership at completion and others do not. This is configured per contract.
3. Contract duration is configured per contract.
4. The business may have a standard payment amount, but the amount must be stored as a contract snapshot and remain editable by the owner before activation.
5. A contract schedule can require payment every day or only on selected weekdays.
6. The owner configures the payment deadline time.
7. Missed obligations carry forward and immediately appear to the owner as arrears.
8. Partial installment payments are prohibited.
9. A rider may pay one or more whole installments in advance.
10. A rider may clear old arrears.
11. There are no automatic late penalties, deposits, application fees, insurance charges, tracker fees or maintenance contributions.
12. Rider payments are mobile-money only through Snippe. Mr. Ng’umbi may record cash payments manually.
13. Snippe transaction fees are paid by Mr. Ng’umbi and are not added to the rider’s obligation.
14. Refund controls are not exposed in the product.
15. Owner and rider are the only user roles.
16. Riders sign in with their phone number and a four-digit PIN.
17. A rider’s phone number can only be changed by Mr. Ng’umbi.
18. The PWA must work well on slow connections and low-cost Android phones.
19. Swahili is the default interface language. English is available as an optional language.
20. Existing rider, motorcycle, contract and payment data must be importable from CSV or Excel.
21. The complete agreed system is the launch target, not a stripped-down MVP.

---

## 3. Resolved implementation rules

The following rules remove ambiguity and prevent accounting errors.

### 3.1 Whole-obligation payments only

A rider never types an arbitrary amount. The payment screen displays whole obligations and lets the rider choose a valid option such as:

- Pay today
- Clear all arrears
- Pay arrears plus today
- Pay the next 3, 7, 14 or custom number of whole obligations

The resulting amount must equal the exact sum of selected obligations. An amount below one obligation or an amount that leaves an obligation partially settled must be rejected.

### 3.2 Allocation order

Outstanding overdue obligations must be settled before future obligations. The rider may choose how many whole obligations to pay, but the server applies the money to the oldest outstanding obligation first, then today, then future scheduled obligations. Only the owner may override this order, and every override must be audited.

### 3.3 Contract amount

Create a global default amount in Settings for convenience. Copy that amount into every new contract. The contract value is the legal snapshot and does not change when the global default later changes.

### 3.4 Contract editing

Paid history must never be rewritten. When an active contract is changed:

- Preserve all paid and past obligations.
- Create a contract version and audit event.
- Regenerate only future unpaid obligations.
- Generate an addendum PDF when the financial terms, schedule, motorcycle or ownership-transfer terms change.

### 3.5 Motorcycle changes

The normal workflow does not allow a rider to change motorcycles. Because transfers were also requested, provide an owner-only exceptional transfer action. It must close the current assignment, create a new assignment, record a reason, update future contract obligations if required and preserve the full assignment history.

### 3.6 Maintenance and profitability

Do not build a full workshop or service-management module. Build a lightweight motorcycle expense ledger with date, category, amount and note. This supports the requested maintenance-cost and profitability reports. Label the profitability result as **cash operating margin**, calculated as collected contract revenue minus recorded motorcycle expenses. It is not full accounting profit unless all costs are entered.

### 3.7 Receipt channels

Generate in-app and PDF receipts immediately. Send email receipts through Resend when the rider has an email address. Create SMS and WhatsApp delivery adapters and an outbox, but keep those adapters disabled until a messaging provider and credentials are supplied.

---

## 4. User roles and permissions

### 4.1 Owner: Mr. Ng’umbi

The owner has full access to:

- Dashboard and all reports
- Applications and applicant documents
- Rider creation, approval, suspension and termination
- Rider PIN resets and phone-number changes
- Guarantors and guarantor documents
- Motorcycles and assignment history
- Contract creation, signing, activation, pausing, extending, renegotiating, transferring, completing and terminating
- Mobile-money and cash payments
- Exemption decisions
- Incident reports
- Announcements and notifications
- Imports and exports
- Settings, integration health and audit logs

### 4.2 Rider

A rider may access only his or her own:

- Dashboard
- Current and historical contracts
- Payment obligations and payment calendar
- Payment initiation
- Payment history and receipts
- Assigned motorcycle details
- Uploaded rider documents
- Contract progress
- Incident and exemption requests
- Notifications and announcements
- Language and PIN settings

A rider must never read another rider’s record, application, NIDA data, payment, contract, document, notification or motorcycle assignment.

---

## 5. Information architecture and routes

### 5.1 Public routes

- `/` — Simple branded landing page
- `/apply` — Public rider application form
- `/apply/success` — Submission confirmation and application reference
- `/login` — Rider and owner login entry
- `/privacy` — Privacy notice
- `/terms` — Website terms
- `/offline` — PWA offline fallback

### 5.2 Rider routes

- `/rider` — Rider dashboard
- `/rider/pay` — Select obligations and start Snippe payment
- `/rider/payments` — Payment history
- `/rider/payments/[id]` — Payment and receipt detail
- `/rider/calendar` — Paid, overdue, scheduled, exempted and advance-paid calendar
- `/rider/contract` — Current contract and progress
- `/rider/contracts/[id]` — Historical contract detail
- `/rider/motorcycle` — Assigned motorcycle
- `/rider/documents` — Documents the rider is allowed to view
- `/rider/incidents` — Incident list
- `/rider/incidents/new` — Report breakdown, accident, theft, police matter, maintenance issue or emergency
- `/rider/exemptions` — Exemption request list
- `/rider/notifications` — Notifications
- `/rider/settings` — Language and PIN

### 5.3 Owner routes

- `/owner` — Owner dashboard
- `/owner/applications` — Application pipeline
- `/owner/applications/[id]` — Applicant review
- `/owner/riders` — Rider directory
- `/owner/riders/new` — Add an existing or new rider manually
- `/owner/riders/[id]` — Rider 360-degree profile
- `/owner/motorcycles` — Motorcycle register
- `/owner/motorcycles/[id]` — Motorcycle detail, contract and financial history
- `/owner/contracts` — Contract register
- `/owner/contracts/new` — Contract builder
- `/owner/contracts/[id]` — Contract detail and lifecycle actions
- `/owner/payments` — All payment transactions
- `/owner/payments/cash` — Record owner-only cash payment
- `/owner/reconciliation` — Snippe reconciliation
- `/owner/incidents` — Incident queue
- `/owner/exemptions` — Exemption approval queue
- `/owner/announcements` — Broadcast and targeted web notifications
- `/owner/reports` — Report centre
- `/owner/expenses` — Lightweight motorcycle expense ledger
- `/owner/imports` — CSV/Excel import wizard
- `/owner/settings` — Business, contracts, reminders and integrations
- `/owner/audit` — Audit log
- `/owner/system` — Cron, webhook, email and integration health

---

## 6. Design system

Use a clean Bolt-inspired green identity without copying Bolt’s protected brand assets.

### 6.1 Suggested palette

- Primary green: `#2F8F46`
- Primary hover: `#287C3D`
- Dark green: `#163D24`
- Soft green surface: `#EAF7ED`
- Page background: `#F7F9F7`
- Main text: `#122117`
- Muted text: `#607066`
- Border: `#DDE6DF`
- White: `#FFFFFF`
- Paid/success: green
- Overdue/error: red
- Warning: amber
- Advance paid: blue
- Exempted/non-working: grey

The owner may replace the primary brand colour later through settings, but do not build a full theme editor.

### 6.2 UX rules

- Mobile-first and touch-friendly.
- Minimum 44px touch targets.
- Avoid large data tables on rider screens.
- Use TZS formatting with no unnecessary decimals.
- Always show exact dates and the Africa/Dar_es_Salaam timezone.
- Use plain Swahili on rider screens.
- Use skeletons and optimistic UI only where financial integrity is not affected.
- Payment state must never be optimistic; wait for confirmed server state.
- Display offline, syncing and last-updated status clearly.
- Do not hide overdue obligations behind charts.

---

## 7. Authentication architecture

### 7.1 Owner authentication

Use Supabase Auth with a strong email/password account for Mr. Ng’umbi. Enable MFA if available. The owner account is created manually during deployment and must never use a four-digit PIN.

### 7.2 Rider phone and four-digit PIN

Use Supabase Auth as the identity and session provider, but do not send the raw four-digit PIN directly from the browser to Supabase.

Implement a server-only login route:

1. Normalize the phone number to E.164, for example `+2557XXXXXXXX`.
2. Validate the four-digit PIN.
3. Apply rate limiting by phone and IP.
4. Derive the actual Supabase password on the server using a keyed HMAC:
   `HMAC_SHA256(AUTH_PIN_PEPPER, canonical_phone + ':' + pin)`.
5. Call Supabase `signInWithPassword` using the phone number and derived value.
6. Set the Supabase SSR session cookies securely.

Create rider users through the Supabase Admin API with the phone already confirmed. Generate the derived password server-side. Never expose the service-role key or PIN pepper to client code.

### 7.3 PIN security controls

- Exactly four digits in the UI.
- Reject `0000`, `1111`, `1234`, repeated digits, simple sequences and the last four digits of the phone number.
- Five failed attempts within 15 minutes locks login for 30 minutes.
- Log failed attempts without logging the PIN.
- Owner can reset the PIN.
- Rider must change a temporary PIN on first login.
- Phone-number changes require owner approval and must update the Supabase identity and profile in one audited server transaction.
- Do not build rider self-service account recovery in the first release.

---

## 8. Public rider application

### 8.1 Application form

Create a mobile-friendly multi-step form that works without an account.

Steps:

1. Personal information
2. Contact and address
3. NIDA and driving information
4. Experience and emergency contact
5. Guarantor one
6. Guarantor two
7. Document uploads
8. Declaration and signature
9. Review and submit

### 8.2 Applicant fields

- First name
- Middle name
- Last name
- Date of birth
- Gender
- Primary phone
- Alternative phone
- Optional email
- Region
- District
- Ward
- Street
- Full current address
- NIDA number
- Driving-licence number
- Previous riding experience
- Emergency-contact full name
- Emergency-contact phone
- Emergency-contact relationship

### 8.3 Required applicant documents

- NIDA front
- NIDA back
- Driving licence
- Passport-size photograph
- Signed application declaration

### 8.4 Guarantors

Require exactly two guarantors at submission.

For each guarantor collect:

- Full name
- Phone number
- NIDA number
- Residential address
- Relationship to applicant
- Occupation
- Employer or business
- Passport photograph
- NIDA front and back
- Signed guarantor declaration for each guarantor

### 8.5 Application statuses

- `draft`
- `submitted`
- `under_review`
- `interview`
- `verification`
- `approved`
- `rejected`
- `waitlisted`
- `withdrawn`
- `converted_to_rider`

Rider operational statuses such as suspended or terminated belong to the rider record, not the application pipeline.

### 8.6 Application rules

- Generate a human-readable reference such as `NGR-APP-2026-000123`.
- Allow a rejected applicant to apply again.
- Detect possible duplicates by phone, NIDA and driving-licence number, but never silently block; show the owner a duplicate warning.
- Store public uploads in private buckets through server-controlled signed upload flows.
- Scan file type and size. Accept PDF, JPG, JPEG and PNG only.
- Save drafts during the current device session and provide a secure resume token.
- On approval, allow the owner to convert the application into a rider without retyping data.

---

## 9. Rider and motorcycle management

### 9.1 Rider record

The rider profile must include:

- Rider number, for example `NGR-R-0001`
- Personal and address information
- Phone and optional email
- Status: onboarding, active, suspended, terminated, inactive
- Guarantors
- Documents
- Current contract
- Contract history
- Current motorcycle
- Assignment history
- Payment performance
- Arrears
- Incidents and exemptions
- Risk level
- Notes visible only to the owner

### 9.2 Manual rider creation

The owner must be able to add existing riders directly. The flow should:

1. Create or select a motorcycle.
2. Enter rider data.
3. Add guarantors and documents when available.
4. Create a Supabase Auth user.
5. Set a temporary four-digit PIN.
6. Create the contract.
7. Generate historical or future obligations.
8. Optionally import historical payments.

For public applications, require the signed guarantor declarations. Allow incomplete historical documents for manually imported existing riders, but display a compliance warning until required documents are uploaded.

### 9.3 Motorcycle record

Required fields:

- Internal motorcycle number
- Registration number, unique
- Make and model
- Status: available, assigned, inactive
- Current rider, derived from assignment
- Current contract
- Assignment history
- Total collections
- Recorded expenses
- Cash operating margin

Do not require chassis number, engine number, year, colour, mileage, insurance, road licence, photographs or purchase price.

### 9.4 Assignment rules

- A motorcycle can have only one active assignment.
- A rider can have only one active motorcycle assignment.
- An active contract must point to its assignment.
- Historical assignments are immutable.
- Exceptional transfer requires owner action, reason and effective date.

---

## 10. Contract engine

### 10.1 Contract fields

- Contract number
- Rider
- Motorcycle
- Contract type: fixed-term lease
- Ownership transfers at completion: yes/no
- Ownership-transfer notes or condition
- Start date
- End date or duration in months
- Schedule type: daily or selected weekdays
- Selected weekdays
- Installment amount
- Payment deadline time
- Currency: TZS
- Contract terms/template version
- Special terms
- Status
- Required signatures
- Generated PDF
- Signed physical copy, optional fallback

### 10.2 Contract statuses

- `draft`
- `awaiting_signatures`
- `scheduled`
- `active`
- `paused`
- `completed`
- `completed_early`
- `terminated`
- `cancelled`

### 10.3 Contract workflow

1. Owner selects or creates the rider and motorcycle.
2. Owner sets duration, dates, schedule, amount, deadline and ownership-transfer rule.
3. System previews total expected obligations and contract value.
4. System generates a PDF from the versioned contract template.
5. Owner signs on screen.
6. Rider signs on screen.
7. Optional guarantor and witness signatures may be collected.
8. If electronic signing fails, owner uploads a physically signed copy.
9. Contract activates only after mandatory owner and rider signatures.
10. System generates all scheduled obligations for the contract period.

### 10.4 Contract lifecycle actions

Support owner-only actions:

- Pause
- Resume
- Extend
- Renegotiate amount
- Change future schedule
- Change future deadline
- Terminate
- Complete early
- Exceptional motorcycle transfer

Every action requires:

- Effective date
- Reason
- Confirmation screen showing financial impact
- Contract version or event
- Audit log
- Addendum PDF when legal terms change

### 10.5 Signatures and document integrity

- Capture drawn signatures as transparent images.
- Record signer, role, date, IP, user agent and signature method.
- Generate the final signed PDF.
- Calculate and store a SHA-256 document hash.
- Never overwrite a signed contract PDF.
- Store each addendum as a separate signed document.

---

## 11. Obligation schedule engine

The obligation is the accounting source of truth for what a rider owes on a particular date.

### 11.1 Obligation fields

- Contract ID
- Rider ID
- Motorcycle ID
- Due date
- Due timestamp in UTC
- Local due time snapshot
- Amount due
- Status
- Settled timestamp
- Paid-in-advance timestamp, when relevant
- Exemption or postponement reference
- Contract-version reference

### 11.2 Obligation statuses

- `scheduled`
- `due`
- `overdue`
- `paid`
- `paid_in_advance`
- `exempted`
- `postponed`
- `cancelled`

Do not use a partially-paid status.

### 11.3 Generation rules

- Generate obligations when the contract is activated.
- Daily schedule creates one obligation for every calendar day in the contract period.
- Weekday schedule creates obligations only for selected weekdays.
- Store due timestamps in UTC after calculating them in Africa/Dar_es_Salaam.
- Include leap years and month-boundary tests.
- Use a unique constraint on contract ID and due date.
- Contract edits regenerate only future, unpaid obligations.

### 11.4 Deadline processing

A scheduled job runs frequently and:

- Changes today’s scheduled obligations to due.
- Changes unpaid obligations to overdue after the deadline.
- Creates rider reminder notifications.
- Creates an immediate owner notification or digest of newly overdue riders.
- Updates risk calculations.
- Never relies on a rider opening the app to update status.

---

## 12. Snippe mobile-money integration

### 12.1 Integration principles

- All Snippe requests originate from server-side code.
- Never expose the Snippe API key or webhook secret to the browser.
- Use TZS.
- Mobile money is the only rider-facing payment method.
- Webhook confirmation is the primary source of truth.
- Browser redirects and success screens are not proof of payment.
- Use idempotency keys for payment creation.
- Store the raw provider event in a restricted audit table.

### 12.2 Rider payment flow

1. Rider opens `/rider/pay`.
2. Server loads eligible unpaid obligations.
3. Rider chooses a valid whole-obligation payment option.
4. Rider confirms or enters the payer’s mobile-money phone number. It may belong to another person.
5. Server recalculates the selected obligations and amount.
6. Server creates a local pending payment and reservations for the selected obligations.
7. Server generates a unique Snippe idempotency key.
8. Server creates the Snippe mobile-money payment intent and triggers the USSD push.
9. Rider authorizes with the mobile-money PIN.
10. UI displays pending status and polls the local payment endpoint conservatively.
11. Snippe sends a signed webhook.
12. Server verifies the raw body, timestamp and HMAC signature.
13. Server confirms reference, currency, amount and expected state.
14. In one database transaction, mark payment complete, create allocations, settle obligations, create receipt and notifications.
15. Rider dashboard updates through Realtime or revalidation.

### 12.3 Payment statuses

- `created`
- `pending`
- `completed`
- `failed`
- `expired`
- `cancelled`
- `reversed`

The UI has no refund button. If Snippe reports a reversal, preserve the original completed event, create a reversal event, reopen affected obligations and alert the owner.

### 12.4 Idempotency and concurrency

- Use a unique local idempotency key for every initiation attempt.
- Add unique constraints for Snippe provider reference and webhook event identity.
- Lock selected obligations during payment processing.
- A second attempt against reserved obligations must be rejected or attached to the existing pending attempt.
- Webhook handlers must safely return success when the same event is replayed.
- Never generate duplicate receipts or allocations.

### 12.5 Pending-payment recovery

Allow only one active pending Snippe attempt per rider and contract. When a USSD prompt is not received, re-trigger the push for the same provider payment where supported instead of creating another payment. A new attempt may be created only after the previous provider payment is confirmed failed or expired.

Create a reconciliation job that checks old pending payments against Snippe’s status endpoint. Mark them completed, failed or expired according to the provider state. Surface unresolved records in the owner system-health page. Never free a reservation solely because the browser was closed.

### 12.6 Cash payments

Only the owner may record cash.

Cash flow:

1. Select rider and contract.
2. Select one or more whole outstanding obligations.
3. Show exact total.
4. Confirm payment date and optional note.
5. Create a completed cash payment and allocations in one transaction.
6. Generate the same receipt structure used by mobile-money payments.
7. Record owner identity in the audit log.

Do not require a receipt photograph or external transaction reference.

---

## 13. Receipts

Every completed payment must have:

- Unique receipt number such as `NGR-RCPT-2026-000001`
- Rider name and rider number
- Contract number
- Motorcycle registration number
- Payment date and local time
- Payment method
- Payer phone when mobile money is used
- Snippe reference when applicable
- Total paid
- Covered obligation dates
- Ng’umbi Riders business details
- Verification code or internal receipt ID

Generate an A4 PDF and a mobile-friendly receipt page. Store the PDF in private storage. Riders can download only their own receipts.

Delivery states should be tracked independently for in-app, email, SMS and WhatsApp.

---

## 14. Owner dashboard

The owner landing page must answer, at a glance:

- How much was expected today?
- How much of today’s obligations has been settled?
- How much cash was collected today, regardless of due date?
- Who has paid?
- Who has not paid?
- What is total arrears?
- How many riders and motorcycles are active?
- Which contracts are nearing completion?
- Which applications require review?
- Which riders repeatedly pay late?
- Are any Snippe payments unreconciled?

### 14.1 KPI definitions

- **Expected today:** Sum of obligations due today, excluding exempted and cancelled obligations.
- **Settled for today:** Sum of today’s obligations already paid, including advance payments.
- **Collected today:** Completed payment transactions received today, including arrears and advance payments.
- **Outstanding today:** Today’s unpaid due obligations.
- **Collection rate:** Settled value for today divided by expected today.
- **Total arrears:** All overdue unpaid obligations.
- **Paid riders:** Riders whose currently due obligations are fully settled.
- **Unpaid riders:** Riders with at least one unpaid due or overdue obligation.

Do not merge collected-today and settled-for-today; they answer different questions.

### 14.2 Dashboard sections

- KPI cards
- Paid versus unpaid rider list
- Today’s collection timeline
- Arrears aging summary
- Recent transactions
- Contracts ending in 30, 14 and 7 days
- Applications awaiting action
- High-risk riders
- Integration warnings

---

## 15. Rider dashboard

The rider home screen should show:

- Current payment state: paid, due or overdue
- Amount required now
- Arrears count and amount
- Next due date and deadline
- One prominent **Lipa Sasa** button
- Contract progress percentage
- Remaining obligations and value
- Recent payments
- Assigned motorcycle registration and model
- Unread notifications
- Quick incident-report button

### 15.1 Payment calendar colours

- Green: paid
- Red: overdue/unpaid
- Amber: due today
- Grey: exempted, cancelled or non-scheduled day
- Blue: paid in advance

Because partial payments are prohibited, orange must not represent partial payment. Use amber for due today or pending confirmation.

---

## 16. Incidents and exemption requests

### 16.1 Incident categories

- Breakdown
- Accident
- Theft
- Police issue
- Maintenance request
- Personal emergency

Collect category, date/time, description, location text and optional photographs or documents.

### 16.2 Exemption workflow

A rider may request relief for an obligation because of a breakdown or emergency.

Statuses:

- submitted
- under_review
- approved_waived
- approved_postponed
- rejected
- cancelled

The owner decides whether to:

- Waive the obligation completely, or
- Postpone it to a new date

The decision must update the obligation through a controlled database function, add a contract event when necessary, notify the rider and preserve the original due date in history.

---

## 17. Notifications and announcements

### 17.1 In-app notifications

Create persistent notification records for:

- Payment due reminders
- Payment overdue reminders
- Payment completed
- Payment failed or expired
- Contract activated, changed, paused, resumed or nearing completion
- Exemption decision
- Incident update
- Owner announcement
- PIN or phone-number change

Support read/unread state, deep links and deduplication keys.

### 17.2 PWA push notifications

Use web push for installed devices when permission is granted. Push is supplementary; the in-app notification record remains the source of truth.

### 17.3 Reminder schedule

Make reminder times configurable. Suggested defaults:

- Morning reminder on a scheduled payment day
- Reminder two hours before deadline
- Deadline notification
- Repeated overdue reminder at a reasonable configurable interval until settled

Avoid creating unlimited duplicate notifications. Use one notification thread or a daily dedupe key per obligation and reminder stage.

### 17.4 Owner alerts

At each deadline, create:

- An owner dashboard alert showing all newly overdue riders
- Individual overdue entries for drill-down

### 17.5 Announcements

Owner can send announcements to:

- All active riders
- Selected riders
- Riders with arrears
- Riders on selected contracts

Announcements are in-app and push-enabled.

---

## 18. Resend email integration

Use Resend for:

- Owner daily summary
- Owner system alerts when configured
- Rider receipt email when an email address exists
- Optional contract PDF delivery

### 18.1 Daily owner summary

Default delivery time: 10:00 PM Africa/Dar_es_Salaam, editable in settings.

Include:

- Expected today
- Settled for today
- Collected today
- Cash versus mobile money
- Paid and unpaid rider counts
- New arrears
- Total arrears
- Failed and pending Snippe payments
- Contracts nearing completion
- Applications awaiting review
- Link to owner dashboard

Use an idempotency key so a retry does not send duplicate summaries.

---

## 19. Reports and exports

All reports use Africa/Dar_es_Salaam dates and TZS.

### 19.1 Required reports

1. Daily collection report
2. Weekly collection report
3. Monthly collection report
4. Rider statement
5. Motorcycle statement
6. Arrears report
7. Payment-performance report
8. Contract-progress report
9. Maintenance/expense report
10. Motorcycle cash-operating-margin report
11. Snippe reconciliation report

### 19.2 Report definitions

**Daily/weekly/monthly collections**
- Obligations expected
- Obligations settled
- Payments received
- Cash/mobile-money split
- Collection rate
- Arrears created and recovered

**Rider statement**
- Contract details
- Every obligation
- Every payment
- Allocation of payments to dates
- Exemptions and postponements
- Running outstanding balance

**Motorcycle statement**
- Rider and contract history
- Collections
- Recorded expenses
- Cash operating margin

**Arrears report**
- Rider
- Oldest overdue date
- Days overdue
- Count and amount
- Aging buckets: 1 day, 2–3, 4–7, 8–30 and over 30 days

**Payment performance**
- On-time rate
- Advance-payment rate
- Late-payment count
- Consecutive missed obligations
- Average delay

**Contract progress**
- Total scheduled obligations
- Paid obligations
- Remaining obligations
- Paid value
- Remaining value
- Expected completion date

**Snippe reconciliation**
- Provider-completed/local-completed match
- Provider-completed/local-pending mismatch
- Local-completed/provider-not-completed mismatch
- Duplicate reference detection
- Old pending attempts
- Amount or currency mismatch

### 19.3 Export formats

Every report supports:

- PDF
- Excel workbook
- CSV
- Print-friendly page

Use streaming or server-side generation for large exports. Keep exports protected by owner authorization.

---

## 20. Risk scoring

Create an explainable rule-based risk level, not an opaque AI score.

Suggested default rules:

- Low: no overdue obligations in the last 30 days
- Medium: 1–2 overdue obligations in the last 30 days
- High: 3–6 overdue obligations, two consecutive misses or significant arrears
- Critical: 7 or more overdue obligations, prolonged arrears or owner manual flag

Store the contributing reasons and calculate daily. Allow the owner to change thresholds and manually override the risk level with a note.

---

## 21. CSV and Excel import system

### 21.1 Import types

- Riders
- Guarantors
- Motorcycles
- Contracts
- Assignments
- Historical obligations
- Historical payments
- Motorcycle expenses

### 21.2 Import wizard

1. Select import type.
2. Download template.
3. Upload CSV or XLSX.
4. Map columns.
5. Normalize phone numbers and dates.
6. Validate required fields.
7. Preview valid rows, warnings and errors.
8. Detect duplicates.
9. Run a dry import.
10. Confirm final import.
11. Produce an import report.

### 21.3 Safety rules

- Every import has a batch ID.
- Store original file in a restricted bucket.
- Do not insert invalid rows.
- Make batch rollback possible before dependent live activity exists.
- Do not create duplicate riders by phone or NIDA without owner confirmation.
- Do not create duplicate motorcycles by registration number.
- Historical payments must be imported as completed historical records with clear source metadata.
- Imported data must pass the same invariants as manually entered data.

---

## 22. Database design

Use UUID primary keys internally and human-readable business numbers externally.

### 22.1 Core tables

- `app_settings`
- `profiles`
- `rider_applications`
- `application_documents`
- `riders`
- `rider_private_data`
- `rider_documents`
- `guarantors`
- `guarantor_documents`
- `motorcycles`
- `motorcycle_assignments`
- `contract_templates`
- `contracts`
- `contract_versions`
- `contract_events`
- `contract_signatures`
- `contract_documents`
- `payment_obligations`
- `payments`
- `payment_allocations`
- `payment_events`
- `payment_reservations`
- `receipts`
- `incident_reports`
- `exemption_requests`
- `motorcycle_expenses`
- `notifications`
- `push_subscriptions`
- `announcements`
- `announcement_recipients`
- `message_outbox`
- `daily_summaries`
- `risk_snapshots`
- `import_batches`
- `import_rows`
- `login_attempts`
- `audit_logs`
- `system_job_runs`

### 22.2 Important constraints

- Unique normalized rider phone.
- Unique motorcycle registration number.
- One active contract per rider unless the owner explicitly closes the previous contract.
- One active motorcycle assignment per rider.
- One active motorcycle assignment per motorcycle.
- Unique obligation per contract and due date.
- Obligation amount greater than zero.
- Payment amount greater than zero.
- Completed payment allocations must equal payment amount.
- Each allocation must settle a whole obligation.
- Unique Snippe reference.
- Unique webhook event identity or payload hash.
- Signed contract documents are immutable.

### 22.3 Database functions

Implement security-definer functions in a non-exposed schema for critical transactions:

- Activate contract and generate obligations
- Regenerate future obligations after a contract version
- Create payment reservation
- Complete Snippe payment and allocate obligations
- Record cash payment and allocate obligations
- Apply exemption waiver
- Apply postponement
- Transfer motorcycle
- Change rider phone
- Reverse provider payment safely
- Calculate rider balance and risk

Revoke direct table writes where a controlled function is required.

---

## 23. Row-level security

Enable RLS on every exposed table.

### 23.1 Owner policies

Owner can read and manage all business records through authenticated server or browser requests, except immutable payment and signed-document records that must be changed only through controlled functions.

### 23.2 Rider policies

Rider can select only records whose rider/profile relationship matches `auth.uid()`:

- Own profile and safe rider fields
- Own contracts and contract documents
- Own obligations
- Own payments, allocations and receipts
- Own motorcycle assignment and safe motorcycle fields
- Own incidents and exemptions
- Own notifications

Rider inserts are restricted to incidents, exemption requests, notification reads and push subscriptions. Payment creation must go through a server action or route handler.

### 23.3 Anonymous access

Anonymous users receive no direct table or bucket access. Public applications are submitted through validated server endpoints.

---

## 24. Storage architecture

Create private buckets:

- `application-documents`
- `rider-documents`
- `guarantor-documents`
- `contract-documents`
- `receipts`
- `incident-attachments`
- `import-files`

Rules:

- Never use public buckets for identity documents.
- Use short-lived signed URLs.
- Validate extension, MIME type and file signature.
- Compress large images before or after upload.
- Do not cache NIDA, licence or contract files in the service worker.
- Create a separate storage backup process because database backups alone do not protect storage objects.

---

## 25. Security and privacy

### 25.1 Sensitive data

Treat NIDA numbers, driving-licence numbers, signatures, addresses and guarantor information as sensitive.

- Encrypt especially sensitive database values with application-level AES-256-GCM or an approved equivalent.
- Keep encryption keys in server environment variables.
- Never log decrypted values.
- Mask NIDA and licence numbers in list views.
- Reveal full values only to the owner on a deliberate detail action.

### 25.2 Application security

- Service-role and integration secrets remain server-only.
- Validate all inputs with shared schemas.
- Use secure, HTTP-only, same-site cookies.
- Apply CSRF protections and same-origin checks.
- Add Content Security Policy and secure response headers.
- Rate-limit login, application submission, payment initiation and file uploads.
- Verify Snippe webhook HMAC using the raw body.
- Reject stale webhook timestamps.
- Use idempotency and database uniqueness constraints.
- Audit all owner actions that affect money, contracts, identity or permissions.
- Never delete completed financial history; use reversal or correction events.

### 25.3 Data retention

Create configurable retention rules for rejected applications and unnecessary documents. Do not automatically delete active rider, contract or financial records.

---

## 26. PWA and low-bandwidth strategy

### 26.1 PWA features

- Manifest with Ng’umbi Riders name, icons and green theme
- Standalone display mode
- Install prompt and installation instructions
- Service worker
- Offline fallback page
- Web push subscriptions
- Update-available prompt

### 26.2 Offline behaviour

Cache:

- Application shell
- Static icons and fonts
- Translation files
- Non-sensitive reference data
- Last safe dashboard summary with a visible “last updated” timestamp

Do not cache:

- NIDA images
- Driving licences
- Signed contracts
- Receipts containing sensitive details
- Owner-wide financial reports
- Snippe responses or secrets

Allow an incident draft to be saved locally and synchronized later. Do not allow payment initiation or financial mutation while offline.

### 26.3 Performance targets

- Fast first load on a slow 3G connection.
- Minimal client JavaScript on rider routes.
- Lazy-load charts and heavy export libraries.
- Paginate owner lists.
- Compress uploads.
- Use server components for read-heavy pages.
- Avoid polling when Realtime or controlled revalidation is sufficient.

---

## 27. Scheduled jobs

Use Supabase Cron and secure server/Edge Function jobs.

Required jobs:

1. Obligation status processor — frequent
2. Reminder generator — frequent
3. Pending Snippe reconciliation — frequent
4. Risk-score recalculation — daily and after payment changes
5. Contract-expiry warning generator — daily
6. Owner daily summary through Resend — default 10:00 PM EAT
7. Receipt/message outbox retry — frequent
8. Data-quality checks — daily
9. Old payment reservation cleanup — frequent
10. Backup verification reminder — scheduled

Every job writes a run record with started time, completed time, status, counts and error summary. Jobs must be idempotent.

---

## 28. API and server boundaries

Use Next.js Route Handlers for:

- Snippe webhook
- Snippe payment initiation and status
- Rider login and PIN changes
- Public application submission
- Signed upload URL creation
- Resend email endpoints when needed
- Export generation
- PWA push subscription and delivery
- Health checks

Use Server Actions for authenticated form mutations where appropriate. Keep all financial invariants in Postgres functions or transactional server code, not client components.

Suggested endpoint groups:

- `/api/auth/rider-login`
- `/api/auth/change-pin`
- `/api/applications`
- `/api/uploads/sign`
- `/api/payments/snippe/initiate`
- `/api/payments/[id]/status`
- `/api/webhooks/snippe`
- `/api/reports/[report]/export`
- `/api/push/subscribe`
- `/api/health`

---

## 29. Suggested project structure

```text
app/
  (public)/
  (auth)/
  rider/
  owner/
  api/
components/
  ui/
  forms/
  dashboard/
  payments/
  contracts/
  reports/
  pwa/
features/
  applications/
  riders/
  motorcycles/
  contracts/
  obligations/
  payments/
  reports/
  notifications/
  imports/
lib/
  auth/
  supabase/
  snippe/
  resend/
  security/
  validation/
  money/
  dates/
  i18n/
  pdf/
  exports/
  audit/
  jobs/
messages/
  sw.json
  en.json
supabase/
  migrations/
  seed.sql
  functions/
public/
  icons/
  sw.js
scripts/
  import/
  data-quality/
tests/
  unit/
  integration/
  e2e/
```

Organize by business feature, not only by technical file type.

---

## 30. Environment variables

```text
NEXT_PUBLIC_APP_URL=https://ngumbi.co.tz
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
AUTH_PIN_PEPPER=
PII_ENCRYPTION_KEY=
SNIPPE_API_KEY=
SNIPPE_WEBHOOK_SECRET=
SNIPPE_BASE_URL=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
OWNER_SUMMARY_EMAIL=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
CRON_SECRET=
SENTRY_DSN=
```

Validate required environment variables at startup. Never prefix secrets with `NEXT_PUBLIC_`.

---

## 31. Testing strategy

### 31.1 Unit tests

- Phone normalization
- PIN transformation and validation
- Contract-date calculations
- Daily and weekday obligation generation
- Leap year and month-boundary handling
- Obligation status transitions
- Whole-payment validation
- Oldest-first allocation
- Contract progress
- Risk scoring
- KPI calculations
- TZS formatting

### 31.2 Integration tests

- RLS owner access
- RLS rider isolation
- Public application submission
- Contract activation transaction
- Contract modification preserving paid history
- Snippe initiation with idempotency
- Valid and invalid webhook signatures
- Webhook replay
- Amount/reference mismatch rejection
- Cash payment transaction
- Exemption waiver and postponement
- CSV import dry run and commit
- Resend summary idempotency

### 31.3 End-to-end tests

- Applicant submits application and documents
- Owner approves and converts applicant
- Owner creates and signs contract
- Rider logs in with phone and PIN
- Rider sees correct obligation
- Rider completes mocked Snippe payment
- Receipt appears exactly once
- Dashboard updates
- Rider reports breakdown and requests exemption
- Owner approves postponement
- Owner records cash payment
- Owner exports daily report
- App installs as PWA
- App behaves correctly on slow network and offline fallback

### 31.4 Security tests

- Rider cannot access another rider by changing IDs
- Anonymous user cannot read storage
- Service-role key is absent from client bundles
- Brute-force lockout works
- Webhook replay is harmless
- Signed URL expires
- Financial records cannot be directly deleted

---

## 32. Observability and operations

Implement:

- Structured server logs
- Sentry for frontend and backend errors
- Audit logs for business actions
- Snippe webhook event viewer with masked data
- Cron/job run history
- Integration health cards
- Failed email/message outbox
- Data-quality checks for orphaned assignments, allocation mismatches and duplicate references

Create an owner system page that displays:

- Snippe connection state
- Last successful webhook
- Pending payment count
- Last successful reconciliation
- Last daily summary email
- Last cron run
- Failed job count
- Storage/backup reminder

---

## 33. Explicitly out of scope

Do not add the following unless a future signed change request approves them:

- GPS tracking or live motorcycle location
- Trip or passenger-ride tracking
- Full workshop, spare-parts or service scheduling
- Full double-entry accounting, payroll or tax filing
- Multi-tenant SaaS support
- Native Android or iOS applications
- Public owner registration
- Rider-to-rider messaging
- Automatic guarantor SMS or WhatsApp escalation
- Automatic late fees or interest
- Rider-initiated refunds

---

## 34. Delivery phases

### Phase 0 — Repository and foundations

- Initialize Next.js TypeScript App Router project.
- Configure Supabase local development and migrations.
- Add linting, formatting, tests and CI.
- Add design tokens, responsive shell and i18n.
- Configure environment validation.

**Exit:** Application deploys, CI passes and local Supabase works.

### Phase 1 — Database, auth and RLS

- Create schema, enums, constraints and audit infrastructure.
- Implement owner auth.
- Implement rider phone/PIN auth and rate limiting.
- Add RLS policies and automated isolation tests.

**Exit:** Owner and test riders can sign in; cross-rider access is impossible.

### Phase 2 — Applications and documents

- Build public multi-step form.
- Add two guarantors.
- Add private uploads, review pipeline and duplicate warnings.
- Build owner application review.

**Exit:** A public applicant can submit a complete application and the owner can review it.

### Phase 3 — Riders, motorcycles and imports

- Build rider and motorcycle registers.
- Add manual rider creation.
- Add assignment history.
- Build CSV/XLSX import wizard.

**Exit:** Existing riders and motorcycles can be loaded safely.

### Phase 4 — Contracts and schedule engine

- Build contract template and PDF generation.
- Add signatures and physical-upload fallback.
- Add obligation generation.
- Add lifecycle events and versions.

**Exit:** A signed contract can activate and produce an accurate obligation calendar.

### Phase 5 — Payments and Snippe

- Build whole-obligation selection.
- Integrate Snippe mobile money.
- Verify signed webhooks.
- Add idempotency, allocations, receipts and reconciliation.
- Add owner-only cash payments.

**Exit:** A rider payment settles the correct obligations exactly once.

### Phase 6 — Dashboards and rider experience

- Build owner KPIs, lists and drill-downs.
- Build rider dashboard, calendar, progress and receipts.
- Add Realtime refresh where appropriate.

**Exit:** Both users can understand current payment status without manual calculation.

### Phase 7 — Incidents, exemptions and risk

- Build incident reporting.
- Build waiver/postponement decisions.
- Add explainable risk scoring.

**Exit:** Operational exceptions are tracked without corrupting contract history.

### Phase 8 — Notifications, PWA and Resend

- Add in-app notifications.
- Add PWA manifest, service worker and install UX.
- Add web push.
- Add daily Resend summary and receipt email.
- Add SMS/WhatsApp adapter interfaces and outbox.

**Exit:** The app is installable and reminders work reliably.

### Phase 9 — Reports, expenses and exports

- Build all required reports.
- Add lightweight motorcycle expense ledger.
- Add PDF, XLSX, CSV and print exports.

**Exit:** Owner can reconcile operations and download every requested report.

### Phase 10 — Hardening and launch

- Complete automated tests.
- Run security review and RLS review.
- Test with poor network and low-cost Android devices.
- Import real data into staging.
- Reconcile sample historical totals.
- Configure production domain, email DNS, Snippe webhook and backups.
- Pilot with five riders before full rollout.

**Exit:** Production data and money flows are verified and launch checklist is signed.

---

## 35. Definition of done

The product is complete only when all of the following are true:

1. Every active rider can log in with phone and PIN.
2. Every active contract generates accurate dated obligations.
3. A rider cannot pay less than a full obligation.
4. Advance payments and arrears are allocated correctly.
5. Snippe webhook replay cannot double-credit a rider.
6. Mr. Ng’umbi can record cash payments, and no rider can.
7. Paid history survives contract edits.
8. Owner and rider signatures produce an immutable PDF.
9. Rider applications collect all required details, documents and two guarantors.
10. Riders can see their calendar, balance, contract progress and receipts.
11. Mr. Ng’umbi can see expected, settled, collected, outstanding and arrears values accurately.
12. All requested reports export to PDF, Excel, CSV and print.
13. The app installs as a PWA and has a safe offline mode.
14. Daily Resend summaries are idempotent.
15. RLS tests prove rider isolation.
16. Existing Excel/CSV data can be imported with validation and duplicate detection.
17. Snippe reconciliation identifies mismatches.
18. Sensitive documents are private and use expiring signed URLs.
19. All money-changing actions are audited.
20. Production backup and recovery procedures are documented and tested.

---

## 36. Claude Code execution instructions

You are the lead engineer for Ng’umbi Riders. Build the system described in this specification as production software, not a visual prototype.

Operating rules:

1. Treat this file as the product source of truth.
2. Work phase by phase and keep `IMPLEMENTATION_STATUS.md` updated.
3. Before coding a phase, write its tasks and acceptance tests.
4. Use Supabase migrations for every schema, function, trigger, policy and seed change.
5. Never make undocumented manual database changes.
6. Keep financial state transitions transactional and idempotent.
7. Never trust client-provided amounts, obligation IDs, roles or payment status.
8. Keep Snippe, Resend, encryption, service-role and PIN-pepper secrets server-only.
9. Verify Snippe webhooks from the raw request body.
10. Do not mark a payment complete from a browser callback.
11. Do not weaken RLS to fix a frontend problem.
12. Add tests with every critical business rule.
13. Run type checking, linting and relevant tests after each completed task.
14. Keep the rider UI simple, Swahili-first and optimized for low-cost Android devices.
15. Do not implement multi-tenancy or unrelated fleet features.
16. Use feature flags for SMS and WhatsApp until providers are configured.
17. Keep signed contracts and completed financial records immutable.
18. Record assumptions in `DECISIONS.md` instead of silently changing business rules.
19. Seed realistic Tanzanian development data without using real NIDA numbers or real personal data.
20. Do not declare a phase complete until its exit criteria and automated tests pass.

Start with Phase 0 and Phase 1. Produce the initial architecture, migration plan, route map, environment template, RLS matrix and test plan before implementing feature screens.
