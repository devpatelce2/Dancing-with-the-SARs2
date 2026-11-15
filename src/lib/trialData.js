// ======================================================================
//  TRIAL DATA PROVIDER  —  *** SYNTHETIC, NOT REAL OBSERVATIONS ***
// ======================================================================
// Everything here is generated deterministically from (latitude, longitude,
// time) so the UI behaves consistently while the real SAR-derived dataset is
// not connected yet.
//
// TO PLUG IN REAL DATA LATER: write an object with the same methods as
// `trialProvider` (see bottom of this file) and change `provider` in
// src/lib/dataProvider.js. The UI never imports this file directly.
// ======================================================================

const DAY = 86400000
const EPOCH = Date.UTC(2020, 0, 1)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const smooth = (x) => x * x * (3 - 2 * x)

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const seedOf = (p) => hash(`${p.lat.toFixed(1)},${p.lon.toFixed(1)}`)
const dayOfYear = (ms) => {
  const d = new Date(ms)
  return (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY
}
const yearsSince = (ms) => (ms - EPOCH) / (365.25 * DAY)

// Smooth deterministic "weather-like" noise in [-1, 1]
function noise(seed, ms) {
  const r = rng(seed ^ 0x9e3779b9)
  let v = 0
  ;[17, 43, 97].forEach((period, k) => {
    v += (1 / (k + 1.4)) * Math.sin((2 * Math.PI * ms) / (period * DAY) + r() * 6.283)
  })
  return clamp(v / 1.6, -1, 1)
}

// Per-place "personality": stable numbers that shape every metric.
function profile(place) {
  const r = rng(seedOf(place))
  const absLat = Math.abs(place.lat)
  const north = place.lat >= 0
  return {
    seed: seedOf(place),
    baseVeg: clamp(0.62 - absLat / 140 + (r() - 0.5) * 0.3, 0.06, 0.85),
    baseWater: clamp(r() * 0.16, 0, 0.25),
    baseBuilt: clamp(0.01 + r() * 0.11, 0.01, 0.2),
    seasonAmp: 0.05 + 0.2 * clamp(absLat / 50, 0, 1) * (0.5 + r() * 0.5),
    vegPeakDoy: (north ? 225 : 45) + (r() - 0.5) * 40,
    wetPeakDoy: (north ? 215 : 35) + (r() - 0.5) * 50,
    trendVeg: (r() - 0.62) * 0.02,           // per year (mostly slight loss)
    growthBuilt: 0.0005 + r() * 0.0055,      // per year
    dispRate: -14 + r() * 18,                // mm / year (mostly subsidence)
    floods: [0, 1, 2].map(() => ({
      at: EPOCH + (0.4 + r() * 6.8) * 365.25 * DAY,
      size: 0.03 + r() * 0.09,
      width: (8 + r() * 14) * DAY,
    })),
  }
}

const season = (ms, peakDoy) => Math.sin((2 * Math.PI * (dayOfYear(ms) - peakDoy + 91)) / 365)

export const CLASSES = [
  { id: 'water', label: 'Water', color: '#4cc9f0' },
  { id: 'vegetation', label: 'Vegetation', color: '#7bd88f' },
  { id: 'bare', label: 'Bare soil', color: '#d9a066' },
  { id: 'built', label: 'Built-up', color: '#ff5d73' },
]
const SIGMA0_DB = { water: -20, vegetation: -10, bare: -13, built: -3 }

export const SURFACE_METRICS = [
  { id: 'ndvi', label: 'Vegetation index (NDVI)', unit: '', digits: 2, color: '#7bd88f' },
  { id: 'water', label: 'Surface water extent', unit: '%', digits: 1, color: '#4cc9f0' },
  { id: 'soil', label: 'Soil moisture', unit: '%', digits: 1, color: '#d9a066' },
  { id: 'sigma0', label: 'SAR backscatter (VV)', unit: 'dB', digits: 1, color: '#b69cff' },
  { id: 'disp', label: 'Ground displacement', unit: 'mm', digits: 1, color: '#ffc775' },
  { id: 'built', label: 'Built-up area', unit: '%', digits: 1, color: '#ff5d73' },
]

export function surfaceAt(place, ms) {
  const p = profile(place)
  const y = yearsSince(ms)
  const n = noise(p.seed, ms)
  const wet = Math.max(0, season(ms, p.wetPeakDoy))
  let flood = 0
  p.floods.forEach((f) => { flood += f.size * Math.exp(-(((ms - f.at) / f.width) ** 2)) })

  const veg0 = clamp(p.baseVeg + p.seasonAmp * season(ms, p.vegPeakDoy) + p.trendVeg * y + 0.025 * n, 0.02, 0.92)
  const water0 = clamp(p.baseWater * (1 + 0.6 * wet) + flood + 0.004 * n, 0, 0.6)
  const built0 = clamp(p.baseBuilt + p.growthBuilt * y, 0.005, 0.5)
  const bare0 = Math.max(0.01, 1 - veg0 - water0 - built0)
  const sum = veg0 + water0 + built0 + bare0
  const f = { water: water0 / sum, vegetation: veg0 / sum, bare: bare0 / sum, built: built0 / sum }

  let sigma0 = 0
  CLASSES.forEach((c) => { sigma0 += f[c.id] * SIGMA0_DB[c.id] })
  return {
    fractions: f,
    ndvi: clamp(0.08 + 0.82 * f.vegetation + 0.015 * n, -0.1, 0.95),
    water: f.water * 100,
    soil: clamp(15 + 22 * wet + 160 * flood + 3 * n, 4, 60),
    sigma0: sigma0 + 0.4 * n,
    disp: p.dispRate * y + 3 * Math.sin((2 * Math.PI * (ms - EPOCH)) / (365.25 * DAY)) + 0.6 * n,
    built: f.built * 100,
  }
}

export function landCoverKm2(place, ms, radiusKm) {
  const area = Math.PI * radiusKm * radiusKm
  const f = surfaceAt(place, ms).fractions
  const out = { total: area }
  CLASSES.forEach((c) => { out[c.id] = f[c.id] * area })
  return out
}

// "How much of what became what" between two moments.
export function transitions(place, msA, msB, radiusKm) {
  const a = landCoverKm2(place, msA, radiusKm)
  const b = landCoverKm2(place, msB, radiusKm)
  const loss = {}, gain = {}
  let totalGain = 0
  CLASSES.forEach((c) => {
    const d = b[c.id] - a[c.id]
    if (d < 0) loss[c.id] = -d
    else { gain[c.id] = d; totalGain += d }
  })
  const rows = []
  Object.entries(loss).forEach(([from, L]) => {
    Object.entries(gain).forEach(([to, G]) => {
      const km2 = totalGain > 0 ? (L * G) / totalGain : 0
      if (km2 > 0.005) rows.push({ from, to, km2 })
    })
  })
  rows.sort((x, y) => y.km2 - x.km2)
  return { before: a, after: b, rows }
}

export function series(place, metricId, fromMs, toMs, n = 60) {
  const out = []
  for (let i = 0; i < n; i++) {
    const ms = fromMs + ((toMs - fromMs) * i) / (n - 1)
    const s = surfaceAt(place, ms)
    out.push([ms, metricId in s ? s[metricId] : s.fractions[metricId] * 100])
  }
  return out
}

/* ---------- change patches for map highlighting ---------- */

export const PATCH_TYPES = {
  'veg-loss': { label: 'Vegetation → bare soil', color: '#ffb347' },
  flood: { label: 'Land → water (flooding)', color: '#4cc9f0' },
  urban: { label: 'Land → built-up', color: '#ff5d73' },
  regrowth: { label: 'Bare soil → vegetation', color: '#7bd88f' },
}

export function changePatches(place, radiusKm) {
  const r = rng(seedOf(place) ^ 0xabcdef)
  const types = Object.keys(PATCH_TYPES)
  return Array.from({ length: 9 }, (_, i) => {
    const type = types[Math.floor(r() * types.length)]
    const ang = r() * Math.PI * 2
    const dist = (0.15 + r() * 0.7) * radiusKm
    return {
      id: `patch-${i}`, type,
      dxKm: Math.cos(ang) * dist, dyKm: Math.sin(ang) * dist,
      rKm: radiusKm * (0.07 + r() * 0.14),
      aspect: 0.55 + r() * 0.45, rot: r() * Math.PI,
      onset: EPOCH + (0.3 + r() * 6.8) * 365.25 * DAY,
      duration: (30 + r() * 270) * DAY,
      width: (8 + r() * 14) * DAY,
    }
  })
}

// 0..1 "how far along" a patch is at time ms
export function patchProgress(patch, ms) {
  if (patch.type === 'flood') return Math.exp(-(((ms - patch.onset) / patch.width) ** 2))
  return smooth(clamp((ms - patch.onset) / patch.duration, 0, 1))
}

/* ---------- the provider object the UI uses ---------- */

export const trialProvider = {
  id: 'trial',
  label: 'TRIAL · synthetic data',
  isReal: false,
  note: 'Generated values for UI testing only. Not satellite observations.',
  surfaceAt, landCoverKm2, transitions, series, changePatches, patchProgress,
  metrics: SURFACE_METRICS, classes: CLASSES, patchTypes: PATCH_TYPES,
}
