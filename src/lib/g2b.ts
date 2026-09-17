import type { BizType, Notice } from './types';
import {
  BIZ_TYPE_OPERATION,
  formatInquiryDate,
  normalizeServiceKey,
  parseKstDateTime,
  str,
  toNumber,
} from './util.ts';

export { formatInquiryDate, normalizeServiceKey, parseKstDateTime };

const DEFAULT_BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService';

export class G2BError extends Error {
  code?: string;
  hint?: string;

  constructor(message: string, code?: string, hint?: string) {
    super(message);
    this.name = 'G2BError';
    this.code = code;
    this.hint = hint;
  }
}

/** API 원본 항목 → Notice */
export function normalizeNotice(raw: Record<string, unknown>, bizType: BizType): Notice {
  const no = str(raw.bidNtceNo);
  const ord = str(raw.bidNtceOrd) || '00';
  return {
    id: `${no}-${ord}`,
    bidNtceNo: no,
    bidNtceOrd: ord,
    bizType,
    title: str(raw.bidNtceNm),
    noticeInstitution: str(raw.ntceInsttNm),
    demandInstitution: str(raw.dminsttNm),
    noticeKind: str(raw.ntceKindNm),
    contractMethod: str(raw.cntrctCnclsMthdNm),
    price: toNumber(raw.presmptPrce),
    budget: toNumber(raw.asignBdgtAmt),
    noticedAt: parseKstDateTime(raw.bidNtceDt),
    closesAt: parseKstDateTime(raw.bidClseDt),
    opensAt: parseKstDateTime(raw.opengDt),
    url: str(raw.bidNtceDtlUrl) || null,
  };
}

/** 응답 body.items 가 배열/객체/단일 어느 형태로 와도 배열로 통일 */
function extractItems(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const items = (body as Record<string, unknown>).items;
  if (!items) return [];
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  if (typeof items === 'object') {
    const inner = (items as Record<string, unknown>).item;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    if (inner && typeof inner === 'object') return [inner as Record<string, unknown>];
    return [items as Record<string, unknown>];
  }
  return [];
}

const ERROR_HINTS: Record<string, string> = {
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR:
    '인증키가 등록되지 않았습니다. 포털에서 해당 API 활용신청이 승인됐는지, 키를 정확히 복사했는지 확인하세요.',
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR:
    '일일 호출 한도를 초과했습니다. 확인 주기를 늘리거나 다음 날 다시 시도하세요.',
  SERVICE_ACCESS_DENIED_ERROR:
    '접근이 거부됐습니다. 활용신청한 API와 호출 중인 엔드포인트가 같은지 확인하세요.',
  NODATA_ERROR: '해당 기간에 조회된 공고가 없습니다.',
  APPLICATION_ERROR: '제공기관 서버 오류입니다. 잠시 후 다시 시도하세요.',
  HTTP_ERROR: '요청 파라미터 형식을 확인하세요 (조회 기간 형식은 yyyyMMddHHmm).',
};

/** JSON 이 아니라 XML 오류가 돌아오는 경우가 잦아서 별도 처리 */
function parseXmlError(text: string): { code?: string; msg?: string } {
  const code =
    text.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/)?.[1] ??
    text.match(/<resultCode>([^<]*)<\/resultCode>/)?.[1] ??
    text.match(/<errMsg>([^<]*)<\/errMsg>/)?.[1];
  const msg =
    text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)?.[1] ??
    text.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1] ??
    text.match(/<errMsg>([^<]*)<\/errMsg>/)?.[1];
  return { code, msg };
}

export interface FetchOptions {
  serviceKey: string;
  baseUrl?: string;
  bizType: BizType;
  from: Date;
  to: Date;
  pageNo?: number;
  numOfRows?: number;
  /** 공고명 부분검색어 (선택). 미지정 시 기간 전체 조회 후 앱에서 필터 */
  titleQuery?: string;
  timeoutMs?: number;
}

export interface FetchResult {
  notices: Notice[];
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  requestUrl: string;
}

