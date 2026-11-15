// Free, key-less APIs: Open-Meteo (weather + air quality + geocoding)
// BigDataCloud + OpenStreetMap Nominatim (reverse geocoding) and a built-in
// sea/ocean table so every point on Earth gets a proper name.
import { waterBodyName } from './seas.js'

const WMO = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud-sun'],
  3: ['Overcast', 'cloud'], 45: ['Fog', 'cloud-fog'], 48: ['Rime fog', 'cloud-fog'],
  51: ['Light drizzle', 'cloud-drizzle'], 53: ['Drizzle', 'cloud-drizzle'], 55: ['Heavy drizzle', 'cloud-drizzle'],
  56: ['Freezing drizzle', 'cloud-drizzle'], 57: ['Freezing drizzle', 'cloud-drizzle'],
  61: ['Light rain', 'cloud-rain'], 63: ['Rain', 'cloud-rain'], 65: ['Heavy rain', 'cloud-rain'],
  66: ['Freezing rain', 'cloud-rain'], 67: ['Freezing rain', 'cloud-rain'],
  71: ['Light snow', 'snowflake'], 73: ['Snow', 'snowflake'], 75: ['Heavy snow', 'snowflake'],
  77: ['Snow grains', 'snowflake'],
  80: ['Rain showers', 'cloud-rain'], 81: ['Rain showers', 'cloud-rain'], 82: ['Violent showers', 'cloud-rain'],
  85: ['Snow showers', 'snowflake'], 86: ['Heavy snow showers', 'snowflake'],
  95: ['Thunderstorm', 'cloud-lightning'], 96: ['Thunderstorm, hail', 'cloud-lightning'],
  99: ['Severe thunderstorm, hail', 'cloud-lightning'],
}
export const describeWeather = (code) => WMO[code] ?? ['Unknown', 'cloud']

export function compass(deg) {
  if (deg == null) return '—'
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

async function getJson(url, ms = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchWeather(lat, lon) {
  const base = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
  const wUrl = `https://api.open-meteo.com/v1/forecast?${base}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,'
    + 'weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
    + '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max'
    + '&forecast_days=1&timezone=auto'
  const aUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${base}`
    + '&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide&timezone=auto'

  // Weather is required; air quality is a bonus (fails quietly).
  const [weather, air] = await Promise.all([
    getJson(wUrl),
    getJson(aUrl).catch(() => null),
  ])
  return { weather, air }
}

const WATER_RE = /(ocean|sea|gulf|bay|strait|channel|lake|river|reservoir)/i
const LAND_FEATURE_RE = /(desert|plateau|plain|mountain|range|forest|valley|delta|peninsula|island|basin|park|reserve)/i

const unique = (arr) => arr.filter((p, i) => p && arr.indexOf(p) === i)

async function bigDataCloud(lat, lon) {
  const d = await getJson(
    `https://api-bin.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    6000,
  )
  const info = d.localityInfo ?? {}
  const informative = (info.informative ?? []).map((i) => i.name).filter(Boolean)
  const admin = (info.administrative ?? [])
    .filter((a) => a.name && a.adminLevel >= 4)
    .sort((x, y) => y.adminLevel - x.adminLevel)
    .map((a) => a.name)
  const feature = informative.find((n) => WATER_RE.test(n) || LAND_FEATURE_RE.test(n))
  const place = d.locality || d.city || admin[0]
  const parts = unique([place, d.principalSubdivision, d.countryName])
  return {
    place: place || null,
    feature: feature || null,
    text: parts.join(', '),
    hasLand: !!(d.countryName),
  }
}

async function nominatim(lat, lon) {
  const d = await getJson(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`,
    7000,
  )
  if (!d || d.error) return null
  const a = d.address ?? {}
  const place = a.village || a.hamlet || a.suburb || a.town || a.city || a.municipality
    || a.county || a.state_district || a.region || null
  const parts = unique([place, a.state_district !== place ? a.state_district : null, a.state, a.country])
  return { place, text: parts.join(', '), hasLand: !!a.country }
}

// Always returns a human-readable name — never a blank "Unnamed location".
export async function reverseGeocode(lat, lon) {
  const coord = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
  const water = waterBodyName(lat, lon)
  let big = null
  try { big = await bigDataCloud(lat, lon) } catch { /* try next source */ }

  // Open water: no country returned -> name the sea / ocean.
  if (big && !big.hasLand) {
    const wname = big.feature && WATER_RE.test(big.feature) ? big.feature : water?.name
    if (wname) return { name: wname, sub: `${water?.kind ?? 'Open water'} · ${coord}` }
  }
  if (big?.text) {
    const sub = big.feature && !big.text.includes(big.feature)
      ? `Region: ${big.feature}` : coord
    return { name: big.text, sub }
  }

  // Second opinion for remote land (deserts, mountains, tiny villages).
  try {
    const nm = await nominatim(lat, lon)
    if (nm?.text) return { name: nm.text, sub: coord }
  } catch { /* fall through */ }

  if (water) return { name: water.name, sub: `${water.kind} · ${coord}` }
  if (big?.feature) return { name: big.feature, sub: coord }
  return { name: `Remote area (${coord})`, sub: 'No named place within the geocoder’s range' }
}

export async function geocodeSearch(query) {
  const d = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
    6000,
  )
  const r = d.results?.[0]
  if (!r) return null
  return {
    lat: r.latitude, lon: r.longitude,
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
  }
}

/* ------------------------------------------------------------------ */
/* Time-aware weather: hourly data for any moment on the timeline      */
/* ------------------------------------------------------------------ */

const DAY = 86400000
export const WX_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation',
  'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'is_day',
]
const AIR_VARS = ['us_aqi', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'sulphur_dioxide', 'ozone', 'carbon_monoxide']
const cache = new Map()
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// Chooses the right Open-Meteo endpoint for the requested time window.
// returns {url, source, label} or {error}
function planWindow(lat, lon, fromMs, toMs) {
  const todayStart = Math.floor(Date.now() / DAY) * DAY
  const s = Math.floor((fromMs - todayStart) / DAY)
  const e = Math.floor((toMs - todayStart) / DAY)
  const base = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&timezone=auto`
  const hourly = `&hourly=${WX_VARS.join(',')}`
  if (s > 15) return { error: 'Forecast data only reaches ~15 days ahead.' }
  if (s < -92 || e < -60) {
    const endDay = Math.min(e, -5)
    if (endDay < s) return { error: 'Historical data (ERA5) lags ~5 days behind today.' }
    return {
      source: 'archive', label: 'ERA5 reanalysis (historical)',
      url: `https://archive-api.open-meteo.com/v1/archive?${base}${hourly}&daily=sunrise,sunset`
        + `&start_date=${isoDay(todayStart + s * DAY)}&end_date=${isoDay(todayStart + endDay * DAY)}`,
    }
  }
  const sd = Math.max(s, -92), ed = Math.min(e, 15)
  const nowish = Math.abs(fromMs - Date.now()) < 2 * DAY
  return {
    source: 'forecast',
    label: nowish ? 'Live model analysis / forecast' : (s < 0 ? 'Model analysis (recent past)' : 'Forecast'),
    url: `https://api.open-meteo.com/v1/forecast?${base}${hourly}&daily=sunrise,sunset,uv_index_max`
      + `&start_date=${isoDay(todayStart + sd * DAY)}&end_date=${isoDay(todayStart + ed * DAY)}`,
  }
}

