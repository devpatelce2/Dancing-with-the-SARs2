// Where the site is served from: '/' locally and on Vercel, '/<repo>/' on a GitHub Pages project site.
export const SITE_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
export const DATA_BASE = `${SITE_BASE}data`
