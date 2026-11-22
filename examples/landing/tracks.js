// Synthetic clips for the landing-footstep scenario.
// Everything is generated in memory at 48 kHz stereo; no audio files needed.
import { SAMPLE_RATE, bucketsFromSamples } from './contact-model.js'

export const BUCKET_COUNT = 100

const sparse = (entries) => new Map(entries)

// The footstep: 0.5 s, 24000 samples per channel.
// Left = body landing, right = shoe heel.
export const FOOTSTEP = {
  id: 'footstep',
  label: '脚步（身体/鞋跟）',
  duration: 0.5,
  left: sparse([
    [4000, 0.25],
    [7200, 0.8],
    [7260, -0.8],
  ]),
  right: sparse([
    [4800, 0.4],
    [9600, -0.55],
  ]),
  coarseDelay: 120,
  sampleDelay: 1200,
}

// The trial tone: only sample 100 on the left channel is non-zero.
export const TRIAL_TONE = {
  id: 'trial-tone',
  label: '试音',
  duration: 0.5,
  left: sparse([[100, 1]]),
  right: sparse([]),
  coarseDelay: 120,
  sampleDelay: 1200,
}

// Two minutes of ambient bed: the same two-level pipeline must hold without
// doubling memory when the samples arrive.
export const AMBIENT = {
  id: 'ambient',
  label: '环境底噪（2 分钟）',
  duration: 120,
  left: sparse([]),
  right: sparse([]),
  coarseDelay: 120,
  sampleDelay: 2000,
}

export const TRACKS = [FOOTSTEP, TRIAL_TONE, AMBIENT]

export function sampleCount(track) {
  return Math.round(track.duration * SAMPLE_RATE)
}

function buildChannel(track, channelName) {
  const data = new Float32Array(sampleCount(track))
  const entries = channelName === 'left' ? track.left : track.right
  for (const [index, value] of entries) data[index] = value
  return data
}

/** Deterministic pseudo-noise in roughly [-0.25, 0.25] from an integer seed. */
function noise(index) {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return (x - Math.floor(x) - 0.5) * 0.5
}

/** Fully decoded stereo samples for a track. The ambient bed gets a quiet
 *  deterministic noise floor so its waveform is visibly non-flat. */
export function decodeSamples(track) {
  const left = buildChannel(track, 'left')
  const right = buildChannel(track, 'right')
  if (track.id === AMBIENT.id) {
    for (let i = 0; i < left.length; i++) {
      // Scale the floor down so it reads as background, not another contact.
      left[i] = noise(i) * 0.12
      right[i] = noise(i + 99991) * 0.12
    }
  }
  return [left, right]
}

/** The 100 coarse buckets shown before decoding finishes. */
export function coarseBuckets(track) {
  const [left, right] = decodeSamples(track)
  return bucketsFromSamples(left, right, BUCKET_COUNT)
}

// When true, the next in-flight sample "decoding" fails instead of resolving.
// The page keeps the painted coarse buckets and selection, contacts stay coarse.
let failNext = false
export function setFailNextDecode(value) {
  failNext = value
}

/** Test hook: clear the one-shot failure flag so suites start deterministic. */
export function resetDecodeState() {
  failNext = false
}

/**
 * Simulated two-level decode.
 *  - onCoarse(buckets) fires first so the waveform paints immediately;
 *  - onSamples(samples) fires later, or onError() when decoding fails;
 *  - the returned generation token lets callers drop results from a track the
 *    user already switched away from (stale decodes never touch contacts).
 */
export function startDecode(track, callbacks) {
  const generation = Date.now() + Math.random()
  const timers = {
    coarse: setTimeout(() => callbacks.onCoarse(coarseBuckets(track)), track.coarseDelay),
    samples: setTimeout(() => {
      if (failNext) {
        failNext = false
        callbacks.onError()
      } else {
        callbacks.onSamples(decodeSamples(track))
      }
    }, track.sampleDelay),
  }
  return { generation, timers }
}

export function cancelDecode(timers) {
  if (!timers) return
  clearTimeout(timers.coarse)
  clearTimeout(timers.samples)
}

/** Encode stereo float samples as a PCM WAV blob so the playhead can play. */
export function encodeWav(samples) {
  const [left, right] = samples
  const frameCount = left.length
  const bytesPerSample = 2
  const headerSize = 44
  const buffer = new ArrayBuffer(headerSize + frameCount * 2 * bytesPerSample)
  const view = new DataView(buffer)
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // stereo
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2 * bytesPerSample, true)
  view.setUint16(32, 2 * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, frameCount * 2 * bytesPerSample, true)
  let offset = headerSize
  const toInt16 = (value) => Math.max(-1, Math.min(1, value)) * 0x7fff
  for (let i = 0; i < frameCount; i++) {
    view.setInt16(offset, toInt16(left[i]), true)
    view.setInt16(offset + 2, toInt16(right[i]), true)
    offset += 4
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
