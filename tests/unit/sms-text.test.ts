import { describe, it, expect } from 'vitest';
import { normalizeSmsText, toMsisdn, isGsm7, smsParts } from '@/lib/mobishastra/text';
import { parseMobishastraResponse, parseBalance } from '@/lib/mobishastra/codes';

describe('SMS text', () => {
  it('turns local Tanzanian numbers into 255 MSISDNs', () => {
    expect(toMsisdn('0753522155')).toBe('255753522155');
    expect(toMsisdn('0753 522 155')).toBe('255753522155');
    expect(toMsisdn('+255753522155')).toBe('255753522155');
    expect(toMsisdn('753522155')).toBe('255753522155');
  });

  it('folds typography that would force Unicode billing', () => {
    const out = normalizeSmsText('Ng’umbi Riders — “lipa” leo…');
    expect(out).toBe('Ng\'umbi Riders - "lipa" leo...');
    expect(isGsm7(out)).toBe(true);
  });

  it('counts billable parts like the gateway does', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('é'.repeat(10) + 'ž')).toBe(1);
  });
});

describe('Mobishastra responses', () => {
  it('only confirms success positively', () => {
    expect(parseMobishastraResponse('000').ok).toBe(true);
    expect(parseMobishastraResponse('Send Successful 12345').ok).toBe(true);
    expect(parseMobishastraResponse('No More Credits').ok).toBe(false);
    expect(parseMobishastraResponse('IP address not allowed.').ok).toBe(false);
    expect(parseMobishastraResponse('006').reason).toBe('DND number');
    expect(parseMobishastraResponse('something odd').ok).toBe(false);
    expect(parseMobishastraResponse('').ok).toBe(false);
  });

  it('reads the balance, not the dialling code', () => {
    expect(parseBalance('Tanzania (+255) = 9654,')).toBe(9654);
    expect(parseBalance('Tanzania (+255) = 10,628')).toBe(10628);
  });
});
