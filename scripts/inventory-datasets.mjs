// READ-ONLY inventory of previously acquired Sentinel-1 / NISAR data.
// Usage: npm run inventory -- /path/to/old/project/or/data [/another/path ...]
// Walks the given paths, never writes/moves/deletes inside them, and writes a manifest to ./data-inventory/manifest.json
// (inside THIS project). Nothing is copied or re-downloaded; the manifest only records where files live.
import { readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const roots = process.argv.slice(2).map((p) => resolve(p));
if (!roots.length) { console.error('Provide at least one directory to scan (read-only).'); process.exit(1); }
const SKIP = new Set(['node_modules', '.git', 'dist', '.cache']);
const EXT = new Set(['.h5', '.hdf5', '.zip', '.safe', '.tif', '.tiff', '.nc', '.json', '.geojson', '.csv', '.png', '.xml', '.kml', '.shp']);
const guess = (n) => (/^S1[A-D]_|sentinel/i.test(n) ? 'SENTINEL-1' : /nisar/i.test(n) ? 'NISAR' : null);
const files = []; const errors = [];
function walk(dir) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch (e) { errors.push({ dir, error: e.code }); return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); if (/\.SAFE$/i.test(e.name)) files.push({ path: p, kind: 'SAFE-directory', mission: guess(e.name), bytes: null }); continue; }
    if (!EXT.has(extname(e.name).toLowerCase())) continue;
    const st = statSync(p); files.push({ path: p, kind: extname(e.name).toLowerCase().slice(1), mission: guess(e.name), bytes: st.size, modified: st.mtime.toISOString() });
  }
}
for (const r of roots) { if (!existsSync(r)) { errors.push({ dir: r, error: 'not found' }); continue; } walk(r); }
const summary = files.reduce((a, f) => { const k = f.mission ?? 'unclassified'; a[k] = a[k] ?? { files: 0, bytes: 0 }; a[k].files++; a[k].bytes += f.bytes ?? 0; return a; }, {});
mkdirSync('data-inventory', { recursive: true });
writeFileSync('data-inventory/manifest.json', JSON.stringify({ generated: new Date().toISOString(), roots, summary, errors, files }, null, 2));
console.table(summary); console.log(`${files.length} candidate files; manifest -> data-inventory/manifest.json`);
if (errors.length) console.warn('Unreadable:', errors);
