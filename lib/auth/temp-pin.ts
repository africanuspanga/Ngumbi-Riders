import { validatePin } from './pin';

/*
 * Generate a temporary 4-digit PIN that passes the weak-PIN rules for a given
 * canonical phone (spec §7.3). Used by manual creation, application conversion
 * and bulk import. The rider must change it on first login.
 */
export function generateTempPin(canonicalPhone: string): string {
  for (let i = 0; i < 100; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (validatePin(pin, canonicalPhone).ok) return pin;
  }
  return '2907';
}
