// Regression guard for the "page scrolls to top when a toggle is clicked" bug.
// A visually-hidden checkbox must be anchored inside its own label; otherwise focusing it scrolls the sidebar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const rule = (selector) => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

test('.toggle is a positioned ancestor for its hidden checkbox', () => {
  assert.match(rule('.toggle') ?? '', /position:\s*relative/)
})

test('hidden checkbox is absolutely positioned, tiny and invisible (not offset to the page)', () => {
  const r = rule('.toggle input') ?? ''
  assert.match(r, /position:\s*absolute/)
  assert.match(r, /opacity:\s*0/)
  assert.doesNotMatch(r, /\b(top|left|right|bottom|inset)\s*:/)   // static position stays inside the row
})

test('Sidebar Row is not memoised (registry mutates layer objects in place; memo would freeze the toggle)', () => {
  const src = readFileSync(new URL('../src/ui/Sidebar.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /memo\(/)
})

test('LayerRegistry mutates in place and notifies subscribers', async () => {
  const { LayerRegistry } = await import('../src/core/layers/layerRegistry.js')
  const reg = new LayerRegistry([{ id: 'a', group: 'map', label: 'A', visible: true }])
  const ref = reg.get('a'); let notified = 0; reg.subscribe(() => notified++)
  const v0 = reg.getVersion(); reg.toggle('a')
  assert.equal(reg.get('a'), ref)            // same object -> props-based memo would not see the change
  assert.equal(ref.visible, false); assert.ok(notified > 0); assert.ok(reg.getVersion() > v0)
})
