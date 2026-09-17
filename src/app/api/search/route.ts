import { NextResponse } from 'next/server';
import { applyFilters } from '@/lib/filters';
import { fetchAllNotices, G2BError } from '@/lib/g2b';
import { getSettings } from '@/lib/store';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 검색 전용 (발송/저장 없음).
 * 관리 화면의 "지금 검색해 보기" 버튼이 쓴다.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      overrides?: Partial<Settings>;
      lookbackHours?: number;
      includeRejected?: boolean;
    };

    const serviceKey = process.env.G2B_SERVICE_KEY ?? '';
    if (!serviceKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'G2B_SERVICE_KEY 가 설정되지 않았습니다.',
          hint: '.env.example 를 .env 로 복사하고 공공데이터포털 인증키를 넣은 뒤 서버를 다시 시작하세요.',
        },
        { status: 400 },
      );
    }

    const saved = await getSettings();
    const settings: Settings = { ...saved, ...(body.overrides ?? {}) };
    const hours = body.lookbackHours ?? settings.lookbackHours;

    const now = new Date();
    const from = new Date(now.getTime() - hours * 3600 * 1000);

    const { notices, errors } = await fetchAllNotices({
      serviceKey,
      bizTypes: settings.bizTypes,
      from,
      to: now,
    });

    const { matched, rejected } = applyFilters(notices, settings, now);

    return NextResponse.json({
      ok: errors.length === 0,
      window: { from: from.toISOString(), to: now.toISOString(), hours },
      fetched: notices.length,
      matchedCount: matched.length,
      matched,
      rejected: body.includeRejected ? rejected.slice(0, 200) : [],
      errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const hint = e instanceof G2BError ? e.hint : undefined;
    return NextResponse.json({ ok: false, error: message, hint }, { status: 500 });
  }
}
