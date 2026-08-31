// Small shared helpers for the Worker. Dependency-free and node-testable:
// nothing here touches the Cloudflare runtime.

// Security headers on every response the Worker itself generates. Static
// assets get their own set from public/_headers, which does not apply to
// Worker responses.
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // API responses carry personal data in later milestones; never cache them.
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function err(code, status) {
  return json({ error: code }, status);
}

export const nowSec = () => Math.floor(Date.now() / 1000);

// --- randomness and hashing ---------------------------------------------

// Uniform 0-9 digits. Rejection sampling, because `byte % 10` would make
// 0-5 measurably likelier than 6-9 and shrink the real keyspace of a code.
export function randDigits(count) {
  let out = '';
  while (out.length < count) {
    const bytes = new Uint8Array(count);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= 250) continue; // 250 = floor(256/10)*10
      out += byte % 10;
      if (out.length === count) break;
    }
  }
  return out;
}

// 256 bits, URL-safe. Session tokens and any other bearer value.
export function randToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// IP addresses are never stored. This salted hash is what rate limiting and
// abuse auditing see; without the salt it cannot be reversed by guessing
// addresses, which a bare hash of an IPv4 address absolutely can be.
export async function hashIp(env, ip) {
  if (!ip) return null;
  return sha256Hex(`${env.IP_HASH_SALT || 'atsy-dev-salt'}:${ip}`);
}

// --- requests and cookies ------------------------------------------------

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function sessionCookie(token, maxAgeSec) {
  return `sid=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
}

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Every value interpolated into HTML goes through this. No exceptions.
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
