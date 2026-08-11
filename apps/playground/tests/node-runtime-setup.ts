// Node.js 25 exposes a localStorage global even when no backing file was
// configured. MSW probes it while creating its cookie store, which emits a
// warning and would make tests depend on process-local persisted state.
// Playground tests use MSW's in-memory cookie store deliberately.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: undefined,
  writable: true,
})