function pack(json, label) {
  const off = (json.utc_offset_seconds ?? 0) * 1000
  const h = json.hourly ?? {}
  const ts = (h.time ?? []).map((t) => Date.parse(`${t}:00Z`) - off)
  const vars = {}
  Object.keys(h).forEach((k) => { if (k !== 'time') vars[k] = h[k] })
  return { ts, vars, daily: json.daily ?? {}, offsetMs: off, label, tz: json.timezone_abbreviation }
}

// Hourly weather for [fromMs, toMs]. Cached; resolves {data} or {error}.
export async function fetchHourly(lat, lon, fromMs, toMs) {
  const plan = planWindow(lat, lon, fromMs, toMs)
  if (plan.error) return { error: plan.error }
  const key = plan.url
  if (!cache.has(key)) {
    cache.set(key, getJson(plan.url, 12000).then((j) => pack(j, plan.label)))
  }
  try {
    return { data: await cache.get(key) }
  } catch {
    cache.delete(key)
    return { error: 'Could not reach the weather service.' }
  }
}

export async function fetchAirHourly(lat, lon, fromMs, toMs) {
  const todayStart = Math.floor(Date.now() / DAY) * DAY
  const sd = Math.max(Math.floor((fromMs - todayStart) / DAY), -92)
  const ed = Math.min(Math.floor((toMs - todayStart) / DAY), 4)
  if (ed < sd) return null
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + `&hourly=${AIR_VARS.join(',')}&timezone=auto&start_date=${isoDay(todayStart + sd * DAY)}&end_date=${isoDay(todayStart + ed * DAY)}`
  if (!cache.has(url)) cache.set(url, getJson(url, 10000).then((j) => pack(j, 'CAMS air quality')))
  try { return await cache.get(url) } catch { cache.delete(url); return null }
}

// Linear interpolation of one variable at an exact moment (ms, UTC).
// Wind direction / codes / flags use the nearest hour instead.
export function valueAt(pack_, name, ms) {
  const arr = pack_?.vars?.[name]
  const ts = pack_?.ts
  if (!arr || !ts?.length) return null
  if (ms < ts[0] - 3600000 || ms > ts[ts.length - 1] + 3600000) return null
  const i = Math.max(0, Math.min(ts.length - 2, Math.floor((ms - ts[0]) / 3600000)))
  const a = arr[i], b = arr[i + 1]
  if (a == null && b == null) return null
  if (a == null) return b
  if (b == null) return a
  if (['weather_code', 'is_day', 'wind_direction_10m'].includes(name)) {
    return ms - ts[i] < ts[i + 1] - ms ? a : b
  }
  const f = Math.min(1, Math.max(0, (ms - ts[i]) / (ts[i + 1] - ts[i])))
  return a + (b - a) * f
}

// Sunrise / sunset (ms-local ISO) for the day containing ms.
export function dayInfo(pack_, ms) {
  const d = pack_?.daily
  if (!d?.time) return {}
  const local = new Date(ms + pack_.offsetMs).toISOString().slice(0, 10)
  const i = d.time.indexOf(local)
  if (i < 0) return {}
  return { sunrise: d.sunrise?.[i], sunset: d.sunset?.[i], uv: d.uv_index_max?.[i] }
}

export const METRIC_INFO = {
  temperature_2m: { label: 'Temperature', unit: '°C', digits: 1 },
  relative_humidity_2m: { label: 'Humidity', unit: '%', digits: 0 },
  precipitation: { label: 'Rain', unit: 'mm', digits: 1 },
  wind_speed_10m: { label: 'Wind speed', unit: 'km/h', digits: 0 },
  pressure_msl: { label: 'Pressure', unit: 'hPa', digits: 0 },
  cloud_cover: { label: 'Cloud cover', unit: '%', digits: 0 },
}
