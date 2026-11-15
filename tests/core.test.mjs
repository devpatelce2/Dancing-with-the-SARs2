import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineController } from '../src/core/time/timeController.js';
import { LayerRegistry, DEFAULT_LAYERS } from '../src/core/layers/layerRegistry.js';
import { ObservationStore } from '../src/core/data/observationStore.js';
import { asfAdapter } from '../src/core/data/adapters/asfAdapter.js';
import { genericGeoJsonAdapter } from '../src/core/data/adapters/genericGeoJsonAdapter.js';
import { assertObservation, toIsoUtc } from '../src/core/data/schema.js';
import { PolygonIndex } from '../src/core/geo/pointInPolygon.js';
import { buildQuery, bboxToWkt, DATASETS } from '../src/data/asf.js';

// ---- TimelineController with a fake clock/scheduler (deterministic) ----
function fakeTimeline(opts = {}) {
  let t = 0, queue = [];
  const tl = new TimelineController({ now: Date.UTC(2026, 10, 14), start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 10, 14), speedMsPerSec: 86400e3,
    schedule: (fn) => { queue.push(fn); return queue.length; }, cancel: () => { queue = []; }, clock: () => t, ...opts });
  const advance = (ms) => { t += ms; const q = queue; queue = []; q.forEach((f) => f()); };
  return { tl, advance };
}
test('timeline: setTime clamps to range and notifies subscribers', () => {
  const { tl } = fakeTimeline(); let n = 0; tl.subscribe(() => n++);
  tl.setTime(Date.UTC(2020, 0, 1)); assert.equal(tl.getState().time, tl.getState().start); assert.equal(n, 1);
});
test('timeline: playback advances at configured speed and stops at the end', () => {
  const { tl, advance } = fakeTimeline({ now: Date.UTC(2026, 10, 10) });
  tl.setSpeed(86400e3); tl.play(); assert.equal(tl.getState().playing, true);
  advance(100); advance(100); advance(100);  // 3 × 0.1s × 1 day/s = 0.3 day
  assert.ok(Math.abs(tl.getState().time - (Date.UTC(2026, 10, 10) + 0.3 * 86400e3)) < 1);
  tl.setSpeed(86400e3 * 1000); advance(100); assert.equal(tl.getState().playing, false); assert.equal(tl.getState().time, tl.getState().end);
});
test('timeline: reverse playback and pause', () => {
  const { tl, advance } = fakeTimeline(); tl.setDirection(-1); tl.play(); advance(200); tl.pause();
  const t = tl.getState().time; advance(200); assert.equal(tl.getState().time, t);
  assert.ok(t < Date.UTC(2026, 10, 14));
});
test('timeline: window is the trailing interval ending at the selected time', () => {
  const { tl } = fakeTimeline(); tl.setWindow(2 * 86400e3);
  const w = tl.getWindow(); assert.equal(w.end - w.start, 2 * 86400e3); assert.equal(w.end, tl.getState().time);
});

// ---- registry ----
test('registry: independent toggles; disaster + mission layers registered but not integrated', () => {
  const r = new LayerRegistry(DEFAULT_LAYERS);
  assert.equal(r.list('disaster').length, 7);
  assert.ok(r.list('disaster').every((l) => l.status === 'future' && !l.visible));
  r.setVisible('nisar', true); assert.equal(r.get('nisar').visible, true); assert.equal(r.get('sentinel1').visible, false);
  assert.throws(() => r.register({ id: 'nisar', group: 'satellite' }));
});

// ---- schema / adapters ----
// Test-only inputs below mimic the *shape* of asf_search output to test field mapping. They are never loaded by the app.
const shape = (extra = {}) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  properties: { sceneName: 'S1A_IW_GRDH_TEST', platform: 'Sentinel-1A', flightDirection: 'ASCENDING', polarization: 'VV+VH', processingLevel: 'GRD_HD',
    startTime: '2024-01-01T00:00:00.000000', stopTime: '2024-01-01T00:00:25Z', ...extra } }] });
