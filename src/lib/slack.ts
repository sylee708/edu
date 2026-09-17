import { formatDaysLeft, formatPrice } from './filters';
import { BIZ_TYPE_LABEL, type MatchResult } from './types';

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

/** Slack mrkdwn 형식 메시지 (Incoming Webhook 의 `text` 필드) */
export function buildSlackMessage(r: MatchResult): string {
  const n = r.notice;
  const lines = [
    `🔔 *${n.title}*`,
    '',
    `• 구분: ${BIZ_TYPE_LABEL[n.bizType]}${n.noticeKind ? ` (${n.noticeKind})` : ''}`,
    `• 공고기관: ${n.noticeInstitution || '—'}`,
  ];
  if (n.demandInstitution && n.demandInstitution !== n.noticeInstitution) {
    lines.push(`• 수요기관: ${n.demandInstitution}`);
  }
  lines.push(`• 추정가격: ${formatPrice(n.price ?? n.budget)}`);
  if (n.closesAt) {
    const kst = new Date(new Date(n.closesAt).getTime() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
    lines.push(`• 마감: ${kst} (${formatDaysLeft(r.daysLeft)})`);
  }
  if (r.matchedKeywords.length) {
    lines.push(`• 키워드: ${r.matchedKeywords.join(', ')}`);
  }
  if (n.url) {
    lines.push('', `<${n.url}|공고 상세 보기>`);
  }
  return lines.join('\n');
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Webhook URL 이 설정된 경우에만 호출한다 (미설정 시 판단은 notify.ts 가 담당) */
export async function sendSlack(r: MatchResult): Promise<SendResult> {
  const text = buildSlackMessage(r);
  const url = process.env.SLACK_WEBHOOK_URL!;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
    const body = await res.text();
    // Slack Incoming Webhook 은 성공 시 본문 "ok" 를 그대로 돌려준다
    if (!res.ok || body.trim() !== 'ok') {
      return { ok: false, error: body.trim() || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
