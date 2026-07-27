import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { parseSubscription } from '@/lib/push-subscription';

let vapidInitialized = false;
function ensureVapid() {
  if (!vapidInitialized) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    vapidInitialized = true;
  }
}

export async function POST(req: NextRequest) {
  ensureVapid();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!rateLimit(`push-send:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { type, symbol, confidence, price, target, watch } = body as {
    type: unknown;
    symbol: unknown;
    confidence: unknown;
    price: unknown;
    target: unknown;
    watch: unknown;
  };

  if (
    (type !== 'BUY' && type !== 'SELL') ||
    typeof symbol !== 'string' ||
    symbol.length > 20 ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    (target !== null && (typeof target !== 'number' || !Number.isFinite(target))) ||
    (watch !== null && watch !== 'WATCH_BUY' && watch !== 'WATCH_SELL')
  ) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('push_subscription, trading_type, tier')
    .eq('id', user.id)
    .single();

  if (profile?.tier !== 'pro') return NextResponse.json({ ok: true });
  if (!profile?.push_subscription) return NextResponse.json({ ok: true });

  // Re-check the stored endpoint: rows written before endpoint validation
  // existed could still point anywhere.
  const subscription = parseSubscription(profile.push_subscription);
  if (!subscription) {
    await supabase
      .from('profiles')
      .update({ push_subscription: null })
      .eq('id', user.id);
    return NextResponse.json({ ok: true });
  }

  const coin = symbol.replace('USDT', '');
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let payload: string;

  if (watch !== null) {
    // WATCH alert: confidence threshold ≥ 80
    if (confidence < 80) return NextResponse.json({ ok: true });

    // Spot users: skip WATCH_SELL notifications
    if (profile.trading_type === 'spot' && watch === 'WATCH_SELL') {
      return NextResponse.json({ ok: true });
    }

    const arrow = watch === 'WATCH_BUY' ? '↑' : '↓';
    payload = JSON.stringify({
      title: `${coin} WATCH ${arrow}`,
      body: `${watch} setup forming — Confidence: ${confidence}%`,
      data: { url: '/' },
    });
  } else {
    // BUY/SELL alert
    // Spot users: skip SELL notifications
    if (profile.trading_type === 'spot' && type === 'SELL') {
      return NextResponse.json({ ok: true });
    }

    const arrow = type === 'BUY' ? '↑' : '↓';
    payload = JSON.stringify({
      title: `${coin} ${type} ${arrow}`,
      body: `Confidence: ${confidence}% · Entry: ${fmt(price)}${target ? ` · Target: ${fmt(target)}` : ''}`,
      data: { url: '/' },
    });
  }

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err: unknown) {
    // Subscription expired (410) or invalid (404) — purge it
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 410 || code === 404) {
      await supabase
        .from('profiles')
        .update({ push_subscription: null })
        .eq('id', user.id);
    }
  }

  return NextResponse.json({ ok: true });
}
