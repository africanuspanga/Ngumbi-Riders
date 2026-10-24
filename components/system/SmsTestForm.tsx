'use client';

import { useState, useTransition } from 'react';
import { sendTestSms } from '@/lib/messaging/actions';

const ERRORS: Record<string, string> = {
  invalid_phone: 'Enter a Tanzanian mobile number, e.g. 0753 522 155.',
  not_configured: 'SMS is not configured on this deployment (SMS_RELAY_URL / SMS_RELAY_SECRET).',
  relay_unreachable: 'The SMS relay on the VPS did not answer.',
};

/** One-click "is SMS working?" check for the owner. */
export function SmsTestForm({ defaultPhone }: { defaultPhone: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setResult(null);
          try {
            const res = await sendTestSms(phone);
            setResult(
              res.ok
                ? { ok: true, text: 'Sent. Check the phone — it should arrive from GEAFA within a minute.' }
                : { ok: false, text: ERRORS[res.error] ?? `Not sent: ${res.error}` },
            );
          } catch {
            setResult({ ok: false, text: 'Network error — nothing was sent.' });
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Send a test SMS to</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          className="min-h-10 rounded-(--radius-card) border border-border px-3"
          placeholder="0753 522 155"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-10 rounded-(--radius-card) bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send test SMS'}
      </button>
      {result && (
        <p role="status" className={`w-full text-sm font-medium ${result.ok ? 'text-paid' : 'text-overdue'}`}>
          {result.text}
        </p>
      )}
    </form>
  );
}
