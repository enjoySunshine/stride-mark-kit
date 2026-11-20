/**
 * The stride-mark page: two stacked waveform rows (left = body, right = heel),
 * a selection drawn on the waveform, the six readings, and coarse-first /
 * samples-later loading.
 *
 * Loading order (the point of the page):
 *
 *   1. Put the 100 coarse buckets on screen right away, with the selection.
 *   2. Decode the file in the background.
 *   3. When the samples land, swap the bars and the contacts to sample values,
 *      and leave the selection exactly where the user dragged it.
 *
 * A decode result that lands after a newer track was chosen is dropped: it
 * belongs to a waveform that is no longer on screen, so it must not change the
 * contacts of the one that is.
 */

import { footstepBuckets, toneBuckets, ambientBuckets } from './fixtures.js'
import { createStrideState } from './state.js'
import { normalizeRange } from './model.js'

const TRACKS = {
  footstep: {
    id: 'footstep',
    label: 'Landing',
    url: '/examples/audio/footstep.wav',
    duration: 0.5,
    buckets: footstepBuckets,
  },
  tone: {
    id: 'tone',
    label: 'Test tone',
    url: '/examples/audio/tone.wav',
    duration: 0.5,
    buckets: toneBuckets,
  },
  ambient: {
    id: 'ambient',
    label: 'Ambient bed',
    url: '/examples/audio/ambient.wav',
    duration: 120,
    buckets: ambientBuckets,
  },
  broken: {
    id: 'broken',
    label: 'Undecodable file',
    url: '/examples/audio/not-audio.txt',
    duration: 0.5,
    // The coarse stage exists even though the decode will fail: a plausible
    // landing pattern, so the failure keeps something visible to compare with.
    buckets: footstepBuckets,
  },
}

const formatPeak = (peak) => (peak == null ? '—' : String(Math.round(peak * 1000) / 1000))
const formatSeconds = (value) => `${Math.round(value * 1000) / 1000}s`

// One-shot handoff for "open a second page": the second page reads the exact
// track and selection this one is showing, then removes the entry, so a plain
// reload later starts from the defaults again.
const HANDOFF_KEY = 'stride-mark-kit:handoff'

function writeHandoff(track, selection) {
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ track, start: selection.start, end: selection.end }))
  } catch {
    // Storage may be unavailable (private mode); the second page then just
    // starts from the same defaults, which still match for the whole clip.
  }
}

function takeHandoff() {
  try {
    const raw = localStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    localStorage.removeItem(HANDOFF_KEY)
    const parsed = JSON.parse(raw)
    return parsed && TRACKS[parsed.track] ? parsed : null
  } catch {
    return null
  }
}

/**
 * Build the page's DOM under `root`: the two-row waveform, the six readings,
 * and the controls. Done here rather than in markup so the same page can be
 * opened standalone or through the examples preview.
 */
function buildMarkup(root) {
  root.innerHTML = `
    <style>
      .stride-main { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; }
      .stride-sheet { flex: 1 1 460px; min-width: 320px; }
      .stride-wave { width: 100%; }
      .stride-reading { flex: 0 0 19rem; display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1rem; font-variant-numeric: tabular-nums; margin: 0; }
      .stride-reading dt { color: #666; }
      .stride-reading dd { margin: 0; font-weight: 600; }
      .stride-contact-left { color: #a33; }
      .stride-contact-right { color: #358; }
      .stride-controls { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin-top: .75rem; }
      .stride-status { margin-top: .5rem; color: #555; font-size: .9rem; min-height: 1.2rem; }
      .stride-note { color: #555; font-size: .88rem; }
      .stride-playhead { margin-top: .25rem; font-variant-numeric: tabular-nums; color: #555; font-size: .9rem; }
      @media (prefers-color-scheme: dark) {
        .stride-reading dt, .stride-status, .stride-note, .stride-playhead { color: #aaa; }
        .stride-contact-left { color: #f99; }
        .stride-contact-right { color: #9cf; }
      }
    </style>
    <main class="stride-main">
      <section class="stride-sheet">
        <div id="stride-waveform" class="stride-wave"></div>
        <div id="stride-status" class="stride-status"></div>
        <div id="stride-playhead" class="stride-playhead">Playhead: 0s</div>
        <div class="stride-controls">
          <button id="stride-load-footstep" type="button">Load landing</button>
          <button id="stride-load-tone" type="button">Load test tone</button>
          <button id="stride-load-ambient" type="button">Load ambient bed</button>
          <button id="stride-load-broken" type="button">Load undecodable</button>
          <button id="stride-export" type="button">Export 100 buckets</button>
          <button id="stride-play" type="button">Play / pause</button>
          <button id="stride-second" type="button">Open a second page</button>
        </div>
        <p id="stride-note" class="stride-note">Drag across the waveform to move the selection. The playhead stays put where you click.</p>
      </section>
      <dl class="stride-reading">
        <dt>Current</dt>
        <dd id="stride-r-current">—</dd>
        <dt>Left contact</dt>
        <dd id="stride-r-left" class="stride-contact-left">—</dd>
        <dt>Left peak</dt>
        <dd id="stride-r-left-peak">—</dd>
        <dt>Right contact</dt>
        <dd id="stride-r-right" class="stride-contact-right">—</dd>
        <dt>Right peak</dt>
        <dd id="stride-r-right-peak">—</dd>
        <dt>Selection</dt>
        <dd id="stride-r-selection">—</dd>
      </dl>
    </main>
  `
}

