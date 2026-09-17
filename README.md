# 나라장터 입찰공고 알림봇

공공데이터포털 **나라장터 입찰공고정보서비스**를 주기적으로 조회해서, 키워드에 걸린 새 공고만
텔레그램으로 보내는 웹앱입니다. 관리 화면에서 키워드·제외어·필터·확인 주기를 설정하고,
최근 알림과 즐겨찾기를 볼 수 있습니다.

![나라장터 입찰공고 알림봇 소개](docs/intro.gif)

```
Vercel Cron ──▶ /api/cron ──▶ 공공데이터포털 API 조회
                                 └─▶ 필터(키워드/제외어/유형/가격/마감)
                                      └─▶ 이미 보낸 공고 제외 (Neon)
                                           └─▶ 텔레그램 발송 + 이력 저장
```

---

## 1. 지금 당장: 검색이 되는지 확인하기

```bash
npm install
cp .env.example .env          # 그리고 .env 의 G2B_SERVICE_KEY 를 채우세요
npm run test:search
```

`scripts/test-search.mjs` 는 **의존성 없이 단독 실행**되는 스크립트입니다.
API 호출 → 응답 파싱 → 키워드 매칭까지 터미널에서 바로 확인할 수 있습니다.

```bash
node scripts/test-search.mjs --days 7                   # 최근 7일
node scripts/test-search.mjs --type servc               # 용역만
node scripts/test-search.mjs --keyword 교통,철도,수요예측  # 키워드 직접 지정
node scripts/test-search.mjs --show-rejected            # 걸러진 공고도 표시
node scripts/test-search.mjs --raw                      # 원본 JSON 1건 출력
```

인증키 오류가 나면 스크립트가 원인별 안내를 함께 출력합니다.

> **인증키 주의**
> 공공데이터포털은 Encoding 키와 Decoding 키를 둘 다 줍니다. `.env` 에는 **Encoding 키를
> 따옴표 없이** 그대로 넣으세요. 이미 인코딩된 키를 다시 인코딩하지 않도록 코드에서
> 처리합니다 (`src/lib/util.ts` 의 `normalizeServiceKey`).
> 활용신청 승인 직후에는 반영까지 최대 1시간 정도 걸립니다.

---

## 2. 웹앱 실행

```bash
npm run dev     # http://localhost:3000
```

관리 화면 탭 구성:

| 탭 | 내용 |
|---|---|
| **검색** | 현재 설정으로 실제 API 호출. 결과 확인 + 즐겨찾기 등록. 걸러진 공고도 이유와 함께 볼 수 있어 필터 점검에 씁니다 |
| **설정** | 포함 키워드 / 제외 키워드 / 업무유형 / 추정가격 범위 / 마감까지 남은 일수 / 확인 주기 |
| **알림 이력** | 발송된 알림 기록 (성공·실패·모의 발송) |
| **즐겨찾기** | 나중에 다시 볼 공고 보관 |

화면 상단 칩이 현재 상태를 보여줍니다 — 인증키 유무, 텔레그램 연결 여부, 저장소(Neon/로컬 파일).

### 동작 원칙

- **중복 발송 방지**: 공고번호+차수(`bidNtceNo-bidNtceOrd`)를 키로 `sent_notices` 에 기록합니다.
  발송에 **성공한 것만** 기록하므로, 실패한 공고는 다음 주기에 다시 시도합니다.
- **제외어가 포함어보다 우선**합니다. "교통시설 청소용역" 은 `교통` 에 걸려도 `청소` 때문에 제외됩니다.
- **띄어쓰기를 무시하고 매칭**합니다. `수요예측` 키워드가 "교통 수요 예측" 공고에도 걸립니다.
- 추정가격이 없는 공고는 배정예산으로 판정하고, 둘 다 없으면 `가격 정보 없는 공고도 포함` 설정을 따릅니다.

---

## 3. 알림 채널 연결 (텔레그램 / 슬랙)

텔레그램과 슬랙 중 하나만 연결해도 되고, 둘 다 연결하면 두 곳 모두로 보냅니다.
**둘 다 비어 있으면 모의 발송(dry-run)** 으로 동작합니다 — 실제로 보내지 않고 이력에만
`모의 발송` 으로 남기므로, 채널 연결 없이도 전체 흐름을 테스트할 수 있습니다.

### 텔레그램

