import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    'adapters/msw': 'src/adapters/msw.ts',
    'adapters/node-http': 'src/adapters/node-http.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm'],
  dts: true,
  target: 'node24',
  clean: true,
})