/**
 * @param {typeof import('../../dist/wavesurfer.esm.js').default} WaveSurfer
 *   passed in by the example entry, whose bare 'wavesurfer.js' import the
 *   examples preview rewrites to the built bundle.
 * @param {{root?: HTMLElement, delay?: number, track?: string, start?: number, end?: number}} options
 */
export function start(WaveSurfer, options = {}) {
  if (!WaveSurfer) throw new Error('start(WaveSurfer, options) needs the WaveSurfer class')
  const root = options.root || document.body
  buildMarkup(root)

  const $ = (id) => root.querySelector(`#${id}`)
  const texts = {
    current: $('stride-r-current'),
    left: $('stride-r-left'),
    leftPeak: $('stride-r-left-peak'),
    right: $('stride-r-right'),
    rightPeak: $('stride-r-right-peak'),
    selection: $('stride-r-selection'),
    status: $('stride-status'),
    note: $('stride-note'),
    playhead: $('stride-playhead'),
  }

  const state = createStrideState()

  const wavesurfer = WaveSurfer.create({
    container: $('stride-waveform'),
    height: 96,
    splitChannels: [{ waveColor: 'rgb(200, 90, 60)' }, { waveColor: 'rgb(60, 110, 200)' }],
    waveColor: 'rgb(150, 80, 60)',
    progressColor: 'rgb(90, 50, 40)',
    cursorColor: '#111',
    cursorWidth: 1,
    barWidth: 2,
    barGap: 1,
    // Never rescale the bars to the tallest one: a bar's height reads as the
    // peak value itself, and the export must not be a canvas-scaled number.
    normalize: false,
    // Selection drags belong to the page, not to drag-to-seek.
    dragToSeek: false,
    fillParent: true,
    interact: true,
    // Decoding is the page's own job (it needs the file's sample indices), so
    // WaveSurfer only ever renders peaks here. The rate is still the file's.
    sampleRate: 48000,
  })

  // ---- selection overlay on the waveform -------------------------------

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '0',
    zIndex: '6',
    pointerEvents: 'none',
  })
  wavesurfer.getWrapper().appendChild(overlay)

  const shade = document.createElement('div')
  Object.assign(shade.style, {
    position: 'absolute',
    top: '0',
    height: '0',
    background: 'rgba(255, 200, 0, 0.18)',
    borderLeft: '1px solid rgba(140, 100, 0, 0.7)',
    borderRight: '1px solid rgba(140, 100, 0, 0.7)',
    pointerEvents: 'none',
  })
  overlay.appendChild(shade)

  function marker(color) {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'absolute',
      top: '0',
      width: '0',
      borderLeft: `2px solid ${color}`,
      height: '0',
      pointerEvents: 'none',
    })
    overlay.appendChild(el)
    return el
  }
  const leftMarker = marker('#c33')
  const rightMarker = marker('#36c')

  function timeToPercent(time, duration) {
    return duration > 0 ? (time / duration) * 100 : 0
  }

  function placeMarker(el, contact, frame, height) {
    if (!contact) {
      el.style.height = '0'
      return
    }
    el.style.height = `${height}px`
    // The marker sits on the bar that covers the contact: a sample at its own
    // time, a coarse bucket at the middle of its bar (the bar spans 1/100th
    // of the waveform, so bucket 30 -> 30.5%).
    el.style.left = `${timeToPercent(contact.time, frame.duration)}%`
  }

  function drawSelection() {
    const frame = state.getFrame()
    const duration = frame.duration
    if (!duration) return
    const snapshot = state.getSnapshot()
    const { start, end } = normalizeRange(snapshot.selection, duration)
    const wrapper = wavesurfer.getWrapper()
    const height = wrapper.clientHeight
    overlay.style.height = `${height}px`
    shade.style.height = `${height}px`
    shade.style.left = `${timeToPercent(start, duration)}%`
    shade.style.width = `${Math.max(0.0001, timeToPercent(end - start, duration))}%`

    placeMarker(leftMarker, snapshot.left, frame, height)
    placeMarker(rightMarker, snapshot.right, frame, height)
  }

  // ---- readings ---------------------------------------------------------

  function renderReadings() {
    const snapshot = state.getSnapshot()
    const frame = state.getFrame()
    const unit = frame.level === 'samples' ? 'sample' : 'bucket'

    texts.current.textContent = snapshot.track || '—'
    texts.left.textContent = snapshot.left ? `${unit} ${snapshot.left.index}` : '—'
    texts.leftPeak.textContent = formatPeak(snapshot.left ? snapshot.left.peak : null)
    texts.right.textContent = snapshot.right ? `${unit} ${snapshot.right.index}` : '—'
    texts.rightPeak.textContent = formatPeak(snapshot.right ? snapshot.right.peak : null)
    texts.selection.textContent = `${formatSeconds(snapshot.selection.start)} – ${formatSeconds(
      snapshot.selection.end,
    )}`
    texts.status.textContent =
      snapshot.status === 'samples'
        ? 'Samples decoded: bars and contacts are sample values.'
        : snapshot.status === 'failed'
          ? 'Decode failed: coarse buckets and the selection stay, contacts stay on the buckets.'
          : 'Coarse buckets on screen; samples are still decoding.'

    drawSelection()
  }

  state.subscribe(renderReadings)

  // ---- playhead ---------------------------------------------------------

  wavesurfer.on('timeupdate', (time) => {
    texts.playhead.textContent = `Playhead: ${Math.round(time * 1000) / 1000}s`
  })

  // ---- selection drag ---------------------------------------------------

  {
    let pressed = false
    let dragging = false
    let selectionJustDragged = false
    let anchor = 0
    let startX = 0
    const wrapper = wavesurfer.getWrapper()

    const timeAt = (clientX) => {
      const rect = wrapper.getBoundingClientRect()
      const ratio = rect.width ? (clientX - rect.left) / rect.width : 0
      return Math.max(0, Math.min(1, ratio)) * state.getFrame().duration
    }

    wrapper.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      pressed = true
      dragging = false
      selectionJustDragged = false
      startX = event.clientX
      anchor = timeAt(event.clientX)
    })

    wrapper.addEventListener('pointermove', (event) => {
      if (!pressed) return
      // A small threshold keeps a plain click a seek (a click leaves the
      // selection alone), while a real drag turns into a selection.
      if (!dragging && Math.abs(event.clientX - startX) < 4) return
      dragging = true
      selectionJustDragged = true
      const time = timeAt(event.clientX)
      state.setSelection({ start: Math.min(anchor, time), end: Math.max(anchor, time) })
    })

    const finish = (event) => {
      if (!pressed) return
      pressed = false
      if (dragging) {
        const time = timeAt(event.clientX)
        state.setSelection({ start: Math.min(anchor, time), end: Math.max(anchor, time) })
      }
      dragging = false
    }
    wrapper.addEventListener('pointerup', finish)
    wrapper.addEventListener('pointercancel', finish)

    // After a selection drag, do not also seek: the wavesurfer click listener
    // would otherwise move the playhead at the end of every drag. Capture runs
    // before the wrapper's own bubble listener.
    wrapper.addEventListener(
      'click',
      (event) => {
        if (selectionJustDragged) {
          event.stopPropagation()
          event.preventDefault()
          selectionJustDragged = false
        }
      },
      { capture: true },
    )
  }

  // ---- loading: buckets first, samples later ---------------------------

  // The delay makes the coarse stage observable in the demo (and lets the
  // selection be changed before the samples land). The example entry reads
  // ?delay=0 from the preview's parent page and passes it as `options.delay`.
  const decodeDelay = Math.max(0, options.delay ?? 900)
  // A second page opened from this one picks up the same track and selection.
  const restored = takeHandoff()
  const initialTrack =
    restored && TRACKS[restored.track]
      ? restored.track
      : options.track && TRACKS[options.track]
        ? options.track
        : 'footstep'
  const startParam = Number(options.start ?? (restored ? restored.start : NaN))
  const endParam = Number(options.end ?? (restored ? restored.end : NaN))

  let loadToken = 0
  let currentTrack = 'footstep'

  function trackFor(key) {
    const track = TRACKS[key]
    if (!track) return null
    // Choosing a track resets the selection to its whole clip. A URL-provided
    // selection is applied AFTER the coarse frame is up, as if the user had
    // dragged it, so it is not clobbered by this reset.
    return { track, selection: { start: 0, end: track.duration } }
  }

  // The same waveform on a second page: pass the same ?track/?start/?end and
  // both pages settle on the same six rows. Contacts are read from the coarse
  // frame here and re-read from the sample frame when it arrives, so the
  // selection is a plain drag that survives the level change.
  const hasUrlSelection = Number.isFinite(startParam) && Number.isFinite(endParam)
  function applyUrlSelection() {
    if (!hasUrlSelection) return
    state.setSelection({ start: startParam, end: endParam })
  }

  async function loadTrack(key) {
    const chosen = trackFor(key)
    if (chosen) currentTrack = key
    if (!chosen) return
    const { track, selection } = chosen
    const token = ++loadToken

    // 1. Coarse first: buckets, selection and contacts go on screen now.
    state.setTrack(track, selection)
    // A URL-provided selection is applied on the coarse frame, exactly like a
    // drag made before any samples land.
    applyUrlSelection()
    const generation = state.getGeneration()
    // Draw the coarse frame and point the media element at the clip (so the
    // playhead works). Await it: replacePeaks() is skipped while a load is in
    // flight, and the samples must be swapped in when they land.
    await wavesurfer.load(track.url, state.getFrame().buckets, state.getFrame().duration).catch(() => undefined)
    if (token !== loadToken) return

    // 2. Decode the real audio in the background.
    try {
      const response = await fetch(track.url)
      if (!response.ok) throw new Error(`Failed to fetch ${track.url}: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      if (token !== loadToken) return // a newer track is already on screen

      if (decodeDelay > 0) await new Promise((resolve) => setTimeout(resolve, decodeDelay))
      if (token !== loadToken) return

      const audioBuffer = await decodeAt48k(arrayBuffer)
      if (token !== loadToken) return

      const channels = []
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c))
      if (!state.setSamples(track.id, generation, channels, audioBuffer.duration)) return

      // 3. Swap the drawn bars to the samples WITHOUT reloading the media:
      // replacePeaks re-renders from the buffer we decoded (sharing the same
      // Float32Arrays, so the audio is not held twice), leaving the playhead
      // and the media source alone.
      wavesurfer.replacePeaks(state.getFrame().channels, state.getFrame().duration)
    } catch (error) {
      if (token !== loadToken) return
      // The coarse buckets and the selection stay on screen; contacts stay on
      // the buckets.
      console.warn(error)
      state.setFailed(track.id, generation)
    }
  }

  async function decodeAt48k(arrayBuffer) {
    // Decode at the file's own rate so sample indices are the file's sample
    // indices (4000, 4800, ...), not resampled ones.
    const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 })
    try {
      return await context.decodeAudioData(arrayBuffer)
    } finally {
      if (context.state !== 'closed') await context.close().catch(() => undefined)
    }
  }

  // ---- controls ---------------------------------------------------------

  $('stride-load-footstep').addEventListener('click', () => loadTrack('footstep'))
  $('stride-load-tone').addEventListener('click', () => loadTrack('tone'))
  $('stride-load-ambient').addEventListener('click', () => loadTrack('ambient'))
  $('stride-load-broken').addEventListener('click', () => loadTrack('broken'))
  $('stride-play').addEventListener('click', () => wavesurfer.playPause())
  $('stride-second').addEventListener('click', () => {
    // Hand this page's track and selection to a fresh page and open it. Both
    // pages show the same waveform and settle on the same six rows.
    const snapshot = state.getSnapshot()
    writeHandoff(currentTrack, snapshot.selection)
    const parentHref = window.parent && window.parent !== window ? window.parent.location.href : ''
    const base = parentHref && /^https?:/.test(parentHref) ? parentHref : location.href
    window.open(`${base.split('#')[0]}#landing-contacts.js`, '_blank')
  })
  $('stride-export').addEventListener('click', () => {
    const buckets = state.export()
    const left = buckets[0]
    const right = buckets[1]
    texts.note.textContent =
      `Exported ${buckets.length} channels × ${left.length} buckets (whole track, independent of the selection). ` +
      `Left[30] = ${formatPeak(left[30])}, Right[40] = ${formatPeak(right[40])}.`
    console.log('100 whole-track buckets', buckets)
    return buckets
  })

  // Deterministic startup for a second page: same track + selection + delay
  // produce the same six rows once the samples settle.
  renderReadings()
  const firstLoad = loadTrack(initialTrack)
  void firstLoad

  const api = { wavesurfer, state, loadTrack, tracks: TRACKS }
  // Exposed for the console and for end-to-end checks. A second page on the
  // same waveform replaces the handle, the same way it replaces the six rows.
  window.stridePage = api
  return api
}

export default { start }
