// Free, stateless proxy for the ASF Search API, for hosting the site on GitHub Pages (or any static host).
// Deploy: Cloudflare dashboard > Workers & Pages > Create > Hello World > paste this file > Deploy.
// Then build the site with VITE_ASF_BASE=https://<your-worker>.workers.dev (see README).
const ASF = 'https://api.daac.asf.alaska.edu';
const ALLOWED = new Set(['/health', '/services/search/param']);
// Put your site's origin here to stop other sites using your proxy, e.g. 'https://yourteam.github.io'. '*' allows any.
const ALLOW_ORIGIN = '*';

const cors = (extra = {}) => ({ 'Access-Control-Allow-Origin': ALLOW_ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', ...extra });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors() });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/asf/, '').replace(/\/+$/, '') || '/health';
    if (!ALLOWED.has(path)) return new Response(JSON.stringify({ error: 'Unsupported ASF endpoint', path }), { status: 404, headers: cors({ 'Content-Type': 'application/json' }) });
    try {
      const upstream = await fetch(`${ASF}${path}${url.search}`, { headers: { Accept: 'application/geo+json, application/json, text/plain' }, cf: { cacheTtl: 180, cacheEverything: true } });
      const headers = cors({ 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'public, max-age=180' });
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'ASF catalog is temporarily unreachable', detail: String(error) }), { status: 502, headers: cors({ 'Content-Type': 'application/json' }) });
    }
  },
};
