import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './defaults';
import type { FavoriteRecord, NotificationRecord, Settings } from './types';

/**
 * 저장소는 두 가지 백엔드를 갖는다.
 *  - DATABASE_URL 이 있으면  → Neon (Postgres)
 *  - 없으면                  → 로컬 .data/store.json
 *
 * 덕분에 Neon 연결 전에도 로컬에서 그대로 동작하고,
 * 나중에 환경변수만 채우면 코드 수정 없이 DB 로 넘어간다.
 */

export type Backend = 'neon' | 'file';

export function activeBackend(): Backend {
  return process.env.DATABASE_URL ? 'neon' : 'file';
}

interface StoreShape {
  settings: Settings;
  sent: Record<string, string>; // noticeId -> sentAt ISO
  notifications: NotificationRecord[];
  favorites: FavoriteRecord[];
}

const EMPTY: StoreShape = {
  settings: DEFAULT_SETTINGS,
  sent: {},
  notifications: [],
  favorites: [],
};

// ─────────────────────────────────────────────── 파일 백엔드
const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

async function readFileStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      sent: parsed.sent ?? {},
      notifications: parsed.notifications ?? [],
      favorites: parsed.favorites ?? [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function writeFileStore(s: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(s, null, 2), 'utf8');
}

// ─────────────────────────────────────────────── Neon 백엔드
type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, any>[]>;
let sqlClient: SqlFn | null = null;
let schemaReady = false;

