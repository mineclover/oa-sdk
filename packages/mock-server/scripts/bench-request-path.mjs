#!/usr/bin/env node
/**
 * Request-path benchmark for @oa-sdk/mock-server.
 *
 * Serves a realistic spec (default: the @oa-sdk/schemas build output) and
 * sends a fixed number of sequential requests per scenario through
 *   - the Node HTTP adapter: the server runs in a child process and the
 *     requests travel over one keep-alive node:http connection, and
 *   - the MSW adapter: requests are resolved in this process with msw's
 *     getResponse().
 * For every scenario it reports the median request latency and the CPU time
 * per request of the process that runs the mock (the server child for Node
 * HTTP, so client work is excluded; this process for MSW). It also reports how
 * much heap a Node mock server retains after serving many distinct concrete
 * URLs, and the time the response generator (GenerateFolder) takes for the
 * spec's media type schemas and for a synthetic schema whose optional
 * properties share subtrees.
 *
 * With --baseline, a second build of the package (e.g. one built from an
 * earlier commit) is measured alongside, alternating with the current build
 * every round so that both see the same machine load. Every figure is the
 * median over rounds.
 *
 * Usage (from packages/mock-server, after building it and @oa-sdk/schemas):
 *   node --expose-gc scripts/bench-request-path.mjs [options]
 *
 * Options:
 *   --dist <dir>       build to measure (default: ./dist)
 *   --baseline <dir>   build to compare against (default: none)
 *   --spec <file>      OpenAPI JSON/YAML (default: ../schemas/dist/openapi.json)
 *   --requests <n>     requests per scenario, build and round (default: 2000)
 *   --rounds <n>       rounds (default: 5)
 *   --urls <n>         distinct concrete URLs for the retained-heap check (default: 20000)
 */
