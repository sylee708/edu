import { applyFilters } from './filters';
import { fetchAllNotices } from './g2b';
import { anyChannelConfigured, sendNotice } from './notify';
import { addNotifications, filterUnsent, getSettings, markSent } from './store';
import type { MatchResult, NotificationRecord, Settings } from './types';

export interface CheckOutcome {
  ranAt: string;
  window: { from: string; to: string };
  fetched: number;
  matched: number;
  /** 필터는 통과했지만 이미 보낸 적 있어 건너뛴 수 */
  alreadySent: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  errors: { bizType: string; message: string; hint?: string }[];
  items: {
    id: string;
    title: string;
    url: string | null;
    matchedKeywords: string[];
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
  }[];
}

/**
 * 한 번의 "확인 주기"에 해당하는 작업.
 *   조회 → 필터 → 이미 보낸 것 제외 → 발송 → 기록
 * dryRun=true 면 발송도 기록도 하지 않고 결과만 돌려준다 (검색 확인용).
 */
export async function runCheck(
  options: { dryRun?: boolean; overrides?: Partial<Settings>; lookbackHours?: number } = {},
): Promise<CheckOutcome> {
  const { dryRun = false, overrides = {}, lookbackHours } = options;

  const base = await getSettings();
  const settings: Settings = { ...base, ...overrides };

  const now = new Date();
  const hours = lookbackHours ?? settings.lookbackHours;
  const from = new Date(now.getTime() - hours * 3600 * 1000);

  const serviceKey = process.env.G2B_SERVICE_KEY ?? '';
  const { notices, errors } = await fetchAllNotices({
    serviceKey,
    bizTypes: settings.bizTypes,
    from,
    to: now,
  });

  const { matched } = applyFilters(notices, settings, now);

  const outcome: CheckOutcome = {
    ranAt: now.toISOString(),
    window: { from: from.toISOString(), to: now.toISOString() },
    fetched: notices.length,
    matched: matched.length,
    alreadySent: 0,
    sent: 0,
    failed: 0,
    dryRun,
    errors,
    items: [],
  };

  if (dryRun) {
    outcome.items = matched.map((m) => ({
      id: m.notice.id,
      title: m.notice.title,
      url: m.notice.url,
      matchedKeywords: m.matchedKeywords,
      status: 'skipped' as const,
    }));
    return outcome;
  }

  // 이미 보낸 공고는 다시 보내지 않는다
  const unsentIds = new Set(await filterUnsent(matched.map((m) => m.notice.id)));
  const toSend = matched.filter((m) => unsentIds.has(m.notice.id));
  outcome.alreadySent = matched.length - toSend.length;

  const records: NotificationRecord[] = [];
  const succeeded: string[] = [];

  for (const m of toSend) {
    const result = await sendNotice(m);
    const record = buildRecord(m, result.channel, result.ok, result.error);
    records.push(record);

    if (result.ok) {
      succeeded.push(m.notice.id);
      outcome.sent += 1;
    } else {
      outcome.failed += 1;
    }
    outcome.items.push({
      id: m.notice.id,
      title: m.notice.title,
      url: m.notice.url,
      matchedKeywords: m.matchedKeywords,
      status: result.ok ? 'sent' : 'failed',
      error: result.error,
    });

    // 텔레그램 rate limit 여유
    if (toSend.length > 1) await new Promise((r) => setTimeout(r, 120));
  }

  // 발송 성공한 것만 "보냄" 처리 — 실패 건은 다음 주기에 재시도된다
  await markSent(succeeded);
  await addNotifications(records);

  return outcome;
}

function buildRecord(
  m: MatchResult,
  channel: string,
  ok: boolean,
  error?: string,
): NotificationRecord {
  return {
    id: `${m.notice.id}@${Date.now()}`,
    noticeId: m.notice.id,
    title: m.notice.title,
    url: m.notice.url,
    bizType: m.notice.bizType,
    matchedKeywords: m.matchedKeywords,
    price: m.notice.price ?? m.notice.budget,
    closesAt: m.notice.closesAt,
    sentAt: new Date().toISOString(),
    channel,
    ok,
    error: error ?? null,
  };
}

export function isDryRunMode(): boolean {
  return !anyChannelConfigured();
}
