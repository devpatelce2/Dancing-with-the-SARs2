// Sentinel-1 / NISAR orbit tracks.
// 1) Tries live TLEs from CelesTrak (real orbits).
// 2) If that fails (offline / blocked), falls back to an APPROXIMATE
//    circular sun-synchronous model so the UI never breaks.
import * as Cesium from 'cesium'
import * as sat from 'satellite.js'

export const SATELLITES = [
  {
    id: 's1a', name: 'Sentinel-1A', celestrak: 'SENTINEL-1A', color: '#4cc9f0',
    band: 'C-band SAR', swathKm: 250,
    fallback: { altKm: 693, incDeg: 98.18, ltanHours: 18, phaseDeg: 0 },
  },
  {
    id: 's1c', name: 'Sentinel-1C', celestrak: 'SENTINEL-1C', color: '#70e6d1',
    band: 'C-band SAR', swathKm: 250,
    fallback: { altKm: 693, incDeg: 98.18, ltanHours: 18, phaseDeg: 180 },
  },
  {
    id: 'nisar', name: 'NISAR', celestrak: 'NISAR', color: '#ffc775',
    band: 'L + S-band SAR', swathKm: 240,
    fallback: { altKm: 747, incDeg: 98.4, ltanHours: 18, phaseDeg: 90 },
  },
]

// Keep the drawn path short and clean: a little behind, a bit ahead.
const TRAIL_MIN = 10
const AHEAD_MIN = 30
const STEP_SEC = 60
const REBUILD_SEC = 30

const MU = 398600.4418 // km^3/s^2
const RE = 6378.137 // km

