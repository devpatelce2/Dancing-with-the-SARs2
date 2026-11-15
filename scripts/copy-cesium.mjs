// Copies Cesium's static runtime assets (workers, widgets CSS, textures) into public/cesium.
// Generated output; gitignored. Avoids adding a copy plugin dependency.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/cesium/Build/Cesium';
const dst = 'public/cesium';
if (!existsSync(src)) { console.error('cesium not installed'); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const d of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) cpSync(`${src}/${d}`, `${dst}/${d}`, { recursive: true });
console.log('Cesium assets copied to', dst);
