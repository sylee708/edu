/**
 * 외부 의존성이 전혀 없는 순수 헬퍼들.
 * (단위 테스트에서 그대로 import 할 수 있도록 따로 떼어 두었다)
 */
import type { BizType } from './types';

/** 업무유형별 API 오퍼레이션 이름 */
export const BIZ_TYPE_OPERATION: Record<BizType, string> = {
  servc: 'getBidPblancListInfoServc',
  thng: 'getBidPblancListInfoThng',
  cnstwk: 'getBidPblancListInfoCnstwk',
  frgcpt: 'getBidPblancListInfoFrgcpt',
};

/**
 * 공공데이터포털 인증키는 "Encoding" 키와 "Decoding" 키 두 가지로 제공된다.
 * Encoding 키(%2B 등 포함)를 다시 encodeURIComponent 하면 %252B 가 되어 인증이 깨진다.
 * 그래서 이미 퍼센트 인코딩된 키인지 판별해서 한 번만 인코딩한다.
 */
export function normalizeServiceKey(raw: string): string {
  const key = raw.trim();
  if (/%[0-9A-Fa-f]{2}/.test(key)) return key; // 이미 인코딩된 키
  return encodeURIComponent(key);
}

/** yyyyMMddHHmm (API가 요구하는 형식, KST 기준) */
export function formatInquiryDate(d: Date): string {
  // 조회 기준 시각은 한국 시간이다. UTC 기준 서버(Vercel)에서도 맞도록 +9h 보정.
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}` +
    `${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`
  );
}

/** "2026-09-17 18:00" / "20260917180000" 등 다양한 표기를 ISO 문자열로 */
export function parseKstDateTime(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '-') return null;

  let y: number, mo: number, d: number;
  let h = 0,
    mi = 0,
    sec = 0;

  const dashed = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const packed = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/);

  if (dashed) {
    y = Number(dashed[1]);
    mo = Number(dashed[2]);
    d = Number(dashed[3]);
    h = Number(dashed[4] ?? 0);
    mi = Number(dashed[5] ?? 0);
    sec = Number(dashed[6] ?? 0);
  } else if (packed) {
    y = Number(packed[1]);
    mo = Number(packed[2]);
    d = Number(packed[3]);
    h = Number(packed[4] ?? 0);
    mi = Number(packed[5] ?? 0);
    sec = Number(packed[6] ?? 0);
  } else {
    return null;
  }

  // KST(UTC+9) 로 해석
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - 9 * 60 * 60 * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}
