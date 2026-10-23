/*
 * Late-payment SMS reminders (client request 2026-10-23).
 *
 *   "The SMS needs to work when someone is late in paying for 48 hours and it
 *    just tell him in swahili: hujalipa — unadaiwa malipo ya siku 2, and also
 *    when he is late for 7 days tell him: kama hujalipa hii itapelekea kuvunja
 *    mkataba."
 *
 * HOW LATENESS IS MEASURED
 * A rider's lateness is the age of their OLDEST unpaid payment day — that is
 * the day they have been behind since. Paying it moves the anchor forward to
 * the next unpaid day, which starts a new cycle.
 *
 * ONCE PER STAGE PER ANCHOR, NOT ONCE PER DAY
 * Each stage is sent once for a given oldest-unpaid obligation, keyed
 * `late_sms_<stage>:<obligation id>`. A rider who stays 7+ days behind gets the
 * warning once, not a text every morning; a rider who pays the oldest day and
 * falls behind again is reminded again. A rider already 7+ days behind when
 * this first runs gets only the 7-day warning — sending "you owe 2 days" to
 * somebody 30 days behind would understate the debt.
 *
 * Plain ASCII on purpose: one curly apostrophe or em dash would switch the
 * whole SMS to Unicode and double what each reminder costs.
 *
 * Pure, so every rule is unit tested.
 */

export type LateStage = 'late_2d' | 'warn_7d';

export const STAGE_THRESHOLD_DAYS: Record<LateStage, number> = {
  late_2d: 2,
  warn_7d: 7,
};

export type LateRiderInput = {
  riderId: string;
  profileId: string | null;
  firstName: string;
  fullName: string;
  phone: string | null;
  /** The oldest unpaid (due/overdue) obligation. */
  oldestObligationId: string;
  oldestDueDate: string; // YYYY-MM-DD
  /** Everything unpaid and already due, in TZS. */
  owedAmount: number;
  owedCount: number;
};

export type LateReminder = LateRiderInput & {
  stage: LateStage;
  daysLate: number;
  dedupeKey: string;
  text: string;
};

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function daysLate(oldestDueDate: string, today: string): number {
  return Math.round((toMs(today) - toMs(oldestDueDate)) / DAY_MS);
}

/** The stage a rider is in today, or null when they are not late enough. */
export function stageFor(late: number): LateStage | null {
  if (late >= STAGE_THRESHOLD_DAYS.warn_7d) return 'warn_7d';
  if (late >= STAGE_THRESHOLD_DAYS.late_2d) return 'late_2d';
  return null;
}

function tzs(amount: number): string {
  return `TZS ${Math.round(amount).toLocaleString('en-US')}`;
}

export function reminderText(stage: LateStage, rider: { firstName: string; owedAmount: number }, late: number): string {
  const name = rider.firstName.trim() || 'Mteja';
  if (stage === 'late_2d') {
    return (
      `Ng'umbi Riders: Habari ${name}, hujalipa - unadaiwa malipo ya siku ${late} ` +
      `(${tzs(rider.owedAmount)}). Tafadhali lipa leo kupitia app ya Ng'umbi Riders.`
    );
  }
  return (
    `Ng'umbi Riders: Habari ${name}, umechelewa kulipa kwa siku ${late}. ` +
    `Deni lako ni ${tzs(rider.owedAmount)}. Kama hujalipa, hii itapelekea kuvunja mkataba. Lipa leo.`
  );
}

export function planLateReminders(riders: readonly LateRiderInput[], today: string): LateReminder[] {
  const out: LateReminder[] = [];
  for (const r of riders) {
    if (r.owedAmount <= 0) continue;
    const late = daysLate(r.oldestDueDate, today);
    const stage = stageFor(late);
    if (!stage) continue;
    out.push({
      ...r,
      stage,
      daysLate: late,
      dedupeKey: `late_sms_${stage}:${r.oldestObligationId}`,
      text: reminderText(stage, r, late),
    });
  }
  // Most overdue first: if the run is cut short, the riders closest to losing
  // their contract have already been told.
  return out.sort((a, b) => b.daysLate - a.daysLate);
}

/** One line for the owner about who crossed into the 7-day warning today. */
export function ownerWarningDigest(warned: readonly LateReminder[]): string | null {
  if (warned.length === 0) return null;
  const total = warned.reduce((s, r) => s + r.owedAmount, 0);
  const names = warned
    .slice(0, 5)
    .map((r) => `${r.fullName} (${tzs(r.owedAmount)})`)
    .join(', ');
  const more = warned.length > 5 ? ` na wengine ${warned.length - 5}` : '';
  return (
    `Ng'umbi Riders: Waendeshaji ${warned.length} wamechelewa siku 7+ na wameonywa kuvunjwa mkataba: ` +
    `${names}${more}. Jumla ${tzs(total)}.`
  );
}
