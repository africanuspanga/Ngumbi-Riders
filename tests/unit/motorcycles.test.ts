import { describe, it, expect } from 'vitest';
import {
  normalizeRegistration,
  motorcycleSchema,
} from '@/lib/motorcycles/validation';

describe('normalizeRegistration', () => {
  it('upper-cases and collapses whitespace', () => {
    expect(normalizeRegistration('  mc123  abc ')).toBe('MC123 ABC');
    expect(normalizeRegistration('t 456 def')).toBe('T 456 DEF');
  });
});

describe('motorcycleSchema', () => {
  it('accepts and normalises a valid motorcycle', () => {
    const res = motorcycleSchema.safeParse({
      motorcycleNumber: 'ngr-m-0001',
      registrationNumber: 'mc 123 abc',
      make: 'Bajaj',
      model: 'Boxer',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.registrationNumber).toBe('MC 123 ABC');
      expect(res.data.motorcycleNumber).toBe('NGR-M-0001');
    }
  });

  it('requires number and registration', () => {
    expect(motorcycleSchema.safeParse({ motorcycleNumber: '', registrationNumber: '' }).success).toBe(false);
  });
});
