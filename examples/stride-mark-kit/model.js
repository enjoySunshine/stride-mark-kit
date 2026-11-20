/**
 * Progressive waveform data for the stride-mark page.
 *
 * A track is shown at one of two levels:
 *
 *   - 'buckets': 100 coarse buckets covering the whole track, available as soon
 *     as the duration is known (before any audio has been decoded).
 *   - 'samples': the decoded audio, at its real sample rate.
 *
 * Everything the page shows comes from a frame at one of those levels, so the
 * three questions the page asks always agree with what is currently drawn:
 *
 *   1. How tall is each drawn bar?                       -> drawableChannels()
 *   2. Which entry is the contact inside the selection?  -> findContact()
 *   3. What are the track's 100 whole-track buckets?     -> exportBuckets()
 *
 * The rules these implement:
 *
 *   - A contact is the entry with the largest |value| inside the selection
 *     `[start, end)`. Ties on |value| go to the EARLIER entry, and the peak
 *     keeps that entry's sign. So when 0.8 and -0.8 both land in a selection,
 *     the contact is the earlier 0.8.
 *   - Coarse buckets are whole-track: `duration / 100` each, holding the
 *     largest-|value| sample of the slice, with its sign. A selection covers
 *     every bucket whose slice overlaps it with positive length.
 *   - The exported 100 buckets never depend on the selection or on the decode
 *     state, and their values are original peaks, never canvas-normalized
 *     heights.
 */

/** Number of coarse buckets covering a whole track. */
export const BUCKET_COUNT = 100

const EPSILON = 1e-9

/**
 * @typedef {'buckets' | 'samples'} Level
 *
 * @typedef {object} Frame
 * @property {Level} level
 * @property {number} duration          length of the frame in seconds
 * @property {Float32Array[] | null} channels audio samples, only at 'samples'
 * @property {Float32Array[] | null} buckets  whole-track bucket peaks, only at 'buckets'
 * @property {number} bucketCount
 *
 * @typedef {object} Contact
 * @property {number} index  sample index at 'samples', bucket index at 'buckets'
 * @property {number} peak   signed peak at that entry
 * @property {number} time   a time inside the entry (sample time or bucket centre)
 *
 * @typedef {object} Range
 * @property {number} start
 * @property {number} end
 */

/** Copy a fixture's bucket peaks into one Float32Array per channel. */
export function bucketChannels(buckets, channels, count = BUCKET_COUNT) {
  const out = []
  for (let c = 0; c < channels; c++) {
    const values = new Float32Array(count)
    const source = (buckets && buckets[c]) || []
    for (let i = 0; i < count; i++) values[i] = source[i] || 0
    out.push(values)
  }
  return out
}

/** Index of the largest |value| in [from, to); ties keep the earlier entry. */
function peakIndex(values, from, to) {
  let bestAbs = -1
  let bestIndex = -1
  for (let i = Math.max(0, from); i < to && i < values.length; i++) {
    const magnitude = Math.abs(values[i])
    if (magnitude > bestAbs) {
      bestAbs = magnitude
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * Contact inside `range` (end-exclusive) for one channel, at the frame's
 * current level. An empty range yields no contact.
 *
 * @param {Frame} frame
 * @param {number} channel
 * @param {Range} range
 * @returns {Contact | null}
 */
export function findContact(frame, channel, range) {
  const { start, end } = normalizeRange(range, frame.duration)
  if (!(end > start)) return null

  if (frame.level === 'samples' && frame.channels) {
    const data = frame.channels[channel]
    if (!data) return null
    const sampleRate = data.length / frame.duration
    // Sample k is in the selection when start <= k / rate < end.
    const from = Math.ceil(start * sampleRate - EPSILON)
    const to = Math.ceil(end * sampleRate - EPSILON)
    if (to <= from) return null
    const index = peakIndex(data, from, to)
    if (index === -1) return null
    return { index, peak: data[index], time: index / sampleRate }
  }

  // Coarse buckets cover equal slices of the whole track; a selection covers
  // every bucket whose slice overlaps it with positive length.
  const buckets = frame.buckets && frame.buckets[channel]
  if (!buckets) return null
  const bucketDuration = frame.duration / buckets.length
  const from = Math.floor(start / bucketDuration + EPSILON)
  const to = Math.ceil(end / bucketDuration - EPSILON)
  if (to <= from) return null
  const index = peakIndex(buckets, from, to)
  if (index === -1) return null
  return { index, peak: buckets[index], time: (index + 0.5) * bucketDuration }
}

/** Clamp a range to [0, duration]; returns it ordered. */
export function normalizeRange(range, duration) {
  const start = Math.max(0, Math.min(duration, range.start))
  const end = Math.max(0, Math.min(duration, range.end))
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

/** The values the waveform draws at the frame's current level. */
export function drawableChannels(frame) {
  if (frame.level === 'samples' && frame.channels) return frame.channels
  if (frame.buckets) return frame.buckets
  return []
}

/**
 * The 100 whole-track buckets. When a summary is supplied (the page keeps one
 * from the coarse stage), it is returned as a copy: this is what makes the
 * export identical before and after the samples arrive and independent of the
 * selection. Values are original peaks, never heights scaled for the canvas.
 */
export function exportBuckets(frame, summary, count = BUCKET_COUNT) {
  // Values are original peaks, rounded just enough to drop Float32 noise
  // (0.800000011920929 -> 0.8) so a reader sees the sample's value, not the
  // storage representation.
  const clean = (channel) => channel.map((value) => Math.round(value * 1e6) / 1e6)
  if (summary) return summary.map((channel) => clean(channel))

  const source = frame.buckets || frame.channels || []
  return source.map((channel) => {
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const from = Math.floor((i * channel.length) / count)
      const to = Math.floor(((i + 1) * channel.length) / count)
      const index = peakIndex(channel, from, to)
      out[i] = index === -1 ? 0 : channel[index]
    }
    return clean(out)
  })
}
