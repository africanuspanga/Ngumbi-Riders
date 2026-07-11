import { describe, it, expect } from 'vitest';
import { zodResolver } from '@hookform/resolvers/zod';
import { applicationSchema, STEP_FIELDS } from '@/lib/validation/application';

/*
 * Regression: with @hookform/resolvers v3 + zod v4 the resolver did not
 * recognise zod's error shape and RETHREW the ZodError instead of returning a
 * field-error map. Every react-hook-form `trigger()`/`handleSubmit()` then
 * rejected, so the /apply wizard's "Continue" button silently did nothing on
 * step 1 (later-step fields are always empty there, so full-schema parsing
 * always fails). These tests exercise the resolver the way the wizard does.
 */

const resolverOptions = {
  fields: {},
  shouldUseNativeValidation: false,
} as never;

const stepOneValues = {
  firstName: 'Juma',
  middleName: '',
  lastName: 'Mwinyi',
  dateOfBirth: '1995-05-20',
  gender: 'male',
} as never;

describe('zodResolver(applicationSchema)', () => {
  it('returns a field-error map (never throws) when later steps are still empty', async () => {
    const resolver = zodResolver(applicationSchema);
    const result = await resolver(stepOneValues, undefined, resolverOptions);
    expect(result.errors).toBeTruthy();
    // Step-1 fields are valid, so none of them may carry an error — this is
    // exactly what the wizard's next() checks via trigger(STEP_FIELDS[0]).
    for (const field of STEP_FIELDS[0]) {
      expect(result.errors).not.toHaveProperty(field);
    }
    // The missing later-step fields are the ones that must be flagged.
    expect(result.errors).toHaveProperty('primaryPhone');
    expect(result.errors).toHaveProperty('nidaNumber');
  });

  it('surfaces the stable i18n message key on the failing field', async () => {
    const resolver = zodResolver(applicationSchema);
    const now = new Date();
    const underage = { ...(stepOneValues as object), dateOfBirth: `${now.getFullYear() - 10}-01-01` };
    const result = await resolver(underage as never, undefined, resolverOptions);
    const dob = (result.errors as Record<string, { message?: string }>).dateOfBirth;
    expect(dob?.message).toBe('age');
  });

  it('returns no errors for a fully valid application', async () => {
    const resolver = zodResolver(applicationSchema);
    const valid = {
      ...(stepOneValues as object),
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
      guarantorOne: {
        fullName: 'John Doe',
        phone: '0712345678',
        nidaNumber: '19900101123456789012',
        residentialAddress: 'Kariakoo, Dar es Salaam',
        relationship: 'Ndugu',
        occupation: 'Mfanyabiashara',
        employer: '',
      },
      guarantorTwo: {
        fullName: 'Baraka Mushi',
        phone: '0715000004',
        nidaNumber: '19900101123456789012',
        residentialAddress: 'Kariakoo, Dar es Salaam',
        relationship: 'Ndugu',
        occupation: 'Mfanyabiashara',
        employer: '',
      },
      declarationAccepted: true,
      signature: 'data:image/png;base64,AAAA',
    };
    const result = await resolver(valid as never, undefined, resolverOptions);
    expect(result.errors).toEqual({});
  });
});
