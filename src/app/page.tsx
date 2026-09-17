'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDaysLeft, formatPrice, parseKeywordList } from '@/lib/filters';
import { BIZ_TYPE_LABEL, type BizType, type FavoriteRecord, type MatchResult, type NotificationRecord, type Settings } from '@/lib/types';

type Tab = 'search' | 'settings' | 'history' | 'favorites';

interface EnvInfo {
  storage: 'neon' | 'file';
  hasServiceKey: boolean;
  telegram: boolean;
  slack: boolean;
}

const BIZ_TYPES: BizType[] = ['servc', 'thng', 'cnstwk', 'frgcpt'];

function kstDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export default function Page() {
  const [tab, setTab] = useState<Tab>('search');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);

  // 폼 상태 (설정 탭)
  const [keywordsText, setKeywordsText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // 검색 결과
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{
    fetched: number;
    matchedCount: number;
    matched: MatchResult[];
    rejected: MatchResult[];
    errors: { bizType: string; message: string; hint?: string }[];
    window: { hours: number };
  } | null>(null);
  const [searchError, setSearchError] = useState<{ error: string; hint?: string } | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [lookback, setLookback] = useState(24);

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);

  const favIds = useMemo(() => new Set(favorites.map((f) => f.noticeId)), [favorites]);

  const loadSettings = useCallback(async () => {
    const r = await fetch('/api/settings').then((x) => x.json());
    if (r.ok) {
      setSettings(r.settings);
      setEnv(r.env);
      setKeywordsText(r.settings.keywords.join(', '));
      setExcludeText(r.settings.excludeKeywords.join(', '));
      setLookback(r.settings.lookbackHours);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    const r = await fetch('/api/notifications?limit=100').then((x) => x.json());
    if (r.ok) setNotifications(r.notifications);
  }, []);

  const loadFavorites = useCallback(async () => {
    const r = await fetch('/api/favorites').then((x) => x.json());
    if (r.ok) setFavorites(r.favorites);
  }, []);

  useEffect(() => {
    loadSettings();
    loadNotifications();
    loadFavorites();
  }, [loadSettings, loadNotifications, loadFavorites]);

  function patch(p: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaveMsg('');
    const body: Partial<Settings> = {
      ...settings,
      keywords: parseKeywordList(keywordsText),
      excludeKeywords: parseKeywordList(excludeText),
    };
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((x) => x.json());
    setSaving(false);
    if (r.ok) {
      setSettings(r.settings);
      setKeywordsText(r.settings.keywords.join(', '));
      setExcludeText(r.settings.excludeKeywords.join(', '));
      setSaveMsg('저장했습니다.');
      setTimeout(() => setSaveMsg(''), 2500);
    } else {
      setSaveMsg(`저장 실패: ${r.error}`);
    }
  }

  async function runSearch() {
    if (!settings) return;
    setSearching(true);
    setSearchError(null);
    setResult(null);
    const overrides: Partial<Settings> = {
      ...settings,
      keywords: parseKeywordList(keywordsText),
      excludeKeywords: parseKeywordList(excludeText),
    };
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides, lookbackHours: lookback, includeRejected: true }),
    });
    const r = await res.json();
    setSearching(false);
    if (!res.ok || r.ok === false) {
      if (r.matched) setResult(r);
      setSearchError({ error: r.error ?? r.errors?.[0]?.message ?? '알 수 없는 오류', hint: r.hint ?? r.errors?.[0]?.hint });
      if (!r.matched) return;
    }
    setResult(r);
  }

  async function runCheckNow() {
    setChecking(true);
    setCheckMsg('');
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookbackHours: lookback }),
    });
    const r = await res.json();
    setChecking(false);
    if (r.ok) {
      const o = r.outcome;
      setCheckMsg(
        `조회 ${o.fetched}건 · 매칭 ${o.matched}건 · 기발송 제외 ${o.alreadySent}건 · ` +
          `발송 ${o.sent}건${o.failed ? ` · 실패 ${o.failed}건` : ''}` +
          (env && !env.telegram && !env.slack ? ' (알림 채널 미설정 — 모의 발송)' : ''),
      );
      loadNotifications();
    } else {
      setCheckMsg(`실패: ${r.error}`);
    }
  }

  async function toggleFavorite(m: MatchResult) {
    const n = m.notice;
    if (favIds.has(n.id)) {
      const r = await fetch(`/api/favorites?noticeId=${encodeURIComponent(n.id)}`, {
        method: 'DELETE',
      }).then((x) => x.json());
      if (r.ok) setFavorites(r.favorites);
    } else {
      const r = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noticeId: n.id,
          title: n.title,
          url: n.url,
          bizType: n.bizType,
          price: n.price ?? n.budget,
          closesAt: n.closesAt,
        }),
      }).then((x) => x.json());
      if (r.ok) setFavorites(r.favorites);
    }
  }

  if (!settings) {
    return (
      <div className="wrap">
        <p className="sub">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>나라장터 입찰공고 알림봇</h1>
      </header>
      <p className="sub">
        공공데이터포털 입찰공고정보서비스를 키워드로 감시하고, 새 공고만 골라 텔레그램으로 보냅니다.
      </p>

      <div className="envbar">
        <span className={`chip ${env?.hasServiceKey ? 'ok' : 'err'}`}>
          인증키 {env?.hasServiceKey ? '설정됨' : '없음'}
        </span>
        <span className={`chip ${env?.telegram ? 'ok' : 'warn'}`}>
          텔레그램 {env?.telegram ? '연결됨' : '미설정'}
        </span>
        <span className={`chip ${env?.slack ? 'ok' : 'warn'}`}>
          슬랙 {env?.slack ? '연결됨' : '미설정'}
        </span>
        {env && !env.telegram && !env.slack && (
          <span className="chip warn">알림 채널 없음 (모의 발송)</span>
        )}
        <span className={`chip ${env?.storage === 'neon' ? 'ok' : 'warn'}`}>
          저장소 {env?.storage === 'neon' ? 'Neon' : '로컬 파일'}
        </span>
        <span className={`chip ${settings.enabled ? 'ok' : ''}`}>
          알림 {settings.enabled ? '켜짐' : '꺼짐'}
        </span>
      </div>

      <nav className="tabs" role="tablist">
        {(
          [
            ['search', '검색'],
            ['settings', '설정'],
            ['history', `알림 이력${notifications.length ? ` (${notifications.length})` : ''}`],
            ['favorites', `즐겨찾기${favorites.length ? ` (${favorites.length})` : ''}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {/* ───────────────────────── 검색 */}
      {tab === 'search' && (
        <>
          <div className="card">
            <h2>지금 검색해 보기</h2>
            <p className="hint">
              현재 설정된 키워드·필터로 실제 API 를 호출합니다. 알림은 보내지 않고 결과만 보여줍니다.
            </p>
            <div className="grid">
              <label className="field">
                <span>조회 기간 (최근 n시간)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={lookback}
                  onChange={(e) => setLookback(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>대상 업무유형</span>
                <div className="checks" style={{ paddingTop: 6 }}>
                  {BIZ_TYPES.map((t) => (
                    <label key={t} className="check">
                      <input
                        type="checkbox"
                        checked={settings.bizTypes.includes(t)}
                        onChange={(e) =>
                          patch({
                            bizTypes: e.target.checked
                              ? [...settings.bizTypes, t]
                              : settings.bizTypes.filter((x) => x !== t),
                          })
                        }
                      />
                      {BIZ_TYPE_LABEL[t]}
                    </label>
                  ))}
                </div>
              </label>
            </div>
            <div className="actions">
              <button className="btn primary" onClick={runSearch} disabled={searching}>
                {searching ? '검색 중…' : '검색 실행'}
              </button>
              <button className="btn" onClick={runCheckNow} disabled={checking}>
                {checking ? '확인 중…' : '지금 확인하고 알림 보내기'}
              </button>
              {checkMsg && <span className="status">{checkMsg}</span>}
            </div>
          </div>

          {searchError && (
            <div className="alert err">
              <strong>검색 오류</strong> — {searchError.error}
              {searchError.hint && <span className="hint">{searchError.hint}</span>}
            </div>
          )}

          {result && (
            <>
              <div className="summary">
                <div>
                  <span className="k">조회된 공고</span>
                  <span className="v">{result.fetched.toLocaleString('ko-KR')}</span>
                </div>
                <div>
                  <span className="k">키워드 매칭</span>
                  <span className="v">{result.matchedCount.toLocaleString('ko-KR')}</span>
                </div>
                <div>
                  <span className="k">조회 기간</span>
                  <span className="v">최근 {result.window.hours}h</span>
                </div>
              </div>

              {result.matched.length === 0 ? (
                <div className="empty">
                  키워드에 걸린 공고가 없습니다. 조회 기간을 늘리거나 키워드를 넓혀 보세요.
                </div>
              ) : (
                <ul className="list">
                  {result.matched.map((m) => (
                    <NoticeItem
                      key={m.notice.id}
                      m={m}
                      starred={favIds.has(m.notice.id)}
                      onStar={() => toggleFavorite(m)}
                    />
                  ))}
                </ul>
              )}

              {result.rejected.length > 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showRejected}
                      onChange={(e) => setShowRejected(e.target.checked)}
                    />
                    걸러진 공고 {result.rejected.length}건 보기 (필터 점검용)
                  </label>
                  {showRejected && (
                    <ul className="list" style={{ marginTop: 14 }}>
                      {result.rejected.slice(0, 60).map((m) => (
                        <li key={m.notice.id} className="item">
                          <p className="title" style={{ fontWeight: 400, opacity: 0.75 }}>
                            {m.notice.title}
                          </p>
                          <div className="meta">
                            <span>{BIZ_TYPE_LABEL[m.notice.bizType]}</span>
                            <span>{m.notice.noticeInstitution}</span>
                            <span style={{ color: 'var(--err)' }}>걸러짐: {m.rejectedBy}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ───────────────────────── 설정 */}
      {tab === 'settings' && (
        <>
          <div className="card">
            <h2>키워드</h2>
            <p className="hint">쉼표 또는 줄바꿈으로 구분합니다. 띄어쓰기는 무시하고 매칭합니다.</p>
            <label className="field">
              <span>포함 키워드 — 하나라도 들어 있으면 알림</span>
              <textarea
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder="교통, 수요예측, 도시계획"
              />
            </label>
            <label className="field">
              <span>제외 키워드 — 하나라도 들어 있으면 제외 (포함보다 우선)</span>
              <textarea
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                placeholder="청소, 경비, 급식"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.searchInstitution}
                onChange={(e) => patch({ searchInstitution: e.target.checked })}
              />
              공고명뿐 아니라 기관명에서도 키워드 찾기
            </label>
          </div>

          <div className="card">
            <h2>필터</h2>
            <p className="hint">비워두면 해당 조건은 적용하지 않습니다.</p>
            <div className="grid">
              <label className="field">
                <span>추정가격 하한 (만원)</span>
                <input
                  type="number"
                  min={0}
                  value={settings.minPrice === null ? '' : settings.minPrice / 10000}
                  onChange={(e) =>
                    patch({ minPrice: e.target.value === '' ? null : Number(e.target.value) * 10000 })
                  }
                  placeholder="제한 없음"
                />
              </label>
              <label className="field">
                <span>추정가격 상한 (만원)</span>
                <input
                  type="number"
                  min={0}
                  value={settings.maxPrice === null ? '' : settings.maxPrice / 10000}
                  onChange={(e) =>
                    patch({ maxPrice: e.target.value === '' ? null : Number(e.target.value) * 10000 })
                  }
                  placeholder="제한 없음"
                />
              </label>
              <label className="field">
                <span>마감까지 최소 남은 일수</span>
                <input
                  type="number"
                  min={0}
                  value={settings.minDaysLeft ?? ''}
                  onChange={(e) =>
                    patch({ minDaysLeft: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  placeholder="제한 없음"
                />
              </label>
              <label className="field">
                <span>마감까지 최대 남은 일수</span>
                <input
                  type="number"
                  min={0}
                  value={settings.maxDaysLeft ?? ''}
                  onChange={(e) =>
                    patch({ maxDaysLeft: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  placeholder="제한 없음"
                />
              </label>
            </div>
            <div className="checks" style={{ marginTop: 4 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.allowUnknownPrice}
                  onChange={(e) => patch({ allowUnknownPrice: e.target.checked })}
                />
                가격 정보가 없는 공고도 포함
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.excludeClosed}
                  onChange={(e) => patch({ excludeClosed: e.target.checked })}
                />
                이미 마감된 공고 제외
              </label>
            </div>
          </div>

          <div className="card">
            <h2>확인 주기</h2>
            <p className="hint">
              배포 후 실제 실행 간격은 <code>vercel.json</code> 의 cron 스케줄이 결정합니다. 여기 값은
              한 번 확인할 때 거슬러 올라갈 기간을 정하는 데 쓰입니다.
            </p>
            <div className="grid">
              <label className="field">
                <span>확인 주기 (분)</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={settings.intervalMinutes}
                  onChange={(e) => patch({ intervalMinutes: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>한 번에 조회할 기간 (시간)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={settings.lookbackHours}
                  onChange={(e) => patch({ lookbackHours: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              알림 켜기
            </label>
          </div>

          <div className="actions">
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? '저장 중…' : '설정 저장'}
            </button>
            {saveMsg && (
              <span className={`status ${saveMsg.startsWith('저장 실패') ? 'err' : 'ok'}`}>
                {saveMsg}
              </span>
            )}
          </div>
        </>
      )}

      {/* ───────────────────────── 알림 이력 */}
      {tab === 'history' && (
        <>
          <div className="actions" style={{ marginBottom: 16 }}>
            <button className="btn" onClick={loadNotifications}>
              새로고침
            </button>
            {env && !env.telegram && !env.slack && (
              <span className="status">
                알림 채널 미설정 상태라 <code>모의 발송</code> 으로 기록됩니다.
              </span>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="empty">아직 보낸 알림이 없습니다.</div>
          ) : (
            <ul className="list">
              {notifications.map((n) => (
                <li key={n.id} className="item">
                  <p className="title">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noreferrer">
                        {n.title}
                      </a>
                    ) : (
                      n.title
                    )}
                  </p>
                  <div className="meta">
                    <span>{BIZ_TYPE_LABEL[n.bizType]}</span>
                    <span>{formatPrice(n.price)}</span>
                    <span>마감 {kstDate(n.closesAt)}</span>
                    <span>보냄 {kstDate(n.sentAt)}</span>
                    <span
                      style={{ color: n.ok ? 'var(--ok)' : 'var(--err)' }}
                    >
                      {n.ok ? (n.channel === 'dry-run' ? '모의 발송' : '발송 성공') : `실패: ${n.error}`}
                    </span>
                  </div>
                  {n.matchedKeywords.length > 0 && (
                    <div className="kws" style={{ marginTop: 8 }}>
                      {n.matchedKeywords.map((k) => (
                        <span key={k} className="kw">
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ───────────────────────── 즐겨찾기 */}
      {tab === 'favorites' && (
        <>
          {favorites.length === 0 ? (
            <div className="empty">
              검색 결과에서 <strong>★ 즐겨찾기</strong> 를 누르면 여기에 모입니다.
            </div>
          ) : (
            <ul className="list">
              {favorites.map((f) => (
                <li key={f.noticeId} className="item">
                  <p className="title">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {f.title}
                      </a>
                    ) : (
                      f.title
                    )}
                  </p>
                  <div className="row2">
                    <div className="meta">
                      <span>{BIZ_TYPE_LABEL[f.bizType]}</span>
                      <span>{formatPrice(f.price)}</span>
                      <span>마감 {kstDate(f.closesAt)}</span>
                    </div>
                    <button
                      className="star on"
                      onClick={async () => {
                        const r = await fetch(
                          `/api/favorites?noticeId=${encodeURIComponent(f.noticeId)}`,
                          { method: 'DELETE' },
                        ).then((x) => x.json());
                        if (r.ok) setFavorites(r.favorites);
                      }}
                    >
                      ★ 해제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function NoticeItem({
  m,
  starred,
  onStar,
}: {
  m: MatchResult;
  starred: boolean;
  onStar: () => void;
}) {
  const n = m.notice;
  return (
    <li className="item">
      <p className="title">
        {n.url ? (
          <a href={n.url} target="_blank" rel="noreferrer">
            {n.title}
          </a>
        ) : (
          n.title
        )}
      </p>
      <div className="meta">
        <span>{BIZ_TYPE_LABEL[n.bizType]}</span>
        <span>{n.noticeInstitution || '—'}</span>
        <span>{formatPrice(n.price ?? n.budget)}</span>
        <span>마감 {kstDate(n.closesAt)}</span>
        <span>{formatDaysLeft(m.daysLeft)}</span>
      </div>
      <div className="row2">
        <div className="kws">
          {m.matchedKeywords.map((k) => (
            <span key={k} className="kw">
              {k}
            </span>
          ))}
        </div>
        <button className={`star ${starred ? 'on' : ''}`} onClick={onStar}>
          {starred ? '★ 즐겨찾기' : '☆ 즐겨찾기'}
        </button>
      </div>
    </li>
  );
}
