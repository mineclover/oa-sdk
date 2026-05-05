/**
 * v0.6 — propose persona stubs from orphan responses.
 * v0.12 — also propose happy-path stubs for operations without any persona.
 *
 * Two modes:
 *   - proposeStubsFromOrphans: only stubs for orphan response codes
 *   - proposeStubsFromSpec:    happy-path + orphan stubs (full spec scan)
 *
 * Heuristics:
 *   - happy-path: security → actor, method+path → intent, opId → trigger
 *   - orphan: status code → trigger/actor/severity (existing logic)
 *
 * Stubs are pure data — caller decides what to do (stdout, file write,
 * append). Naming-collision against existing personas is skipped.
 */

import type { MinimalOpenApiDoc } from './bind.js'
import type { OperationInfo } from './load.js'
import { listPersonasForOperation, findOperation } from './resolver.js'
import type { DomainMatrix, Persona } from './types.js'
import { isHttpDomain } from './kind.js'

export interface ProposeOptions {
  spec: MinimalOpenApiDoc
  domains: DomainMatrix[]
  knownOperations: Map<string, OperationInfo>
}

/** v0.12: 어떤 signal이 stub 생성을 트리거했는지 표시 */
export type StubSignal =
  | 'orphan'        // declared response without persona expecting it
  | 'new-op'        // operation has no implemented persona at all
  | 'new-schema'    // schema in spec without data-model file

export interface ProposedStub {
  /** Domain file recommendation (best-effort: primary persona's domain or path-prefix). */
  domain: string
  operationId: string
  /** 적용 status code (orphan/new-op) 또는 schema 이름 (new-schema). */
  statusCode: string
  /** Signal source. */
  signal: StubSignal
  /** Generated persona row (matches Persona shape, status='proposed'). */
  persona: Persona
  /** True if this id collides with an existing persona — caller may skip. */
  collision: boolean
}

export function proposeStubsFromOrphans(opts: ProposeOptions): ProposedStub[] {
  const stubs: ProposedStub[] = []
  const existingIds = new Set<string>()
  const acknowledged = new Set<string>()    // `${opId}|${code}` keys
  for (const m of opts.domains) {
    for (const p of m.personas) existingIds.add(p.id)
    for (const ack of m.acknowledged_orphans ?? []) {
      acknowledged.add(`${ack.operationId}|${ack.statusCode}`)
    }
  }

  for (const [opId, info] of opts.knownOperations.entries()) {
    const claimers = listPersonasForOperation(opId, opts.domains)
    const expectedSet = new Set<string>()
    for (const p of claimers) {
      for (const code of p.outcome?.expects ?? []) expectedSet.add(String(code))
    }

    const orphans = [...info.responses]
      .filter(code => /^\d{3}$/.test(code))      // skip 'default' / range
      .filter(code => !expectedSet.has(code))
      .filter(code => !acknowledged.has(`${opId}|${code}`))   // skip intentional orphans
      .sort()

    if (orphans.length === 0) continue

    const primary = claimers[0]                  // sample for inheriting reference / data
    const ownerDomain = findDomainOf(primary?.id, opts.domains) ?? inferDomainFromPath(info.path, opts.domains)

    for (const code of orphans) {
      const stub = buildStub(opId, info, code, primary, ownerDomain, opts.spec, opts.domains)
      stubs.push({
        domain: ownerDomain,
        operationId: opId,
        statusCode: code,
        signal: 'orphan',
        persona: stub,
        collision: existingIds.has(stub.id),
      })
    }
  }

  return stubs.sort((a, b) =>
    a.domain.localeCompare(b.domain) ||
    a.operationId.localeCompare(b.operationId) ||
    a.statusCode.localeCompare(b.statusCode),
  )
}

// ─── v0.12: signal-driven full-spec inference ────────────────────────────

/**
 * proposeStubsFromSpec — 전체 spec scan으로 3 signal 모두 처리:
 *   - new-op:     spec 신규 op, 페르소나 없음 → happy-path stub
 *   - orphan:     declared response, 페르소나 없음 → negative-path stub (기존)
 *   - new-schema: spec 신규 schema, data-model 없음 → 안내 stub
 *
 * 출력은 idempotent — 이미 처리된 op/schema는 skip.
 */
