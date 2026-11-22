// jsdom integration test for the full LandingController lifecycle:
// coarse-first painting, pre-decode selection drags, sample arrival, stale
// decode rejection, decode failure, and cross-page state sharing.
//
//   node --test examples/landing/landing.test.js
//
// WaveSurfer itself is replaced by a minimal DOM-backed double, so the test
// exercises our controller, not the library rendering.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
// Same tracks.js instance the rewritten controller imports (both resolve to
// this sibling file), so the failure flag set here is the one it reads.
import { setFailNextDecode, resetDecodeState } from './tracks.js'

const dom = new JSDOM('<!DOCTYPE html><body></body>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.BroadcastChannel = window.BroadcastChannel
globalThis.localStorage = window.localStorage
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.Blob = window.Blob
globalThis.DataView = DataView
// The test instantiates LandingController itself; suppress the module's auto-boot.
window.__landingManualBoot = true
globalThis.Float32Array = Float32Array

// The test double lives in a real module so no nested data-URL imports are
// needed when redirecting the controller's bare 'wavesurfer.js' specifier.

// Build the DOM the controller expects.
function mountDom() {
  document.body.innerHTML = `
    <div id="waveform"><div id="overlay-layer"><div id="selection"></div><div id="markers"></div></div></div>
    <button data-track="footstep"></button>
    <button data-track="trial-tone"></button>
    <button data-track="ambient"></button>
    <button id="narrow-selection"></button>
    <button id="full-selection"></button>
    <button id="fail-decode"></button>
    <button id="export-buckets"></button>
    <button id="play"></button>
    <div id="export-output"></div>
    <span id="readout-track"></span>
    <span id="readout-left-contact"></span>
    <span id="readout-left-peak"></span>
    <span id="readout-right-contact"></span>
    <span id="readout-right-peak"></span>
    <span id="readout-selection"></span>
    <span id="readout-level"></span>
    <span id="readout-time"></span>`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Node cannot import a module that bare-imports 'wavesurfer.js', so rewrite the
// controller source: redirect the bare library name to the DOM-backed double and
// the root-absolute helper paths to sibling relative paths. The rewritten entry
// is written INTO this directory (not /tmp) so every import resolves inside one
// module graph and tracks.js's failNext flag is a single shared instance.
const { readFile, writeFile } = await import('node:fs/promises')
const sourcePath = new URL('../landing.js', import.meta.url)
const controllerSource = await readFile(sourcePath, 'utf8')

const redirected = controllerSource
  .replace("from 'wavesurfer.js'", "from './fake-wavesurfer.js'")
  .replaceAll('/examples/landing/contact-model.js', './contact-model.js')
  .replaceAll('/examples/landing/tracks.js', './tracks.js')
  .replaceAll('/examples/landing/shared-store.js', './shared-store.js')

const tempEntry = new URL('./.landing-controller.entry.js', import.meta.url)
await writeFile(tempEntry, redirected)
const entryUrl = tempEntry

let LandingController
let liveControllers = []
beforeEach(async () => {
  mountDom()
  localStorage.clear()
  liveControllers = []
  // Import the rewritten entry WITHOUT a cache-busting query: a query suffix
  // would instantiate the whole graph (including tracks.js's failNext flag) a
  // second time, so the flag the test sets would not be the one the controller
  // reads. Isolation comes from destroy() in afterEach + resetDecodeState().
  ;({ LandingController } = await import(entryUrl.href))
  resetDecodeState()
})
afterEach(() => {
  // Destroy EVERY controller created during the test (a track switch builds a
  // new one without dropping the old reference from window.__landing); each
  // instance cancels all decode timers it ever started.
  liveControllers.forEach((c) => c.destroy?.())
  liveControllers = []
  document.body.innerHTML = ''
})

test.after(async () => {
  const { rm } = await import('node:fs/promises')
  await rm(tempEntry, { force: true })
})

const text = (id) => document.querySelector(id).textContent.trim()
const controller = () => {
  const instance = new LandingController()
  liveControllers.push(instance)
  return instance
}

test('coarse buckets paint first with contacts 30/40 before samples arrive', async () => {
  const c = controller()
  await sleep(250) // coarse timer (~120ms) fired, samples (~1200ms) pending
  assert.equal(text('#readout-level'), '粗桶')
  assert.equal(text('#readout-left-contact'), '30（桶）')
  assert.equal(text('#readout-left-peak'), '0.8')
  assert.equal(text('#readout-right-contact'), '40（桶）')
  assert.equal(text('#readout-right-peak'), '-0.55')
  assert.equal(c.ws.lastLoad.kind, 'load')
})

test('a pre-decode narrowed selection moves contacts to buckets 16/20', async () => {
  controller()
  await sleep(250)
  document.querySelector('#narrow-selection').click()
  assert.equal(text('#readout-level'), '粗桶')
  assert.equal(text('#readout-left-contact'), '16（桶）')
  assert.equal(text('#readout-left-peak'), '0.25')
  assert.equal(text('#readout-right-contact'), '20（桶）')
  assert.equal(text('#readout-right-peak'), '0.4')
  assert.match(text('#readout-selection'), /0\.080.*0\.120/)
})

test('sample arrival switches contacts to 4000/4800 while keeping the dragged selection', async () => {
  controller()
  await sleep(250)
  document.querySelector('#narrow-selection').click()
  await sleep(1400) // samples arrived
  assert.equal(text('#readout-level'), '采样')
  assert.match(text('#readout-selection'), /0\.080.*0\.120/)
  assert.equal(text('#readout-left-contact'), '4000（采样）')
  assert.equal(text('#readout-left-peak'), '0.25')
  assert.equal(text('#readout-right-contact'), '4800（采样）')
  assert.equal(text('#readout-right-peak'), '0.4')
  // The 0.8 bar is still exported but no longer marked as a contact.
  const [left] = window.__landing.exportBuckets()
  assert.equal(left[30], 0.8)
  assert.equal(document.querySelectorAll('.contact-marker').length, 2)
})

test('full-duration sample contacts are 7200 (+0.8) and 9600 (-0.55)', async () => {
  controller()
  await sleep(1500)
  assert.equal(text('#readout-left-contact'), '7200（采样）')
  assert.equal(text('#readout-left-peak'), '0.8')
  assert.equal(text('#readout-right-contact'), '9600（采样）')
  assert.equal(text('#readout-right-peak'), '-0.55')
})

test('a stale trial-tone decode cannot change footstep contacts after switching', async () => {
  controller()
  await sleep(200)
  document.querySelector('[data-track="trial-tone"]').click()
  await sleep(50)
  document.querySelector('[data-track="footstep"]').click()
  await sleep(1600) // both decodes have now resolved
  assert.equal(text('#readout-level'), '采样')
  assert.equal(text('#readout-left-contact'), '7200（采样）')
  assert.equal(text('#readout-right-contact'), '9600（采样）')
  assert.ok(!text('#readout-track').includes('100'))
})

test('switching tracks resets the selection to the new full duration (end excluded)', async () => {
  controller()
  await sleep(200)
  document.querySelector('#narrow-selection').click()
  assert.match(text('#readout-selection'), /0\.080.*0\.120/)
  // Trial tone, then footstep: the selection must return to 0–0.5 s.
  document.querySelector('[data-track="trial-tone"]').click()
  await sleep(50)
  assert.match(text('#readout-selection'), /0\.000.*0\.500/)
  document.querySelector('[data-track="footstep"]').click()
  await sleep(50)
  assert.match(text('#readout-selection'), /0\.000.*0\.500/)
  // And the two-minute ambient bed resets to its own 0–120 s span.
  document.querySelector('[data-track="ambient"]').click()
  await sleep(50)
  assert.match(text('#readout-selection'), /0\.000.*120\.000/)
})

test('decode failure keeps coarse buckets, selection and contacts', async () => {
  const c = controller()
  await sleep(200)
  document.querySelector('#narrow-selection').click()
  setFailNextDecode(true)
  await sleep(1400)
  assert.match(text('#readout-level'), /粗桶/)
  assert.equal(text('#readout-left-contact'), '16（桶）')
  assert.equal(text('#readout-right-contact'), '20（桶）')
  assert.match(text('#readout-selection'), /0\.080.*0\.120/)
  assert.ok(c.buckets !== null)
})

test('100-bucket export is stable across selection and level', async () => {
  const c = controller()
  await sleep(250)
  const coarseFull = c.exportBuckets()
  document.querySelector('#narrow-selection').click()
  const coarseNarrow = c.exportBuckets()
  await sleep(1400)
  const sampleLevel = c.exportBuckets()
  for (const [l, r] of [coarseFull, coarseNarrow, sampleLevel]) {
    assert.equal(l.length, 100)
    assert.equal(r.length, 100)
    assert.equal(l[30], 0.8)
    assert.equal(r[40], -0.55)
  }
  assert.deepEqual(sampleLevel, coarseFull)
})

test('only one level is retained after samples arrive (coarse buckets released)', async () => {
  const c = controller()
  await sleep(250)
  assert.ok(c.buckets !== null && c.samples === null)
  await sleep(1400)
  assert.ok(c.samples !== null && c.buckets === null)
})

test('state is shared so a second controller restores the same readout lines', async () => {
  controller()
  await sleep(250)
  document.querySelector('#narrow-selection').click()
  await sleep(1400)
  const snapshot = [
    '#readout-track',
    '#readout-left-contact',
    '#readout-left-peak',
    '#readout-right-contact',
    '#readout-right-peak',
    '#readout-selection',
  ].map((id) => text(id))

  // A fresh controller in the same storage/broadcast scope restores state.
  mountDom()
  const second = new LandingController()
  liveControllers.push(second)
  await sleep(50)
  const restored = [
    '#readout-track',
    '#readout-left-contact',
    '#readout-left-peak',
    '#readout-right-contact',
    '#readout-right-peak',
    '#readout-selection',
  ].map((id) => text(id))
  assert.deepEqual(restored, snapshot)
  assert.equal(second.level, 'samples')
})
