/** 업무유형 (나라장터 입찰공고 구분) */
export type BizType = 'servc' | 'thng' | 'cnstwk' | 'frgcpt';

export const BIZ_TYPE_LABEL: Record<BizType, string> = {
  servc: '용역',
  thng: '물품',
  cnstwk: '공사',
  frgcpt: '외자',
};

/** API 원본 응답을 앱에서 쓰기 좋게 정규화한 공고 한 건 */
export interface Notice {
  /** 공고번호-차수 (중복 판정 키) */
  id: string;
  bidNtceNo: string;
  bidNtceOrd: string;
  bizType: BizType;
  /** 공고명 */
  title: string;
  /** 공고기관 */
  noticeInstitution: string;
  /** 수요기관 */
  demandInstitution: string;
  /** 공고종류 (일반/변경/재공고 등) */
  noticeKind: string;
  /** 계약체결방법 */
  contractMethod: string;
  /** 추정가격(원). 미제공이면 null */
  price: number | null;
  /** 배정예산(원). 미제공이면 null */
  budget: number | null;
  /** 공고일시 ISO */
  noticedAt: string | null;
  /** 입찰마감일시 ISO */
  closesAt: string | null;
  /** 개찰일시 ISO */
  opensAt: string | null;
  /** 공고 상세 URL */
  url: string | null;
}

/** 필터에 걸린 결과 */
export interface MatchResult {
  notice: Notice;
  matched: boolean;
  matchedKeywords: string[];
  /** 걸러진 이유 (matched=false 일 때) */
  rejectedBy: string | null;
  /** 마감까지 남은 일수 (소수 포함). 마감일시 없으면 null */
  daysLeft: number | null;
}

export interface FilterConfig {
  /** 포함 키워드 (하나라도 걸리면 매치) */
  keywords: string[];
  /** 제외 키워드 (하나라도 걸리면 탈락) */
  excludeKeywords: string[];
  /** 검색할 업무유형 */
  bizTypes: BizType[];
  /** 추정가격 하한(원). null이면 제한 없음 */
  minPrice: number | null;
  /** 추정가격 상한(원). null이면 제한 없음 */
  maxPrice: number | null;
  /** 가격 정보가 없는 공고를 통과시킬지 */
  allowUnknownPrice: boolean;
  /** 마감까지 남은 일수 상한 (이보다 더 멀면 탈락). null이면 제한 없음 */
  maxDaysLeft: number | null;
  /** 마감까지 남은 일수 하한 (이보다 촉박하면 탈락). null이면 제한 없음 */
  minDaysLeft: number | null;
  /** 이미 마감된 공고 제외 */
  excludeClosed: boolean;
  /** 기관명에서도 키워드를 찾을지 */
  searchInstitution: boolean;
}

export interface Settings extends FilterConfig {
  /** 확인 주기 (분). Vercel Cron 스케줄과 별개로, 최소 간격 가드로 사용 */
  intervalMinutes: number;
  /** 한 번 확인할 때 거슬러 올라갈 기간 (시간) */
  lookbackHours: number;
  /** 알림 활성화 여부 */
  enabled: boolean;
}

export interface NotificationRecord {
  id: string;
  noticeId: string;
  title: string;
  url: string | null;
  bizType: BizType;
  matchedKeywords: string[];
  price: number | null;
  closesAt: string | null;
  sentAt: string;
  /** 'telegram' | 'dry-run' */
  channel: string;
  ok: boolean;
  error?: string | null;
}

export interface FavoriteRecord {
  noticeId: string;
  title: string;
  url: string | null;
  bizType: BizType;
  price: number | null;
  closesAt: string | null;
  memo: string;
  createdAt: string;
}
