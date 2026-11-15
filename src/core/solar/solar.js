// Solar position — NOAA Solar Calculator algorithm (Meeus, "Astronomical Algorithms").
// Pure functions, UTC in, degrees out. No dependency on the map, layers or datasets.
// Accuracy: declination ≈ 0.01°, equation of time ≈ 0.1 min for 1900–2100 (adequate for a day/night overlay).
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const toJulianDay = (ms) => ms / 86400000 + 2440587.5;
const norm360 = (x) => ((x % 360) + 360) % 360;
export const normLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

/** @param {number|Date} when UTC instant @returns {{declination:number, eqTimeMin:number, subsolarLat:number, subsolarLon:number}} */
export function solarPosition(when) {
  const ms = when instanceof Date ? when.getTime() : when;
  const jd = toJulianDay(ms);
  const T = (jd - 2451545.0) / 36525;
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032)); // geometric mean longitude
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T); // mean anomaly
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T); // orbit eccentricity
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLon = trueLon - 0.00569 - 0.00478 * Math.sin(omega * RAD); // apparent longitude
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD); // corrected obliquity
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(appLon * RAD)) * DEG;
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTimeMin =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  const utcMin = ((((ms % 86400000) + 86400000) % 86400000) / 60000);
  // The Sun is on the local meridian when true solar time = 720 min.
  const subsolarLon = normLon((720 - utcMin - eqTimeMin) / 4);
  return { declination, eqTimeMin, subsolarLat: declination, subsolarLon };
}

/** Solar elevation (degrees) at a point for a precomputed solar position. */
export function solarElevation(latDeg, lonDeg, pos) {
  const lat = latDeg * RAD;
  const dec = pos.declination * RAD;
  const H = (lonDeg - pos.subsolarLon) * RAD;
  const s = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}

/** Terminator (solar elevation = 0°) as [lon, lat] pairs from -180..180. */
export function terminatorLine(pos, stepDeg = 1) {
  const dec = Math.abs(pos.declination) < 1e-6 ? 1e-6 : pos.declination * RAD;
  const pts = [];
  for (let lon = -180; lon <= 180 + 1e-9; lon += stepDeg) {
    const H = (lon - pos.subsolarLon) * RAD;
    pts.push([lon, Math.atan(-Math.cos(H) / Math.tan(dec)) * DEG]);
  }
  return pts;
}

/**
 * Rasterise illumination to RGBA (equirectangular, row 0 = +90°).
 * Darkness ramps through civil (−6°), nautical (−12°) and astronomical (−18°) twilight,
 * so shading is a direct function of solar elevation, never a fixed image.
 */
export function illuminationRGBA(pos, width, height, { maxAlpha = 0.62, rgb = [4, 8, 24] } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const sd = Math.sin(pos.declination * RAD);
  const cd = Math.cos(pos.declination * RAD);
  for (let y = 0; y < height; y++) {
    const lat = (90 - ((y + 0.5) / height) * 180) * RAD;
    const sl = Math.sin(lat) * sd;
    const cl = Math.cos(lat) * cd;
    for (let x = 0; x < width; x++) {
      const H = (-180 + ((x + 0.5) / width) * 360 - pos.subsolarLon) * RAD;
      const elev = Math.asin(Math.max(-1, Math.min(1, sl + cl * Math.cos(H)))) * DEG;
      const t = elev >= 0 ? 0 : Math.min(1, -elev / 18);
      const smooth = t * t * (3 - 2 * t);
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = Math.round(smooth * maxAlpha * 255);
    }
  }
  return data;
}
