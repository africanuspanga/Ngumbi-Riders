import { describe, it, expect } from 'vitest';
import {
  normalizeRegistration,
  normalizeSerial,
  motorcycleSchema,
} from '@/lib/motorcycles/validation';

describe('normalizeRegistration', () => {
  it('upper-cases and collapses whitespace', () => {
    expect(normalizeRegistration('  mc123  abc ')).toBe('MC123 ABC');
    expect(normalizeRegistration('t 456 def')).toBe('T 456 DEF');
  });
});

describe('normalizeSerial', () => {
  it('upper-cases and strips all whitespace (chassis/engine)', () => {
    expect(normalizeSerial('md2a 15c 1234 ')).toBe('MD2A15C1234');
  });
});

describe('motorcycleSchema (#16)', () => {
  const valid = {
    chassisNumber: 'md2a15c1234',
    engineNumber: 'ojea1234',
    colour: 'Red',
    make: 'Bajaj',
    model: 'Boxer',
    registrationNumber: '',
    region: 'Dar es Salaam',
    district: 'Kinondoni',
  };

  it('accepts a motorcycle with NO registration number (#16 optional)', () => {
    const res = motorcycleSchema.safeParse(valid);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.chassisNumber).toBe('MD2A15C1234');
      expect(res.data.registrationNumber).toBe('');
    }
  });

  it('requires chassis, engine, colour, make and model', () => {
    for (const field of ['chassisNumber', 'engineNumber', 'colour', 'make', 'model'] as const) {
      expect(motorcycleSchema.safeParse({ ...valid, [field]: '' }).success).toBe(false);
    }
  });

  it('rejects a district that is not in the chosen region', () => {
    expect(motorcycleSchema.safeParse({ ...valid, region: 'Dar es Salaam', district: 'Moshi' }).success).toBe(false);
  });

  it('allows region/district to be omitted (code falls back)', () => {
    expect(motorcycleSchema.safeParse({ ...valid, region: '', district: '' }).success).toBe(true);
  });
});
