import test from 'node:test'
import assert from 'node:assert/strict'
import { inWindow, spanCovers, windowSignature, coverageClass, COVERAGE_CLASSES } from '../src/data/acquisitionWindow.js'

const r = (id, iso) => ({ id, startTime: iso })
const D = (s) => Date.parse(s)

test('inWindow: half-open [start, end) on the scene start time', () => {
  const recs = [r('a', '2026-07-01T00:00:00Z'), r('b', '2026-07-02T00:00:00Z'), r('c', '2026-07-03T00:00:00Z'), { id: 'bad', startTime: 'nope' }, { id: 'none' }]
  const out = inWindow(recs, { start: D('2026-07-01T00:00:00Z'), end: D('2026-07-03T00:00:00Z') }).map((x) => x.id)
  assert.deepEqual(out, ['a', 'b']) // c starts exactly at `end`; invalid times are never drawn
})
test('spanCovers: contained windows reuse loaded data, others need a search', () => {
  const span = { start: D('2026-06-01'), end: D('2026-08-01') }
  assert.equal(spanCovers(span, { start: D('2026-07-01'), end: D('2026-07-02') }), true)
  assert.equal(spanCovers(span, { start: D('2026-07-31'), end: D('2026-08-02') }), false)
  assert.equal(spanCovers(null, { start: 0, end: 1 }), false)
  // a window that starts before the timeline itself only needs data from the timeline start
  assert.equal(spanCovers(span, { start: D('2026-05-31'), end: D('2026-06-02') }, D('2026-06-01')), true)
  assert.equal(spanCovers(span, { start: D('2026-05-31'), end: D('2026-06-02') }), false)
})
test('windowSignature: changes when the drawn set changes, not when order does', () => {
  const a = [r('x', 't'), r('y', 't')], b = [r('y', 't'), r('x', 't')]
  assert.equal(windowSignature(a), windowSignature(b))
  assert.notEqual(windowSignature(a), windowSignature([r('x', 't')]))
  assert.equal(windowSignature([]), '0||')
})
test('coverage classes: stepped, contiguous, and every positive count has a class', () => {
  assert.deepEqual(COVERAGE_CLASSES.map((c) => c.label), ['1 scene', '2 scenes', '3 to 4 scenes', '5 or more scenes'])
  for (let n = 1; n <= 40; n++) assert.ok(coverageClass(n), `count ${n}`)
  assert.equal(coverageClass(0), null)
  assert.equal(coverageClass(3).label, '3 to 4 scenes'); assert.equal(coverageClass(31).label, '5 or more scenes')
  const alphas = COVERAGE_CLASSES.map((c) => c.alpha); assert.deepEqual([...alphas].sort(), alphas) // more overlap is never fainter
})
