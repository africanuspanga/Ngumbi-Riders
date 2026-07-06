import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { processOutbox } from '@/lib/messaging/outbox';

// Receipt/message outbox retry (spec §27). Delivers email; SMS/WhatsApp are
// skipped until their adapters are enabled.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await runJob('outbox', async () => processOutbox());
  return NextResponse.json(result);
}
