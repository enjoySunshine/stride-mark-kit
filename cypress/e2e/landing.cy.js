// Landing-footstep two-level (coarse buckets -> decoded samples) contacts.
// The page is driven through its real timers and buttons, so the tests assert
// what the user described: contacts must always match the level + selection
// that are current at that moment.

const PAGE = 'cypress/e2e/landing.html'

const readout = (id) =>
  cy
    .get(id)
    .invoke('text')
    .then((text) => text.trim())

const waitMs = (ms) => cy.wait(ms)

describe('Landing footstep contacts', () => {
  beforeEach(() => {
    cy.visit(PAGE)
    cy.window().its('__landing').should('exist')
  })

  it('paints coarse buckets first with full-duration contacts on bars 30 and 40', () => {
    // Coarse buckets arrive at ~120 ms; samples not yet decoded at this point.
    readout('#readout-level').should('equal', '粗桶')
    readout('#readout-left-contact').should('equal', '30（桶）')
    readout('#readout-left-peak').should('equal', '0.8')
    readout('#readout-right-contact').should('equal', '40（桶）')
    readout('#readout-right-peak').should('equal', '-0.55')
    readout('#readout-selection').should('contain', '0.000 s')
    readout('#readout-selection').should('contain', '0.500 s')
  })

  it('recomputes coarse contacts from the narrowed selection before samples arrive', () => {
    cy.get('#narrow-selection').click()
    readout('#readout-selection').should('contain', '0.080 s')
    readout('#readout-selection').should('contain', '0.120 s')
    // Still coarse: bucket 16 (0.25) and bucket 20 (0.4); 7200/9600 do not exist yet.
    readout('#readout-level').should('equal', '粗桶')
    readout('#readout-left-contact').should('equal', '16（桶）')
    readout('#readout-left-peak').should('equal', '0.25')
    readout('#readout-right-contact').should('equal', '20（桶）')
    readout('#readout-right-peak').should('equal', '0.4')
  })

  it('switches contacts to samples 4000/4800 when samples arrive, keeping the dragged selection', () => {
    cy.get('#narrow-selection').click()
    // Samples resolve at ~1200 ms.
    waitMs(1500)
    readout('#readout-level').should('equal', '采样')
    readout('#readout-selection').should('contain', '0.080 s')
    readout('#readout-left-contact').should('equal', '4000（采样）')
    readout('#readout-left-peak').should('equal', '0.25')
    readout('#readout-right-contact').should('equal', '4800（采样）')
    readout('#readout-right-peak').should('equal', '0.4')
    // The 0.8 bar remains drawn in the waveform but is no longer a contact.
    cy.window().then((win) => {
      const [left] = win.__landing.exportBuckets()
      expect(left[30]).to.equal(0.8)
    })
    cy.get('.contact-marker').should('have.length', 2)
  })

  it('uses the earliest of equal-absolute samples and keeps its sign (7200 = +0.8)', () => {
    // Full selection; after decoding the left contact is sample 7200 (+0.8),
    // not 7260 (-0.8), because ties resolve to the earlier sample.
    waitMs(1500)
    readout('#readout-level').should('equal', '采样')
    readout('#readout-left-contact').should('equal', '7200（采样）')
    readout('#readout-left-peak').should('equal', '0.8')
    readout('#readout-right-contact').should('equal', '9600（采样）')
    readout('#readout-right-peak').should('equal', '-0.55')
  })

  it('keeps coarse buckets and contacts when sample decoding fails', () => {
    cy.get('#fail-decode').click()
    waitMs(1500)
    readout('#readout-level').should('contain', '粗桶')
    readout('#readout-left-contact').should('equal', '30（桶）')
    readout('#readout-left-peak').should('equal', '0.8')
    readout('#readout-right-contact').should('equal', '40（桶）')
    readout('#readout-right-peak').should('equal', '-0.55')
  })

  it('drops a stale trial-tone decode after switching to the footstep', () => {
    // Load the trial tone, then switch before its 1.2 s decode completes.
    cy.get('[data-track="trial-tone"]').click()
    readout('#readout-track').should('contain', '试音')
    cy.get('[data-track="footstep"]').click()
    readout('#readout-track').should('contain', '脚步')
    // Let both in-flight decodes finish; the trial tone's sample 100 must not
    // leak into the footstep readout lines.
    waitMs(1800)
    readout('#readout-level').should('equal', '采样')
    readout('#readout-left-contact').should('equal', '7200（采样）')
    readout('#readout-left-peak').should('equal', '0.8')
    readout('#readout-right-contact').should('equal', '9600（采样）')
    readout('#readout-right-peak').should('equal', '-0.55')
    cy.get('#readout-track').should('not.contain', '100')
  })

  it('exports the same 100 original-value buckets regardless of selection and level', () => {
    const assertExport = () =>
      cy.window().then((win) => {
        const [left, right] = win.__landing.exportBuckets()
        expect(left).to.have.length(100)
        expect(right).to.have.length(100)
        expect(left[30]).to.equal(0.8)
        expect(right[40]).to.equal(-0.55)
      })

    assertExport() // coarse, full selection
    cy.get('#narrow-selection').click()
    assertExport() // coarse, narrowed selection
    waitMs(1500)
    assertExport() // sample level: buckets re-derived from samples
  })

  it('renders the two-minute ambient bed through both levels without errors', () => {
    cy.get('[data-track="ambient"]').click()
    readout('#readout-level').should('equal', '粗桶')
    waitMs(2400)
    readout('#readout-level').should('equal', '采样')
    cy.window().then((win) => {
      const [left] = win.__landing.exportBuckets()
      expect(left).to.have.length(100)
    })
  })

  it('keeps the six readout lines identical in a second page for the same waveform', () => {
    cy.get('#narrow-selection').click()
    waitMs(1500)
    const expected = {}
    ;[
      '#readout-track',
      '#readout-left-contact',
      '#readout-left-peak',
      '#readout-right-contact',
      '#readout-right-peak',
      '#readout-selection',
    ].forEach((id) => readout(id).then((value) => (expected[id] = value)))

    // Open the same waveform in a second page; localStorage + BroadcastChannel
    // carry the current track, level and selection across pages.
    cy.visit(PAGE)
    cy.window().its('__landing').should('exist')
    Object.entries(expected).forEach(([id, value]) => readout(id).should('equal', value))
  })
})
