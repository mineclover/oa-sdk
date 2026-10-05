import type { SetupWorker } from 'msw/browser'
import { parseMockHeaders, parseSpec } from './user-input.js'

let worker: SetupWorker | null = null

type CodegenModules = {
  generateTypesFromSpec: typeof import('@oa-sdk/codegen/typegen/browser')['generateTypesFromSpec']
  generateRouter: typeof import('@oa-sdk/router/browser')['generateRouter']
  generateClient: typeof import('@oa-sdk/client/browser')['generateClient']
}

let codegenModulesPromise: Promise<CodegenModules> | null = null

function loadCodegenModules(): Promise<CodegenModules> {
  codegenModulesPromise ??= Promise.all([
    import('@oa-sdk/codegen/typegen/browser'),
    import('@oa-sdk/router/browser'),
    import('@oa-sdk/client/browser'),
  ]).then(([typegen, router, client]) => ({
    generateTypesFromSpec: typegen.generateTypesFromSpec,
    generateRouter: router.generateRouter,
    generateClient: client.generateClient,
  }))
  return codegenModulesPromise
}

type MockModules = {
  createMswHandlers: typeof import('@oa-sdk/mock-server/browser')['createMswHandlers']
  setupWorker: typeof import('msw/browser')['setupWorker']
}

let mockModulesPromise: Promise<MockModules> | null = null

function loadMockModules(): Promise<MockModules> {
  mockModulesPromise ??= Promise.all([
    import('@oa-sdk/mock-server/browser'),
    import('msw/browser'),
  ]).then(([mockServer, mswBrowser]) => ({
    createMswHandlers: mockServer.createMswHandlers,
    setupWorker: mswBrowser.setupWorker,
  }))
  return mockModulesPromise
}

// ─── Example spec ─────────────────────────────────────────────

const EXAMPLE_SPEC = `openapi: '3.2.0'
info:
  title: Pet Store
  version: 1.0.0
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
  schemas:
    Pet:
      type: object
      required: [id, name, species]
      properties:
        id:
          type: integer
        name:
          type: string
          minLength: 1
        species:
          type: string
          enum: [dog, cat, bird]
        age:
          type: integer
          minimum: 0
    CreatePet:
      type: object
      required: [name, species]
      properties:
        name:
          type: string
          minLength: 1
        species:
          type: string
          enum: [dog, cat, bird]
paths:
  /pets:
    get:
      operationId: listPets
      parameters:
        - name: species
          in: query
          schema:
            type: string
            enum: [dog, cat, bird]
      responses:
        '200':
          description: OK
          content:
            application/json:
              examples:
                default:
                  dataValue:
                    - id: 1
                      name: Buddy
                      species: dog
                      age: 3
                    - id: 2
                      name: Whiskers
                      species: cat
                      age: 5
    post:
      operationId: createPet
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreatePet'
      responses:
        '201':
          description: Created
          content:
            application/json:
              examples:
                default:
                  dataValue:
                    id: 3
                    name: Tweety
                    species: bird
  /pets/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    get:
      operationId: getPet
      responses:
        '200':
          description: OK
          content:
            application/json:
              examples:
                default:
                  dataValue:
                    id: 1
                    name: Buddy
                    species: dog
                    age: 3
    delete:
      operationId: deletePet
      security:
        - bearerAuth: []
      responses:
        '204':
          description: Deleted
`

// ─── DOM refs ─────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const specInput = $<HTMLTextAreaElement>('spec-input')
const outputTypes = $('output-types')
const outputRouter = $('output-router')
const outputClient = $('output-client')
const btnGenerate = $<HTMLButtonElement>('btn-generate')
const btnLoadExample = $<HTMLButtonElement>('btn-load-example')
const btnStartMock = $<HTMLButtonElement>('btn-start-mock')
const btnStopMock = $<HTMLButtonElement>('btn-stop-mock')
const btnSend = $<HTMLButtonElement>('btn-send')
const mockMethod = $<HTMLSelectElement>('mock-method')
const mockUrl = $<HTMLInputElement>('mock-url')
const mockBody = $<HTMLTextAreaElement>('mock-body')
const mockHeaders = $<HTMLTextAreaElement>('mock-headers')
const mockStatus = $('mock-status')
const mockResponseStatus = $('mock-response-status')
const mockResponseBody = $('mock-response-body')

// ─── Tabs ─────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
    tab.classList.add('active')
    const target = (tab as HTMLElement).dataset.tab!
    document.getElementById(`tab-${target}`)!.classList.remove('hidden')
  })
})

// ─── Generate ─────────────────────────────────────────────────

