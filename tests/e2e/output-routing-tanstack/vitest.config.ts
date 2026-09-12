import { defineConfig } from 'vitest/config'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@oa-sdk/router': path.resolve(repoRoot, 'packages/router/src/index.ts'),
      '@oa-sdk/mock-server': path.resolve(repoRoot, 'packages/mock-server/src/index.ts'),
      '@oa-sdk/codegen/spec-lens': path.resolve(repoRoot, 'packages/codegen/src/spec-lens/index.ts'),
      '@oa-sdk/codegen/zodgen': path.resolve(repoRoot, 'packages/codegen/src/zodgen/index.ts'),
      '@oa-sdk/codegen/typegen': path.resolve(repoRoot, 'packages/codegen/src/typegen/index.ts'),
      '@oa-sdk/codegen/apitomy': path.resolve(repoRoot, 'packages/codegen/src/apitomy/index.ts'),
      '@oa-sdk/codegen': path.resolve(repoRoot, 'packages/codegen/src/index.ts'),
      '@oa-sdk/typespec-decorators': path.resolve(repoRoot, 'packages/typespec-decorators/src/index.ts'),
      '@oa-sdk/personas': path.resolve(repoRoot, 'packages/personas/src/index.ts'),
      '@oa-sdk/dpm': path.resolve(repoRoot, 'packages/dpm/src/index.ts'),
      '@oa-sdk/core/browser': path.resolve(repoRoot, 'packages/core/src/browser.ts'),
      '@oa-sdk/core': path.resolve(repoRoot, 'packages/core/src/index.ts'),
      '@oa-sdk/parser/browser': path.resolve(repoRoot, 'packages/parser/src/browser.ts'),
      '@oa-sdk/parser': path.resolve(repoRoot, 'packages/parser/src/index.ts'),
      '@oa-sdk/openapi-projection-contract': path.resolve(repoRoot, 'packages/openapi-projection-contract/src/index.ts'),
      '@oa-sdk/ast-sync/guards': path.resolve(repoRoot, 'packages/ast-sync/src/guards/index.ts'),
      '@oa-sdk/ast-sync': path.resolve(repoRoot, 'packages/ast-sync/src/index.ts'),
      '@oa-sdk/spec-lens': path.resolve(repoRoot, 'packages/spec-lens/src/index.ts'),
      '@oa-sdk/client': path.resolve(repoRoot, 'packages/client/src/index.ts'),
    },
  },
})
