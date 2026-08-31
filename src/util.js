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

// Every value interpolated into HTML goes through this. No exceptions.
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
