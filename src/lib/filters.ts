import type { FilterConfig, MatchResult, Notice } from './types';

/**
 * 한국어 공고명은 띄어쓰기가 들쭉날쭉하다.
 * ("교통 수요 예측" / "교통수요예측" / "교통수요 예측")
 * 그래서 원문과 공백제거본 양쪽에서 찾는다.
 */
function normalize(s: string): { plain: string; squished: string } {
  const plain = s.toLowerCase();
  return { plain, squished: plain.replace(/[\s ·・\-_()[\]]/g, '') };
}

function contains(haystack: { plain: string; squished: string }, needle: string): boolean {
  const n = normalize(needle);
  if (!n.plain) return false;
  return haystack.plain.includes(n.plain) || haystack.squished.includes(n.squished);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (t - now.getTime()) / DAY_MS;
}

/** 공고 한 건을 필터에 통과시켜 본다 */
export function matchNotice(
  notice: Notice,
  config: FilterConfig,
  now: Date = new Date(),
): MatchResult {
  const daysLeft = daysUntil(notice.closesAt, now);
  const fail = (rejectedBy: string): MatchResult => ({
    notice,
    matched: false,
    matchedKeywords: [],
    rejectedBy,
    daysLeft,
  });

  // 1) 업무유형
  if (config.bizTypes.length > 0 && !config.bizTypes.includes(notice.bizType)) {
    return fail('업무유형');
  }

  // 2) 검색 대상 텍스트
  const haystackSource = config.searchInstitution
    ? [notice.title, notice.noticeInstitution, notice.demandInstitution].join(' ')
    : notice.title;
  const haystack = normalize(haystackSource);

  // 3) 제외 키워드 — 하나라도 걸리면 탈락 (포함 키워드보다 우선)
  const hitExclude = config.excludeKeywords.find((k) => contains(haystack, k));
  if (hitExclude) return fail(`제외어: ${hitExclude}`);

  // 4) 포함 키워드 — 하나라도 걸리면 통과. 키워드가 비어 있으면 전부 통과
  let matchedKeywords: string[] = [];
  if (config.keywords.length > 0) {
    matchedKeywords = config.keywords.filter((k) => contains(haystack, k));
    if (matchedKeywords.length === 0) return fail('키워드 불일치');
  }

  // 5) 추정가격 (추정가격이 없으면 배정예산으로 대체)
  const amount = notice.price ?? notice.budget;
  if (amount === null) {
    if (!config.allowUnknownPrice) return fail('가격정보 없음');
  } else {
    if (config.minPrice !== null && amount < config.minPrice) return fail('추정가격 하한');
    if (config.maxPrice !== null && amount > config.maxPrice) return fail('추정가격 상한');
  }

  // 6) 마감일
  if (daysLeft !== null) {
    if (config.excludeClosed && daysLeft < 0) return fail('마감됨');
    if (config.maxDaysLeft !== null && daysLeft > config.maxDaysLeft) {
      return fail('마감일 상한');
    }
    if (config.minDaysLeft !== null && daysLeft >= 0 && daysLeft < config.minDaysLeft) {
      return fail('준비기간 부족');
    }
  }

  return { notice, matched: true, matchedKeywords, rejectedBy: null, daysLeft };
}

export function applyFilters(
  notices: Notice[],
  config: FilterConfig,
  now: Date = new Date(),
): { matched: MatchResult[]; rejected: MatchResult[] } {
  const results = notices.map((n) => matchNotice(n, config, now));
  return {
    matched: results.filter((r) => r.matched),
    rejected: results.filter((r) => !r.matched),
  };
}

/** 관리 화면에서 한 줄에 쉼표/줄바꿈으로 입력한 키워드를 배열로 */
export function parseKeywordList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export function formatPrice(v: number | null): string {
  if (v === null) return '—';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(v % 100_000_000 === 0 ? 0 : 1)}억원`;
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

export function formatDaysLeft(days: number | null): string {
  if (days === null) return '—';
  if (days < 0) return '마감';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}시간 남음`;
  return `${Math.floor(days)}일 남음`;
}
