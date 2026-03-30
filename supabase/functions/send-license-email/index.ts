/**
 * Supabase Edge Function: Send License Activation Email
 *
 * Called by lemon-webhook after subscription_created or order_created.
 * Fetches the license key from LemonSqueezy Licenses API and sends it
 * to the customer via Resend (transactional email).
 *
 * Deploy:
 *   supabase functions deploy send-license-email
 *
 * Required secrets:
 *   LEMON_SQUEEZY_API_KEY   — LS Dashboard → API → API Keys
 *   RESEND_API_KEY          — resend.com → API Keys
 *   FROM_EMAIL              — verified sender address (e.g. hello@eodi.me)
 *   SUPABASE_URL            — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 *
 * Can also be triggered from lemon-webhook by calling:
 *   fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-license-email`, {
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ order_id, customer_email, customer_name, plan }),
 *   });
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

interface SendEmailRequest {
  order_id: string;
  customer_email: string;
  customer_name: string;
  plan: 'personal' | 'solo_biz' | 'business' | 'enterprise';
}

// ── Fetch license key from LemonSqueezy Licenses API ────────────────────────

async function fetchLicenseKey(orderId: string): Promise<string | null> {
  const apiKey = Deno.env.get('LEMON_SQUEEZY_API_KEY');
  if (!apiKey) throw new Error('LEMON_SQUEEZY_API_KEY not set');

  const res = await fetch(
    `https://api.lemonsqueezy.com/v1/licenses?filter[order_id]=${orderId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.api+json',
      },
    },
  );

  if (!res.ok) {
    console.error('LemonSqueezy API error:', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const licenses = data?.data;
  if (!Array.isArray(licenses) || licenses.length === 0) return null;

  return licenses[0]?.attributes?.key ?? null;
}

// ── Send email via Resend ────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  personal:   'Personal',
  solo_biz:   'Solo Biz',
  business:   'Business',
  enterprise: 'Enterprise',
};

function buildEmailHtml(name: string, plan: string, licenseKey: string): string {
  const planLabel = PLAN_LABELS[plan] ?? plan;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your eodi.me ${planLabel} License Key</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8e8f0;">
  <div style="max-width:560px;margin:40px auto;padding:40px 32px;background:#16161e;border-radius:16px;border:0.5px solid rgba(255,255,255,0.1);">
    <div style="text-align:center;margin-bottom:32px;">
      <img src="https://eodi.me/images/logo.png" alt="eodi.me" width="120" style="opacity:0.9;">
    </div>
    <h1 style="font-size:22px;font-weight:600;margin:0 0 8px;color:#f0f0f8;">
      Your ${planLabel} License Key
    </h1>
    <p style="color:#8888a8;margin:0 0 28px;font-size:14px;">
      Hi ${name}, thank you for subscribing to eodi.me ${planLabel}!
    </p>

    <div style="background:#0a0a0f;border-radius:10px;padding:20px;margin-bottom:28px;text-align:center;">
      <div style="font-size:11px;color:#6060a0;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">
        Your License Key
      </div>
      <div style="font-family:'SF Mono',Menlo,monospace;font-size:18px;letter-spacing:.05em;color:#6496ff;font-weight:600;">
        ${licenseKey}
      </div>
    </div>

    <p style="color:#8888a8;font-size:13px;margin:0 0 20px;">
      To activate your license:
    </p>
    <ol style="color:#a8a8c8;font-size:13px;padding-left:20px;margin:0 0 28px;">
      <li style="margin-bottom:8px;">Open the <strong style="color:#e8e8f0;">eodi.me</strong> desktop app</li>
      <li style="margin-bottom:8px;">Click the <strong style="color:#e8e8f0;">⚙ Settings</strong> icon → <strong style="color:#e8e8f0;">License</strong> tab</li>
      <li style="margin-bottom:8px;">Paste your license key above and click <strong style="color:#e8e8f0;">Activate</strong></li>
    </ol>

    <a href="https://eodi.me/download"
       style="display:inline-block;background:#6496ff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:32px;">
      Download eodi.me
    </a>

    <hr style="border:none;border-top:0.5px solid rgba(255,255,255,0.08);margin-bottom:24px;">

    <p style="color:#50507a;font-size:12px;margin:0;">
      Questions? Reply to this email or visit
      <a href="https://eodi.me" style="color:#6496ff;">eodi.me</a>.
      Your license key is tied to this purchase — keep it safe.
    </p>
  </div>
</body>
</html>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Verify caller is internal (service role key in Authorization header)
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!authHeader.includes(serviceRoleKey) && !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: SendEmailRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { order_id, customer_email, customer_name, plan } = body;
  if (!order_id || !customer_email || !plan) {
    return new Response(JSON.stringify({ error: 'Missing required fields: order_id, customer_email, plan' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch license key from LemonSqueezy
  let licenseKey: string | null = null;
  try {
    licenseKey = await fetchLicenseKey(order_id);
  } catch (e) {
    console.error('Failed to fetch license key:', e);
    return new Response(JSON.stringify({ error: 'Failed to fetch license key from LemonSqueezy' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!licenseKey) {
    return new Response(JSON.stringify({ error: 'No license key found for order', order_id }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Send email via Resend
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'hello@eodi.me';
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not set');
    return new Response(JSON.stringify({ error: 'Email service not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const planLabel = PLAN_LABELS[plan] ?? plan;
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `eodi.me <${fromEmail}>`,
      to: [customer_email],
      subject: `Your eodi.me ${planLabel} License Key`,
      html: buildEmailHtml(customer_name || 'there', plan, licenseKey),
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error('Resend API error:', emailRes.status, errText);
    return new Response(JSON.stringify({ error: 'Failed to send email', detail: errText }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const emailData = await emailRes.json();
  console.log(`License email sent to ${customer_email} for order ${order_id} (${planLabel}), resend_id=${emailData.id}`);

  return new Response(
    JSON.stringify({ success: true, email_id: emailData.id, license_key_hint: licenseKey.slice(0, 9) + '...' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
