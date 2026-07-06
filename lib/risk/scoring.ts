/*
 * Explainable, rule-based rider risk scoring (spec §20) — NOT an opaque AI
 * score. Pure and dependency-free so the rules and their reasons are unit
 * tested. Thresholds are configurable (the owner may tune them) and every
 * contributing factor is recorded as a human-readable reason.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
function escalate(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

export type RiskThresholds = {
  mediumMinOverdue: number; // 1-2 overdue -> medium
  highMinOverdue: number; // 3-6 overdue -> high
  criticalMinOverdue: number; // 7+ overdue -> critical
  highMinConsecutive: number; // two consecutive misses -> high
  significantArrears: number; // TZS -> at least high
  prolongedArrears: number; // TZS -> critical
};

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  mediumMinOverdue: 1,
  highMinOverdue: 3,
  criticalMinOverdue: 7,
  highMinConsecutive: 2,
  significantArrears: 50_000,
  prolongedArrears: 200_000,
};

export type RiskInput = {
  overdueLast30: number; // overdue obligations in the last 30 days
  consecutiveMisses: number; // trailing run of missed obligations
  arrearsAmount: number; // total outstanding arrears (TZS)
  manualOverride?: RiskLevel | null; // owner manual flag
};

export type RiskResult = { level: RiskLevel; reasons: string[] };

export function computeRisk(
  input: RiskInput,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
): RiskResult {
  const reasons: string[] = [];

  if (input.manualOverride) {
    return { level: input.manualOverride, reasons: ['Owner manual override'] };
  }

  let level: RiskLevel = 'low';

  if (input.overdueLast30 >= thresholds.criticalMinOverdue) {
    level = escalate(level, 'critical');
    reasons.push(`${input.overdueLast30} overdue obligations in the last 30 days`);
  } else if (input.overdueLast30 >= thresholds.highMinOverdue) {
    level = escalate(level, 'high');
    reasons.push(`${input.overdueLast30} overdue obligations in the last 30 days`);
  } else if (input.overdueLast30 >= thresholds.mediumMinOverdue) {
    level = escalate(level, 'medium');
    reasons.push(`${input.overdueLast30} overdue obligation(s) in the last 30 days`);
  }

  if (input.consecutiveMisses >= thresholds.highMinConsecutive) {
    level = escalate(level, 'high');
    reasons.push(`${input.consecutiveMisses} consecutive missed obligations`);
  }

  if (input.arrearsAmount >= thresholds.prolongedArrears) {
    level = escalate(level, 'critical');
    reasons.push('Prolonged / large arrears');
  } else if (input.arrearsAmount >= thresholds.significantArrears) {
    level = escalate(level, 'high');
    reasons.push('Significant arrears');
  }

  if (reasons.length === 0) reasons.push('No overdue obligations in the last 30 days');
  return { level, reasons };
}