async function fetchTle(name) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 7000)
  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(name)}&FORMAT=TLE`
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    for (let i = 0; i + 2 < lines.length; i++) {
      if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')
        && lines[i].toUpperCase().includes(name.toUpperCase())) {
        return { l1: lines[i + 1], l2: lines[i + 2] }
      }
    }
    throw new Error('no TLE in response')
  } finally {
    clearTimeout(timer)
  }
}

function sunRightAscension(date) {
  const d = date.getTime() / 86400000 - 10957.5 // days since J2000
  const L = (280.46 + 0.9856474 * d) % 360
  const g = ((357.528 + 0.9856003 * d) % 360) * Math.PI / 180
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180
  const eps = 23.439 * Math.PI / 180
  return Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam))
}

// Approximate circular sun-synchronous orbit (fallback only).
function approxState(fb, date) {
  const a = RE + fb.altKm
  const n = Math.sqrt(MU / (a ** 3))
  const tSec = date.getTime() / 1000
  const u = (fb.phaseDeg * Math.PI / 180) + n * (tSec % (2 * Math.PI / n))
  const raan = sunRightAscension(date) + (fb.ltanHours - 12) * 15 * Math.PI / 180
  const inc = fb.incDeg * Math.PI / 180
  const cu = Math.cos(u), su = Math.sin(u)
  const x = a * (cu * Math.cos(raan) - su * Math.cos(inc) * Math.sin(raan))
  const y = a * (cu * Math.sin(raan) + su * Math.cos(inc) * Math.cos(raan))
  const z = a * su * Math.sin(inc)
  const speed = Math.sqrt(MU / a)
  return { position: { x, y, z }, speed }
}

export function createSatelliteTrack(viewer, def) {
  const color = Cesium.Color.fromCssColorString(def.color)
  const state = {
    satrec: null,
    source: 'APPROX MODEL',
    tleEpoch: null,
    pos: Cesium.Cartesian3.fromDegrees(0, 0, 700000),
    trail: [], ahead: [], nadir: [],
    lastBuild: -Infinity,
  }
  const info = {
    id: def.id, name: def.name, band: def.band, swathKm: def.swathKm,
    lat: 0, lon: 0, altKm: def.fallback.altKm, speedKms: 0,
    source: state.source, tleEpoch: null,
  }

  function sample(date) {
    if (state.satrec) {
      const pv = sat.propagate(state.satrec, date)
      if (pv && pv.position) {
        const gd = sat.eciToGeodetic(pv.position, sat.gstime(date))
        const v = pv.velocity
        return {
          lat: sat.degreesLat(gd.latitude), lon: sat.degreesLong(gd.longitude),
          altKm: gd.height, speed: Math.hypot(v.x, v.y, v.z),
        }
      }
    }
    const s = approxState(def.fallback, date)
    const gd = sat.eciToGeodetic(s.position, sat.gstime(date))
    return {
      lat: sat.degreesLat(gd.latitude), lon: sat.degreesLong(gd.longitude),
      altKm: gd.height, speed: s.speed,
    }
  }

  const toCart = (s) => Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.altKm * 1000)

  function rebuildPaths(date, nowSec) {
    const trail = [], ahead = []
    for (let t = -TRAIL_MIN * 60; t <= 0; t += STEP_SEC) {
      trail.push(toCart(sample(new Date(date.getTime() + t * 1000))))
    }
    for (let t = 0; t <= AHEAD_MIN * 60; t += STEP_SEC) {
      ahead.push(toCart(sample(new Date(date.getTime() + t * 1000))))
    }
    state.trail = trail
    state.ahead = ahead
    state.lastBuild = nowSec
  }

  function update(date) {
    const nowSec = date.getTime() / 1000
    const s = sample(date)
    state.pos = toCart(s)
    state.nadir = [state.pos, Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0)]
    if (Math.abs(nowSec - state.lastBuild) > REBUILD_SEC) rebuildPaths(date, nowSec)
    info.lat = s.lat; info.lon = s.lon; info.altKm = s.altKm; info.speedKms = s.speed
    info.source = state.source; info.tleEpoch = state.tleEpoch
  }

  const entities = []
  const add = (e) => { const ent = viewer.entities.add(e); entities.push(ent); return ent }

  add({
    id: `sat-${def.id}`,
    name: def.name,
    position: new Cesium.CallbackProperty(() => state.pos, false),
    point: {
      pixelSize: 10, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: def.name, font: '600 12px sans-serif',
      fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(14, -4),
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })
  add({
    id: `sat-${def.id}-trail`,
    polyline: {
      positions: new Cesium.CallbackProperty(() => state.trail, false),
      width: 2, material: color.withAlpha(0.3),
    },
  })
  add({
    id: `sat-${def.id}-ahead`,
    polyline: {
      positions: new Cesium.CallbackProperty(() => state.ahead, false),
      width: 2.5,
      material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 14 }),
    },
  })
  add({
    id: `sat-${def.id}-nadir`,
    polyline: {
      positions: new Cesium.CallbackProperty(() => state.nadir, false),
      width: 1, material: color.withAlpha(0.35),
    },
  })

  const onTick = (clock) => update(Cesium.JulianDate.toDate(clock.currentTime))
  viewer.clock.onTick.addEventListener(onTick)
  update(Cesium.JulianDate.toDate(viewer.clock.currentTime))

  let destroyed = false
  fetchTle(def.celestrak).then(({ l1, l2 }) => {
    if (destroyed) return
    state.satrec = sat.twoline2satrec(l1, l2)
    state.source = 'LIVE TLE (CelesTrak)'
    const yy = parseInt(l1.slice(18, 20), 10)
    const day = parseFloat(l1.slice(20, 32))
    const year = yy < 57 ? 2000 + yy : 1900 + yy
    state.tleEpoch = new Date(Date.UTC(year, 0, 1) + (day - 1) * 86400000)
      .toISOString().slice(0, 10)
    state.lastBuild = -Infinity
  }).catch((err) => {
    console.warn(`[orbits] ${def.name}: using approximate model (${err.message})`)
  })

  return {
    def, info,
    setShow(on) { entities.forEach((e) => { e.show = on }) },
    destroy() {
      destroyed = true
      viewer.clock.onTick.removeEventListener(onTick)
      entities.forEach((e) => viewer.entities.remove(e))
    },
  }
}
