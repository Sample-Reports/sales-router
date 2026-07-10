// Vercel Edge Middleware — Share Link Gateway
//
// Deployed to: insights-router, prinsights-router, sales-router (identical file).
// Required Vercel env vars per project:
//   SUPABASE_URL           https://xxx.supabase.co
//   SUPABASE_SERVICE_KEY   service_role key
//   TIER                   one of: insights | prinsights | sales
//   IP_SALT                any long random string (for hashing IPs)
//
// Flow:
//   1. /s/<token> hits this middleware.
//   2. Look up (token, tier) in Supabase.
//   3. Reject if missing / revoked / expired  → branded 410 page.
//   4. Otherwise: fire-and-forget view log, then rewrite to /IMC/<category>/<slug>.
//      The router's existing vercel.json rewrites take it from there.

import { rewrite } from '@vercel/edge';

export const config = {
  matcher: '/s/:token*',
};

const CONTACT_EMAIL = 'contact@infovisionintelligence.com';

export default async function middleware(request, context) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  if (!m) return renderExpired();

  const token         = m[1];
  const tier          = env('TIER');
  const supabaseUrl   = env('SUPABASE_URL');
  const supabaseKey   = env('SUPABASE_SERVICE_KEY');

  if (!tier || !supabaseUrl || !supabaseKey) {
    console.error('[share-middleware] missing env vars');
    return renderExpired('Service temporarily unavailable.');
  }

  let share = null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/dashboard_shares` +
      `?token=eq.${encodeURIComponent(token)}` +
      `&tier=eq.${encodeURIComponent(tier)}` +
      `&select=token,category,slug,expires_at,revoked_at`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Accept: 'application/json',
        },
      },
    );
    const rows = await res.json();
    share = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.error('[share-middleware] supabase lookup failed', err);
    return renderExpired('Service temporarily unavailable.');
  }

  if (!share)                                         return renderExpired();
  if (share.revoked_at)                               return renderExpired('This link has been revoked.');
  if (new Date(share.expires_at).getTime() < Date.now()) return renderExpired();

  // Fire-and-forget view logging. Never blocks the response.
  const ipHash = await hashIp(request, env('IP_SALT') || 'default-salt-change-me');
  context.waitUntil(logView(supabaseUrl, supabaseKey, token, ipHash, request));

  // Internal rewrite. URL bar stays at /s/<token>.
  const TIER_BASE = { insights: '/IMC', prinsights: '/PR', sales: '/Sales' };
  const base = TIER_BASE[tier] || '/IMC';
  const target = new URL(url);
  target.pathname = `${base}/${share.category}/${share.slug}`;
  return rewrite(target);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function hashIp(request, salt) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const data = new TextEncoder().encode(ip + '|' + salt);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

async function logView(supabaseUrl, supabaseKey, token, ipHash, request) {
  const ua      = (request.headers.get('user-agent') || '').slice(0, 500);
  const referer = (request.headers.get('referer')    || '').slice(0, 500);

  const insertViewRow = fetch(`${supabaseUrl}/rest/v1/dashboard_share_views`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ token, ip_hash: ipHash, user_agent: ua, referer }),
  }).catch((err) => console.error('[share-middleware] view insert failed', err));

  const incrementCounter = fetch(`${supabaseUrl}/rest/v1/rpc/increment_share_view`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: token }),
  }).catch((err) => console.error('[share-middleware] increment rpc failed', err));

  await Promise.all([insertViewRow, incrementCounter]);
}

function renderExpired(customMessage) {
  const message = customMessage || "The interactive intelligence report you're trying to access is no longer available.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access Expired · InfoVision Intelligence</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; height:100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(1200px 800px at 20% -10%, #4b0082 0%, #1a0033 55%, #0a0018 100%);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 520px;
    text-align: center;
    padding: 48px 40px;
  }
  .badge {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 28px;
  }
  h1 {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin: 0 0 18px;
  }
  p {
    font-size: 16px;
    line-height: 1.6;
    opacity: 0.82;
    margin: 0 0 36px;
  }
  a.cta {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #1a0033;
    border-radius: 999px;
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.02em;
    transition: transform .15s ease;
  }
  a.cta:hover { transform: translateY(-1px); }
  .brand {
    margin-top: 56px;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.45;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">Access Expired</div>
    <h1>This link is no longer active</h1>
    <p>${escapeHtml(message)} Get in touch and we&rsquo;ll send you a fresh link.</p>
    <a class="cta" href="mailto:${CONTACT_EMAIL}?subject=Request%20a%20new%20intelligence%20link">Contact us</a>
    <div class="brand">InfoVision Intelligence</div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
