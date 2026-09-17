import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFilters,
  daysUntil,
  formatPrice,
  matchNotice,
  parseKeywordList,
} from '../src/lib/filters.ts';
import { parseKstDateTime, normalizeServiceKey, formatInquiryDate } from '../src/lib/util.ts';

const NOW = new Date('2026-09-17T00:00:00.000Z');

function notice(over = {}) {
  return {
    id: 'A-00',
    bidNtceNo: 'A',
    bidNtceOrd: '00',
    bizType: 'servc',
    title: '2026년 도시부 교통수요예측 연구용역',
    noticeInstitution: '한국교통연구원',
    demandInstitution: '국토교통부',
    noticeKind: '일반',
    contractMethod: '일반경쟁',
    price: 200_000_000,
    budget: null,
    noticedAt: '2026-09-16T00:00:00.000Z',
    closesAt: '2026-09-27T00:00:00.000Z', // 10일 뒤
    opensAt: null,
    url: 'https://example.test/a',
    ...over,
  };
}

const base = {
  keywords: ['교통'],
  excludeKeywords: [],
  bizTypes: ['servc'],
  minPrice: null,
  maxPrice: null,
  allowUnknownPrice: true,
  maxDaysLeft: null,
  minDaysLeft: null,
  excludeClosed: true,
  searchInstitution: false,
};

test('키워드가 들어 있으면 통과한다', () => {
  const r = matchNotice(notice(), base, NOW);
  assert.equal(r.matched, true);
  assert.deepEqual(r.matchedKeywords, ['교통']);
});

test('띄어쓰기가 달라도 매칭된다', () => {
  const r = matchNotice(notice({ title: '교통 수요 예측 용역' }), { ...base, keywords: ['수요예측'] }, NOW);
  assert.equal(r.matched, true);
});

test('제외 키워드가 포함 키워드보다 우선한다', () => {
  const r = matchNotice(notice({ title: '교통시설 청소용역' }), { ...base, excludeKeywords: ['청소'] }, NOW);
  assert.equal(r.matched, false);
  assert.match(r.rejectedBy, /제외어/);
});

test('업무유형이 다르면 걸러진다', () => {
  const r = matchNotice(notice({ bizType: 'cnstwk' }), base, NOW);
  assert.equal(r.matched, false);
  assert.equal(r.rejectedBy, '업무유형');
});

test('추정가격 하한/상한이 적용된다', () => {
  assert.equal(matchNotice(notice(), { ...base, minPrice: 300_000_000 }, NOW).matched, false);
  assert.equal(matchNotice(notice(), { ...base, maxPrice: 100_000_000 }, NOW).matched, false);
  assert.equal(matchNotice(notice(), { ...base, minPrice: 100_000_000 }, NOW).matched, true);
});

test('추정가격이 없으면 배정예산으로 판정한다', () => {
  const n = notice({ price: null, budget: 50_000_000 });
  assert.equal(matchNotice(n, { ...base, maxPrice: 100_000_000 }, NOW).matched, true);
  assert.equal(matchNotice(n, { ...base, maxPrice: 10_000_000 }, NOW).matched, false);
});

test('가격 정보가 아예 없을 때 allowUnknownPrice 를 따른다', () => {
  const n = notice({ price: null, budget: null });
  assert.equal(matchNotice(n, { ...base, allowUnknownPrice: true }, NOW).matched, true);
  assert.equal(matchNotice(n, { ...base, allowUnknownPrice: false }, NOW).matched, false);
});

test('마감된 공고는 excludeClosed 로 걸러진다', () => {
  const n = notice({ closesAt: '2026-09-10T00:00:00.000Z' });
  assert.equal(matchNotice(n, base, NOW).matched, false);
  assert.equal(matchNotice(n, { ...base, excludeClosed: false }, NOW).matched, true);
});

test('마감까지 남은 일수 상·하한이 적용된다', () => {
  assert.equal(matchNotice(notice(), { ...base, maxDaysLeft: 5 }, NOW).matched, false);
  assert.equal(matchNotice(notice(), { ...base, maxDaysLeft: 15 }, NOW).matched, true);
  assert.equal(matchNotice(notice(), { ...base, minDaysLeft: 14 }, NOW).matched, false);
  assert.equal(matchNotice(notice(), { ...base, minDaysLeft: 3 }, NOW).matched, true);
});

test('기관명 검색 옵션이 동작한다', () => {
  const n = notice({ title: '데이터 구축 용역' });
  const cfg = { ...base, keywords: ['교통연구원'] };
  assert.equal(matchNotice(n, cfg, NOW).matched, false);
  assert.equal(matchNotice(n, { ...cfg, searchInstitution: true }, NOW).matched, true);
});

test('키워드가 비어 있으면 전부 통과한다', () => {
  assert.equal(matchNotice(notice({ title: '아무 공고' }), { ...base, keywords: [] }, NOW).matched, true);
});

test('applyFilters 가 통과/탈락을 나눠준다', () => {
  const { matched, rejected } = applyFilters(
    [notice(), notice({ id: 'B-00', title: '건물 청소용역' })],
    base,
    NOW,
  );
  assert.equal(matched.length, 1);
  assert.equal(rejected.length, 1);
});

test('daysUntil 계산', () => {
  assert.equal(Math.round(daysUntil('2026-09-27T00:00:00.000Z', NOW)), 10);
  assert.equal(daysUntil(null, NOW), null);
});

test('키워드 입력 파싱 (중복·공백 제거)', () => {
  assert.deepEqual(parseKeywordList(' 교통, 철도 ,,교통\n도시 '), ['교통', '철도', '도시']);
});

test('금액 포맷', () => {
  assert.equal(formatPrice(200_000_000), '2억원');
  assert.equal(formatPrice(5_000_000), '500만원');
  assert.equal(formatPrice(null), '—');
});

test('API 날짜 파싱 (KST 해석)', () => {
  assert.equal(parseKstDateTime('2026-09-17 18:00'), '2026-09-17T09:00:00.000Z');
  assert.equal(parseKstDateTime('20260917180000'), '2026-09-17T09:00:00.000Z');
  assert.equal(parseKstDateTime(''), null);
  assert.equal(parseKstDateTime('-'), null);
});

test('인증키는 이미 인코딩된 경우 다시 인코딩하지 않는다', () => {
  assert.equal(normalizeServiceKey('abc%2Bdef%3D%3D'), 'abc%2Bdef%3D%3D');
  assert.equal(normalizeServiceKey('abc+def=='), 'abc%2Bdef%3D%3D');
});

test('조회일시는 KST yyyyMMddHHmm 형식', () => {
  assert.equal(formatInquiryDate(new Date('2026-09-17T00:00:00.000Z')), '202609170900');
});
