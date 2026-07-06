import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness probe (spec §28). Does not touch secrets or the database so it can be
// polled cheaply by uptime monitoring.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'ngumbi-riders',
    time: new Date().toISOString(),
  });
}
