import { NextResponse } from 'next/server';
import { listNotifications } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
  const notifications = await listNotifications(Math.min(Math.max(limit, 1), 200));
  return NextResponse.json({ ok: true, notifications });
}
