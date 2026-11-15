const ASF_ORIGIN = 'https://api.daac.asf.alaska.edu';
const ALLOWED_PATHS = ['/health', '/services/search/param'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const incoming = new URL(req.url, 'https://local.invalid');
  const upstreamPath = incoming.pathname.replace(/^\/api\/asf/, '') || '/health';
  if (!ALLOWED_PATHS.some((allowed) => upstreamPath === allowed)) {
    return res.status(404).json({ error: 'Unsupported ASF endpoint' });
  }

  const upstream = new URL(upstreamPath, ASF_ORIGIN);
  upstream.search = incoming.search;

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
