/**
 * Landing-contact page logic. Kept free of DOM code so it can be unit-tested:
 * the page wires this to WaveSurfer and to its six text rows.
 *
 * This owns:
 *
 *   - One selection (in seconds), dragged by the user and re-read against
 *     whatever level is currently on screen.
 *   - Two contacts (left/right), each a { index, peak } where index is a
 *     bucket number at 'buckets' and a sample number at 'samples'.
 *   - The level switch: buckets first, samples when the decode lands.
 *   - A whole-track bucket summary, captured at load time, so the export never
 *     changes with the selection or the decode state.
 *   - A generation counter: a result from a superseded load never touches the
 *     contacts of the load that replaced it.
 */

import { bucketChannels, exportBuckets, findContact, normalizeRange, BUCKET_COUNT } from './model.js'

/**
 * @typedef {object} TrackDefinition
 * @property {string} id
 * @property {string} label
 * @property {string} url
 * @property {number} duration          seconds; coarse buckets exist from the start
 * @property {number[][]} buckets       signed whole-track bucket peaks, per channel
 *
 * @typedef {object} Snapshot
 * @property {'buckets' | 'samples'} level
 * @property {string} track
 * @property {import('./model.js').Contact | null} left
 * @property {import('./model.js').Contact | null} right
 * @property {import('./model.js').Range} selection
 * @property {'decoding' | 'samples' | 'failed'} status
 */

export function createStrideState(options = {}) {
  const listeners = new Set()
  let frame = { level: 'buckets', duration: 0, channels: null, buckets: null, bucketCount: BUCKET_COUNT }
  let summary = null
  let selection = { start: 0, end: 0 }
  let track = null
  let left = null
  let right = null
  let generation = 0
  let status = 'decoding'

  function snapshot() {
    return {
      level: frame.level,
      track: track ? track.label : '',
      left,
      right,
      selection: { ...selection },
      status,
    }
  }

  const notify = () => {
    const current = snapshot()
    if (options.onChange) options.onChange(current)
    listeners.forEach((listener) => listener())
  }

  /** Re-read both contacts from the current frame and selection. */
  function recomputeContacts() {
    left = findContact(frame, 0, selection)
    right = findContact(frame, 1, selection)
  }

  /** Put a new track on screen at the coarse level. */
  function setTrack(nextTrack, nextSelection) {
    generation++
    track = nextTrack
    // Buckets first: the first drawing can be made before any sample decodes.
    frame = {
      level: 'buckets',
      duration: nextTrack.duration,
      channels: null,
      buckets: bucketChannels(nextTrack.buckets, 2),
      bucketCount: BUCKET_COUNT,
    }
    // The export summary is a copy, frozen here, so promoting to samples (which
    // releases the bucket arrays) cannot change the exported values later.
    summary = frame.buckets.map((channel) => channel.slice())
    status = 'decoding'
    // A newly loaded track gets the selection the page decides for it, and its
    // contacts are read against THAT track's buckets.
    selection = normalizeRange(nextSelection, nextTrack.duration)
    recomputeContacts()
    notify()
  }

  /** The selection was dragged against the level on screen right now. */
  function setSelection(nextSelection) {
    if (!track) return
    selection = normalizeRange(nextSelection, frame.duration)
    recomputeContacts()
    notify()
  }

  /** Decoded samples arrived (they may belong to a superseded track). */
  function setSamples(trackId, resultGeneration, channels, duration) {
    // Stale decode: a newer track has already replaced this one. Keep the
    // contacts of the track that is on screen now.
    if (!track || track.id !== trackId || resultGeneration !== generation) return false
    frame = {
      level: 'samples',
      duration: duration || frame.duration,
      channels,
      buckets: null, // release the coarse peaks: one level in memory at a time
      bucketCount: BUCKET_COUNT,
    }
    status = 'samples'
    // Selection seconds stay exactly where the user dragged them.
    recomputeContacts()
    notify()
    return true
  }

  /** The decode failed: buckets and selection stay, contacts stay on buckets. */
  function setFailed(trackId, resultGeneration) {
    if (!track || track.id !== trackId || resultGeneration !== generation) return
    status = 'failed'
    notify()
  }

  /** Always whole-track: never the selection, never recomputed from samples. */
  function exportPeaks() {
    return exportBuckets(frame, summary || undefined)
  }

  return {
    setTrack,
    setSelection,
    setSamples,
    setFailed,
    export: exportPeaks,
    getSnapshot: snapshot,
    getFrame: () => frame,
    getGeneration: () => generation,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
