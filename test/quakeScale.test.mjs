import test from 'node:test'
import assert from 'node:assert/strict'
import { quakeClass, quakeSize, mmiLabel, quakeSummary, QUAKE_CLASSES } from '../src/data/quakeScale.js'

test('magnitude classes and levels', () => {
  assert.deepEqual([4.5, 4.9, 5, 5.9, 6, 6.9, 7, 7.5, 8, 9.1].map((m) => quakeClass(m).label), ['Light', 'Light', 'Moderate', 'Moderate', 'Strong', 'Strong', 'Major', 'Major', 'Great', 'Great'])
  assert.equal(quakeClass(7.5).level, 4); assert.equal(quakeClass(4.6).level, 1); assert.equal(quakeClass(8.2).level, 5)
  assert.equal(quakeClass(null), null); assert.equal(quakeClass(NaN), null); assert.equal(QUAKE_CLASSES.length, 5)
})
test('marker size grows with magnitude and is clamped', () => {
  const s = [4.5, 5, 6, 7, 8, 9.5].map(quakeSize)
  assert.ok(s.every((v, i) => i === 0 || v >= s[i - 1])); assert.equal(s[0], 9); assert.ok(s[5] <= 34); assert.equal(quakeSize(undefined), 9)
})
test('intensity labels follow the Modified Mercalli scale; missing values stay missing', () => {
  assert.deepEqual(mmiLabel(6.4), { roman: 'VI', word: 'Strong', value: 6.4 }); assert.equal(mmiLabel(8.6).roman, 'IX'); assert.equal(mmiLabel(1).word, 'Not felt')
  assert.equal(mmiLabel(null), null); assert.equal(mmiLabel(0), null); assert.equal(mmiLabel(14).roman, 'XII')
})
test('summary uses only what USGS reported', () => {
  const q = quakeSummary({ mag: 7.5, magType: 'mww', mmi: 8.9, cdi: 7.2, felt: 512, alert: 'red', tsunami: 1 }, 10)
  assert.equal(q.cls.label, 'Major'); assert.equal(q.shaking.roman, 'IX'); assert.equal(q.felt.roman, 'VII'); assert.equal(q.feltReports, 512); assert.equal(q.alert, 'red'); assert.equal(q.tsunami, true); assert.equal(q.depthKm, 10)
  const bare = quakeSummary({ mag: 5.1, mmi: null, alert: null, tsunami: 0 }, null)
  assert.equal(bare.shaking, null); assert.equal(bare.felt, null); assert.equal(bare.alert, null); assert.equal(bare.tsunami, false); assert.equal(bare.depthKm, null)
  assert.equal(quakeSummary({ mag: null }, 5), null); assert.equal(quakeSummary({ mag: 6, alert: 'purple' }, 5).alert, null)
})
