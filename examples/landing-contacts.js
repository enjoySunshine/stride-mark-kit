// Landing contacts: body (left) and heel (right) contact points
//
// The waveform is drawn from 100 coarse buckets as soon as the page knows the
// duration, then swapped to the decoded samples when they arrive. The
// selection is drawn on the waveform and can be dragged before the samples
// land; the contacts always match the waveform that is on screen at that
// moment.
//
// URL parameters (all optional):
//   ?track=footstep|tone|ambient|broken  which clip to load first
//   ?delay=0                             skip the artificial decode delay
//   ?start=0.08&end=0.12                 start with this selection

import WaveSurfer from 'wavesurfer.js'
import page from '/examples/stride-mark-kit/page.js'

const params = new URLSearchParams(location.search)
const start = Number(params.get('start'))
const end = Number(params.get('end'))

page.start(WaveSurfer, {
  track: params.get('track') || undefined,
  delay: params.has('delay') ? Number(params.get('delay')) : undefined,
  start: Number.isFinite(start) && params.has('start') ? start : undefined,
  end: Number.isFinite(end) && params.has('end') ? end : undefined,
})
