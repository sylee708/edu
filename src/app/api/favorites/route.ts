import { NextResponse } from 'next/server';
import { addFavorite, listFavorites, removeFavorite } from '@/lib/store';
import type { FavoriteRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, favorites: await listFavorites() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<FavoriteRecord>;
  if (!body.noticeId || !body.title) {
    return NextResponse.json({ ok: false, error: 'noticeId, title 이 필요합니다.' }, { status: 400 });
  }
  await addFavorite({
    noticeId: body.noticeId,
    title: body.title,
    url: body.url ?? null,
    bizType: body.bizType ?? 'servc',
    price: body.price ?? null,
    closesAt: body.closesAt ?? null,
    memo: body.memo ?? '',
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, favorites: await listFavorites() });
}

export async function DELETE(req: Request) {
  const noticeId = new URL(req.url).searchParams.get('noticeId');
  if (!noticeId) {
    return NextResponse.json({ ok: false, error: 'noticeId 가 필요합니다.' }, { status: 400 });
  }
  await removeFavorite(noticeId);
  return NextResponse.json({ ok: true, favorites: await listFavorites() });
}
