# Backup & Recovery (spec §24, §25.3, DoD #20)

## What must be backed up
1. **Postgres database** — all business + financial data.
2. **Storage objects** — application/rider/guarantor/contract/receipt/incident/
   import files. **DB backups do NOT include storage** — this needs a separate
   process (spec §24).

## Database backups
- Enable Supabase automated daily backups; enable **Point-in-Time Recovery**
  (PITR) on a paid plan for minimal RPO.
- Financial history is append-only (reversal/correction events, never deletes),
  which bounds corruption blast radius.
- Restore drill: restore to a staging project, run `npm run test:rls` and spot-
  check collection totals against `/owner/reports`.

## Storage backups
- Schedule a job (e.g. a separate cron / external worker) that copies each
  private bucket to durable object storage (S3/GCS) with versioning.
- Never make identity-document buckets public (§24).
- The owner **System health** page shows a storage-backup reminder.

## Recovery procedure (outline)
1. Restore the database (PITR to just before the incident).
2. Restore storage objects from the latest snapshot.
3. Re-point env (URL/keys) if a new project.
4. Reconcile: run `/api/cron/reconcile-pending` and `/api/cron/data-quality`;
   review the System page for mismatches.
5. Verify RLS + a test payment before reopening to riders.

## Retention
- Configurable retention for rejected applications and unnecessary documents
  (§25.3). NEVER auto-delete active rider, contract or financial records.
