import { formatDaysLeft, formatPrice } from './filters';
import { BIZ_TYPE_LABEL, type MatchResult } from './types';

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildMessage(r: MatchResult): string {
  const n = r.notice;
  const lines = [
    `🔔 <b>${escapeHtml(n.title)}</b>`,
    '',
    `· 구분: ${BIZ_TYPE_LABEL[n.bizType]}${n.noticeKind ? ` (${escapeHtml(n.noticeKind)})` : ''}`,
    `· 공고기관: ${escapeHtml(n.noticeInstitution || '—')}`,
  ];
  if (n.demandInstitution && n.demandInstitution !== n.noticeInstitution) {
    lines.push(`· 수요기관: ${escapeHtml(n.demandInstitution)}`);
  }
  lines.push(`· 추정가격: ${formatPrice(n.price ?? n.budget)}`);
  if (n.closesAt) {
    const kst = new Date(new Date(n.closesAt).getTime() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
    lines.push(`· 마감: ${kst} (${formatDaysLeft(r.daysLeft)})`);
  }
  if (r.matchedKeywords.length) {
    lines.push(`· 키워드: ${r.matchedKeywords.map(escapeHtml).join(', ')}`);
  }
  if (n.url) {
    lines.push('', `<a href="${escapeHtml(n.url)}">공고 상세 보기</a>`);
  }
  return lines.join('\n');
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** 토큰/챗ID 가 설정된 경우에만 호출한다 (미설정 시 판단은 notify.ts 가 담당) */
export async function sendTelegram(r: MatchResult): Promise<SendResult> {
  const text = buildMessage(r);
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