export interface ProposeFromSpecOptions extends ProposeOptions {
  /** 이미 존재하는 data-models 엔티티 이름 set (new-schema signal 검출에 사용). */
  knownDataModels?: Set<string>
}

export function proposeStubsFromSpec(opts: ProposeFromSpecOptions): ProposedStub[] {
  const orphanStubs = proposeStubsFromOrphans(opts)
  const happyStubs = generateHappyPathStubs(opts)
  const schemaStubs = generateSchemaStubs(opts)
  return [...happyStubs, ...orphanStubs, ...schemaStubs].sort((a, b) =>
    a.domain.localeCompare(b.domain) ||
    a.signal.localeCompare(b.signal) ||
    a.operationId.localeCompare(b.operationId),
  )
}

function generateHappyPathStubs(opts: ProposeOptions): ProposedStub[] {
  const stubs: ProposedStub[] = []
  const existingIds = new Set<string>()
  for (const m of opts.domains) for (const p of m.personas) existingIds.add(p.id)

  for (const [opId, info] of opts.knownOperations.entries()) {
    const claimers = listPersonasForOperation(opId, opts.domains)
    if (claimers.length > 0) continue                  // already has happy-path

    const persona = buildHappyPathPersona(opId, info, opts.spec)
    if (!persona) continue
    const ownerDomain = inferDomainFromPath(info.path, opts.domains)

    stubs.push({
      domain: ownerDomain,
      operationId: opId,
      statusCode: String(persona.outcome?.expects?.[0] ?? '200'),
      signal: 'new-op',
      persona,
      collision: existingIds.has(persona.id),
    })
  }
  return stubs
}

function buildHappyPathPersona(opId: string, info: OperationInfo, spec: MinimalOpenApiDoc): Persona | null {
  const op = findOperation(spec, opId)
  if (!op) return null
  const operation = op.operation

  // Actor inference from security
  const security = operation['security'] as Array<Record<string, unknown>> | undefined
  const isPublic = !security || security.length === 0 ||
    (security.length === 1 && Object.keys(security[0] ?? {}).length === 0)

  const path = info.path
  let actor = 'user'
  let consumer: string | undefined
  if (isPublic) {
    actor = 'guest'
  } else if (path.includes('/admin/')) {
    actor = 'admin'
    consumer = 'internal-tool'
  } else if (path.startsWith('/me/') || path === '/me') {
    actor = 'owner-self'
  } else if (path.startsWith('/health') || path.startsWith('/version')) {
    actor = 'system'
    consumer = 'infra-ops'
  }

  const intent = inferIntent(info.method, path, opId)
  const trigger = inferTriggerFromOpId(opId, intent)
  const successCode = pickSuccessCode([...info.responses])

  const persona: Persona = {
    id: makeHappyPathId(opId),
    status: 'proposed',
    identity: { actor, data: inferDataFromOp(opId, spec), intent, trigger },
    notes: `(auto-stub from spec, signal=new-op) happy-path for ${opId}. 검토 후 actor / data / consumer / skills 보강 필요.`,
  }
  if (consumer) persona.identity.consumer = consumer
  persona.outcome = {
    shape: inferShape(intent, path),
    access: actor === 'guest' ? ['public'] : ['scoped:read'],
    maps_to: [opId],
    expects: [successCode],
  }
  return persona
}

function inferIntent(method: string, path: string, opId: string): string {
  const m = method.toLowerCase()
  const lid = opId.toLowerCase()
  if (lid.includes('login') || lid.includes('refresh') || lid.includes('register')) return 'authenticate'
  if (lid.includes('logout') || lid.includes('revoke')) return 'revoke'
  if (lid.includes('export')) return 'export'
  if (lid.includes('subscribe') || lid.includes('stream')) return 'subscribe'
  if (lid.includes('monitor') || (m === 'get' && path.startsWith('/health'))) return 'monitor'
  if (m === 'get') return /\{[^}]+\}\s*$/.test(path) ? 'read-detail' : 'list'
  if (m === 'post') return 'create'
  if (m === 'put' || m === 'patch') return 'update'
  if (m === 'delete') return /\/me$/.test(path) ? 'soft-delete' : 'hard-delete'
  return 'read-detail'
}