export async function fetchNotices(opts: FetchOptions): Promise<FetchResult> {
  const {
    serviceKey,
    baseUrl = process.env.G2B_BASE_URL || DEFAULT_BASE,
    bizType,
    from,
    to,
    pageNo = 1,
    numOfRows = 100,
    titleQuery,
    timeoutMs = 20000,
  } = opts;

  if (!serviceKey) {
    throw new G2BError('인증키가 비어 있습니다. .env 의 G2B_SERVICE_KEY 를 확인하세요.');
  }

  const operation = BIZ_TYPE_OPERATION[bizType];
  const params = [
    `serviceKey=${normalizeServiceKey(serviceKey)}`,
    `pageNo=${pageNo}`,
    `numOfRows=${numOfRows}`,
    `type=json`,
    `inqryDiv=1`,
    `inqryBgnDt=${formatInquiryDate(from)}`,
    `inqryEndDt=${formatInquiryDate(to)}`,
  ];
  if (titleQuery) params.push(`bidNtceNm=${encodeURIComponent(titleQuery)}`);

  const requestUrl = `${baseUrl.replace(/\/$/, '')}/${operation}?${params.join('&')}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(requestUrl, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new G2BError(
      `API 서버에 연결하지 못했습니다: ${msg}`,
      'NETWORK',
      '네트워크 연결 또는 방화벽/프록시 설정을 확인하세요.',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (text.trimStart().startsWith('<')) {
    const { code, msg } = parseXmlError(text);
    throw new G2BError(
      `API 오류 응답: ${msg ?? code ?? `HTTP ${res.status}`}`,
      code,
      code ? ERROR_HINTS[code] : undefined,
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new G2BError(
      `응답을 JSON 으로 해석하지 못했습니다 (HTTP ${res.status}). 앞부분: ${text.slice(0, 200)}`,
    );
  }

  const header = json?.response?.header ?? {};
  const resultCode = str(header.resultCode);
  if (resultCode && resultCode !== '00' && resultCode !== '0') {
    const msg = str(header.resultMsg) || '알 수 없는 오류';
    throw new G2BError(`API 오류 (${resultCode}): ${msg}`, resultCode, ERROR_HINTS[msg]);
  }

  const body = json?.response?.body ?? {};
  const notices = extractItems(body)
    .map((it) => normalizeNotice(it, bizType))
    .filter((n) => n.bidNtceNo);

  return {
    notices,
    totalCount: toNumber(body.totalCount) ?? notices.length,
    pageNo: toNumber(body.pageNo) ?? pageNo,
    numOfRows: toNumber(body.numOfRows) ?? numOfRows,
    requestUrl: requestUrl.replace(/serviceKey=[^&]*/, 'serviceKey=***'),
  };
}

/** 여러 업무유형을 한 번에, 페이지도 끝까지 (상한 있음) */
export async function fetchAllNotices(opts: {
  serviceKey: string;
  baseUrl?: string;
  bizTypes: BizType[];
  from: Date;
  to: Date;
  maxPages?: number;
  numOfRows?: number;
}): Promise<{ notices: Notice[]; errors: { bizType: BizType; message: string; hint?: string }[] }> {
  const { bizTypes, maxPages = 5, numOfRows = 100, ...rest } = opts;
  const all: Notice[] = [];
  const errors: { bizType: BizType; message: string; hint?: string }[] = [];

  for (const bizType of bizTypes) {
    try {
      for (let page = 1; page <= maxPages; page++) {
        const r = await fetchNotices({ ...rest, bizType, pageNo: page, numOfRows });
        all.push(...r.notices);
        if (r.notices.length < numOfRows) break;
        if (page * numOfRows >= r.totalCount) break;
      }
    } catch (e) {
      if (e instanceof G2BError && e.code === 'NODATA_ERROR') continue;
      errors.push({
        bizType,
        message: e instanceof Error ? e.message : String(e),
        hint: e instanceof G2BError ? e.hint : undefined,
      });
    }
  }

  // 같은 공고가 중복으로 들어오는 경우 제거
  const seen = new Set<string>();
  const unique = all.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));

  return { notices: unique, errors };
}
