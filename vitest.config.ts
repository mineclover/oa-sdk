import { defineConfig } from 'vitest/config'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@oa-sdk/mock-server': path.resolve(__dirname, 'packages/mock-server/src/index.ts'),
      '@oa-sdk/codegen/spec-lens': path.resolve(__dirname, 'packages/codegen/src/spec-lens/index.ts'),
      '@oa-sdk/codegen/zodgen': path.resolve(__dirname, 'packages/codegen/src/zodgen/index.ts'),
      '@oa-sdk/codegen/typegen': path.resolve(__dirname, 'packages/codegen/src/typegen/index.ts'),
      '@oa-sdk/codegen/apitomy': path.resolve(__dirname, 'packages/codegen/src/apitomy/index.ts'),
      '@oa-sdk/codegen': path.resolve(__dirname, 'packages/codegen/src/index.ts'),
      '@oa-sdk/typespec-decorators': path.resolve(__dirname, 'packages/typespec-decorators/src/index.ts'),
      '@oa-sdk/personas': path.resolve(__dirname, 'packages/personas/src/index.ts'),
      '@oa-sdk/dpm': path.resolve(__dirname, 'packages/dpm/src/index.ts'),
      '@oa-sdk/core/browser': path.resolve(__dirname, 'packages/core/src/browser.ts'),
      '@oa-sdk/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@oa-sdk/parser/browser': path.resolve(__dirname, 'packages/parser/src/browser.ts'),
      '@oa-sdk/parser': path.resolve(__dirname, 'packages/parser/src/index.ts'),
      '@oa-sdk/openapi-projection-contract': path.resolve(__dirname, 'packages/openapi-projection-contract/src/index.ts'),
      '@oa-sdk/ast-sync/guards': path.resolve(__dirname, 'packages/ast-sync/src/guards/index.ts'),
      '@oa-sdk/ast-sync': path.resolve(__dirname, 'packages/ast-sync/src/index.ts'),
      '@oa-sdk/spec-lens': path.resolve(__dirname, 'packages/spec-lens/src/index.ts'),
      '@oa-sdk/client': path.resolve(__dirname, 'packages/client/src/index.ts'),
      '@oa-sdk/router': path.resolve(__dirname, 'packages/router/src/index.ts'),
      '@oa-sdk/tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@oa-sdk/collab-workspace': path.resolve(__dirname, 'packages/collab-workspace/src/index.ts'),
      '@oa-sdk/surface-ir': path.resolve(__dirname, 'packages/surface-ir/src/index.ts'),
      '@oa-sdk/rpc': path.resolve(__dirname, 'packages/rpc/src/index.ts'),
      '@oa-sdk/popup-bridge/host': path.resolve(__dirname, 'packages/popup-bridge/src/host.ts'),
      '@oa-sdk/popup-bridge/popup': path.resolve(__dirname, 'packages/popup-bridge/src/popup.ts'),
      '@oa-sdk/popup-bridge/testing': path.resolve(__dirname, 'packages/popup-bridge/src/testing.ts'),
      '@oa-sdk/popup-bridge': path.resolve(__dirname, 'packages/popup-bridge/src/index.ts'),
    },
  },
})
