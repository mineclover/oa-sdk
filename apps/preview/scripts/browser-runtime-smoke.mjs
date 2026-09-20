#!/usr/bin/env node

import assert from 'node:assert/strict'
import { builtinModules } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
const previewDist = join(workspaceRoot, 'apps/preview/dist')
assert(existsSync(join(previewDist, 'index.html')), 'preview dist is missing; build @oa-sdk/preview before running this smoke')

const javascriptFiles = walk(previewDist).filter(path => path.endsWith('.js'))
assert(javascriptFiles.length > 0, 'preview build emitted no JavaScript assets')

const forbiddenBundleReferences = []
for (const path of javascriptFiles) {
  const source = readFileSync(path, 'utf8')
  if (source.includes('__vite-browser-external')) {
    forbiddenBundleReferences.push(`${path}: Vite browser external shim`)
  }
  for (const specifier of moduleSpecifiers(source, path)) {
    if (isNodeBuiltin(specifier)) forbiddenBundleReferences.push(`${path}: ${specifier}`)
  }
}
assert.deepEqual(
  forbiddenBundleReferences,
  [],
  `preview browser bundle references Node builtins:\n${forbiddenBundleReferences.join('\n')}`,
)

const [
  coreNode,
  coreBrowser,
  parserNode,
  parserBrowser,
  typegenNode,
  typegenBrowser,
  routerNode,
  routerBrowser,
  clientNode,
  clientBrowser,
  mockNode,
  mockBrowser,
] = await Promise.all([
  loadBuiltSurface('packages/core/dist/index.js'),
  loadBuiltSurface('packages/core/dist/browser.js'),
  loadBuiltSurface('packages/parser/dist/index.js'),
  loadBuiltSurface('packages/parser/dist/browser.js'),
  loadBuiltSurface('packages/codegen/dist/typegen/index.js'),
  loadBuiltSurface('packages/codegen/dist/typegen/browser.js'),
  loadBuiltSurface('packages/router/dist/index.js'),
  loadBuiltSurface('packages/router/dist/browser.js'),
  loadBuiltSurface('packages/client/dist/index.js'),
  loadBuiltSurface('packages/client/dist/browser.js'),
  loadBuiltSurface('packages/mock-server/dist/index.js'),
  loadBuiltSurface('packages/mock-server/dist/browser.js'),
])

assertSurfaceDelta(
  '@oa-sdk/core/browser',
  coreNode,
  coreBrowser,
  [
    'DEFAULT_CONFIG_FILES',
    'DEFAULT_ENV_VAR_NAME',
    'DEFAULT_VCS_DIRS',
    'DEFAULT_WORKSPACE_FILES',
    'createHttpServer',
    'findProjectRoot',
    'findProjectRootDetail',
    'readJsonBody',
    'readRaw',
    'writeJson',
  ],
  [],
)
assertSurfaceDelta(
  '@oa-sdk/codegen/typegen/browser',
  typegenNode,
  typegenBrowser,
  ['analyzeExternalSchemaRefs'],
  [],
)
assertSurfaceDelta('@oa-sdk/router/browser', routerNode, routerBrowser, [], [])
assertSurfaceDelta(
  '@oa-sdk/client/browser',
  clientNode,
  clientBrowser,
  [
    'generateHookFactory',
    'generateKeyFactory',
    'generateOptionsFactory',
    'generateTanstackQuery',
    'getOperationTag',
    'isQueryOperation',
    'toKeyFactoryName',
  ],
  [],
)
assert.deepEqual(
  browserOnlyExports(parserNode, parserBrowser),
  ['derefInternalSpec', 'derefInternalSpecWithDiagnostics'],
  '@oa-sdk/parser/browser gained an undocumented browser-only runtime export',
)
assert.deepEqual(
  browserOnlyExports(mockNode, mockBrowser),
  ['derefInternalSpec', 'parseDocument'],
  '@oa-sdk/mock-server/browser gained an undocumented browser-only runtime export',
)
for (const forbidden of ['derefSpec', 'resolveRefGraph', 'runPipeline']) {
  assert(!(forbidden in parserBrowser), `@oa-sdk/parser/browser must not export Node-only ${forbidden}`)
}
for (const forbidden of ['createNodeMockServer', 'DerefFolder', 'derefSpec', 'runPipeline']) {
  assert(!(forbidden in mockBrowser), `@oa-sdk/mock-server/browser must not export Node-only ${forbidden}`)
}