async function sql(): Promise<SqlFn> {
  if (!sqlClient) {
    const { neon } = await import('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL!) as unknown as SqlFn;
  }
  return sqlClient;
}

export async function ensureSchema(): Promise<void> {
  if (activeBackend() !== 'neon' || schemaReady) return;
  const q = await sql();
  await q`CREATE TABLE IF NOT EXISTS app_settings (
    id INT PRIMARY KEY DEFAULT 1,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT settings_single_row CHECK (id = 1)
  )`;
  await q`CREATE TABLE IF NOT EXISTS sent_notices (
    notice_id TEXT PRIMARY KEY,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    notice_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    biz_type TEXT NOT NULL,
    matched_keywords TEXT[] NOT NULL DEFAULT '{}',
    price BIGINT,
    closes_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    channel TEXT NOT NULL,
    ok BOOLEAN NOT NULL DEFAULT true,
    error TEXT
  )`;
  await q`CREATE INDEX IF NOT EXISTS notifications_sent_at_idx ON notifications (sent_at DESC)`;
  await q`CREATE TABLE IF NOT EXISTS favorites (
    notice_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT,
    biz_type TEXT NOT NULL,
    price BIGINT,
    closes_at TIMESTAMPTZ,
    memo TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  schemaReady = true;
}

// ─────────────────────────────────────────────── 공개 API
export async function getSettings(): Promise<Settings> {
  if (activeBackend() === 'file') return (await readFileStore()).settings;
  await ensureSchema();
  const q = await sql();
  const rows = await q`SELECT data FROM app_settings WHERE id = 1`;
  if (!rows.length) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(rows[0].data as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };

  if (activeBackend() === 'file') {
    const s = await readFileStore();
    s.settings = next;
    await writeFileStore(s);
    return next;
  }
  await ensureSchema();
  const q = await sql();
  await q`INSERT INTO app_settings (id, data, updated_at)
          VALUES (1, ${JSON.stringify(next)}::jsonb, now())
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  return next;
}

/** 이미 보낸 공고 id 집합 (중복 발송 방지의 핵심) */
export async function filterUnsent(noticeIds: string[]): Promise<string[]> {
  if (noticeIds.length === 0) return [];
  if (activeBackend() === 'file') {
    const s = await readFileStore();
    return noticeIds.filter((id) => !(id in s.sent));
  }
  await ensureSchema();
  const q = await sql();
  const rows = await q`SELECT notice_id FROM sent_notices WHERE notice_id = ANY(${noticeIds})`;
  const sent = new Set(rows.map((r) => r.notice_id as string));
  return noticeIds.filter((id) => !sent.has(id));
}

export async function markSent(noticeIds: string[]): Promise<void> {
  if (noticeIds.length === 0) return;
  if (activeBackend() === 'file') {
    const s = await readFileStore();
    const now = new Date().toISOString();
    for (const id of noticeIds) s.sent[id] = now;
    await writeFileStore(s);
    return;
  }
  await ensureSchema();
  const q = await sql();
  await q`INSERT INTO sent_notices (notice_id)
          SELECT unnest(${noticeIds}::text[])
          ON CONFLICT (notice_id) DO NOTHING`;
}

export async function addNotifications(records: NotificationRecord[]): Promise<void> {
  if (records.length === 0) return;
  if (activeBackend() === 'file') {
    const s = await readFileStore();
    s.notifications = [...records, ...s.notifications].slice(0, 500);
    await writeFileStore(s);
    return;
  }
  await ensureSchema();
  const q = await sql();
  for (const r of records) {
    await q`INSERT INTO notifications
      (id, notice_id, title, url, biz_type, matched_keywords, price, closes_at, sent_at, channel, ok, error)
      VALUES (${r.id}, ${r.noticeId}, ${r.title}, ${r.url}, ${r.bizType},
              ${r.matchedKeywords}, ${r.price}, ${r.closesAt}, ${r.sentAt},
              ${r.channel}, ${r.ok}, ${r.error ?? null})
      ON CONFLICT (id) DO NOTHING`;
  }
}

export async function listNotifications(limit = 50): Promise<NotificationRecord[]> {
  if (activeBackend() === 'file') {
    return (await readFileStore()).notifications.slice(0, limit);
  }
  await ensureSchema();
  const q = await sql();
  const rows = await q`SELECT * FROM notifications ORDER BY sent_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    noticeId: r.notice_id,
    title: r.title,
    url: r.url,
    bizType: r.biz_type,
    matchedKeywords: r.matched_keywords ?? [],
    price: r.price === null ? null : Number(r.price),
    closesAt: r.closes_at ? new Date(r.closes_at).toISOString() : null,
    sentAt: new Date(r.sent_at).toISOString(),
    channel: r.channel,
    ok: r.ok,
    error: r.error,
  }));
}

export async function listFavorites(): Promise<FavoriteRecord[]> {
  if (activeBackend() === 'file') {
    return (await readFileStore()).favorites;
  }
  await ensureSchema();
  const q = await sql();
  const rows = await q`SELECT * FROM favorites ORDER BY created_at DESC`;
  return rows.map((r) => ({
    noticeId: r.notice_id,
    title: r.title,
    url: r.url,
    bizType: r.biz_type,
    price: r.price === null ? null : Number(r.price),
    closesAt: r.closes_at ? new Date(r.closes_at).toISOString() : null,
    memo: r.memo ?? '',
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addFavorite(fav: FavoriteRecord): Promise<void> {
  if (activeBackend() === 'file') {
    const s = await readFileStore();
    s.favorites = [fav, ...s.favorites.filter((f) => f.noticeId !== fav.noticeId)];
    await writeFileStore(s);
    return;
  }
  await ensureSchema();
  const q = await sql();
  await q`INSERT INTO favorites (notice_id, title, url, biz_type, price, closes_at, memo)
          VALUES (${fav.noticeId}, ${fav.title}, ${fav.url}, ${fav.bizType},
                  ${fav.price}, ${fav.closesAt}, ${fav.memo})
          ON CONFLICT (notice_id) DO UPDATE SET memo = EXCLUDED.memo`;
}

export async function removeFavorite(noticeId: string): Promise<void> {
  if (activeBackend() === 'file') {
    const s = await readFileStore();
    s.favorites = s.favorites.filter((f) => f.noticeId !== noticeId);
    await writeFileStore(s);
    return;
  }
  await ensureSchema();
  const q = await sql();
  await q`DELETE FROM favorites WHERE notice_id = ${noticeId}`;
}
