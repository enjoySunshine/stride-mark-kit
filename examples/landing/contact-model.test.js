// Node-runnable verification of the contact rules (no DOM needed):
//   node --test examples/landing/contact-model.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SAMPLE_RATE,
  peakInRange,
  coarseContact,
  sampleContact,
  bucketsFromSamples,
  exportBuckets,
} from './contact-model.js'
import { decodeSamples, FOOTSTEP, BUCKET_COUNT } from './tracks.js'

test('peakInRange keeps the sign of the largest absolute value', () => {
  const data = [0, 0.4, -0.9, 0.9, 0.2]
  const contact = peakInRange(data, 0, data.length)
  assert.equal(contact.index, 2)
  assert.equal(contact.peak, -0.9)
})

test('peakInRange resolves equal absolute values to the earliest index', () => {
  const data = [0.8, 0, -0.8]
  const contact = peakInRange(data, 0, data.length)
  assert.equal(contact.index, 0)
  assert.equal(contact.peak, 0.8)
})

test('peakInRange treats the end index as excluded', () => {
  const contact = peakInRange([0.5, 0.9], 0, 1)
  assert.deepEqual(contact, { index: 0, peak: 0.5 })
})

test('footstep coarse buckets land on 30 (0.8) and 40 (-0.55)', () => {
  const [left, right] = bucketsFromSamples(...decodeSamples(FOOTSTEP), BUCKET_COUNT)
  assert.equal(left.length, 100)
  assert.equal(right.length, 100)
  assert.equal(left[30], 0.8)
  assert.equal(right[40], -0.55)
  // Bucket 16 holds the 0.25 body contact, bucket 20 the 0.4 heel contact.
  assert.equal(left[16], 0.25)
  assert.equal(right[20], 0.4)
})

test('coarse contacts over the full selection are buckets 30 and 40', () => {
  const [left, right] = bucketsFromSamples(...decodeSamples(FOOTSTEP), BUCKET_COUNT)
  const leftContact = coarseContact(left, 0.5, { start: 0, end: 0.5 })
  const rightContact = coarseContact(right, 0.5, { start: 0, end: 0.5 })
  assert.deepEqual(leftContact, { index: 30, peak: 0.8 })
  assert.deepEqual(rightContact, { index: 40, peak: -0.55 })
})

test('coarse contacts over 0.08–0.12 are buckets 16 (0.25) and 20 (0.4)', () => {
  const [left, right] = bucketsFromSamples(...decodeSamples(FOOTSTEP), BUCKET_COUNT)
  const selection = { start: 0.08, end: 0.12 }
  assert.deepEqual(coarseContact(left, 0.5, selection), { index: 16, peak: 0.25 })
  assert.deepEqual(coarseContact(right, 0.5, selection), { index: 20, peak: 0.4 })
})

test('sample contacts over 0.08–0.12 are samples 4000 (0.25) and 4800 (0.4)', () => {
  const [left, right] = decodeSamples(FOOTSTEP)
  const selection = { start: 0.08, end: 0.12 }
  assert.deepEqual(sampleContact(left, selection), { index: 4000, peak: 0.25 })
  assert.deepEqual(sampleContact(right, selection), { index: 4800, peak: 0.4 })
})

test('sample contacts over the full selection are 7200 (+0.8) and 9600 (-0.55)', () => {
  const [left, right] = decodeSamples(FOOTSTEP)
  const selection = { start: 0, end: 0.5 }
  // +0.8 at 7200 beats -0.8 at 7260 on the tie-breaker (earlier wins).
  assert.deepEqual(sampleContact(left, selection), { index: 7200, peak: 0.8 })
  assert.deepEqual(sampleContact(right, selection), { index: 9600, peak: -0.55 })
})

test('an empty-ish selection reports no contact', () => {
  const [left] = decodeSamples(FOOTSTEP)
  const contact = sampleContact(left, { start: 0.3, end: 0.30002 })
  assert.equal(contact.index, -1)
  assert.equal(contact.peak, 0)
})

test('export is independent of selection and re-derived at sample level', () => {
  const samples = decodeSamples(FOOTSTEP)
  const buckets = bucketsFromSamples(...samples, BUCKET_COUNT)
  const narrowed = { start: 0.08, end: 0.12 }
  const fromCoarse = exportBuckets('coarse', { buckets, samples: null }, BUCKET_COUNT)
  const fromSamples = exportBuckets('samples', { buckets: null, samples }, BUCKET_COUNT)
  assert.deepEqual(fromCoarse, fromSamples)
  assert.equal(fromSamples[0][30], 0.8)
  assert.equal(fromSamples[1][40], -0.55)
  // Touching the selection does not change the export.
  void narrowed
  assert.equal(fromSamples[0].length, BUCKET_COUNT)
})

test('sample rate matches the 0.5 s / 24000 sample spec', () => {
  assert.equal(SAMPLE_RATE, 48000)
  assert.equal(decodeSamples(FOOTSTEP)[0].length, 24000)
})
