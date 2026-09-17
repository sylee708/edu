import { buildMessage as buildTelegramMessage, sendTelegram, telegramConfigured } from './telegram';
import { sendSlack, slackConfigured } from './slack';
import type { MatchResult } from './types';

/**
 * 텔레그램/슬랙 둘 다 "나중에" 연결하는 단계라서,
 * 둘 다 비어 있으면 실제로 보내지 않고 dry-run 으로 기록만 남긴다.
 * 둘 중 하나만 설정해도, 둘 다 설정해도 그대로 동작한다.
 */
export function anyChannelConfigured(): boolean {
  return telegramConfigured() || slackConfigured();
}

export interface SendResult {
  ok: boolean;
  /** 'dry-run' | 'telegram' | 'slack' | 'telegram,slack' 등 실제 발송(성공)된 채널 목록 */
  channel: string;
  error?: string;
}

export async function sendNotice(r: MatchResult): Promise<SendResult> {
  if (!anyChannelConfigured()) {
    console.log(
      '[dry-run] 텔레그램/슬랙 미설정 — 발송 대신 로그만 남깁니다\n' + buildTelegramMessage(r) + '\n',
    );
    return { ok: true, channel: 'dry-run' };
  }

  const attempts: { name: string; ok: boolean; error?: string }[] = [];

  if (telegramConfigured()) {
    const res = await sendTelegram(r);
    attempts.push({ name: 'telegram', ok: res.ok, error: res.error });
  }
  if (slackConfigured()) {
    const res = await sendSlack(r);
    attempts.push({ name: 'slack', ok: res.ok, error: res.error });
  }

  const succeeded = attempts.filter((a) => a.ok).map((a) => a.name);
  const failed = attempts.filter((a) => !a.ok);

  return {
    // 설정된 채널 중 하나라도 성공하면 "보냄" 처리 (재시도 시 중복 발송 방지)
    ok: succeeded.length > 0,
    channel: (succeeded.length > 0 ? succeeded : attempts.map((a) => a.name)).join(','),
    error: failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join('; ') : undefined,
  };
}
