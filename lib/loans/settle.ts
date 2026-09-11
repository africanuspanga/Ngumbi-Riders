import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOwner, notifyRider } from '@/lib/notifications/service';
import { enqueueSms } from '@/lib/messaging/outbox';
import { writeAudit } from '@/lib/audit/audit';

/*
 * "When the phone loan is fully completed, motorcycle collections resume
 *  automatically." (client feedback 2026-09-11 #13)
 *
 * `automatically` is the requirement, so this runs from the SETTLEMENT PATH —
 * every one of them: the Snippe webhook, the rider's status poll, the
 * reconcile cron and a confirmed cash payment. Whichever way the last
 * instalment arrives, the lease resumes in the same breath, and a rider is
 * never left waiting until midnight to be allowed to pay for their motorcycle
 * again.
 *
 * The nightly job calls it too, as a backstop for the one case this path
 * cannot cover: a loan whose remaining instalments were cancelled or waived
 * rather than paid, which settles nothing and therefore triggers nothing.
 *
 * BEST-EFFORT, ALWAYS. A failure here must never fail the payment that caused
 * it. The money settled; the pause flag is an operational convenience, and the
 * nightly sweep will clear it. Raising from here would turn a successful
 * payment into a reported failure and invite the rider to pay twice.
 */

/**
 * Complete any phone loan whose instalments are now all settled.
 *
 * `obligationIds` are the obligations a payment just settled — only the loans
 * behind them can possibly have become complete, so this is a two-query check
 * rather than a scan of every active loan.
 *
 * Returns the loans it completed, for logging.
 */
export async function completePhoneLoansFor(obligationIds: string[]): Promise<string[]> {
  if (!obligationIds?.length) return [];
  const admin = createAdminClient();

  try {
    const { data, error } = await admin
      .from('payment_obligations')
      .select('phone_loan_id')
      .in('id', obligationIds)
      .eq('kind', 'phone_loan')
      .not('phone_loan_id', 'is', null);
    if (error) return [];

    const loanIds = [
      ...new Set(
        ((data ?? []) as { phone_loan_id: string | null }[])
          .map((o) => o.phone_loan_id)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (loanIds.length === 0) return [];

    return await completeLoansIfSettled(loanIds);
  } catch {
    return [];
  }
}

/**
 * Sweep every active loan. Used by the nightly job as the backstop described
 * above, and cheap: there are only ever a handful of active phone loans.
 */
export async function sweepCompletedPhoneLoans(): Promise<string[]> {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin.from('phone_loans').select('id').eq('status', 'active');
    if (error) return [];
    const ids = ((data ?? []) as { id: string }[]).map((l) => l.id);
    return ids.length ? await completeLoansIfSettled(ids) : [];
  } catch {
    return [];
  }
}

async function completeLoansIfSettled(loanIds: string[]): Promise<string[]> {
  const admin = createAdminClient();
  const completed: string[] = [];

  for (const loanId of loanIds) {
    // `complete_phone_loan` re-checks this itself and refuses while anything is
    // outstanding, so this query is only an optimisation — the guard that
    // matters is in the database, where a race cannot get past it.
    const { count, error } = await admin
      .from('payment_obligations')
      .select('id', { count: 'exact', head: true })
      .eq('phone_loan_id', loanId)
      .in('status', ['scheduled', 'due', 'overdue']);
    if (error || (count ?? 0) > 0) continue;

    const { data: done, error: rpcErr } = await admin.rpc('complete_phone_loan', {
      p_loan_id: loanId,
    });
    // `false` means it was already completed by a concurrent caller — not an
    // error, and not something to announce a second time.
    if (rpcErr || done !== true) continue;

    completed.push(loanId);
    await announceCompletion(loanId);
  }

  return completed;
}

async function announceCompletion(loanId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const { data } = await admin
      .from('phone_loans')
      .select('id, rider_id, total_amount, riders(first_name, last_name, phone)')
      .eq('id', loanId)
      .maybeSingle();
    const loan = data as
      | {
          id: string;
          rider_id: string;
          total_amount: number;
          riders: { first_name: string; last_name: string; phone: string | null } | null;
        }
      | null;
    if (!loan) return;

    const name = loan.riders ? `${loan.riders.first_name} ${loan.riders.last_name}` : 'Rider';

    await notifyRider(loan.rider_id, {
      type: 'phone_loan_completed',
      title: 'Umemaliza kulipa mkopo wa simu',
      body: 'Hongera! Umemaliza kulipa simu. Malipo ya pikipiki yameendelea tena.',
      deepLink: '/rider/loans',
      dedupeKey: `phone_loan_completed:${loanId}`,
    });

    if (loan.riders?.phone) {
      await enqueueSms({
        recipient: loan.riders.phone,
        text: "Ng'umbi Riders: Hongera! Umemaliza kulipa mkopo wa simu. Malipo ya pikipiki yameendelea tena.",
        subject: 'phone_loan_completed',
      });
    }

    await notifyOwner({
      type: 'phone_loan_completed',
      title: 'Phone loan repaid',
      body: `${name} has finished repaying their phone loan. The motorcycle lease has resumed.`,
      deepLink: '/owner/phone-loans',
      dedupeKey: `phone_loan_completed_owner:${loanId}`,
    });

    await writeAudit({
      actorId: null,
      actorRole: 'system',
      action: 'phone_loan.completed',
      entityType: 'phone_loan',
      entityId: loanId,
      metadata: { riderId: loan.rider_id, total: loan.total_amount },
    });
  } catch {
    /* the loan is completed and the lease resumed; the message is secondary */
  }
}
