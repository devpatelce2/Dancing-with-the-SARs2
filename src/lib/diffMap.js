// Difference map: how much brighter or darker each pixel is on a date than in the baseline (median of the baseline scenes), in dB.
// Built in the browser from the per-date grey radar images the pipeline already writes (one shared grey stretch, one shared pixel grid),
// so existing sites work without re-processing. Red = darker (smooth open water, flooded bare ground). Blue = brighter (flooded
// vegetation double-bounce, wet soil, growing crops). It is evidence to look at, not a confirmed flood map.

export const FLOOR_DB = 1.0 // |change| below this stays transparent: it is mostly speckle and 8-bit rounding

/** RGBA for one pixel. d = change vs baseline in dB, thr = positive threshold in dB. Transparent when small or missing. */
export function diffPixel(d, thr) {
  if (!Number.isFinite(d)) return [0, 0, 0, 0]
  const a = Math.abs(d); if (a < FLOOR_DB) return [0, 0, 0, 0]
  const s = Math.min(1, (a - FLOOR_DB) / Math.max(0.5, 2 * thr - FLOOR_DB)) // 0 at the floor, 1 at twice the threshold
  const mix = (p, q) => Math.round(p + (q - p) * s)
  const alpha = Math.round(80 + 150 * s)
  return d < 0 ? [mix(255, 190), mix(150, 0), mix(70, 30), alpha] : [mix(130, 20), mix(195, 70), mix(255, 235), alpha]
}

/** Per-pixel median over baseline scenes, using only pixels each scene has data for. NaN where no baseline scene has data.
 *  Values are grey levels, so the result is an integer or x.5. Insertion sort into one small reused buffer: no per-pixel garbage. */
export function baselineMedian(grays, alphas) {
  const n = grays[0].length; const K = grays.length; const out = new Float32Array(n); const v = new Uint8Array(K)
  if (K === 1) { const g = grays[0], a = alphas[0]; for (let p = 0; p < n; p++) out[p] = a[p] > 0 ? g[p] : NaN; return out }
  for (let p = 0; p < n; p++) {
    let c = 0
    for (let k = 0; k < K; k++) {
      if (alphas[k][p] === 0) continue
      const x = grays[k][p]; let j = c++
      while (j > 0 && v[j - 1] > x) { v[j] = v[j - 1]; j-- }
      v[j] = x
    }
    out[p] = c === 0 ? NaN : c & 1 ? v[c >> 1] : (v[(c >> 1) - 1] + v[c >> 1]) / 2
  }
  return out
}

/** dB change of one scene vs the baseline median. scaleDb = dB per grey level = (hi - lo) / 255. */
export function diffGrid(gray, alpha, baseMed, scaleDb) {
  const out = new Float32Array(gray.length)
  for (let p = 0; p < gray.length; p++) out[p] = alpha[p] > 0 && Number.isFinite(baseMed[p]) ? (gray[p] - baseMed[p]) * scaleDb : NaN
  return out
}

export function colourise(diff, thr) {
  const rgba = new Uint8ClampedArray(diff.length * 4)
  for (let p = 0; p < diff.length; p++) rgba.set(diffPixel(diff[p], thr), p * 4)
  return rgba
}

/** Share of valid pixels at least thr dB darker / brighter than the baseline. */
export function diffStats(diff, thr) {
  let n = 0, dark = 0, bright = 0
  for (const d of diff) { if (!Number.isFinite(d)) continue; n++; if (d <= -thr) dark++; else if (d >= thr) bright++ }
  return { valid: n, darkPct: n ? (100 * dark) / n : 0, brightPct: n ? (100 * bright) / n : 0 }
}

/** Fast path used by the app: colour + statistics in one pass, with a lookup table instead of per-pixel maths.
 *  A grey level minus a baseline median is always a multiple of 0.5, so 1021 table entries cover every possible change exactly;
 *  the output is identical to colourise(diffGrid(...)) and diffStats(diffGrid(...)) (see tests). */
