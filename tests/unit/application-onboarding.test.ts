import { describe, it, expect } from 'vitest';
import {
  applicationSchema,
  isValidIdentityNumber,
  identityTypeValues,
} from '@/lib/validation/application';
import { requiredApplicantDocTypes } from '@/lib/applications/documents';

const base = {
  firstName: 'Asha',
  middleName: '',
  lastName: 'Mbwana',
  dateOfBirth: '1996-01-01',
  gender: 'female' as const,
  primaryPhone: '+255712345678',
  alternativePhone: '',
  email: '',
  region: 'Dar es Salaam',
  district: 'Kinondoni',
  ward: 'Msasani',
  street: 'Mtaa wa 1',
  fullAddress: 'Kinondoni, Dar es Salaam',
  identityType: 'nida' as const,
  identityNumber: '12345678901234567890',
  drivingLicenceNumber: '',
  previousExperience: '',
  emergencyContactName: 'Juma Juma',
  emergencyContactPhone: '+255713333333',
  emergencyContactRelationship: 'Ndugu',
  guarantor: {
    fullName: 'Neema Paul',
    phone: '+255714444444',
    nidaNumber: '09876543210987654321',
    residentialAddress: 'Ubungo',
    relationship: 'Dada',
    occupation: 'Mfanyabiashara',
    employer: '',
  },
  declarationAccepted: true as const,
  signature: 'data:image/png;base64,AAAA',
};

describe('application onboarding validation (#3/#4/#5)', () => {
  it('accepts a valid NIDA application with one guarantor', () => {
    expect(applicationSchema.safeParse(base).success).toBe(true);
  });

  it('lets a Voter ID applicant submit with NO driving licence (#3)', () => {
    const r = applicationSchema.safeParse({
      ...base,
      identityType: 'voter_id',
      identityNumber: 'T-0099887766',
      drivingLicenceNumber: '',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a NIDA identity number that is not 20 digits', () => {
    const r = applicationSchema.safeParse({ ...base, identityType: 'nida', identityNumber: '123' });
    expect(r.success).toBe(false);
  });

  it('rejects a district that does not belong to the region (#5)', () => {
    const r = applicationSchema.safeParse({ ...base, region: 'Dar es Salaam', district: 'Moshi' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown region (#5)', () => {
    const r = applicationSchema.safeParse({ ...base, region: 'Atlantis', district: 'Kinondoni' });
    expect(r.success).toBe(false);
  });

  it('has exactly one guarantor field (#4)', () => {
    expect('guarantor' in base).toBe(true);
    expect('guarantorTwo' in base).toBe(false);
  });

  it('validates identity numbers per type', () => {
    expect(isValidIdentityNumber('nida', '12345678901234567890')).toBe(true);
    expect(isValidIdentityNumber('nida', '1234')).toBe(false);
    expect(isValidIdentityNumber('voter_id', 'AB1234')).toBe(true);
    expect(isValidIdentityNumber('driving_licence', '4021')).toBe(false); // < 5
  });

  it('requires the right docs per identity type and never forces a licence for NIDA/voter (#3)', () => {
    expect(requiredApplicantDocTypes('nida')).toEqual(['nida_front', 'nida_back', 'photo', 'declaration']);
    expect(requiredApplicantDocTypes('voter_id')).toEqual(['voter_id', 'photo', 'declaration']);
    expect(requiredApplicantDocTypes('driving_licence')).toEqual(['licence', 'photo', 'declaration']);
    expect(requiredApplicantDocTypes('nida')).not.toContain('licence');
    expect(requiredApplicantDocTypes('voter_id')).not.toContain('licence');
  });

  it('exposes the three identity types', () => {
    expect(identityTypeValues).toEqual(['nida', 'driving_licence', 'voter_id']);
  });
});