test('asf adapter: normalizes common fields, preserves original, treats zone-less time as UTC', () => {
  const fc = shape(); assert.ok(asfAdapter.canHandle(fc));
  const { observations, skipped } = asfAdapter.normalize(fc); assert.equal(skipped.length, 0);
  const o = assertObservation(observations[0]);
  assert.equal(o.properties.mission, 'SENTINEL-1'); assert.equal(o.properties.layerId, 'sentinel1');
  assert.equal(o.properties.timestamp, '2024-01-01T00:00:00.000Z'); assert.equal(o.properties.orbitDirection, 'ASCENDING');
  assert.equal(o.properties.verificationStatus, 'user-supplied'); assert.equal(o.properties.metadata.original.sceneName, 'S1A_IW_GRDH_TEST');
});
test('asf adapter: routes NISAR to its own layer; skips (never invents) unusable records', () => {
  const fc = shape({ sceneName: 'NISAR_L2_TEST', platform: 'NISAR' }); fc.features.push({ type: 'Feature', geometry: null, properties: { sceneName: 'S1A_X', startTime: '2024-01-01' } });
  const { observations, skipped } = asfAdapter.normalize(fc);
  assert.equal(observations[0].properties.layerId, 'nisar'); assert.equal(skipped.length, 1);
});
test('schema: rejects invalid observations', () => {
  assert.throws(() => assertObservation({ type: 'Feature', geometry: {}, properties: {} }));
  assert.equal(toIsoUtc('garbage'), null);
});
test('generic adapter requires explicit field mapping and layer', () => {
  const ad = genericGeoJsonAdapter({ layerId: 'earthquakes', idProp: 'eid', timeProp: 'when', source: 'unit-test', verification: 'test' });
  const { observations, skipped } = ad.normalize({ features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { eid: 'a', when: '2020-01-01T00:00:00Z' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { eid: 'b' } }] });
  assert.equal(observations.length, 1); assert.equal(skipped.length, 1);
});
test('store: windowed query, pagination and extent', () => {
  const st = new ObservationStore();
  const mk = (d) => ({ ...shape({ sceneName: `S1A_${d}`, startTime: `2024-01-${d}T00:00:00Z`, stopTime: `2024-01-${d}T00:00:30Z` }).features[0] });
  st.add('sentinel1', asfAdapter.normalize({ features: ['01', '02', '03', '10'].map(mk) }).observations);
  const win = { start: Date.UTC(2024, 0, 1), end: Date.UTC(2024, 0, 4) };
  const r = st.query({ layerId: 'sentinel1', window: win, limit: 2 });
  assert.equal(r.total, 3); assert.equal(r.features.length, 2); assert.equal(r.nextOffset, 2);
  assert.equal(st.query({ layerId: 'nisar' }).total, 0);
  assert.equal(new Date(st.extent('sentinel1').end).toISOString(), '2024-01-10T00:00:30.000Z');
});

// ---- geo ----
test('point in polygon (hole respected)', () => {
  const sq = (a, b) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
  const idx = new PolygonIndex([{ properties: { n: 'ring' }, geometry: { type: 'Polygon', coordinates: [sq(0, 10), sq(4, 6)] } }]);
  assert.equal(idx.find(1, 1).length, 1); assert.equal(idx.find(5, 5).length, 0); assert.equal(idx.find(20, 20).length, 0);
});


test('ASF query: map-ready defaults and correctly ordered WKT bounds', () => {
  assert.equal(DATASETS['SENTINEL-1'].defaultLevel, 'GRD_HD');
  assert.equal(DATASETS.NISAR.defaultLevel, 'GCOV');
  assert.equal(bboxToWkt({ west: 68, south: 22, east: 71, north: 25 }), 'POLYGON((68.0000 22.0000,71.0000 22.0000,71.0000 25.0000,68.0000 25.0000,68.0000 22.0000))');
  const q = buildQuery({ dataset: 'NISAR', start: '2026-10-01', end: '2026-10-31', bbox: { west: 68, south: 22, east: 71, north: 25 }, maxResults: 50 });
  assert.equal(q.get('dataset'), 'NISAR');
  assert.equal(q.get('processingLevel'), 'GCOV');
  assert.equal(q.get('maxResults'), '50');
  assert.match(q.get('intersectsWith'), /^POLYGON\(\(/);
});