export function renderDiff(gray, alpha, baseMed, scaleDb, thr) {
  const lut = new Uint8ClampedArray(1021 * 4); const cls = new Int8Array(1021)
  for (let k = 0; k < 1021; k++) { const d = Math.fround(((k - 510) / 2) * scaleDb); lut.set(diffPixel(d, thr), k * 4); cls[k] = d <= -thr ? -1 : d >= thr ? 1 : 0 }
  const lut32 = new Uint32Array(lut.buffer); const n = gray.length
  const rgba = new Uint8ClampedArray(n * 4); const out32 = new Uint32Array(rgba.buffer)
  let valid = 0, dark = 0, bright = 0
  for (let p = 0; p < n; p++) {
    const m = baseMed[p]
    if (alpha[p] === 0 || m !== m) continue // no data here (m !== m is the NaN test)
    const k = Math.round((gray[p] - m) * 2) + 510
    out32[p] = lut32[k]; valid++
    if (cls[k] < 0) dark++; else if (cls[k] > 0) bright++
  }
  return { rgba, stats: { valid, darkPct: valid ? (100 * dark) / valid : 0, brightPct: valid ? (100 * bright) / valid : 0 } }
}

// ---- browser part (needs canvas) ----
async function loadGray(url) {
  const img = new Image(); img.decoding = 'async'; img.src = url
  try { await img.decode() } catch { throw new Error(`could not load ${url}`) }
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
  const { data } = g.getImageData(0, 0, c.width, c.height); const n = c.width * c.height
  const gray = new Uint8Array(n), alpha = new Uint8Array(n)
  for (let p = 0, q = 0; p < n; p++, q += 4) { gray[p] = data[q]; alpha[p] = data[q + 3] }
  return { w: c.width, h: c.height, gray, alpha }
}

const toBlobUrl = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('could not encode the difference map'))), 'image/png'))

/** Lazy difference maps for one site. Nothing is computed until a date is asked for; each date is computed once and kept.
 *  get(i) -> Promise<{ url, stats }>.  Only the baseline scenes and the requested date are downloaded and decoded.
 *  PNG encoding happens off the main thread (canvas.toBlob), so the page stays responsive. dispose() frees the images. */
export function createDiffSource(base, ts) {
  const pts = ts.points; const [lo, hi] = ts.visualisationStretchDb ?? []
  const fail = (msg) => ({ get: () => Promise.reject(new Error(msg)), dispose() {} })
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !pts.every((p) => p.image)) return fail('This site has no per-date radar images; re-run the analysis.')
  const bi = pts.map((p, i) => (p.isBaseline ? i : -1)).filter((i) => i >= 0)
  if (!bi.length) return fail('No baseline scenes to compare against.')
  const thr = Math.abs(ts.method?.thresholdDb ?? -3); const scale = (hi - lo) / 255
  const imgs = new Map(); const maps = new Map(); const urls = []; let basePromise = null; let dead = false
  const img = (i) => { if (!imgs.has(i)) imgs.set(i, loadGray(`${base}/${pts[i].image}`)); return imgs.get(i) }
  const baseline = () => (basePromise ??= Promise.all(bi.map(img)).then((b) => {
    if (b.some((m) => m.w !== b[0].w || m.h !== b[0].h)) throw new Error('Per-date images differ in size, cannot compare them.')
    return { med: baselineMedian(b.map((m) => m.gray), b.map((m) => m.alpha)), w: b[0].w, h: b[0].h }
  }))
  const build = async (i) => {
    const [b, m] = await Promise.all([baseline(), img(i)])
    if (m.w !== b.w || m.h !== b.h) throw new Error('Per-date images differ in size, cannot compare them.')
    const { rgba, stats } = renderDiff(m.gray, m.alpha, b.med, scale, thr)
    const c = document.createElement('canvas'); c.width = b.w; c.height = b.h
    c.getContext('2d').putImageData(new ImageData(rgba, b.w, b.h), 0, 0)
    const url = await toBlobUrl(c)
    if (dead) URL.revokeObjectURL(url); else urls.push(url)
    return { url, stats }
  }
  return {
    get(i) { if (!maps.has(i)) { const p = build(i); maps.set(i, p); p.catch(() => maps.delete(i)) } return maps.get(i) },
    dispose() { dead = true; urls.forEach((u) => URL.revokeObjectURL(u)); urls.length = 0; imgs.clear(); maps.clear() },
  }
}

/** Every date at once (kept for callers that want them all). */
export async function loadDiffMaps(base, ts) {
  const src = createDiffSource(base, ts)
  return Promise.all(ts.points.map((_, i) => src.get(i)))
}
