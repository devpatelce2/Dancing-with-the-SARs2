// Pure helpers that keep drawn footprints in step with the timeline.
// The timeline window is half-open [start, end): a scene starting exactly at `end` is not yet drawn.

export const recordMs = (record) => Date.parse(record?.startTime ?? '')

/** Records whose acquisition start falls inside the window. Records with no valid time are never drawn. */
export function inWindow(records, win) {
  return (records ?? []).filter((r) => { const t = recordMs(r); return Number.isFinite(t) && t >= win.start && t < win.end })
}

/**
 * Does a loaded span already hold everything the window needs? `floor` is the timeline's own start: a window that
 * begins before it only needs data from the floor onward, because no scene before the timeline can be selected.
 */
export function spanCovers(span, win, floor = -Infinity) {
  if (!span) return false
  return Math.max(win.start, floor) >= span.start && win.end <= span.end
}

/** Cheap identity for a drawn set, so the canvas is only repainted when the set really changed. */
export function windowSignature(records) {
  const ids = (records ?? []).map((r) => r.id).sort()
  return `${ids.length}|${ids[0] ?? ''}|${ids[ids.length - 1] ?? ''}`
}

/**
 * Footprint-density classes. The density view counts how many acquisitions cover each point on the map.
 * It says nothing about radar brightness (backscatter), which is a property of the image, not of the catalogue.
 */
export const COVERAGE_CLASSES = [
  { min: 1, max: 1, label: '1 scene', alpha: 0.32 },
  { min: 2, max: 2, label: '2 scenes', alpha: 0.5 },
  { min: 3, max: 4, label: '3 to 4 scenes', alpha: 0.7 },
  { min: 5, max: Infinity, label: '5 or more scenes', alpha: 0.9 },
]
export function coverageClass(count) {
  return COVERAGE_CLASSES.find((c) => count >= c.min && count <= c.max) ?? null
}
