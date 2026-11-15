// Earthquake strength for display. Two different things, kept apart on purpose:
//  * MAGNITUDE (M): the energy released at the source. One number per earthquake. Classes follow the usual USGS wording.
//  * INTENSITY (MMI, Modified Mercalli): how hard the ground shook at a place. USGS reports the maximum estimated value
//    (`mmi`) and the maximum reported by people (`cdi`) when it has them. We never estimate intensity ourselves.
export const QUAKE_CLASSES = [
  { min: 8, label: 'Great', color: '#e254ff' },
  { min: 7, label: 'Major', color: '#ff3d5a' },
  { min: 6, label: 'Strong', color: '#ff7b3c' },
  { min: 5, label: 'Moderate', color: '#ffb347' },
  { min: -Infinity, label: 'Light', color: '#ffe08a' },
]
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
/** Class for a magnitude: { label, color, level 1..5 }. null when the magnitude is unknown. */
export function quakeClass(mag) {
  if (!isNum(mag)) return null
  const i = QUAKE_CLASSES.findIndex((c) => mag >= c.min)
  return { ...QUAKE_CLASSES[i], level: QUAKE_CLASSES.length - i }
}
/** Marker diameter in pixels: grows steadily with magnitude, clamped so M4.5 is visible and M9 does not cover a country. */
export const quakeSize = (mag) => (isNum(mag) ? Math.round(Math.max(9, Math.min(34, 9 + (mag - 4.5) * 6.2))) : 9)

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const MMI_WORD = ['Not felt', 'Weak', 'Weak', 'Light', 'Moderate', 'Strong', 'Very strong', 'Severe', 'Violent', 'Extreme', 'Extreme', 'Extreme']
/** Modified Mercalli intensity as roman numeral + shaking word, e.g. 6.4 -> { roman: 'VI', word: 'Strong' }. */
export function mmiLabel(v) {
  if (!isNum(v) || v < 1) return null
  const i = Math.min(12, Math.max(1, Math.round(v))) - 1
  return { roman: ROMAN[i], word: MMI_WORD[i], value: v }
}
/** Everything the hover card shows for one USGS earthquake record (`p` = USGS properties, depthKm from the geometry). */
export function quakeSummary(p, depthKm) {
  const cls = quakeClass(p?.mag); if (!cls) return null
  return {
    mag: p.mag, magType: typeof p.magType === 'string' ? p.magType : null, cls, depthKm: isNum(depthKm) ? depthKm : null,
    shaking: mmiLabel(p.mmi), felt: mmiLabel(p.cdi), feltReports: isNum(p.felt) && p.felt > 0 ? p.felt : null,
    alert: ['green', 'yellow', 'orange', 'red'].includes(p.alert) ? p.alert : null, tsunami: p.tsunami === 1,
  }
}
