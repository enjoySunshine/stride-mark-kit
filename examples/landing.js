// Landing-footstep contact example:
// coarse buckets paint first, decoded samples arrive later, and the contact
// markers always follow whichever level + selection are current at that moment.

import WaveSurfer from 'wavesurfer.js'
import { coarseContact, sampleContact, exportBuckets } from '/examples/landing/contact-model.js'
import {
  TRACKS,
  FOOTSTEP,
  BUCKET_COUNT,
  startDecode,
  cancelDecode,
  decodeSamples,
  encodeWav,
  setFailNextDecode,
} from '/examples/landing/tracks.js'
import { createBridge, readState } from '/examples/landing/shared-store.js'

const SAMPLE_RATE = 48000

export class LandingController {
  constructor() {
    this.ws = WaveSurfer.create({
      container: '#waveform',
      height: 180,
      splitChannels: [
        { waveColor: 'rgb(200, 60, 60)', progressColor: 'rgb(120, 30, 30)' },
        { waveColor: 'rgb(60, 120, 200)', progressColor: 'rgb(30, 70, 120)' },
      ],
      // The export reads original values, never canvas-stretched heights.
      normalize: false,
      interact: false,
      cursorWidth: 1,
      cursorColor: 'rgb(255, 255, 255)',
    })

    this.bridge = createBridge()
    this.timers = null
    // Every decode this instance starts, kept so destroy() can cancel a timer
    // even after loadTrack() replaced this.timers with a newer handle.
    this.ownedTimers = new Set()
    this.generation = 0

    this.track = FOOTSTEP
    this.level = 'coarse'
    this.selection = { start: 0, end: FOOTSTEP.duration }
    this.buckets = null
    this.samples = null

    this.overlay = document.querySelector('#selection')
    this.markerLayer = document.querySelector('#markers')
    this.readouts = {
      track: document.querySelector('#readout-track'),
      leftContact: document.querySelector('#readout-left-contact'),
      leftPeak: document.querySelector('#readout-left-peak'),
      rightContact: document.querySelector('#readout-right-contact'),
      rightPeak: document.querySelector('#readout-right-peak'),
      selection: document.querySelector('#readout-selection'),
      level: document.querySelector('#readout-level'),
      time: document.querySelector('#readout-time'),
    }

    this.bindUi()
    this.bridge.subscribe((state) => this.applyRemoteState(state))

    if (typeof window !== 'undefined') window.__landing = this

    const restored = readState(FOOTSTEP.id)
    const initialTrack = TRACKS.find((item) => item.id === restored.trackId) ?? FOOTSTEP
    this.selection = restored.selection
    this.loadTrack(initialTrack, restored.level, false)
  }

  // ---- track / decode lifecycle -------------------------------------------------

  /** Cancel in-flight decodes and tear down the underlying waveform. */
  destroy() {
    this.ownedTimers.forEach((timers) => cancelDecode(timers))
    this.ownedTimers.clear()
    this.timers = null
    this.generation += 1 // any timer that was already queued is now stale
    this.ws.destroy()
  }

  switchTrack(track) {
    this.selection = { start: 0, end: track.duration }
    this.loadTrack(track)
  }

