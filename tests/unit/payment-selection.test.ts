import { describe, it, expect } from 'vitest';
import {
  outstanding,
  selectOldest,
  validateWholeAmount,
  presetOptions,
  SelectionError,
  type SelectableObligation,
} from '@/lib/payments/selection';

const ob = (id: string, dueDate: string, amountDue = 5000, status = 'overdue'): SelectableObligation => ({
  id,
  dueDate,
  amountDue,
  status,
});

// Three overdue + today (unsorted input) + a future + a paid one.
const OBS: SelectableObligation[] = [
  ob('c', '2026-07-03'),
  ob('a', '2026-07-01'),
  ob('b', '2026-07-02'),
  ob('today', '2026-07-06', 5000, 'due'),
  ob('future', '2026-07-10', 5000, 'scheduled'),
  ob('paid', '2026-06-30', 5000, 'paid'),
];

describe('outstanding', () => {
  it('filters non-outstanding and sorts oldest-first', () => {
    expect(outstanding(OBS).map((o) => o.id)).toEqual(['a', 'b', 'c', 'today', 'future']);
  });
});

describe('selectOldest', () => {
  it('picks the oldest N and sums them', () => {
    const r = selectOldest(OBS, 3);
    expect(r.obligationIds).toEqual(['a', 'b', 'c']);
    expect(r.amount).toBe(15000);
  });
  it('rejects a count larger than available', () => {
    expect(() => selectOldest(OBS, 99)).toThrow(SelectionError);
  });
  it('rejects zero / non-integer counts', () => {
    expect(() => selectOldest(OBS, 0)).toThrow(SelectionError);
    expect(() => selectOldest(OBS, 1.5)).toThrow(SelectionError);
  });
});

describe('validateWholeAmount (oldest-first, no partials)', () => {
  it('accepts an exact whole-obligation sum', () => {
    const r = validateWholeAmount(OBS, 10000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.obligationIds).toEqual(['a', 'b']);
  });
  it('rejects an amount that partially settles an obligation', () => {
    const r = validateWholeAmount(OBS, 7000); // 5000 + partial
    expect(r).toEqual({ ok: false, reason: 'partial_obligation' });
  });
  it('rejects an amount exceeding all outstanding', () => {
    const r = validateWholeAmount(OBS, 999999);
    expect(r).toEqual({ ok: false, reason: 'exceeds_outstanding' });
  });
  it('rejects zero or negative', () => {
    expect(validateWholeAmount(OBS, 0).ok).toBe(false);
    expect(validateWholeAmount(OBS, -5000).ok).toBe(false);
  });
});

describe('presetOptions', () => {
  it('offers clear-arrears and arrears+today when overdue exist', () => {
    const opts = presetOptions(OBS, '2026-07-06');
    const keys = opts.map((o) => o.key);
    expect(keys).toContain('clear_arrears');
    expect(keys).toContain('arrears_plus_today');
    const clear = opts.find((o) => o.key === 'clear_arrears')!;
    expect(clear.count).toBe(3);
    expect(clear.amount).toBe(15000);
  });

  it('offers pay-today only when there are no arrears', () => {
    const noArrears: SelectableObligation[] = [
      ob('today', '2026-07-06', 5000, 'due'),
      ob('f1', '2026-07-07', 5000, 'scheduled'),
      ob('f2', '2026-07-08', 5000, 'scheduled'),
    ];
    const opts = presetOptions(noArrears, '2026-07-06');
    expect(opts.map((o) => o.key)).toContain('pay_today');
    expect(opts.find((o) => o.key === 'pay_today')!.amount).toBe(5000);
  });
});