function inferTriggerFromOpId(opId: string, intent: string): string {
  const lid = opId.toLowerCase()
  if (lid.includes('login')) return 'return-visit'
  if (lid.includes('register') || lid.includes('signup')) return 'first-arrival'
  if (lid.includes('refresh')) return 'token-expiring'
  if (lid.includes('logout')) return 'leave-device'
  if (lid.includes('export')) return 'gdpr-portability'
  if (intent === 'monitor') return 'load-balancer-probe'
  if (intent === 'list' || intent === 'read-detail') return 'profile-page'
  if (intent === 'update') return 'edit-profile'
  if (intent === 'hard-delete' || intent === 'soft-delete') return 'leave-service'
  return 'first-arrival'
}

function inferShape(intent: string, _path: string): string {
  if (intent === 'list') return 'list-paginated'
  if (intent === 'authenticate') return 'token'
  if (intent === 'subscribe') return 'stream-sse'
  if (intent === 'export') return 'bulk-batch'
  if (intent === 'hard-delete' || intent === 'soft-delete' || intent === 'revoke') return 'command'
  return 'detail'
}

function pickSuccessCode(declared: string[]): number {
  for (const c of ['200', '201', '202', '204']) if (declared.includes(c)) return Number(c)
  const exact = declared.filter(c => /^2\d{2}$/.test(c))
  if (exact.length > 0) return Number(exact[0])
  return 200
}

function makeHappyPathId(opId: string): string {
  return `happy-${opId}`
}

function generateSchemaStubs(opts: ProposeFromSpecOptions): ProposedStub[] {
  const stubs: ProposedStub[] = []
  const known = opts.knownDataModels ?? new Set<string>()
  const schemas = (opts.spec as { components?: { schemas?: Record<string, unknown> } }).components?.schemas
  if (!schemas) return stubs

  for (const name of Object.keys(schemas)) {
    if (known.has(name)) continue
    // 비-entity로 보이는 스키마는 skip (Request/Response/Error 등)
    if (/Request$|Response$|^Error$|Validation/.test(name)) continue
    const persona: Persona = {
      id: `data-model-${name}`,
      status: 'proposed',
      identity: { actor: 'system', data: name, intent: 'read-detail', trigger: 'first-arrival' },
      notes: `(auto-stub from spec, signal=new-schema) ${name} schema 발견 — data-models/${name}.persona.yaml 작성 권장. 이 stub은 placeholder; 실제 구현은 data-model 파일에.`,
    }
    stubs.push({
      domain: '(data-models)',
      operationId: name,
      statusCode: '-',
      signal: 'new-schema',
      persona,
      collision: false,
    })
  }
  return stubs
}

// ─── stub construction ────────────────────────────────────────────────────

interface CodeProfile {
  actor: string | null         // null means inherit primary persona's actor
  trigger: string
  intent: string | null        // null means inherit
  access: string[]
  shape: string | null         // null means inherit
  idPrefix: string             // for naming heuristic
  noteHint: string
}

const CODE_PROFILES: Record<string, CodeProfile> = {
  '400': { actor: null, trigger: 'malformed-request', intent: null, access: [], shape: null, idPrefix: 'malformed', noteHint: '잘못된 요청 형식' },
  '401': { actor: 'guest', trigger: 'missing-auth', intent: null, access: ['public'], shape: null, idPrefix: 'guest-unauthorized', noteHint: '미인증 호출' },
  '403': { actor: 'user', trigger: 'insufficient-scope', intent: null, access: ['scoped:read', 'audited'], shape: null, idPrefix: 'insufficient-scope', noteHint: '권한 부족' },
  '404': { actor: null, trigger: 'phantom-id', intent: null, access: [], shape: null, idPrefix: 'not-found', noteHint: '존재하지 않는 리소스' },
  '409': { actor: null, trigger: 'duplicate-identity', intent: null, access: [], shape: null, idPrefix: 'conflict', noteHint: '중복 식별자' },
  '422': { actor: null, trigger: 'malformed-payload', intent: null, access: [], shape: null, idPrefix: 'malformed-payload', noteHint: 'schema 위반' },
  '429': { actor: null, trigger: 'rate-limit-hit', intent: null, access: ['rate-limited'], shape: null, idPrefix: 'rate-limited', noteHint: '요청 한도 초과' },
  '500': { actor: null, trigger: 'server-error', intent: null, access: [], shape: null, idPrefix: 'server-error', noteHint: '서버 내부 오류' },
  '503': { actor: 'system', trigger: 'dependency-down', intent: 'monitor', access: ['public'], shape: null, idPrefix: 'dependency-down', noteHint: '의존 시스템 장애' },
}

