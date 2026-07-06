import { describe, it, expect } from 'vitest';
import {
  allowedTransitions,
  canTransition,
  isTerminal,
  PIPELINE_STATUSES,
  STATUS_META,
} from '@/lib/applications/status';

describe('application status machine', () => {
  it('allows the normal review progression', () => {
    expect(canTransition('submitted', 'under_review')).toBe(true);
    expect(canTransition('under_review', 'verification')).toBe(true);
    expect(canTransition('verification', 'approved')).toBe(true);
    expect(canTransition('approved', 'converted_to_rider')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('submitted', 'converted_to_rider')).toBe(false);
    expect(canTransition('submitted', 'approved')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
  });

  it('treats rejected/withdrawn/converted as terminal', () => {
    expect(isTerminal('rejected')).toBe(true);
    expect(isTerminal('withdrawn')).toBe(true);
    expect(isTerminal('converted_to_rider')).toBe(true);
    expect(isTerminal('submitted')).toBe(false);
  });

  it('can reject or waitlist from any active review stage', () => {
    for (const s of ['submitted', 'under_review', 'interview', 'verification'] as const) {
      expect(allowedTransitions(s)).toContain('rejected');
      expect(allowedTransitions(s)).toContain('withdrawn');
    }
  });

  it('exposes labels for every pipeline status', () => {
    for (const s of PIPELINE_STATUSES) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
    }
  });
});
