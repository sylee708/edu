import type { Settings } from './types';

/** 교통·도시공학 연구용역 기본 키워드 */
export const DEFAULT_KEYWORDS = [
  '교통',
  '통행',
  '수요예측',
  '교통량',
  '도로',
  '철도',
  '대중교통',
  '버스',
  '물류',
  '모빌리티',
  '자율주행',
  '도시계획',
  '국토',
  '공간정보',
  '교통안전',
  '보행',
  '주차',
];

/** 이름만 비슷하고 연구와 무관한 공고를 걸러내는 기본 제외어 */
export const DEFAULT_EXCLUDE_KEYWORDS = [
  '청소',
  '경비',
  '급식',
  '제설',
  '식당',
  '조경',
  '방역',
  '유니폼',
  '차량임차',
  '보험',
];

export const DEFAULT_SETTINGS: Settings = {
  keywords: DEFAULT_KEYWORDS,
  excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
  bizTypes: ['servc', 'thng'],
  minPrice: null,
  maxPrice: null,
  allowUnknownPrice: true,
  maxDaysLeft: null,
  minDaysLeft: null,
  excludeClosed: true,
  searchInstitution: false,
  intervalMinutes: 60,
  lookbackHours: 24,
  enabled: true,
};
