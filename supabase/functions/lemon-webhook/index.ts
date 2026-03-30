/**
 * [LEGACY — NOT IN USE]
 *
 * This function was written for LemonSqueezy integration.
 * eodi.me has migrated to Polar (polar.sh) for payments.
 * License validation is handled locally in the desktop app.
 *
 * This file is kept for reference only. Do NOT deploy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Original: Supabase Edge Function: Lemon Squeezy Webhook Handler
 *
 * Deploy: supabase functions deploy lemon-webhook
 * URL:    https://<project>.supabase.co/functions/v1/lemon-webhook
 *
 * Handles LemonSqueezy subscription lifecycle events and syncs plan state
 * to the user_subscriptions table. The desktop app manages its own local
 * license.json via the LS Licenses API — this function is for server-side
 * subscription tracking only (audit, support, future web portal).
 *
 * Required secrets:
 *   LEMON_SQUEEZY_WEBHOOK_SECRET  — from LS Dashboard → Webhooks
 *   SUPABASE_URL                  — auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY     — auto-injected by Supabase
 *
 * Listened events (configure in LS Dashboard):
 *   subscription_created, subscription_updated, subscription_cancelled,
 *   subscription_expired, subscription_paused, subscription_resumed,
 *   subscription_payment_success, subscription_payment_failed,
 *   order_created (one-time / lifetime licenses)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Plan mapping ────────────────────────────────────────────────────────────

type Plan = 'free' | 'personal' | 'solo_biz' | 'business' | 'enterprise';

function planFromVariantName(name: string): Plan {
  const n = (name ?? '').toLowerCase();
  if (n.includes('enterprise'))            return 'enterprise';
  if (n.includes('business') && !n.includes('solo')) return 'business';
  if (n.includes('solo'))                  return 'solo_biz';
  if (n.includes('personal'))              return 'personal';
  // Any other paid variant — grant personal as minimum
  console.warn(`Unknown variant name: "${name}", defaulting to personal`);
  return 'personal';
}

// ── Webhook signature verification ─────────────────────────────────────────

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  // LemonSqueezy sends hex-encoded HMAC-SHA256
  const sigBytes = new Uint8Array(
    (signature.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)),
  );
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
}

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  const secret = Deno.env.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
  if (!secret) {
    console.error('LEMON_SQUEEZY_WEBHOOK_SECRET not set');
    return new Response('Server configuration error', { status: 500 });
  }

  const signature = req.headers.get('X-Signature') ?? '';
  const rawBody = await req.text();

  if (!signature || !(await verifySignature(rawBody, signature, secret))) {
    console.error('Webhook signature verification failed');
    return new Response('Unauthorized', { status: 401 });
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventName = (payload?.meta as Record<string, unknown>)?.event_name as string;
  const data = (payload?.data as Record<string, unknown>) ?? {};
  const attrs = (data?.attributes as Record<string, unknown>) ?? {};

  console.log(`Event: ${eventName}`);

  // Events we care about
  const SUBSCRIPTION_EVENTS = new Set([
    'subscription_created',
    'subscription_updated',
    'subscription_cancelled',
    'subscription_expired',
    'subscription_paused',
    'subscription_resumed',
    'subscription_payment_success',
    'subscription_payment_failed',
  ]);

  const isSubscriptionEvent = SUBSCRIPTION_EVENTS.has(eventName);
  const isOrderEvent = eventName === 'order_created';

  if (!isSubscriptionEvent && !isOrderEvent) {
    console.log(`Ignoring event: ${eventName}`);
    return new Response(JSON.stringify({ ignored: true, event: eventName }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Extract fields ────────────────────────────────────────────────────────
  const userEmail: string = ((attrs?.user_email as string) ?? '').toLowerCase().trim();
  if (!userEmail) {
    console.error('No user_email in payload');
    return new Response('Bad Request: missing user_email', { status: 400 });
  }

  let plan: Plan = 'personal';
  let subStatus = 'active';
  let lsSubscriptionId: string | null = null;
  let lsOrderId: string | null = null;
  let lsCustomerId: string | null = null;
  let lsVariantName: string | null = null;
  let lsProductName: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  if (isSubscriptionEvent) {
    // Subscription events: data.type === "subscriptions"
    lsSubscriptionId = String(data?.id ?? '');
    lsOrderId = String(attrs?.order_id ?? '');
    lsCustomerId = String(attrs?.customer_id ?? '');
    lsVariantName = String(attrs?.variant_name ?? '');
    lsProductName = String(attrs?.product_name ?? '');
    plan = planFromVariantName(lsVariantName);

    // Map LS status to our status
    const lsStatus = String(attrs?.status ?? 'active').toLowerCase();
    if (['cancelled', 'expired'].includes(lsStatus))   subStatus = lsStatus;
    else if (lsStatus === 'paused')                     subStatus = 'paused';
    else if (['past_due', 'unpaid'].includes(lsStatus)) subStatus = 'past_due';
    else if (lsStatus === 'on_trial')                   subStatus = 'on_trial';
    else                                                subStatus = 'active';

    // For cancellation/expiry, plan stays at what they had (for grace period UI)
    // but status signals the state
    if (['subscription_cancelled', 'subscription_expired'].includes(eventName)) {
      subStatus = eventName === 'subscription_cancelled' ? 'cancelled' : 'expired';
    }
    if (eventName === 'subscription_payment_failed') subStatus = 'past_due';
    if (eventName === 'subscription_resumed')        subStatus = 'active';

    periodStart = String(attrs?.renews_at ?? attrs?.created_at ?? '') || null;
    periodEnd   = String(attrs?.ends_at   ?? attrs?.renews_at   ?? '') || null;
  } else {
    // order_created — one-time or lifetime purchase
    lsOrderId = String(attrs?.identifier ?? data?.id ?? '');
    lsCustomerId = String(attrs?.customer_id ?? '');
    const firstItem = (attrs?.first_order_item as Record<string, unknown>) ?? {};
    lsVariantName = String(firstItem?.variant_name ?? '');
    lsProductName = String(firstItem?.product_name ?? '');
    plan = planFromVariantName(lsVariantName);
    subStatus = 'active';
    // One-time: no expiry (lifetime)
    periodEnd = null;
  }

  // ── Upsert subscription record ────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error: upsertError } = await supabase
    .from('user_subscriptions')
    .upsert(
      {
        user_email:           userEmail,
        plan,
        status:               subStatus,
        ls_subscription_id:   lsSubscriptionId || null,
        ls_order_id:          lsOrderId || null,
        ls_customer_id:       lsCustomerId || null,
        ls_variant_name:      lsVariantName || null,
        ls_product_name:      lsProductName || null,
        current_period_start: periodStart || null,
        current_period_end:   periodEnd   || null,
        updated_at:           new Date().toISOString(),
      },
      {
        onConflict: 'user_email',
        ignoreDuplicates: false,
      },
    );

  if (upsertError) {
    console.error('Upsert error:', upsertError);
    return new Response('Database error', { status: 500 });
  }

  // ── Append to event audit log ─────────────────────────────────────────────
  await supabase.from('subscription_events').insert({
    user_email:  userEmail,
    event_name:  eventName,
    plan,
    status:      subStatus,
    ls_sub_id:   lsSubscriptionId,
    ls_order_id: lsOrderId,
    raw_payload: payload,
  });

  console.log(`✅ ${eventName} → ${userEmail} | plan=${plan} status=${subStatus}`);

  // ── Trigger license email for new purchases ───────────────────────────────
  const shouldSendEmail =
    eventName === 'order_created' ||
    eventName === 'subscription_created';

  if (shouldSendEmail && subStatus === 'active') {
    const customerName = String(
      (attrs?.user_name as string) ??
      (attrs?.first_order_item as Record<string, unknown>)?.user_name ??
      '',
    );
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Fire-and-forget: don't block webhook response on email delivery
    fetch(`${supabaseUrl}/functions/v1/send-license-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id:       lsOrderId ?? '',
        customer_email: userEmail,
        customer_name:  customerName,
        plan,
      }),
    }).catch((e) => console.error('Failed to trigger license email:', e));
  }

  return new Response(
    JSON.stringify({ success: true, event: eventName, email: userEmail, plan, status: subStatus }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
