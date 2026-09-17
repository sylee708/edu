/**
 * 실제 네트워크 없이 전체 파이프라인(HTTP 응답 → 파싱 → 필터)을 검증한다.
 * globalThis.fetch 를 갈아끼워 공공데이터포털 응답 형태를 그대로 흉내낸다.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchAllNotices, fetchNotices, G2BError } from '../src/lib/g2b.ts';
import { applyFilters } from '../src/lib/filters.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockJson(payload) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return calls;
}

const SAMPLE = {
  response: {
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: {
      pageNo: 1,
      numOfRows: 100,
      totalCount: 3,
      items: [
        {
          bidNtceNo: '20260900123',
          bidNtceOrd: '00',
          bidNtceNm: '2026년 광역버스 노선체계 개편 및 교통수요예측 연구용역',
          ntceInsttNm: '경기도청',
          dminsttNm: '경기도 교통국',
          ntceKindNm: '일반공고',
          cntrctCnclsMthdNm: '협상에의한계약',
          presmptPrce: '250000000',
          asignBdgtAmt: '275000000',
          bidNtceDt: '2026-09-16 09:00',
          bidClseDt: '2026-09-30 18:00',
          opengDt: '2026-10-01 11:00',
          bidNtceDtlUrl: 'https://www.g2b.go.kr/detail/20260900123',
        },
        {
          bidNtceNo: '20260900124',
          bidNtceOrd: '01',
          bidNtceNm: '청사 주차장 청소 용역',
          ntceInsttNm: '서울특별시',
          dminsttNm: '서울특별시',
          ntceKindNm: '재공고',
          cntrctCnclsMthdNm: '일반경쟁',
          presmptPrce: '48000000',
          bidNtceDt: '2026-09-16 10:00',
          bidClseDt: '2026-09-22 18:00',
          bidNtceDtlUrl: 'https://www.g2b.go.kr/detail/20260900124',
        },
        {
          bidNtceNo: '20260900125',
          bidNtceOrd: '00',
          bidNtceNm: '하수관로 정비공사 감리',
          ntceInsttNm: '한국환경공단',
          dminsttNm: '한국환경공단',
          presmptPrce: '',
          bidNtceDt: '2026-09-16 11:00',
          bidClseDt: '2026-09-29 18:00',
          bidNtceDtlUrl: 'https://www.g2b.go.kr/detail/20260900125',
        },
      ],
    },
  },
};

const NOW = new Date('2026-09-17T00:00:00.000Z');
const FROM = new Date('2026-09-16T00:00:00.000Z');

test('정상 응답을 파싱해 Notice 로 정규화한다', async () => {
  const calls = mockJson(SAMPLE);
  const r = await fetchNotices({
    serviceKey: 'dummy%2Bkey%3D%3D',
    bizType: 'servc',
    from: FROM,
    to: NOW,
  });

  assert.equal(r.notices.length, 3);
  assert.equal(r.totalCount, 3);

  const first = r.notices[0];
  assert.equal(first.id, '20260900123-00');
  assert.equal(first.title, '2026년 광역버스 노선체계 개편 및 교통수요예측 연구용역');
  assert.equal(first.price, 250_000_000);
  assert.equal(first.budget, 275_000_000);
  assert.equal(first.closesAt, '2026-09-30T09:00:00.000Z'); // 18:00 KST
  assert.equal(first.bizType, 'servc');

  // 빈 문자열 가격은 null
  assert.equal(r.notices[2].price, null);

  // 요청 URL 에 필수 파라미터가 모두 들어갔는지
  const url = calls[0];
  assert.match(url, /getBidPblancListInfoServc/);
  assert.match(url, /inqryDiv=1/);
  assert.match(url, /inqryBgnDt=202609160900/);
  assert.match(url, /type=json/);
  assert.match(url, /serviceKey=dummy%2Bkey%3D%3D/); // 이중 인코딩 안 됨

  // 로그에 남는 URL 에서는 키가 가려져야 한다
  assert.match(r.requestUrl, /serviceKey=\*\*\*/);
});

test('조회 → 필터 전체 흐름', async () => {
  mockJson(SAMPLE);
  const { notices } = await fetchAllNotices({
    serviceKey: 'k',
    bizTypes: ['servc'],
    from: FROM,
    to: NOW,
  });

  const { matched, rejected } = applyFilters(
    notices,
    {
      keywords: ['교통', '버스', '수요예측'],
      excludeKeywords: ['청소'],
      bizTypes: ['servc'],
      minPrice: 100_000_000,
      maxPrice: null,
      allowUnknownPrice: false,
      maxDaysLeft: null,
      minDaysLeft: 3,
      excludeClosed: true,
      searchInstitution: false,
    },
    NOW,
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0].notice.bidNtceNo, '20260900123');
  assert.deepEqual(matched[0].matchedKeywords, ['교통', '버스', '수요예측']);
  assert.equal(Math.round(matched[0].daysLeft), 13);

  const reasons = rejected.map((r) => r.rejectedBy);
  assert.ok(reasons.some((r) => r?.includes('제외어')));
  assert.ok(reasons.includes('키워드 불일치') || reasons.includes('가격정보 없음'));
});

test('인증키 오류(XML 응답)를 안내 메시지와 함께 던진다', async () => {
  globalThis.fetch = async () =>
    new Response(
      `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`,
      { status: 200 },
    );

  await assert.rejects(
    () => fetchNotices({ serviceKey: 'bad', bizType: 'servc', from: FROM, to: NOW }),
    (e) => {
      assert.ok(e instanceof G2BError);
      assert.equal(e.code, 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
      assert.match(e.hint, /활용신청/);
      return true;
    },
  );
});

test('업무유형별 오류는 전체를 중단시키지 않고 errors 로 모인다', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) return new Response('<error><errMsg>APPLICATION_ERROR</errMsg></error>', { status: 200 });
    return new Response(JSON.stringify(SAMPLE), { status: 200 });
  };

  const { notices, errors } = await fetchAllNotices({
    serviceKey: 'k',
    bizTypes: ['servc', 'thng'],
    from: FROM,
    to: NOW,
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].bizType, 'servc');
  assert.equal(notices.length, 3); // 물품 쪽은 정상 수신
});

test('같은 공고가 여러 번 와도 중복 제거된다', async () => {
  mockJson(SAMPLE);
  const { notices } = await fetchAllNotices({
    serviceKey: 'k',
    bizTypes: ['servc', 'thng'],
    from: FROM,
    to: NOW,
  });
  // servc/thng 양쪽에서 같은 3건이 오지만 id 기준으로 3건만 남는다
  assert.equal(notices.length, 3);
});

test('인증키가 없으면 호출 전에 막는다', async () => {
  await assert.rejects(
    () => fetchNotices({ serviceKey: '', bizType: 'servc', from: FROM, to: NOW }),
    /인증키가 비어 있습니다/,
  );
});