const paritySpec = {
  openapi: '3.2.0',
  info: { title: 'Browser boundary parity', version: '1.0.0' },
  paths: {
    '/pets': { $ref: '#/components/pathItems/Pets' },
  },
  components: {
    pathItems: {
      Pets: {
        get: {
          operationId: 'listPets',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
    },
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
    },
  },
}

assert.equal(coreBrowser.toColonPath('/pets/{petId}'), coreNode.toColonPath('/pets/{petId}'))
assert.equal(coreBrowser.toOperationMethodName('list-pets'), coreNode.toOperationMethodName('list-pets'))
assert.deepEqual(parserBrowser.parseDocument(paritySpec), parserNode.parseDocument(paritySpec))

// Typegen currently owns separate Node/browser renderers by ADR-008. The shared
// in-memory schema projection is parity-gated; filesystem-backed external refs
// remain deliberately Node-only.
const schemaOnlySpec = { ...paritySpec, paths: {} }
assert.equal(
  typegenBrowser.generateTypesFromSpec(schemaOnlySpec),
  typegenNode.generateTypesFromSpec(schemaOnlySpec),
  'Node/browser typegen schema projection drifted',
)
assert.equal(
  routerBrowser.generateRouter(paritySpec, { target: 'hono', typesImport: './types' }),
  routerNode.generateRouter(paritySpec, { target: 'hono', typesImport: './types' }),
  'Node/browser router generation drifted',
)
assert.equal(
  clientBrowser.generateClient(paritySpec, { typesImport: './types' }),
  clientNode.generateClient(paritySpec, { typesImport: './types' }),
  'Node/browser client generation drifted',
)
assert.deepEqual(
  normalizeMswHandlers(mockBrowser.createMswHandlers(paritySpec)),
  normalizeMswHandlers(mockNode.createMswHandlers(paritySpec)),
  'Node/browser MSW handler generation drifted',
)

console.log(
  `Browser runtime boundary OK: ${javascriptFiles.length} preview assets, ` +
    '6 browser subpaths, no Node builtins, Node/browser in-memory parity.',
)

function loadBuiltSurface(relativePath) {
  const path = join(workspaceRoot, relativePath)
  assert(existsSync(path), `built public surface is missing: ${relativePath}`)
  return import(pathToFileURL(path).href)
}

function walk(directory) {
  const paths = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) paths.push(...walk(path))
    else paths.push(path)
  }
  return paths
}

function moduleSpecifiers(source, path) {
  const specifiers = []
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS)
  const visit = node => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function isNodeBuiltin(specifier) {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return specifier.startsWith('node:') || builtinModules.includes(bare) || builtinModules.includes(bare.split('/')[0])
}

function assertSurfaceDelta(name, nodeSurface, browserSurface, expectedNodeOnly, expectedBrowserOnly) {
  const nodeOnly = Object.keys(nodeSurface).filter(key => !(key in browserSurface)).sort()
  assert.deepEqual(nodeOnly, [...expectedNodeOnly].sort(), `${name} Node-only runtime surface drifted`)
  assert.deepEqual(browserOnlyExports(nodeSurface, browserSurface), [...expectedBrowserOnly].sort(), `${name} browser-only runtime surface drifted`)
}

function browserOnlyExports(nodeSurface, browserSurface) {
  return Object.keys(browserSurface).filter(key => !(key in nodeSurface)).sort()
}

function normalizeMswHandlers(handlers) {
  return handlers.map(handler => ({
    header: handler.info.header,
    method: handler.info.method,
    path: handler.info.path,
  }))
}
