/*
 * Deadline processing (spec §11.4): the scheduled job that turns the static
 * obligation calendar into live payment state — WITHOUT relying on a rider
 * opening the app. Pure so the transition rules are unit tested.
 *
 *   scheduled + day arrived (before deadline) -> due
 *   scheduled/due + deadline passed (unpaid)  -> overdue
 *
 * Settled / exempted / cancelled / postponed obligations are never touched.
 */
export type TransitionObligation = {
  id: string;
  dueDate: string; // YYYY-MM-DD (local)
  dueAtUtcMs: number; // epoch ms of the deadline
  status: string;
};

export type TransitionResult = {
  toDue: string[];
  toOverdue: string[];
};

const ACTIONABLE = new Set(['scheduled', 'due']);

export function computeObligationTransitions(
  obligations: TransitionObligation[],
  nowMs: number,
  today: string,
): TransitionResult {
  const toDue: string[] = [];
  const toOverdue: string[] = [];

  for (const o of obligations) {
    if (!ACTIONABLE.has(o.status)) continue;

    if (nowMs >= o.dueAtUtcMs) {
      // Deadline passed and still unpaid.
      if (o.status !== 'overdue') toOverdue.push(o.id);
    } else if (o.status === 'scheduled' && o.dueDate <= today) {
      // The day has arrived but the deadline hasn't passed.
      toDue.push(o.id);
    }
  }

  return { toDue, toOverdue };
}
