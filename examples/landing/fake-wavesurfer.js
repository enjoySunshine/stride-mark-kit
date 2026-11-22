// Test-only WaveSurfer double used by landing.test.js (jsdom, no real canvas).
// The real library cannot run under Node, so the controller's bare
// 'wavesurfer.js' import is redirected here in the test's module rewrite.
class FakeWaveSurfer {
  constructor() {
    this.listeners = new Map()
    const wrapper = document.createElement('div')
    Object.defineProperty(wrapper, 'clientWidth', { value: 800, configurable: true })
    wrapper.getBoundingClientRect = () => ({ left: 0, width: 800, top: 0, right: 800 })
    this.wrapper = wrapper
    this.mediaElement = document.createElement('audio')
    this.lastLoad = null
  }

  static create() {
    return new FakeWaveSurfer()
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(fn)
    return this
  }

  emit(event, ...args) {
    this.listeners.get(event)?.forEach((fn) => fn(...args))
  }

  async load(url, peaks, duration) {
    this.lastLoad = { kind: 'load', url, peaks, duration }
  }

  async loadBlob(blob, peaks, duration) {
    this.lastLoad = { kind: 'loadBlob', blob, peaks, duration }
  }

  getWrapper() {
    return this.wrapper
  }

  getMediaElement() {
    return this.mediaElement
  }

  destroy() {
    this.listeners.clear()
  }

  playPause() {}
}

export default FakeWaveSurfer