function buildStub(
  opId: string,
  info: OperationInfo,
  code: string,
  primary: Persona | undefined,
  domain: string,
  spec: MinimalOpenApiDoc,
  domains: DomainMatrix[],
): Persona {
  const profile = CODE_PROFILES[code] ?? defaultProfile(code)

  // identity
  const actor = profile.actor ?? primary?.identity.actor ?? 'system'
  const intent = profile.intent ?? primary?.identity.intent ?? inferIntentFromMethod(info.method)
  const data = primary?.identity.data ?? inferDataFromOp(opId, spec)
  const trigger = profile.trigger

  // reference (inherit from primary, but trim regulation if 401-public)
  const reference: Persona['reference'] = {}
  const channels = primary?.reference?.channel ?? []
  const regulations = primary?.reference?.regulation ?? []
  if (channels.length > 0) reference.channel = [...channels]
  // regulations only inherit when actor matches primary or status preserves data context
  if (regulations.length > 0 && actor === primary?.identity.actor) {
    reference.regulation = [...regulations]
  }

  // outcome
  const shape = profile.shape ?? primary?.outcome?.shape ?? 'command'
  const access = mergeAccess(primary?.outcome?.access ?? [], profile.access, code)

  const id = makePersonaId(opId, code, profile.idPrefix, domains)

  const persona: Persona = {
    id,
    status: 'proposed',
    identity: { actor, data, intent, trigger },
    notes: `(auto-stub) ${profile.noteHint} → ${code}. ${opId}의 ${code} orphan 해소. 검토 후 status: implemented로 승격.`,
  }
  if (Object.keys(reference).length > 0) persona.reference = reference
  persona.outcome = {
    shape,
    access,
    maps_to: [opId],
    expects: [Number(code)],
  }
  return persona
}

function defaultProfile(code: string): CodeProfile {
  return { actor: null, trigger: `status-${code}`, intent: null, access: [], shape: null, idPrefix: `status-${code}`, noteHint: `상태 코드 ${code}` }
}

function mergeAccess(primary: string[], profileAccess: string[], code: string): string[] {
  // For 401: drop scoped:* and private-self (it's an unauthenticated path)
  if (code === '401') return [...new Set(['public', ...profileAccess])]
  // Otherwise keep primary access + add profile-specific tags
  return [...new Set([...primary, ...profileAccess])]
}

function inferIntentFromMethod(method: string): string {
  const m = method.toLowerCase()
  if (m === 'get') return 'read-detail'
  if (m === 'post') return 'create'
  if (m === 'put' || m === 'patch') return 'update'
  if (m === 'delete') return 'soft-delete'
  return 'read-detail'
}

function inferDataFromOp(opId: string, spec: MinimalOpenApiDoc): string {
  // Best-effort guess from operationId or path. Fallback: 'Resource'.
  const op = findOperation(spec, opId)
  if (op) {
    const seg = op.path.split('/').filter(Boolean)[0]
    if (seg) return capitalize(stripPlaceholder(seg))
  }
  return 'Resource'
}

function stripPlaceholder(s: string): string {
  return s.replace(/\{[^}]+\}/g, '').trim() || s
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

function makePersonaId(opId: string, code: string, prefix: string, domains: DomainMatrix[]): string {
  const taken = new Set<string>()
  for (const m of domains) for (const p of m.personas) taken.add(p.id)

  const base = `${prefix}-${opId}`
  if (!taken.has(base)) return base
  // Disambiguate with status code
  return `${prefix}-${opId}-${code}`
}

function findDomainOf(personaId: string | undefined, domains: DomainMatrix[]): string | null {
  if (!personaId) return null
  for (const m of domains) {
    if (m.personas.some(p => p.id === personaId)) return m.domain
  }
  return null
}

