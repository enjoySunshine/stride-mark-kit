// Two-level waveform data: coarse buckets arrive first, decoded samples later.
// All functions here are pure so the contact rules can be reused by every
// example page without duplicating logic. Plain JS: the example preview
// inlines this module's importer into a native <script type="module">.

export const SAMPLE_RATE = 48000

const EMPTY_CONTACT = { index: -1, peak: 0 }

// Round away Float32 storage drift (0.8 stored as 0.8000000119) so readouts and
// exports show the original sample value with its sign intact.
const round6 = (value) => (value === 0 ? 0 : Math.round(value * 1e6) / 1e6)

/**
 * Largest absolute value in a half-open index window [start, end), keeping the
 * sign of the winning sample. Ties on absolute value resolve to the earliest
 * index: when 0.8 and -0.8 land in the same window the contact keeps 0.8.
 * Returns { index: -1, peak: 0 } when the window covers no non-zero value.
 */
export function peakInRange(level, start, end) {
  let best = EMPTY_CONTACT
  let bestAbs = 0
  const to = Math.min(end, level.length)
  for (let i = Math.max(0, start); i < to; i++) {
    // Compare rounded magnitudes so Float32 twins (0.8 and -0.8 both stored as
    // 0.8000000119) count as equal and the strictly earlier index wins.
    const abs = Math.abs(round6(level[i]))
    if (abs > bestAbs) {
      best = { index: i, peak: round6(level[i]) }
      bestAbs = abs
    }
  }
  return best
}

/**
 * Contact at the coarse (fixed-bucket) level for one channel.
 * Bucket b covers [b * duration / bucketCount, (b + 1) * duration / bucketCount).
 */
export function coarseContact(buckets, duration, selection) {
  const first = Math.floor((selection.start / duration) * buckets.length)
  const last = Math.ceil((selection.end / duration) * buckets.length)
  return peakInRange(buckets, first, last)
}

/**
 * Contact at the sample level for one channel.
 * A sample belongs to the selection when start <= t < end (end excluded).
 */
export function sampleContact(samples, selection) {
  const first = Math.ceil(selection.start * SAMPLE_RATE)
  const last = Math.ceil(selection.end * SAMPLE_RATE)
  return peakInRange(samples, first, last)
}

/**
 * The fixed coarse buckets for fully decoded samples.
 * Samples are split into equal consecutive groups; each bucket stores the
 * largest absolute sample of its group (sign preserved). Values are rounded to
 * 6 decimals so Float32 storage drift (0.8 -> 0.8000000119) never leaks into the
 * readout/export: the export reports the original values, not canvas math.
 */
export function bucketsFromSamples(left, right, bucketCount) {
  const build = (channel) => {
    const buckets = new Array(bucketCount).fill(0)
    const groupSize = channel.length / bucketCount
    for (let b = 0; b < bucketCount; b++) {
      const start = Math.floor(b * groupSize)
      const end = b === bucketCount - 1 ? channel.length : Math.floor((b + 1) * groupSize)
      buckets[b] = round6(peakInRange(channel, start, end).peak)
    }
    return buckets
  }
  return [build(left), build(right)]
}

/**
 * Whole-duration export of exactly bucketCount buckets, independent of the
 * selection and of which level is on screen. At sample level the buckets are
 * re-derived from the samples instead of being retained alongside them, so the
 * two levels never double the held memory.
 */
export function exportBuckets(level, data, bucketCount) {
  if (data.samples) return bucketsFromSamples(data.samples[0], data.samples[1], bucketCount)
  if (!data.buckets) throw new Error('No waveform data available to export')
  return data.buckets
}
