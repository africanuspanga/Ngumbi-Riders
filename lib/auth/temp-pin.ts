import { randomInt } from 'node:crypto';
import { validatePin } from './pin';

/*
 * Generate a temporary 4-digit PIN that passes the weak-PIN rules for a given
 * canonical phone (spec §7.3). Used by manual creation, application conversion
 * and bulk import. The rider must change it on first login. CSPRNG — a PIN is
 * a credential, so Math.random() is not acceptable.
 */
export function generateTempPin(canonicalPhone: string): string {
  for (let i = 0; i < 100; i++) {
    const pin = String(randomInt(1000, 10000));
    if (validatePin(pin, canonicalPhone).ok) return pin;
  }
  return '2907';
}
