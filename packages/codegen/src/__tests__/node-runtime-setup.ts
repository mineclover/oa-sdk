// Node.js 25 exposes a localStorage global without configuring a storage file.
// MSW probes that global during module initialization; keep its test cookie
// store in memory so tests have no process-local persisted state or warning.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: undefined,
  writable: true,
})