  loadTrack(track, level = 'coarse', publish = true) {
    // Cancel any decode this instance still has queued before starting a new one.
    this.ownedTimers.forEach((timers) => cancelDecode(timers))
    this.ownedTimers.clear()
    this.timers = null
    this.generation += 1
    const myGeneration = this.generation

    this.track = track
    this.buckets = null
    this.samples = null
    if (this.selection.end > track.duration || this.selection.start >= track.duration) {
      this.selection = { start: 0, end: track.duration }
    }

    // A page restored/synced straight to sample level paints it immediately,
    // so two pages on the same waveform show identical readout lines.
    if (level === 'samples') {
      this.level = 'samples'
      this.samples = decodeSamples(track)
      this.paint(this.samples, track.duration)
      this.refresh()
      if (publish) this.publish()
      return
    }

    this.level = 'coarse'
    const decode = startDecode(track, {
      onCoarse: (buckets) => {
        if (myGeneration !== this.generation) return // user already switched tracks
        // Keep decode.timers in ownedTimers: the samples timeout is still live
        // even though the coarse timeout already fired.
        this.buckets = buckets
        this.level = 'coarse'
        this.paint(buckets, track.duration)
        this.refresh()
        this.publish()
      },
      onSamples: (samples) => {
        if (myGeneration !== this.generation) return // stale decode must not touch contacts
        this.ownedTimers.delete(decode.timers)
        this.samples = samples
        this.buckets = null // release the coarse level: only one level retained
        this.level = 'samples'
        this.paint(samples, track.duration)
        this.refresh()
        this.publish()
      },
      onError: () => {
        if (myGeneration !== this.generation) return
        this.ownedTimers.delete(decode.timers)
        // Decode failed: painted buckets and selection stay, contacts stay coarse.
        this.level = 'failed'
        this.refresh()
        this.publish()
      },
    })
    this.timers = decode.timers
    this.ownedTimers.add(decode.timers)

    if (publish) this.publish()
    this.refresh()
  }

  paint(peaks, duration) {
    if (this.level === 'samples') {
      // Sample level: the WAV blob makes the same load both paint and play.
      const blob = encodeWav(peaks)
      this.ws.loadBlob(blob, peaks, duration).catch(() => undefined)
    } else {
      // Coarse level: peaks with an empty url paint immediately, silently.
      this.ws.load('', peaks, duration).catch(() => undefined)
    }
    // The overlay is positioned in percentages; redraw once layout is done.
    requestAnimationFrame(() => this.renderOverlay())
  }

  // ---- contact computation ------------------------------------------------------

  computeContacts() {
    if (this.level === 'samples' && this.samples) {
      return {
        level: 'samples',
        left: sampleContact(this.samples[0], this.selection),
        right: sampleContact(this.samples[1], this.selection),
      }
    }
    const buckets = this.buckets ?? [[], []]
    return {
      level: this.level,
      left: coarseContact(buckets[0], this.track.duration, this.selection),
      right: coarseContact(buckets[1], this.track.duration, this.selection),
    }
  }

  refresh() {
    // Track, selection and level always reflect the current state, even before
    // the first coarse buckets paint (e.g. a track switch resets the selection).
    this.readouts.track.textContent = this.track.label
    this.readouts.selection.textContent = `${this.selection.start.toFixed(3)} s – ${this.selection.end.toFixed(3)} s（终点不算）`
    this.readouts.level.textContent =
      this.level === 'samples' ? '采样' : this.level === 'failed' ? '粗桶（解码失败，保留粗桶）' : '粗桶'
    this.renderOverlay()

    // Contact readouts/markers wait for real data instead of flashing empty.
    if (this.level !== 'samples' && !this.buckets) return

    const contacts = this.computeContacts()
    const unit = contacts.level === 'samples' ? '采样' : '桶'
    const formatContact = (contact) => (contact.index < 0 ? '—（选区内无峰值）' : `${contact.index}（${unit}）`)
    const formatPeak = (contact) => (contact.index < 0 ? '—' : contact.peak.toString())

    this.readouts.leftContact.textContent = formatContact(contacts.left)
    this.readouts.leftPeak.textContent = formatPeak(contacts.left)
    this.readouts.rightContact.textContent = formatContact(contacts.right)
    this.readouts.rightPeak.textContent = formatPeak(contacts.right)

    this.renderMarkers(contacts)
  }

  /** Whole-duration 100-bucket export; unchanged by selection or level. */
  exportBuckets() {
    return exportBuckets(this.level, { buckets: this.buckets, samples: this.samples }, BUCKET_COUNT)
  }

  // ---- selection overlay + contact markers --------------------------------------

  timeToPercent(time) {
    return (time / this.track.duration) * 100
  }

  xToTime(clientX) {
    const rect = this.ws.getWrapper().getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * this.track.duration
  }

  renderOverlay() {
    const left = this.timeToPercent(this.selection.start)
    const width = this.timeToPercent(this.selection.end) - left
    this.overlay.style.left = `${left}%`
    this.overlay.style.width = `${Math.max(0, width)}%`
  }

