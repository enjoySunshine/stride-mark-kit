// Shared session state so a second page opened on the same waveform shows the
// same six readout lines. BroadcastChannel syncs live; localStorage restores
// the state for a page opened later (and covers browsers without the channel).

const STORAGE_KEY = 'wavesurfer-landing-example-state'
const CHANNEL_NAME = 'wavesurfer-landing-example'

export function defaultState(trackId) {
  return { trackId, level: 'coarse', selection: { start: 0, end: 0.5 } }
}

export function readState(fallbackTrackId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultState(fallbackTrackId), ...JSON.parse(raw) }
  } catch {
    // storage unavailable (private mode, sandboxed iframe): fall back silently
  }
  return defaultState(fallbackTrackId)
}

function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / availability errors
  }
}

export function createBridge() {
  const listeners = new Set()
  let channel = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event) => {
      listeners.forEach((listener) => listener(event.data))
    }
  } catch {
    channel = null
  }

  // Cross-tab fallback when BroadcastChannel is unavailable.
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const state = JSON.parse(event.newValue)
      listeners.forEach((listener) => listener(state))
    } catch {
      // ignore malformed state
    }
  }
  window.addEventListener('storage', onStorage)

  return {
    publish(state) {
      writeState(state)
      try {
        if (channel) channel.postMessage(state)
      } catch {
        // a closed channel is harmless; localStorage still carries the state
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