async function generate() {
  const spec = parseSpec(specInput.value)
  if (!spec) {
    const msg = '// Error: Invalid OpenAPI spec'
    outputTypes.textContent = msg
    outputRouter.textContent = msg
    outputClient.textContent = msg
    return
  }

  let codegen: CodegenModules
  try {
    codegen = await loadCodegenModules()
  } catch (e) {
    const msg = `// Error loading generators:\n// ${e}`
    outputTypes.textContent = msg
    outputRouter.textContent = msg
    outputClient.textContent = msg
    return
  }

  try {
    outputTypes.textContent = codegen.generateTypesFromSpec(spec)
  } catch (e) {
    outputTypes.textContent = `// Error generating types:\n// ${e}`
  }

  try {
    outputRouter.textContent = codegen.generateRouter(spec, { target: 'hono', typesImport: './types' })
  } catch (e) {
    outputRouter.textContent = `// Error generating router:\n// ${e}`
  }

  try {
    outputClient.textContent = codegen.generateClient(spec, { typesImport: './types' })
  } catch (e) {
    outputClient.textContent = `// Error generating client:\n// ${e}`
  }
}

btnGenerate.addEventListener('click', () => { void generate() })

// ─── Load Example ─────────────────────────────────────────────

btnLoadExample.addEventListener('click', () => {
  specInput.value = EXAMPLE_SPEC
  mockMethod.value = 'GET'
  mockUrl.value = '/pets'
  mockBody.value = ''
  mockHeaders.value = ''
  void generate()
})

// ─── Mock Server (Service Worker) ─────────────────────────────

btnStartMock.addEventListener('click', async () => {
  const spec = parseSpec(specInput.value)
  if (!spec) {
    mockStatus.textContent = 'Error: Invalid spec'
    mockStatus.style.color = '#f85149'
    return
  }

  try {
    const { createMswHandlers, setupWorker } = await loadMockModules()
    if (worker) await worker.stop()
    const handlers = createMswHandlers(spec)
    worker = setupWorker(...handlers)
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
    mockStatus.textContent = 'Running (Service Worker)'
    mockStatus.style.color = '#3fb950'
    btnStartMock.disabled = true
    btnStopMock.disabled = false
  } catch (e) {
    mockStatus.textContent = `Error: ${e}`
    mockStatus.style.color = '#f85149'
  }
})

btnStopMock.addEventListener('click', async () => {
  if (worker) {
    await worker.stop()
    worker = null
  }
  mockStatus.textContent = 'Stopped'
  mockStatus.style.color = '#8b949e'
  btnStartMock.disabled = false
  btnStopMock.disabled = true
})

// ─── Send Request ─────────────────────────────────────────────

btnSend.addEventListener('click', async () => {
  if (!worker) {
    mockResponseStatus.textContent = 'Mock server not running'
    mockResponseStatus.style.color = '#f85149'
    return
  }

  const method = mockMethod.value
  const url = mockUrl.value.startsWith('/') ? mockUrl.value : '/' + mockUrl.value
  const fullUrl = window.location.origin + url

  const init: RequestInit = { method }

  // Custom headers that cannot be read stop the request, so it is never sent without them.
  let headers: Record<string, string>
  try {
    headers = parseMockHeaders(mockHeaders.value)
  } catch (e) {
    mockResponseStatus.textContent = `Invalid headers: ${e instanceof Error ? e.message : String(e)}`
    mockResponseStatus.style.color = '#f85149'
    mockResponseBody.textContent = ''
    return
  }

  // Body for non-GET methods
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const bodyText = mockBody.value.trim()
    if (bodyText) {
      init.body = bodyText
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
    }
  }

  if (Object.keys(headers).length > 0) init.headers = headers

  try {
    const start = performance.now()
    const res = await fetch(fullUrl, init)
    const elapsed = Math.round(performance.now() - start)

    const statusColor = res.ok ? '#3fb950' : res.status < 500 ? '#d29922' : '#f85149'
    mockResponseStatus.innerHTML =
      `<span style="color:${statusColor}">${res.status} ${res.statusText}</span>` +
      ` <span style="color:#8b949e">${elapsed}ms</span>`

    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('json')) {
      const json = await res.json()
      mockResponseBody.textContent = JSON.stringify(json, null, 2)
    } else {
      mockResponseBody.textContent = await res.text() || '(empty body)'
    }
  } catch (e) {
    mockResponseStatus.textContent = `Fetch error: ${e}`
    mockResponseStatus.style.color = '#f85149'
    mockResponseBody.textContent = ''
  }
})

// ─── Init ─────────────────────────────────────────────────────

btnLoadExample.click()