import { fork } from 'node:child_process'
import { Agent, request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { getResponse } from 'msw'
import { parse as parseYaml } from 'yaml'

const scriptPath = fileURLToPath(import.meta.url)
const packageDir = resolve(dirname(scriptPath), '..')
const SERVE_FLAG = '--serve-node-http'

const BEARER = { Authorization: 'Bearer bench-token' }
const JSON_BEARER = { ...BEARER, 'Content-Type': 'application/json' }
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

/**
 * Scenarios on the @oa-sdk/schemas API. `request(i, context)` returns the i-th
 * request; templated scenarios use a different concrete URL for every request.
 */
const SCENARIOS = [
  { name: 'static example (GET /version)', expect: 200, request: () => ({ method: 'GET', path: '/version' }) },
  { name: 'static generated (GET /world-model/execution-profiles)', expect: 200, request: () => ({ method: 'GET', path: '/world-model/execution-profiles', headers: BEARER }) },
  { name: 'templated example (GET /users/{id})', expect: 200, request: i => ({ method: 'GET', path: `/users/${uuid(i)}`, headers: BEARER }) },
  { name: 'templated generated (GET /worlds/{worldId})', expect: 200, request: i => ({ method: 'GET', path: `/worlds/${uuid(i)}`, headers: BEARER }) },
  {
    name: 'validated body, example 201 (POST /users)',
    expect: 201,
    request: i => ({ method: 'POST', path: '/users', headers: JSON_BEARER, body: JSON.stringify({ email: `user${i}@example.com`, name: `User ${i}`, password: 'correct-horse' }) }),
  },
  {
    name: 'validated body, generated 201 (POST /worlds)',
    expect: 201,
    request: (i, context) => ({ method: 'POST', path: '/worlds', headers: JSON_BEARER, body: JSON.stringify({ ...context.worldBody, worldId: uuid(i) }) }),
  },
  {
    name: 'invalid body, 422 (POST /users)',
    expect: 422,
    request: i => ({ method: 'POST', path: '/users', headers: JSON_BEARER, body: JSON.stringify({ email: `not-an-email-${i}`, name: '', password: 'short' }) }),
  },
  { name: 'method not allowed (PUT /users/{id})', expect: 405, request: i => ({ method: 'PUT', path: `/users/${uuid(i)}`, headers: BEARER }) },
]

const RETAINED_HEAP_SCENARIOS = [SCENARIOS[2], SCENARIOS[7]]

if (process.argv[2] === SERVE_FLAG) {
  await serveNodeHttp(process.argv[3], process.argv[4])
} else {
  await main(parseArgs(process.argv.slice(2)))
}

async function main(options) {
  const spec = await loadSpec(options.spec)
  const builds = [{ label: 'current', dir: options.dist }]
  if (options.baseline) builds.unshift({ label: 'baseline', dir: options.baseline })
  for (const build of builds) build.module = await loadBuild(build.dir)
  // A schema-valid POST /worlds body: the package's own minimal generator output.
  const context = { worldBody: builds[0].module.generator.fold(worldRequestSchema(spec)) }

  console.log(`spec: ${options.spec} (${Object.keys(spec.paths ?? {}).length} paths)`)
  for (const build of builds) console.log(`${build.label}: ${build.dir}`)
  console.log(`${options.requests} requests per scenario, build and round; ${options.rounds} rounds; node ${process.version}; load average ${loadAverage()}\n`)

  for (const adapter of ['node-http', 'msw']) {
    // label → scenario → one { latency, cpu } sample (µs per request) per round
    const samples = new Map(builds.map(build => [build.label, new Map(SCENARIOS.map(scenario => [scenario.name, []]))]))
    const targets = new Map()
    try {
      for (const build of builds) targets.set(build.label, await openTarget(adapter, build, options, spec))
      for (const target of targets.values()) {
        for (const scenario of SCENARIOS) await runScenario(target, scenario, context, Math.min(500, options.requests), 50_000_000)
      }
      for (let round = 0; round < options.rounds; round += 1) {
        const order = round % 2 === 0 ? builds : [...builds].reverse()
        for (const scenario of SCENARIOS) {
          for (const build of order) {
            const target = targets.get(build.label)
            const cpuBefore = await target.cpu()
            const latencies = await runScenario(target, scenario, context, options.requests, round * options.requests)
            const cpuAfter = await target.cpu()
            samples.get(build.label).get(scenario.name).push({
              latency: median(latencies) * 1000,
              cpu: (cpuAfter.user + cpuAfter.system - cpuBefore.user - cpuBefore.system) / options.requests,
            })
          }
        }
      }
    } finally {
      for (const target of targets.values()) await target.close()
    }
    printTable(adapter, samples, options.rounds)
  }

  printGeneratorTable(builds, spec, options.rounds)

  console.log(`retained heap after ${options.urls} distinct concrete URLs (node-http server, after GC)`)
  for (const build of builds) {
    for (const scenario of RETAINED_HEAP_SCENARIOS) {
      const retained = await measureRetainedHeap(build, scenario, context, options)
      console.log(`  ${build.label.padEnd(9)} ${scenario.name.padEnd(42)} ${formatBytes(retained).padStart(10)}  (${(retained / options.urls).toFixed(1)} B/URL)`)
    }
  }
  console.log(`\nload average at end: ${loadAverage()}`)
}

// ─── targets ────────────────────────────────────────────────────────────────

/** A mock to send requests to, and the CPU usage of the process running it. */
async function openTarget(adapter, build, options, spec) {
  if (adapter === 'node-http') return openNodeHttpServer(build, options)

  const handlers = build.module.createMswHandlers(spec)
  const origin = `http://bench.example.test${basePathOf(spec)}`
  return {
    send: async request => {
      const response = await getResponse(handlers, new Request(`${origin}${request.path}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }))
      if (!response) throw new Error(`MSW left ${request.method} ${request.path} unhandled`)
      await response.arrayBuffer()
      return response.status
    },
    cpu: async () => process.cpuUsage(),
    close: async () => {},
  }
}

async function openNodeHttpServer(build, options) {
  const child = fork(scriptPath, [SERVE_FLAG, build.dir, options.spec], { execArgv: ['--expose-gc'] })
  // The child answers every command with exactly one message, in order.
  const pending = []
  let exitError
  child.on('message', message => pending.shift()?.resolve(message))
  child.on('exit', code => {
    exitError = new Error(`node-http server for ${build.label} exited with code ${code}`)
    for (const reply of pending.splice(0)) reply.reject(exitError)
  })
  const nextMessage = () => new Promise((resolveReply, reject) => {
    if (exitError) reject(exitError)
    else pending.push({ resolve: resolveReply, reject })
  })
  const ask = command => {
    const reply = nextMessage()
    child.send(command)
    return reply
  }

  const { url } = await nextMessage()
  const base = new URL(url)
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  return {
    send: request => sendHttp(agent, base, request),
    cpu: async () => (await ask('cpu')).cpu,
    heap: async () => (await ask('heap')).heap,
    close: async () => {
      agent.destroy()
      if (exitError) return
      const exited = new Promise(resolveExit => child.once('exit', resolveExit))
      child.send('stop')
      await exited
    },
  }
}

/** Child process: serve the spec with one build's Node HTTP adapter and answer measurement requests. */
async function serveNodeHttp(dir, specFile) {
  const module = await loadBuild(dir)
  const server = module.createNodeMockServer(await loadSpec(specFile), { port: 0 })
  await server.start()
  // Never outlive the benchmark, even when it stops without saying so.
  process.on('disconnect', () => process.exit(0))
  process.on('message', async command => {
    if (command === 'cpu') process.send({ cpu: process.cpuUsage() })
    else if (command === 'heap') process.send({ heap: await settledHeap() })
    else if (command === 'stop') {
      await server.stop()
      process.exit(0)
    }
  })
  process.send({ url: server.url })
}

function sendHttp(agent, base, request) {
  return new Promise((resolveStatus, reject) => {
    const outgoing = httpRequest({
      agent,
      host: base.hostname,
      port: base.port,
      method: request.method,
      path: `${base.pathname.replace(/\/$/, '')}${request.path}`,
      headers: {
        ...request.headers,
        ...(request.body !== undefined && { 'Content-Length': Buffer.byteLength(request.body) }),
      },
    }, response => {
      response.on('data', () => {})
      response.on('end', () => resolveStatus(response.statusCode))
      response.on('error', reject)
    })
    outgoing.on('error', reject)
    outgoing.end(request.body)
  })
}

async function runScenario(target, scenario, context, count, offset) {
  const latencies = new Array(count)
  for (let i = 0; i < count; i += 1) {
    const request = scenario.request(offset + i, context)
    const started = performance.now()
    const status = await target.send(request)
    latencies[i] = performance.now() - started
    if (status !== scenario.expect) {
      throw new Error(`${scenario.name}: expected ${scenario.expect}, received ${status} for ${request.method} ${request.path}`)
    }
  }
  return latencies
}

/** Heap a fresh server retains after `options.urls` requests, each to a different concrete URL. */
async function measureRetainedHeap(build, scenario, context, options) {
  const server = await openNodeHttpServer(build, options)
  try {
    // Warm the route first, so only growth per concrete URL remains.
    await runScenario(server, scenario, context, 500, 50_000_000)
    const before = await server.heap()
    await runScenario(server, scenario, context, options.urls, 0)
    return (await server.heap()) - before
  } finally {
    await server.close()
  }
}

async function settledHeap() {
  for (let i = 0; i < 4; i += 1) {
    globalThis.gc()
    await new Promise(resolveTick => setImmediate(resolveTick))
  }
  return process.memoryUsage().heapUsed
}

// ─── generator ──────────────────────────────────────────────────────────────

/**
 * An object schema with `depth` levels, each holding one required string and
 * three optional references to the level below. Generation keeps only the
 * required strings; folding the optional references visits 3^depth nodes.
 */
function optionalSubtreeSchema(depth) {
  let node = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }
  for (let level = 0; level < depth; level += 1) {
    node = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' }, left: node, right: node, items: { type: 'array', items: node } },
    }
  }
  return node
}

function printGeneratorTable(builds, spec, rounds) {
  const specSchemas = mediaTypeSchemas(spec)
  const cases = [
    { name: `every media type schema of the spec (${specSchemas.length})`, schemas: specSchemas },
    { name: 'optional subtrees, depth 8 (synthetic)', schemas: [optionalSubtreeSchema(8)] },
  ]
  const labels = builds.map(build => build.label)
  const header = ['generator: µs per fold of the set'.padEnd(58), ...labels.map(label => label.padStart(10))]
  if (builds.length === 2) header.push('change'.padStart(9))
  console.log(`  ${header.join(' ')}`)
  for (const { name, schemas } of cases) {
    const outputs = builds.map(build => JSON.stringify(schemas.map(schema => build.module.generator.fold(schema))))
    if (outputs.some(output => output !== outputs[0])) throw new Error(`generator output differs between builds for ${name}`)
    const perFold = builds.map(() => [])
    for (let round = 0; round < rounds; round += 1) {
      builds.forEach((build, index) => perFold[index].push(timeFolds(build.module.generator, schemas)))
    }
    const values = perFold.map(median)
    const row = [`  ${name}`.padEnd(58), ...values.map(value => value.toFixed(1).padStart(10))]
    if (builds.length === 2) row.push(`${(((values[1] - values[0]) / values[0]) * 100).toFixed(1)}%`.padStart(9))
    console.log(`  ${row.join(' ')}`)
  }
  console.log('')
}

/** µs to fold every schema once, averaged over enough repetitions to last about 50 ms. */
function timeFolds(generator, schemas) {
  let repetitions = 0
  const started = performance.now()
  do {
    for (const schema of schemas) generator.fold(schema)
    repetitions += 1
  } while (performance.now() - started < 50)
  return ((performance.now() - started) * 1000) / repetitions
}

/** Every request and response media type schema of the spec, with local $refs inlined. */
function mediaTypeSchemas(document) {
  const schemas = []
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(inlineRefs(document, pathItem))) {
      if (!operation || typeof operation !== 'object' || !operation.responses) continue
      const contents = [operation.requestBody?.content, ...Object.values(operation.responses).map(response => response.content)]
      for (const content of contents) {
        for (const mediaType of Object.values(content ?? {})) {
          if (mediaType.schema) schemas.push(mediaType.schema)
          if (mediaType.itemSchema) schemas.push(mediaType.itemSchema)
        }
      }
    }
  }
  return schemas
}

// ─── spec ───────────────────────────────────────────────────────────────────

async function loadSpec(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new Error(`Cannot read ${file}. Build it with \`corepack pnpm turbo run build --filter=@oa-sdk/schemas\` or pass --spec.`)
  }
  return file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
}

function basePathOf(document) {
  const url = document.servers?.[0]?.url
  if (!url) return ''
  try {
    return new URL(url).pathname.replace(/\/$/, '')
  } catch {
    return url.replace(/\/$/, '')
  }
}

/** The POST /worlds request body schema with its local $refs inlined. */
function worldRequestSchema(document) {
  return inlineRefs(document, document.paths['/worlds'].post.requestBody).content['application/json'].schema
}

/**
 * `node` with every local `$ref` replaced by its target. A `$ref` back to a
 * target that is already being inlined on the current path stays a `$ref`, so
 * recursive schemas end there.
 */
function inlineRefs(document, node, ancestors = new Set()) {
  if (Array.isArray(node)) return node.map(item => inlineRefs(document, item, ancestors))
  if (!node || typeof node !== 'object') return node
  const ref = node.$ref
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (ancestors.has(ref)) return node
    const target = ref.slice(2).split('/')
      .map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'))
      .reduce((value, key) => value?.[key], document)
    return inlineRefs(document, target, new Set(ancestors).add(ref))
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, inlineRefs(document, value, ancestors)]))
}

