#!/usr/bin/env node
/**
 * 나라장터 입찰공고 검색 확인용 단독 스크립트
 *
 *   node scripts/test-search.mjs
 *   node scripts/test-search.mjs --days 3 --type servc,thng
 *   node scripts/test-search.mjs --keyword 교통,철도 --show-rejected
 *   node scripts/test-search.mjs --raw            # 원본 JSON 1건 출력
 *
 * 의존성 없음. .env 를 직접 읽습니다. Node 18 이상.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── .env 로딩 (아주 단순한 파서) ──────────────────────────────
function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env) || !process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}
loadEnv();

// ── 인자 파싱 ────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
const flag = (name) => argv.includes(`--${name}`);

const DAYS = Number(arg('days', '1'));
const ROWS = Number(arg('rows', '100'));
const SHOW_REJECTED = flag('show-rejected');
const RAW = flag('raw');

const BIZ = {
  servc: { label: '용역', op: 'getBidPblancListInfoServc' },
  thng: { label: '물품', op: 'getBidPblancListInfoThng' },
  cnstwk: { label: '공사', op: 'getBidPblancListInfoCnstwk' },
  frgcpt: { label: '외자', op: 'getBidPblancListInfoFrgcpt' },
};

const TYPES = arg('type', 'servc,thng')
  .split(',')
  .map((s) => s.trim())
  .filter((t) => BIZ[t]);

const DEFAULT_KEYWORDS = [
  '교통', '통행', '수요예측', '교통량', '도로', '철도', '대중교통', '버스',
  '물류', '모빌리티', '자율주행', '도시계획', '국토', '공간정보', '교통안전',
  '보행', '주차',
];
const KEYWORDS = arg('keyword', '')
  ? arg('keyword', '').split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_KEYWORDS;
const DEFAULT_EXCLUDE = [
  '청소', '경비', '급식', '제설', '식당', '조경', '방역', '유니폼', '차량임차', '보험',
];
const EXCLUDE = arg('exclude', '')
  ? arg('exclude', '').split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_EXCLUDE;

// ── 공통 유틸 (src/lib/g2b.ts 와 동일한 규칙) ────────────────
const normalizeServiceKey = (raw) =>
  /%[0-9A-Fa-f]{2}/.test(raw.trim()) ? raw.trim() : encodeURIComponent(raw.trim());

function formatInquiryDate(d) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}${p(
    kst.getUTCHours(),
  )}${p(kst.getUTCMinutes())}`;
}

function squish(s) {
  return s.toLowerCase().replace(/[\s ·・\-_()[\]]/g, '');
}
function hit(text, words) {
  const plain = text.toLowerCase();
  const sq = squish(text);
  return words.filter((w) => plain.includes(w.toLowerCase()) || sq.includes(squish(w)));
}

function money(v) {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || !n) return '—';
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ── 실행 ─────────────────────────────────────────────────────
const SERVICE_KEY = process.env.G2B_SERVICE_KEY || '';
const BASE_URL =
  process.env.G2B_BASE_URL || 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService';

if (!SERVICE_KEY) {
  console.error(C.r('\n✖ G2B_SERVICE_KEY 가 비어 있습니다.'));
  console.error('  .env.example 를 .env 로 복사한 뒤 인증키를 넣어주세요.\n');
  process.exit(1);
}

const to = new Date();
const from = new Date(to.getTime() - DAYS * 24 * 3600 * 1000);

console.log(C.b('\n나라장터 입찰공고 검색 테스트'));
console.log(C.dim('─'.repeat(70)));
console.log(`조회 기간   ${formatInquiryDate(from)} ~ ${formatInquiryDate(to)} (KST, 최근 ${DAYS}일)`);
console.log(`업무유형    ${TYPES.map((t) => BIZ[t].label).join(', ')}`);
console.log(`키워드      ${KEYWORDS.join(', ')}`);
if (EXCLUDE.length) console.log(`제외어      ${EXCLUDE.join(', ')}`);
console.log(`인증키      ${SERVICE_KEY.slice(0, 6)}…${SERVICE_KEY.slice(-4)} (${SERVICE_KEY.length}자)`);
console.log(C.dim('─'.repeat(70)));

let grandTotal = 0;
let matchedAll = [];
let anyError = false;

for (const type of TYPES) {
  const { label, op } = BIZ[type];
  const url =
    `${BASE_URL.replace(/\/$/, '')}/${op}` +
    `?serviceKey=${normalizeServiceKey(SERVICE_KEY)}` +
    `&pageNo=1&numOfRows=${ROWS}&type=json&inqryDiv=1` +
    `&inqryBgnDt=${formatInquiryDate(from)}&inqryEndDt=${formatInquiryDate(to)}`;

  process.stdout.write(`\n[${label}] 호출 중… `);

  let text;
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    text = await res.text();
    process.stdout.write(C.dim(`HTTP ${res.status} · ${Date.now() - started}ms\n`));
  } catch (e) {
    anyError = true;
    console.log(C.r(`실패: ${e.message}`));
    console.log(C.dim('  → 네트워크/방화벽 또는 프록시 설정을 확인하세요.'));
    continue;
  }

  if (text.trimStart().startsWith('<')) {
    anyError = true;
    const code =
      text.match(/<returnReasonCode>([^<]*)</)?.[1] ??
      text.match(/<resultCode>([^<]*)</)?.[1] ??
      '?';
    const msg =
      text.match(/<returnAuthMsg>([^<]*)</)?.[1] ??
      text.match(/<resultMsg>([^<]*)</)?.[1] ??
      text.match(/<errMsg>([^<]*)</)?.[1] ??
      text.slice(0, 200);
    console.log(C.r(`  ✖ XML 오류 응답  code=${code}  msg=${msg}`));
    if (code.includes('SERVICE_KEY') || msg.includes('SERVICE_KEY')) {
      console.log(C.y('  → 인증키 문제입니다. 확인할 것:'));
      console.log('     1) 공공데이터포털에서 이 API 활용신청이 "승인" 상태인지');
      console.log('     2) 승인 직후라면 반영까지 최대 1시간 정도 걸립니다');
      console.log('     3) Encoding 키를 그대로 .env 에 넣었는지 (따옴표 없이)');
    }
    continue;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    anyError = true;
    console.log(C.r(`  ✖ JSON 파싱 실패. 응답 앞부분: ${text.slice(0, 200)}`));
    continue;
  }

  const header = json?.response?.header ?? {};
  if (header.resultCode && String(header.resultCode) !== '00') {
    anyError = true;
    console.log(C.r(`  ✖ API 오류 ${header.resultCode}: ${header.resultMsg}`));
    continue;
  }

  const body = json?.response?.body ?? {};
  let items = body.items ?? [];
  if (!Array.isArray(items)) items = items.item ? [].concat(items.item) : [items];
  items = items.filter((it) => it && it.bidNtceNo);

  const total = Number(body.totalCount ?? items.length) || 0;
  grandTotal += total;
  console.log(
    C.g(`  ✔ 수신 ${items.length}건`) + C.dim(` / 기간 내 전체 ${total.toLocaleString('ko-KR')}건`),
  );

  if (RAW && items.length) {
    console.log(C.dim('\n  ── 원본 1건 ──'));
    console.log(
      JSON.stringify(items[0], null, 2)
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n'),
    );
  }

  for (const it of items) {
    const title = String(it.bidNtceNm ?? '');
    const ex = EXCLUDE.length ? hit(title, EXCLUDE) : [];
    const kw = hit(title, KEYWORDS);
    if (ex.length) {
      if (SHOW_REJECTED) console.log(C.dim(`    - [제외:${ex[0]}] ${title}`));
      continue;
    }
    if (!kw.length) {
      if (SHOW_REJECTED) console.log(C.dim(`    - [키워드X] ${title}`));
      continue;
    }
    matchedAll.push({ ...it, __label: label, __kw: kw });
  }
}

console.log('\n' + C.dim('─'.repeat(70)));
console.log(C.b(`키워드 매칭 결과: ${matchedAll.length}건`) + C.dim(` (조회 기간 전체 ${grandTotal.toLocaleString('ko-KR')}건 중)`));
console.log(C.dim('─'.repeat(70)));

for (const [i, n] of matchedAll.slice(0, 30).entries()) {
  console.log(
    `\n${C.b(String(i + 1).padStart(2))}. ${n.bidNtceNm}`,
  );
  console.log(
    `    ${C.c(`[${n.__label}]`)} ${n.ntceInsttNm ?? ''}` +
      (n.dminsttNm && n.dminsttNm !== n.ntceInsttNm ? C.dim(` / 수요: ${n.dminsttNm}`) : ''),
  );
  console.log(
    `    추정가격 ${C.y(money(n.presmptPrce ?? n.asignBdgtAmt))}` +
      `   마감 ${n.bidClseDt ?? '—'}` +
      `   ${C.dim(`매칭: ${n.__kw.join(', ')}`)}`,
  );
  if (n.bidNtceDtlUrl) console.log(C.dim(`    ${n.bidNtceDtlUrl}`));
}

if (matchedAll.length > 30) {
  console.log(C.dim(`\n… 외 ${matchedAll.length - 30}건 더`));
}

if (matchedAll.length === 0 && !anyError) {
  console.log(
    C.y('\n조회는 성공했지만 키워드에 걸린 공고가 없습니다.') +
      '\n  → --days 7 로 기간을 늘리거나, --show-rejected 로 어떤 공고가 들어왔는지 확인해 보세요.',
  );
}

console.log(anyError ? C.r('\n일부 호출이 실패했습니다.\n') : C.g('\n검색 정상 동작 확인 완료.\n'));
process.exit(anyError ? 1 : 0);
