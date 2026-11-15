// Same-origin proxy to the ASF DAAC Search API (the browser cannot call it directly: no CORS headers).
// A flat file on purpose: vercel.json rewrites /api/asf/<path> to /api/asf?__path=<path>, which works
// on every Vercel project setup, unlike a catch-all [...path] file.
const ASF_ORIGIN = 'https://api.daac.asf.alaska.edu';
const ALLOWED_PATHS = ['/health', '/services/search/param'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const incoming = new URL(req.url, 'https://local.invalid');
  const raw = incoming.searchParams.get('__path') ?? incoming.pathname.replace(/^\/api\/asf/, '');
  const upstreamPath = ('/' + raw.replace(/^\/+/, '')).replace(/\/+$/, '') || '/health';
  if (!ALLOWED_PATHS.includes(upstreamPath)) {
    return res.status(404).json({ error: 'Unsupported ASF endpoint', path: upstreamPath });
  }

  incoming.searchParams.delete('__path');
  const upstream = new URL(upstreamPath, ASF_ORIGIN);
  upstream.search = incoming.searchParams.toString();

  try {
    const response = await fetch(upstream, {
      headers: { Accept: 'application/geo+json, application/json, text/plain' },
      signal: AbortSignal.timeout(25000),
    });
    const body = await response.arrayBuffer();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    return res.send(Buffer.from(body));
  } catch (error) {
    return res.status(502).json({ error: 'ASF catalog is temporarily unreachable', detail: error.message });
  }
}
