import test from 'node:test'; import assert from 'node:assert/strict'
import { diffPixel, baselineMedian, diffGrid, colourise, diffStats, FLOOR_DB } from '../src/lib/diffMap.js'

test('small or missing change is transparent', () => {
  assert.equal(diffPixel(0.4, 3)[3], 0); assert.equal(diffPixel(-(FLOOR_DB - 0.01), 3)[3], 0); assert.equal(diffPixel(NaN, 3)[3], 0)
})
test('darkening is red, brightening is blue, stronger change is more opaque', () => {
  const [r, , b, a] = diffPixel(-4, 3), [r2, , b2, a2] = diffPixel(4, 3)
  assert.ok(r > b && a > 0); assert.ok(b2 > r2 && a2 > 0)
  assert.ok(diffPixel(-6, 3)[3] > diffPixel(-2, 3)[3])
  assert.ok(diffPixel(-9, 3)[3] <= 255)
})
test('baseline median ignores pixels a scene has no data for', () => {
  const g = [Uint8Array.of(10, 100, 50), Uint8Array.of(30, 0, 70), Uint8Array.of(20, 200, 60)]
  const a = [Uint8Array.of(255, 255, 255), Uint8Array.of(255, 0, 255), Uint8Array.of(255, 255, 0)]
  const m = baselineMedian(g, a)
  assert.equal(m[0], 20); assert.equal(m[1], 150); assert.equal(m[2], 60)
  assert.ok(Number.isNaN(baselineMedian([Uint8Array.of(5)], [Uint8Array.of(0)])[0]))
})
test('diffGrid converts grey levels to dB and masks invalid pixels', () => {
  const d = diffGrid(Uint8Array.of(100, 100, 100), Uint8Array.of(255, 0, 255), Float32Array.of(50, 50, NaN), 0.1)
  assert.ok(Math.abs(d[0] - 5) < 1e-5); assert.ok(Number.isNaN(d[1])); assert.ok(Number.isNaN(d[2]))
})
test('stats count dark and bright shares of valid pixels only', () => {
  const s = diffStats(Float32Array.of(-4, -3, 0, 3.5, NaN, 1), 3)
  assert.equal(s.valid, 5); assert.equal(s.darkPct, 40); assert.equal(s.brightPct, 20)
})
test('colourise yields one RGBA quad per pixel', () => { assert.equal(colourise(Float32Array.of(-5, 0, 5), 3).length, 12) })

test('fast path gives exactly the same picture and statistics as the reference functions', async () => {
  const { baselineMedian, diffGrid, colourise, diffStats, renderDiff } = await import('../src/lib/diffMap.js')
  const n = 5000; const mk = (seed) => { const g = new Uint8Array(n), a = new Uint8Array(n); for (let p = 0; p < n; p++) { g[p] = (p * seed + (p >> 3) * 7) & 255; a[p] = (p + seed) % 11 ? 255 : 0 } return { g, a } }
  for (const K of [1, 2, 3, 4]) {
    const base = Array.from({ length: K }, (_, k) => mk(13 + 4 * k)); const s = mk(101)
    const med = baselineMedian(base.map((b) => b.g), base.map((b) => b.a))
    for (const [scale, thr] of [[0.06, 3], [0.0447, 3], [0.1, 1.5]]) {
      const d = diffGrid(s.g, s.a, med, scale); const fast = renderDiff(s.g, s.a, med, scale, thr)
      assert.deepEqual(Array.from(fast.rgba), Array.from(colourise(d, thr)), `pixels K=${K} scale=${scale}`)
      const ref = diffStats(d, thr)
      assert.equal(fast.stats.valid, ref.valid); assert.ok(Math.abs(fast.stats.darkPct - ref.darkPct) < 1e-9); assert.ok(Math.abs(fast.stats.brightPct - ref.brightPct) < 1e-9)
    }
  }
})
test('median: odd and even counts, missing scenes, all missing', async () => {
  const { baselineMedian } = await import('../src/lib/diffMap.js')
  const g = [[10, 9, 5, 0], [20, 1, 0, 0], [30, 5, 0, 0], [0, 7, 0, 0]].map((r) => Uint8Array.from(r))
  const a = [[255, 255, 255, 0], [255, 255, 0, 0], [255, 255, 0, 0], [0, 255, 0, 0]].map((r) => Uint8Array.from(r))
  const m = baselineMedian(g, a)
  assert.equal(m[0], 20); assert.equal(m[1], 6); assert.equal(m[2], 5); assert.ok(Number.isNaN(m[3]))
})
