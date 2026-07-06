import { describe, it, expect } from 'vitest';
import { manualRiderSchema } from '@/lib/riders/validation';

const base = {
  firstName: 'Juma',
  lastName: 'Mwinyi',
  phone: '0712345678',
  tempPin: '4827',
};

describe('manualRiderSchema', () => {
  it('accepts the minimal required fields', () => {
    expect(manualRiderSchema.safeParse(base).success).toBe(true);
  });

  it('requires a 4-digit temp PIN', () => {
    expect(manualRiderSchema.safeParse({ ...base, tempPin: '12' }).success).toBe(false);
    expect(manualRiderSchema.safeParse({ ...base, tempPin: 'abcd' }).success).toBe(false);
  });

  it('rejects an invalid phone', () => {
    expect(manualRiderSchema.safeParse({ ...base, phone: '123' }).success).toBe(false);
  });

  it('allows optional NIDA but validates 20 digits when present', () => {
    expect(manualRiderSchema.safeParse({ ...base, nidaNumber: '' }).success).toBe(true);
    expect(manualRiderSchema.safeParse({ ...base, nidaNumber: '123' }).success).toBe(false);
    const ok = manualRiderSchema.safeParse({ ...base, nidaNumber: '1990-0101 1234 5678 9012' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.nidaNumber).toBe('19900101123456789012');
  });

  it('allows an optional motorcycle assignment', () => {
    const res = manualRiderSchema.safeParse({
      ...base,
      motorcycleId: '11111111-1111-4111-8111-111111111111',
      assignmentStartDate: '2026-07-01',
    });
    expect(res.success).toBe(true);
  });
});
