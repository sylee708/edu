import { NextResponse } from 'next/server';
import { activeBackend, getSettings, saveSettings } from '@/lib/store';
import { slackConfigured } from '@/lib/slack';
import { telegramConfigured } from '@/lib/telegram';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    ok: true,
    settings,
    env: {
      storage: activeBackend(),
      hasServiceKey: Boolean(process.env.G2B_SERVICE_KEY),
      telegram: telegramConfigured(),
      slack: slackConfigured(),
    },
  });
}

export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as Partial<Settings>;

    // 최소한의 방어
    if (patch.intervalMinutes !== undefined) {
      patch.intervalMinutes = Math.max(5, Math.min(1440, Math.round(patch.intervalMinutes)));
    }
    if (patch.lookbackHours !== undefined) {
      patch.lookbackHours = Math.max(1, Math.min(720, Math.round(patch.lookbackHours)));
    }

    const settings = await saveSettings(patch);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
