'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendAnnouncement, type Audience } from '@/lib/announcements/actions';

export function AnnouncementForm() {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>('all_active');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await sendAnnouncement({ audience, title, body });
      if (res.ok) {
        setMsg(`Sent to ${res.sent} rider(s).`);
        setTitle('');
        setBody('');
        router.refresh();
      } else {
        setMsg('Could not send.');
      }
    } catch {
      setMsg('Could not send (network error). Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Audience</span>
        <select className="input bg-white" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          <option value="all_active">All active riders</option>
          <option value="arrears">Riders with arrears</option>
        </select>
      </label>
      <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input min-h-24" placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <button
        type="button"
        disabled={busy || !title.trim() || !body.trim()}
        onClick={submit}
        className="self-start rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Send announcement'}
      </button>
    </div>
  );
}
