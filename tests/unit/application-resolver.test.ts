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

  // The /apply wizard keeps the drawn signature in React state and pushes it into
  // the form; if the field is read while still unset it validates as `undefined`,
  // whose zod message is NOT one of the apply.errors.* keys, so the UI fell back
  // to the generic "invalid value" ("Thamani si sahihi") the owner saw on step 8.
  // Defaulting the field to '' makes an un-drawn signature report "required".
  describe('signature field error mapping (step 8 regression)', () => {
    const KNOWN_KEYS = new Set([
      'required', 'name', 'phone', 'nida', 'licence', 'age', 'date', 'email',
      'declaration', 'signature', 'generic',
    ]);
    const sigError = async (signature: unknown) => {
      const resolver = zodResolver(applicationSchema);
      const result = await resolver({ signature } as never, undefined, resolverOptions);
      return (result.errors as Record<string, { message?: string }>).signature?.message;
    };

    it('undefined signature yields a message that is NOT a known i18n key (the leak)', async () => {
      const message = await sigError(undefined);
      expect(message).toBeTruthy();
      expect(KNOWN_KEYS.has(message as string)).toBe(false);
    });

    it("empty-string signature reports the stable 'signature' key (\"required\")", async () => {
      expect(await sigError('')).toBe('signature');
    });

    it('a valid data URL clears the signature error', async () => {
      expect(await sigError('data:image/png;base64,AAAA')).toBeUndefined();
    });
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