  markerTime(contact) {
    if (contact.index < 0) return null
    if (this.level === 'samples' && this.samples) return contact.index / SAMPLE_RATE
    // Coarse level: mark the bar (bucket) that contains the contact.
    return ((contact.index + 0.5) / BUCKET_COUNT) * this.track.duration
  }

  renderMarkers(contacts) {
    this.markerLayer.innerHTML = ''
    // The two split-channel rows each take half of the wrapper height.
    const place = (contact, rowIndex, color) => {
      const time = this.markerTime(contact)
      if (time === null) return
      const marker = document.createElement('div')
      marker.className = 'contact-marker'
      marker.dataset.contactIndex = String(contact.index)
      marker.style.borderColor = color
      marker.style.left = `${this.timeToPercent(time)}%`
      marker.style.top = `${rowIndex * 50}%`
      marker.style.height = '50%'
      this.markerLayer.appendChild(marker)
    }
    place(contacts.left, 0, 'rgb(255, 120, 120)')
    place(contacts.right, 1, 'rgb(120, 180, 255)')
  }

  // ---- UI bindings ---------------------------------------------------------------

  bindUi() {
    document.querySelectorAll('[data-track]').forEach((button) => {
      button.addEventListener('click', () => {
        const track = TRACKS.find((item) => item.id === button.dataset.track)
        // A manual track switch resets the selection to the new clip's whole
        // duration (end excluded), matching the trial-tone -> footstep flow.
        if (track) this.switchTrack(track)
      })
    })

    document.querySelector('#narrow-selection')?.addEventListener('click', () => {
      this.setSelection({ start: 0.08, end: 0.12 })
    })
    document.querySelector('#full-selection')?.addEventListener('click', () => {
      this.setSelection({ start: 0, end: this.track.duration })
    })
    document.querySelector('#fail-decode')?.addEventListener('click', () => {
      setFailNextDecode(true)
    })
    document.querySelector('#export-buckets')?.addEventListener('click', () => {
      const [left, right] = this.exportBuckets()
      const output = document.querySelector('#export-output')
      output.textContent = `左[30]=${left[30]} 右[40]=${right[40]}（共 ${left.length} 桶）`
    })
    document.querySelector('#play')?.addEventListener('click', () => {
      this.ws.playPause()
    })

    // Drag on the waveform to move the (half-open) selection. The playhead is
    // the separate wavesurfer cursor, so dragging here never seeks playback.
    const surface = document.querySelector('#waveform')
    surface.addEventListener('pointerdown', (event) => {
      this.dragging = true
      surface.setPointerCapture(event.pointerId)
      const start = this.xToTime(event.clientX)
      this.setSelection({ start, end: start })
    })
    surface.addEventListener('pointermove', (event) => {
      if (!this.dragging) return
      const end = this.xToTime(event.clientX)
      const start = this.selection.start
      this.setSelection({ start: Math.min(start, end), end: Math.max(start, end) })
    })
    const endDrag = () => {
      this.dragging = false
    }
    surface.addEventListener('pointerup', endDrag)
    surface.addEventListener('pointercancel', endDrag)

    this.ws.on('timeupdate', (time) => {
      this.readouts.time.textContent = `${time.toFixed(3)} s`
    })
    this.ws.on('redrawcomplete', () => this.refresh())
    window.addEventListener('resize', () => this.renderOverlay())
  }

  setSelection(selection) {
    this.selection = selection
    this.refresh()
    this.publish()
  }

  // ---- cross-page state ----------------------------------------------------------

  publish() {
    this.bridge.publish({
      trackId: this.track.id,
      level: this.level,
      selection: this.selection,
    })
  }

  applyRemoteState(state) {
    const track = TRACKS.find((item) => item.id === state.trackId)
    if (!track) return
    if (track.id !== this.track.id || this.level !== state.level) {
      this.selection = state.selection
      this.loadTrack(track, state.level, false)
      return
    }
    this.selection = state.selection
    this.refresh()
  }
}

