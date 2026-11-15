// Rebuild public/data/sites.json from the site folders that exist (same rules as `python -m pipeline.rebuild_index`).
// Runs before `npm run dev` and `npm run build`, so a processed site can never be missing from the app.
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function scanSites(root) {
  if (!existsSync(root)) return []
  const sites = []
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id)
    if (!SITE_ID.test(id) || !statSync(dir).isDirectory()) continue
    for (const [file, kind] of [['timeseries.json', 'timeseries'], ['meta.json', null]]) {
      const f = join(dir, file); if (!existsSync(f)) continue
      let j; try { j = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
      if (!j || typeof j !== 'object' || Array.isArray(j)) continue
      sites.push({ id, name: String(j.name || id), ...(kind ? { kind } : {}) }); break
    }
  }
  return sites
}

export function rebuildIndex(root) {
  const sites = scanSites(root); const tmp = join(root, 'sites.json.tmp')
  writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, sites }, null, 2)); renameSync(tmp, join(root, 'sites.json'))
  return sites
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || 'public/data'
  if (!existsSync(root)) { console.log(`sites index: ${root} does not exist, nothing to do`); process.exit(0) }
  const sites = rebuildIndex(root)
  console.log(`sites index: ${sites.length} site(s): ${sites.map((s) => s.id).join(', ') || 'none'}`)
}
