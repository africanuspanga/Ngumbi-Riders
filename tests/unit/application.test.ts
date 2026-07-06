import { describe, it, expect } from 'vitest';
import {
  applicationSchema,
  guarantorSchema,
} from '@/lib/validation/application';
import {
  formatApplicationReference,
  parseApplicationReference,
  isApplicationReference,
} from '@/lib/applications/reference';
import { validateFile, MAX_FILE_BYTES } from '@/lib/applications/documents';

const validGuarantor = {
  fullName: 'John Doe',
  phone: '0712345678',
  nidaNumber: '19900101123456789012',
  residentialAddress: 'Kariakoo, Dar es Salaam',
  relationship: 'Ndugu',
  occupation: 'Mfanyabiashara',
  employer: '',
};

function validApplication() {
  return {
    firstName: 'Juma',
    middleName: '',
    lastName: 'Mwinyi',
    dateOfBirth: '1995-05-20',
    gender: 'male' as const,
    primaryPhone: '0713000002',
    alternativePhone: '',
    email: '',
    region: 'Dar es Salaam',
    district: 'Ilala',
    ward: 'Upanga',
    street: 'Mtaa wa Uhuru',
    fullAddress: 'Nyumba na. 12, Upanga, Ilala',
    nidaNumber: '19950520123456789012',
    drivingLicenceNumber: 'DL-4456789',
    previousExperience: '',
    emergencyContactName: 'Asha Kileo',
    emergencyContactPhone: '0714000003',
    emergencyContactRelationship: 'Mama',
    guarantorOne: validGuarantor,
    guarantorTwo: { ...validGuarantor, fullName: 'Baraka Mushi', phone: '0715000004' },
    declarationAccepted: true as const,
    signature: 'data:image/png;base64,AAAA',
  };
}

describe('applicationSchema', () => {
  it('accepts a complete valid application', () => {
    const res = applicationSchema.safeParse(validApplication());
    expect(res.success).toBe(true);
  });

  it('normalises NIDA by stripping spaces/dashes', () => {
    const res = guarantorSchema.safeParse({
      ...validGuarantor,
      nidaNumber: '1990-0101 1234 5678 9012',
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.nidaNumber).toBe('19900101123456789012');
  });

  it('rejects applicants under 18', () => {
    const app = validApplication();
    const now = new Date();
    app.dateOfBirth = `${now.getFullYear() - 10}-01-01`;
    expect(applicationSchema.safeParse(app).success).toBe(false);
  });

  it('rejects an invalid phone', () => {
    const app = validApplication();
    app.primaryPhone = '12345';
    expect(applicationSchema.safeParse(app).success).toBe(false);
  });

  it('rejects a NIDA that is not 20 digits', () => {
    expect(guarantorSchema.safeParse({ ...validGuarantor, nidaNumber: '123' }).success).toBe(false);
  });

  it('requires the declaration to be accepted', () => {
    const app = { ...validApplication(), declarationAccepted: false };
    expect(applicationSchema.safeParse(app).success).toBe(false);
  });

  it('requires a signature data URL', () => {
    const app = { ...validApplication(), signature: 'not-an-image' };
    expect(applicationSchema.safeParse(app).success).toBe(false);
  });
});

describe('application reference', () => {
  it('formats with zero-padded sequence', () => {
    expect(formatApplicationReference(2026, 123)).toBe('NGR-APP-2026-000123');
  });
  it('parses a valid reference', () => {
    expect(parseApplicationReference('NGR-APP-2026-000123')).toEqual({
      year: 2026,
      seq: 123,
    });
  });
  it('rejects invalid references', () => {
    expect(parseApplicationReference('NGR-2026-1')).toBeNull();
    expect(isApplicationReference('NGR-APP-2026-000123')).toBe(true);
    expect(isApplicationReference('bad')).toBe(false);
  });
});

describe('validateFile', () => {
  it('accepts a small PNG', () => {
    expect(validateFile({ name: 'nida.png', type: 'image/png', size: 1000 }).ok).toBe(true);
  });
  it('accepts a PDF', () => {
    expect(validateFile({ name: 'doc.pdf', type: 'application/pdf', size: 1000 }).ok).toBe(true);
  });
  it('rejects an oversized file', () => {
    const r = validateFile({ name: 'big.jpg', type: 'image/jpeg', size: MAX_FILE_BYTES + 1 });
    expect(r).toEqual({ ok: false, reason: 'size' });
  });
  it('rejects a disallowed type', () => {
    const r = validateFile({ name: 'x.gif', type: 'image/gif', size: 10 });
    expect(r).toEqual({ ok: false, reason: 'type' });
  });
  it('rejects a mismatched extension', () => {
    const r = validateFile({ name: 'x.exe', type: 'application/pdf', size: 10 });
    expect(r).toEqual({ ok: false, reason: 'extension' });
  });
  it('rejects an empty file', () => {
    expect(validateFile({ name: 'x.png', type: 'image/png', size: 0 })).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
});