/*
  <html>
    <style>
      body {
        box-sizing: border-box;
        margin: 0;
        padding: 1rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        gap: 1rem;
        font-family: sans-serif;
        color: #222;
      }
      body * { box-sizing: border-box; }
      h1 { font-size: 1.1rem; margin: 0 0 0.5rem; }
      #waveform { position: relative; width: 100%; touch-action: none; }
      #overlay-layer {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        overflow: hidden;
      }
      #selection {
        position: absolute;
        top: 0;
        bottom: 0;
        background: rgba(255, 210, 80, 0.25);
        border-left: 1px solid rgba(200, 150, 0, 0.8);
        border-right: 1px solid rgba(200, 150, 0, 0.8);
      }
      .contact-marker { position: absolute; width: 0; border-left: 2px solid; }
      .controls { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.6rem 0; }
      button {
        font-size: 0.85rem;
        padding: 0.35rem 0.6rem;
        border: 1px solid #888;
        border-radius: 4px;
        background: #f5f5f5;
        cursor: pointer;
      }
      aside { border: 1px solid #ccc; border-radius: 6px; padding: 0.8rem; align-self: start; }
      aside h2 { font-size: 0.95rem; margin: 0 0 0.6rem; }
      .readout {
        display: grid;
        grid-template-columns: 5.5rem 1fr;
        gap: 0.25rem 0.5rem;
        font-size: 0.85rem;
        margin-bottom: 0.5rem;
      }
      .readout dt { color: #666; }
      .readout dd { margin: 0; font-variant-numeric: tabular-nums; }
      #export-output { margin-top: 0.4rem; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
      .hint { font-size: 0.75rem; color: #777; margin-top: 0.5rem; line-height: 1.4; }
      @media (prefers-color-scheme: dark) {
        body { background: #222; color: #eee; }
        aside { border-color: #555; }
        .readout dt { color: #aaa; }
        button { background: #333; color: #eee; border-color: #666; }
      }
    </style>

    <section id="stage">
      <h1>落地脚步 — 上：身体（左声道） 下：鞋跟（右声道）</h1>
      <div id="waveform">
        <div id="overlay-layer">
          <div id="selection"></div>
          <div id="markers"></div>
        </div>
      </div>
      <div class="controls">
        <button data-track="footstep">脚步</button>
        <button data-track="trial-tone">试音</button>
        <button data-track="ambient">环境底噪</button>
        <button id="narrow-selection">选区 0.08–0.12 s</button>
        <button id="full-selection">选区整段</button>
        <button id="fail-decode">下次采样解码失败</button>
        <button id="export-buckets">导出 100 桶</button>
        <button id="play">播放 / 暂停</button>
      </div>
      <div id="export-output"></div>
      <p class="hint">
        在波形上按住拖动可改选区（终点不算）。粗桶先画，约 1.2 秒后采样到达；采样到达前可随时拖选区、换音频。
        再打开一个本页，两边读数一致。
      </p>
    </section>

    <aside>
      <h2>读数</h2>
      <dl class="readout">
        <dt>现在这条</dt><dd id="readout-track">—</dd>
        <dt>左接触</dt><dd id="readout-left-contact">—</dd>
        <dt>左峰值</dt><dd id="readout-left-peak">—</dd>
        <dt>右接触</dt><dd id="readout-right-contact">—</dd>
        <dt>右峰值</dt><dd id="readout-right-peak">—</dd>
        <dt>选区起止</dt><dd id="readout-selection">—</dd>
        <dt>数据层级</dt><dd id="readout-level">—</dd>
        <dt>播放头</dt><dd id="readout-time">0.000 s</dd>
      </dl>
    </aside>
  </html>
*/

// Expose for end-to-end tests; harmless in the preview iframe.
if (typeof window !== 'undefined') {
  window.LandingController = LandingController
  // Auto-boot in the example preview, whose injected HTML already contains the
  // readout elements. Test harnesses set window.__landingManualBoot so they own
  // instantiation explicitly (otherwise this would create a second controller).
  if (!window.__landingManualBoot && !window.__landing && document.querySelector('#readout-track')) {
    window.__landing = new LandingController()
  }
}
