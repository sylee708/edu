import { NextResponse } from 'next/server';
import { runCheck } from '@/lib/checker';
import { getSettings } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 관리 화면의 "지금 확인하고 알림 보내기" */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { lookbackHours?: number };
    const settings = await getSettings();
    if (!settings.enabled) {
      return NextResponse.json({ ok: false, error: '알림이 꺼져 있습니다.' }, { status: 409 });
    }
    const outcome = await runCheck({ lookbackHours: body.lookbackHours });
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
