import { NextResponse } from 'next/server';
import { runCheck } from '@/lib/checker';
import { getSettings } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron 이 호출하는 엔드포인트.
 * vercel.json 의 schedule 에 따라 자동 실행된다 (PC 를 꺼도 동작).
 *
 * 보호: CRON_SECRET 이 설정돼 있으면
 *   - Vercel 이 붙여주는 Authorization: Bearer <CRON_SECRET> 헤더, 또는
 *   - ?secret=... 쿼리
 * 둘 중 하나가 맞아야 실행된다.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const url = new URL(req.url);
    const provided = auth?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret');
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      return NextResponse.json({ ok: true, skipped: '알림이 꺼져 있음' });
    }

    const outcome = await runCheck();
    console.log(
      `[cron] 조회 ${outcome.fetched} · 매칭 ${outcome.matched} · ` +
        `기발송 ${outcome.alreadySent} · 발송 ${outcome.sent} · 실패 ${outcome.failed}`,
    );
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[cron] 실패:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