// ─── reporting ──────────────────────────────────────────────────────────────

function printTable(adapter, samples, rounds) {
  const labels = [...samples.keys()]
  const compare = labels.length === 2
  const cpuOwner = adapter === 'node-http' ? 'server process' : 'this process'
  console.log(`${adapter}: µs per request, median of ${rounds} rounds`)
  for (const [metric, title] of [['latency', 'median latency'], ['cpu', `CPU time (${cpuOwner})`]]) {
    const header = [title.padEnd(58), ...labels.map(label => label.padStart(10))]
    if (compare) header.push('change'.padStart(9))
    console.log(`  ${header.join(' ')}`)
    for (const scenario of SCENARIOS) {
      const values = labels.map(label => median(samples.get(label).get(scenario.name).map(sample => sample[metric])))
      const row = [`  ${scenario.name}`.padEnd(58), ...values.map(value => value.toFixed(1).padStart(10))]
      if (compare) row.push(`${(((values[1] - values[0]) / values[0]) * 100).toFixed(1)}%`.padStart(9))
      console.log(`  ${row.join(' ')}`)
    }
  }
  console.log('')
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function formatBytes(bytes) {
  const sign = bytes < 0 ? '-' : ''
  const value = Math.abs(bytes)
  if (value >= 1024 * 1024) return `${sign}${(value / 1024 / 1024).toFixed(2)} MiB`
  return `${sign}${(value / 1024).toFixed(1)} KiB`
}

function loadAverage() {
  return loadavg().map(value => value.toFixed(2)).join(' ')
}

// ─── setup ──────────────────────────────────────────────────────────────────

async function loadBuild(dir) {
  return import(pathToFileURL(resolve(dir, 'index.js')).href)
}

function parseArgs(args) {
  const parsed = {
    dist: resolve(packageDir, 'dist'),
    baseline: undefined,
    spec: resolve(packageDir, '../schemas/dist/openapi.json'),
    requests: 2000,
    rounds: 5,
    urls: 20000,
  }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    switch (flag) {
      case '--dist': parsed.dist = resolve(value); break
      case '--baseline': parsed.baseline = resolve(value); break
      case '--spec': parsed.spec = resolve(value); break
      case '--requests': parsed.requests = positiveInteger(flag, value); break
      case '--rounds': parsed.rounds = positiveInteger(flag, value); break
      case '--urls': parsed.urls = positiveInteger(flag, value); break
      default: throw new Error(`Unknown option ${flag}`)
    }
  }
  if (typeof globalThis.gc !== 'function') {
    throw new Error('Run with node --expose-gc: the retained-heap check collects garbage before measuring.')
  }
  return parsed
}

function positiveInteger(flag, value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${flag} must be a positive integer`)
  return number
}