1. 텔레그램에서 [@BotFather](https://t.me/BotFather) 에게 `/newbot` → 토큰 받기
2. 만든 봇과 대화를 시작한 뒤(아무 메시지나 보내기), 아래로 chat id 확인:
   ```bash
   curl "https://api.telegram.org/bot<토큰>/getUpdates"
   ```
   응답의 `message.chat.id` 가 chat id 입니다.
3. `.env` 에 채우기:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-...
   TELEGRAM_CHAT_ID=123456789
   ```

### 슬랙

1. [slack.com](https://slack.com) 에서 워크스페이스 가입(또는 생성)
2. [Incoming Webhooks](https://api.slack.com/messaging/webhooks) 앱을 워크스페이스에 추가하고,
   알림 받을 채널을 선택해 Webhook URL 발급 (`https://hooks.slack.com/services/...`)
3. `.env` 에 채우기:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   ```

봇 생성이나 chat id 확인 같은 절차 없이 URL 하나만 있으면 되어 텔레그램보다 간단합니다.

---

## 4. Neon 데이터베이스 연결

`DATABASE_URL` 이 비어 있으면 로컬 `.data/store.json` 에 저장하고, 채워지면 Neon 을 씁니다.
코드 수정은 필요 없습니다.

1. [neon.tech](https://neon.tech) 에서 프로젝트 생성
2. 연결 문자열 복사 (`postgresql://...?sslmode=require`)
3. `.env` 에 `DATABASE_URL=...`

테이블은 첫 호출 때 자동 생성됩니다 (`ensureSchema`).

| 테이블 | 용도 |
|---|---|
| `app_settings` | 키워드·필터·주기 설정 (JSONB 1행) |
| `sent_notices` | 보낸 공고 id — 중복 발송 방지 |
| `notifications` | 알림 이력 |
| `favorites` | 즐겨찾기 |

---

## 5. Vercel 배포 (PC 를 꺼도 자동 실행)

```bash
npm i -g vercel
vercel            # 프로젝트 연결
vercel --prod     # 배포
```

배포 후 **Project → Settings → Environment Variables** 에 다음을 등록하세요:

| 이름 | 값 |
|---|---|
| `G2B_SERVICE_KEY` | 공공데이터포털 Encoding 키 |
| `TELEGRAM_BOT_TOKEN` | 봇 토큰 (선택) |
| `TELEGRAM_CHAT_ID` | 챗 ID (선택) |
| `SLACK_WEBHOOK_URL` | 슬랙 Incoming Webhook URL (선택) |
| `DATABASE_URL` | Neon 연결 문자열 |
| `CRON_SECRET` | 임의의 긴 문자열 (크론 보호용) |

> 텔레그램/슬랙 중 최소 하나는 채워야 실제로 발송됩니다. 둘 다 비우면 배포 후에도 모의 발송으로 동작합니다.

> Vercel 의 Neon 연동(Marketplace)을 쓰면 `DATABASE_URL` 이 자동으로 주입됩니다.

### 크론 주기 바꾸기

`vercel.json` 의 스케줄을 고치고 다시 배포하면 됩니다. **시각은 UTC 기준**입니다.

```jsonc
{ "crons": [{ "path": "/api/cron", "schedule": "0 * * * *" }] }   // 매시 정각 (기본값)
```

| 원하는 주기 | schedule |
|---|---|
| 매시 정각 | `0 * * * *` |
| 6시간마다 | `0 */6 * * *` |
| 평일 한국시간 09시 | `0 0 * * 1-5` (UTC 00시 = KST 09시) |
| 평일 한국시간 09·13·17시 | `0 0,4,8 * * 1-5` |

> Hobby 플랜은 **크론이 하루 1회**로 제한되고 실행 시각도 정확히 보장되지 않습니다.
> 매시간 돌리려면 Pro 플랜이 필요합니다. 그때까지는 `0 0 * * *` 처럼 하루 1회로 두고
> `lookbackHours` 를 24~48 로 넉넉히 잡아두면 놓치는 공고가 없습니다.

크론이 잘 도는지는 Vercel 대시보드 → **Logs** 에서 `[cron] 조회 … 발송 …` 줄로 확인할 수 있고,
직접 호출해 볼 수도 있습니다:

```bash
curl "https://<배포주소>/api/cron?secret=<CRON_SECRET>"
```

---

## 6. 테스트

```bash
npm test        # 24개 — 필터 로직 + API 파싱 + 전체 파이프라인(fetch 모킹)
npm run build   # 타입체크 + 프로덕션 빌드
```

`tests/pipeline.test.mjs` 는 `fetch` 를 갈아끼워 공공데이터포털 응답 형태를 그대로 흉내 내므로,
네트워크 없이도 조회 → 파싱 → 필터 흐름 전체를 검증합니다.

---

## 7. 구조

```
src/
  lib/
    types.ts      타입 정의
    util.ts       순수 헬퍼 (인증키 인코딩, KST 날짜 파싱)
    g2b.ts        공공데이터포털 API 클라이언트 (오류 코드별 안내 포함)
    filters.ts    키워드/제외어/가격/마감일 필터 — 부수효과 없는 순수 함수
    defaults.ts   교통·도시공학 기본 키워드셋
    store.ts      저장소 (Neon ↔ 로컬 파일 자동 전환)
    telegram.ts   텔레그램 메시지 조립 + 발송
    slack.ts      슬랙 메시지 조립 + 발송 (Incoming Webhook)
    notify.ts     두 채널을 함께 관리 (둘 다 미설정 시 dry-run)
    checker.ts    한 주기 = 조회→필터→중복제외→발송→기록
  app/
    page.tsx      관리 화면
    api/
      search/     검색만 (발송 없음)
      check/      지금 확인하고 발송
      cron/       Vercel Cron 진입점
      settings/   설정 조회·저장
      notifications/  알림 이력
      favorites/  즐겨찾기
scripts/test-search.mjs   단독 검색 확인 스크립트
tests/                    단위·통합 테스트
```

### API 엔드포인트 참고

업무유형별로 오퍼레이션이 다릅니다 (`src/lib/util.ts`):

| 유형 | 오퍼레이션 |
|---|---|
| 용역 | `getBidPblancListInfoServc` |
| 물품 | `getBidPblancListInfoThng` |
| 공사 | `getBidPblancListInfoCnstwk` |
| 외자 | `getBidPblancListInfoFrgcpt` |

공공데이터포털에서 **이 4개 오퍼레이션이 포함된 API 에 활용신청**이 되어 있어야 합니다.
포털에서 안내하는 베이스 URL 이 다르면 `.env` 의 `G2B_BASE_URL` 로 바꿀 수 있습니다.