function inferDomainFromPath(path: string, domains: DomainMatrix[]): string {
  // v0.13: only HTTP domains can own HTTP operation stubs.
  // cli-tool/library-api/event-stream domains are excluded as proposal targets.
  const httpDomains = domains.filter(isHttpDomain)
  const known = new Set(httpDomains.map(d => d.domain))
  const seg = path.split('/').filter(Boolean)[0]
  if (seg && known.has(seg)) return seg
  // Special-cases for path prefixes that don't map 1:1 to a domain folder
  if (path.startsWith('/moderation') && known.has('users')) return 'users'
  if (path === '/version' && known.has('health')) return 'health'
  return [...known][0] ?? 'unknown'
}

// ─── rendering ─────────────────────────────────────────────────────────────

/** Render proposals as a single YAML document for review/copy-paste. */
export function renderStubsAsYaml(stubs: ProposedStub[]): string {
  if (stubs.length === 0) return '# No signals detected — nothing to propose.\n'
  const lines: string[] = []
  lines.push('# AUTO-GENERATED proposal — review then copy into appropriate domain .personas.yaml')
  lines.push('# Each stub is `status: proposed`. Promote to `implemented` after filling details.')
  lines.push(`# Signal types: orphan (response code) | new-op (no persona) | new-schema (no data-model)`)
  lines.push('')

  // Summary
  const bySignal = new Map<StubSignal, number>()
  for (const s of stubs) bySignal.set(s.signal, (bySignal.get(s.signal) ?? 0) + 1)
  for (const [sig, count] of [...bySignal.entries()].sort()) {
    lines.push(`#   ${sig}: ${count}`)
  }
  lines.push('')

  let lastDomain = ''
  let lastOp = ''
  let lastSignal: StubSignal | '' = ''
  for (const stub of stubs) {
    if (stub.domain !== lastDomain) {
      lines.push('')
      lines.push(`# ════════ domain: ${stub.domain} ════════`)
      lastDomain = stub.domain
      lastOp = ''
      lastSignal = ''
    }
    if (stub.signal !== lastSignal) {
      lines.push('')
      lines.push(`# ── signal: ${stub.signal} ──`)
      lastSignal = stub.signal
      lastOp = ''
    }
    if (stub.operationId !== lastOp) {
      lines.push('')
      lines.push(`# ${stub.signal === 'new-schema' ? 'schema' : 'op'}: ${stub.operationId}`)
      lastOp = stub.operationId
    }
    if (stub.collision) {
      lines.push(`# ⚠️  id '${stub.persona.id}' collides with existing persona — review and rename`)
    }
    lines.push(serializePersona(stub.persona))
  }
  return lines.join('\n') + '\n'
}

function serializePersona(p: Persona): string {
  const out: string[] = []
  out.push(`  - id: ${p.id}`)
  out.push(`    status: ${p.status}`)
  out.push('    identity:')
  out.push(`      actor: ${p.identity.actor}`)
  out.push(`      data: ${yamlScalar(p.identity.data)}`)
  out.push(`      intent: ${p.identity.intent}`)
  out.push(`      trigger: ${p.identity.trigger}`)
  if (p.identity.proficiency) out.push(`      proficiency: ${p.identity.proficiency}`)
  if (p.reference) {
    out.push('    reference:')
    if (p.reference.regulation && p.reference.regulation.length > 0) {
      out.push(`      regulation: [${p.reference.regulation.join(', ')}]`)
    }
    if (p.reference.channel && p.reference.channel.length > 0) {
      out.push(`      channel: [${p.reference.channel.join(', ')}]`)
    }
  }
  if (p.outcome) {
    out.push('    outcome:')
    if (p.outcome.shape) out.push(`      shape: ${p.outcome.shape}`)
    if (p.outcome.access && p.outcome.access.length > 0) {
      out.push(`      access: [${p.outcome.access.map(yamlScalar).join(', ')}]`)
    }
    if (p.outcome.maps_to && p.outcome.maps_to.length > 0) {
      out.push(`      maps_to: [${p.outcome.maps_to.join(', ')}]`)
    }
    if (p.outcome.expects && p.outcome.expects.length > 0) {
      out.push(`      expects: [${p.outcome.expects.join(', ')}]`)
    }
  }
  if (p.notes) out.push(`    notes: ${yamlScalar(p.notes)}`)
  return out.join('\n')
}

function yamlScalar(v: string): string {
  // Quote when needed: contains special chars or starts with reserved
  if (/[:\[\]{}#&*!|>'"%@`,]|^\s|\s$/.test(v)) return `"${v.replace(/"/g, '\\"')}"`
  return v
}
