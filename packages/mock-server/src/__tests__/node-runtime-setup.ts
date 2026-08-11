// Node.js 25 exposes a localStorage global without configuring a storage file.
// MSW detects it while initializing cookies; tests intentionally use MSW's
// in-memory cookie store to avoid persisted cross-worker state and warnings.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: undefined,
  writable: true,
})
