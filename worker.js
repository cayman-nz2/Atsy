// Atsy — entry module. Routing only: no constants are exported from here,
// because workerd rejects non-handler exports on the entry module.
//
// Static assets in dist/ are served ahead of this Worker; only unmatched
// paths (in practice /api/*) reach the fetch handler.

import { VERSION } from './src/version.js';
import { json, err } from './src/util.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health') {
      return json({ ok: true, version: VERSION });
    }

    if (path.startsWith('/api/')) {
      return err('not_found', 404);
    }

    // Anything else that reaches the Worker had no matching asset.
    if (env.ASSETS) {
      const notFound = await env.ASSETS.fetch(new URL('/404.html', url));
      if (notFound.ok) {
        return new Response(notFound.body, {
          status: 404,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
          },
        });
      }
    }
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  },
};
