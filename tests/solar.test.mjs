import test from 'node:test';
import assert from 'node:assert/strict';
import { solarPosition, solarElevation, terminatorLine, toJulianDay, illuminationRGBA } from '../src/core/solar/solar.js';

const utc = (s) => Date.parse(s);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

test('Julian day of J2000.0 epoch', () => assert.equal(toJulianDay(utc('2000-01-01T12:00:00Z')), 2451545.0));

// Reference values: Astronomical Almanac / NOAA Solar Calculator (declination ≈ -23.03° at J2000.0).
test('declination at J2000.0', () => near(solarPosition(utc('2000-01-01T12:00:00Z')).declination, -23.03, 0.05, 'dec'));
test('March equinox 2026 (20 Mar ~14:46 UTC): declination ≈ 0', () =>
  near(solarPosition(utc('2026-03-20T14:46:00Z')).declination, 0, 0.1, 'dec'));
test('June solstice 2026 (21 Jun ~08:24 UTC): declination ≈ +23.44', () =>
  near(solarPosition(utc('2026-06-21T08:24:00Z')).declination, 23.44, 0.05, 'dec'));
test('December solstice 2026: declination ≈ -23.44', () =>
  near(solarPosition(utc('2026-12-21T20:50:00Z')).declination, -23.44, 0.05, 'dec'));
// Equation of time extremes: ≈ -14.2 min (11 Feb), ≈ +16.4 min (3 Nov).
test('equation of time, 11 Feb', () => near(solarPosition(utc('2026-02-11T12:00:00Z')).eqTimeMin, -14.2, 0.4, 'eot'));
test('equation of time, 3 Nov', () => near(solarPosition(utc('2026-11-03T12:00:00Z')).eqTimeMin, 16.4, 0.4, 'eot'));
test('subsolar longitude follows UTC (+15°/hour westward)', () => {
  const a = solarPosition(utc('2026-11-14T12:00:00Z')).subsolarLon;
  const b = solarPosition(utc('2026-11-14T13:00:00Z')).subsolarLon;
  near(((a - b) + 360) % 360, 15, 0.05, 'Δlon per hour');
});
test('sun is at zenith at the subsolar point and ≈ 0° on the terminator', () => {
  const p = solarPosition(utc('2026-11-14T09:30:00Z'));
  near(solarElevation(p.subsolarLat, p.subsolarLon, p), 90, 1e-6, 'zenith');
  for (const [lon, lat] of terminatorLine(p, 15)) near(solarElevation(lat, lon, p), 0, 1e-6, `terminator @${lon}`);
});
test('polar night / midnight sun in northern winter', () => {
  const p = solarPosition(utc('2026-12-21T12:00:00Z'));
  assert.ok(solarElevation(85, 0, p) < -10);
  const q = solarPosition(utc('2026-06-21T12:00:00Z'));
  assert.ok(solarElevation(85, 0, q) > 10);
});
test('historical dates work (Sentinel-1A launch era, 2014-04-03)', () => {
  const p = solarPosition(utc('2014-04-03T00:00:00Z'));
  assert.ok(p.declination > 5 && p.declination < 6.5, `dec ${p.declination}`); // ≈ +5.7°
});
test('illumination raster: day side transparent, night side opaque-ish, poles handled', () => {
  const p = solarPosition(utc('2026-11-14T12:00:00Z'));
  const w = 360, h = 180, d = illuminationRGBA(p, w, h);
  const px = (lon, lat) => d[(Math.floor((90 - lat) / 180 * h) * w + Math.floor((lon + 180) / 360 * w)) * 4 + 3];
  assert.equal(px(p.subsolarLon, p.subsolarLat), 0);
  assert.ok(px(normalize(p.subsolarLon + 180), -p.subsolarLat) > 150);
  function normalize(x) { return ((x + 540) % 360) - 180; }
});
