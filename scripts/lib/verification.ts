import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export interface TestFileEvidence {
  file: string
  package: string
  track: string
  cases: number
  failed?: number
  skipped?: number
  resultSource: 'executed' | 'cache'
  tests?: Array<{ title: string; status: 'passed' | 'failed' | 'skipped' }>
}
export interface TestRunEvidence {
  schemaVersion: 1
  kind: 'test-run'
  runId: string
  recordedAt: string
  sourceBinding: 'unrecorded' | 'captured-after-execution'
  sourceHashes: Record<string, string>
  passed: number
  failed: number
  skipped: number
  executedPassed: number
  cachedPassed: number
  passedFiles: number
  files: TestFileEvidence[]
}
export interface ClaimEvidence {
  kind: 'regression' | 'reproduction'
  runId?: string
  file: string
  test?: string
  assertion: string
  artifact?: string
  observation?: string
}
export interface VerificationClaim {
  id: string
  featureId: string
  statement: string
  status: 'verified' | 'partial' | 'failing' | 'unverified'
  level: 'unit' | 'integration' | 'local-e2e' | 'external-e2e'
  scope: string
  excludes: string[]
  sourceFiles: string[]
  evidence: ClaimEvidence[]
}
export interface VerificationRegistry {
  schemaVersion: 1
  updatedAt: string
  runs: Array<{ id: string; artifact: string }>
  claims: VerificationClaim[]
  defects: Array<{
    id: string
    claimId: string
    priority: 'P1' | 'P2' | 'P3'
    state: 'open' | 'fixed'
    title: string
    report: string
    closeCriteria: string
  }>
}
export interface FeatureOwnership { id: string; name: string; testPaths: string[] }
export interface VerificationContext {
  root: string
  registry: VerificationRegistry
  features: FeatureOwnership[]
  runs: Map<string, TestRunEvidence>
}
export const registryPath = 'docs/internal/verification/registry.json'
export const statusPath = 'docs/internal/verification/status.md'
export const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

export function repositoryFile(root: string, file: string): string {
  const absolute = resolve(root, file)
  const rel = relative(root, absolute)
  if (!file || isAbsolute(file) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Expected a repository-relative file: ${file}`)
  }
  return absolute
}
export function loadVerification(root: string): VerificationContext {
  const read = (file: string) => JSON.parse(readFileSync(repositoryFile(root, file), 'utf8'))
  const registry: VerificationRegistry = read(registryPath)
  const features: FeatureOwnership[] = read('docs/internal/feature-test-matrix.json').features
  const runs = new Map<string, TestRunEvidence>()
  for (const run of registry.runs) runs.set(run.id, read(run.artifact))
  return { root, registry, features, runs }
}
function matches(pattern: string, file: string): boolean {
  const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replaceAll('\0', '.*')
  return new RegExp(`^${regex}$`).test(file)
}

/** Checks evidence consistency and provenance, not the truth of a test's assertions. */
export function validateVerification(context: VerificationContext): string[] {
  const { root, registry, runs, features } = context
  const errors: string[] = []
  const fail = (message: string) => errors.push(message)
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  const fileExists = (file: string) => existsSync(repositoryFile(root, file))
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) fail(`${label}: duplicate identity`)
  }
  try {
    if (registry.schemaVersion !== 1) fail('registry: unsupported schemaVersion')
    unique(registry.runs.map(r => r.id), 'runs')
    unique(registry.claims.map(c => c.id), 'claims')
    unique(registry.defects.map(d => d.id), 'defects')
    for (const ref of registry.runs) {
      const run = runs.get(ref.id)
      if (!run || run.schemaVersion !== 1 || run.kind !== 'test-run' || run.runId !== ref.id) {
        fail(`${ref.id}: invalid test-run artifact`); continue
      }
      if (!run.recordedAt || !['unrecorded', 'captured-after-execution'].includes(run.sourceBinding)) fail(`${ref.id}: missing provenance`)
      unique(run.files.map(f => f.file), `${ref.id} files`)
      for (const f of run.files) {
        // Historical file names remain valid evidence after a test is moved.
        // Current claim references are checked for existence below.
        repositoryFile(root, f.file)
        if (!f.file.startsWith(`packages/${f.package.replace('@oa-sdk/', '')}/`)) fail(`${ref.id}: package/file mismatch ${f.file}`)
        if (!['executed', 'cache'].includes(f.resultSource)) fail(`${ref.id}: invalid resultSource ${f.file}`)
        if (!['core', 'downstream', 'maintenance', 'internal'].includes(f.track)) fail(`${ref.id}: invalid track ${f.file}`)
        if (![f.cases, f.failed ?? 0, f.skipped ?? 0].every(count)) fail(`${ref.id}: invalid case count ${f.file}`)
        if (f.tests) {
          if (f.tests.some(t => !t.title || !['passed', 'failed', 'skipped'].includes(t.status))) fail(`${ref.id}: invalid test result ${f.file}`)
          if (f.tests.filter(t => t.status === 'passed').length !== f.cases ||
              f.tests.filter(t => t.status === 'failed').length !== (f.failed ?? 0) ||
              f.tests.filter(t => t.status === 'skipped').length !== (f.skipped ?? 0)) fail(`${ref.id}: test titles/count mismatch ${f.file}`)
        }
      }
      const sum = (field: 'cases' | 'failed' | 'skipped', mode?: string) => run.files
        .filter(f => !mode || f.resultSource === mode).reduce((n, f) => n + (f[field] ?? 0), 0)
      const totals = { passed: sum('cases'), failed: sum('failed'), skipped: sum('skipped'),
        executedPassed: sum('cases', 'executed'), cachedPassed: sum('cases', 'cache'),
        passedFiles: run.files.filter(f => f.cases > 0).length }
      for (const [key, value] of Object.entries(totals)) {
        if (!count(run[key as keyof typeof totals]) || run[key as keyof typeof totals] !== value) fail(`${ref.id}: ${key} total mismatch`)
      }
      for (const [file, hash] of Object.entries(run.sourceHashes)) {
        repositoryFile(root, file)
        if (!/^[a-f0-9]{64}$/.test(hash)) fail(`${ref.id}: invalid source hash ${file}`)
      }
      // Legacy imports retain package summaries; those must agree with files too.
      const packages = (run as TestRunEvidence & { packages?: Record<string, { passed: number }> }).packages
      if (packages) {
        const names = new Set(run.files.map(f => f.package))
        for (const name of new Set([...Object.keys(packages), ...names])) {
          if (packages[name]?.passed !== run.files.filter(f => f.package === name).reduce((n, f) => n + f.cases, 0)) fail(`${ref.id}: package total mismatch ${name}`)
        }
      }
    }
    for (const claim of registry.claims) {
      const owner = features.find(f => f.id === claim.featureId)
      if (!owner) fail(`${claim.id}: unknown feature ${claim.featureId}`)
      if (!['verified', 'partial', 'failing', 'unverified'].includes(claim.status)) fail(`${claim.id}: invalid status`)
      if (!['unit', 'integration', 'local-e2e', 'external-e2e'].includes(claim.level)) fail(`${claim.id}: invalid level`)
      if (!claim.statement || !claim.scope || !Array.isArray(claim.excludes)) fail(`${claim.id}: scope and exclusions are required`)
      if (!claim.sourceFiles.length) fail(`${claim.id}: sourceFiles are required`)
      for (const file of claim.sourceFiles) if (!fileExists(file)) fail(`${claim.id}: missing source ${file}`)
      const directProof = claim.evidence.filter(e => {
        if (!e.assertion || !fileExists(e.file)) { fail(`${claim.id}: invalid evidence file/assertion`); return false }
        if (e.kind === 'reproduction') {
          if (!e.artifact || !fileExists(e.artifact)) { fail(`${claim.id}: missing reproduction artifact`); return false }
          const artifact = JSON.parse(readFileSync(repositoryFile(root, e.artifact), 'utf8'))
          if (artifact.kind !== 'defect-reproduction' || !e.observation || !(e.observation in artifact.observations)) fail(`${claim.id}: invalid reproduction observation`)
          for (const source of new Set([...claim.sourceFiles, e.file])) {
            if (artifact.sourceHashes?.[source] !== sha256(readFileSync(repositoryFile(root, source)))) fail(`${claim.id}: reproduction source changed; reproduce again or update the defect disposition`)
          }
          return false
        }
        if (e.kind !== 'regression') { fail(`${claim.id}: invalid evidence kind`); return false }
        if (owner && !owner.testPaths.some(p => matches(p, e.file))) fail(`${claim.id}: evidence test is not owned by feature`)
        const run = runs.get(e.runId ?? '')
        const file = run?.files.find(f => f.file === e.file)
        if (!run || !file || !e.test || !file.tests?.some(t => t.title === e.test && t.status === 'passed')) {
          fail(`${claim.id}: missing passing test title in run`); return false
        }
        if (file.resultSource !== 'executed' || run.failed > 0 || run.sourceBinding === 'unrecorded') return false
        return claim.sourceFiles.every(source => {
          const hash = run.sourceHashes[source]
          return hash && hash === sha256(readFileSync(repositoryFile(root, source)))
        })
      })
      const open = registry.defects.filter(d => d.claimId === claim.id && d.state === 'open')
      if (claim.status === 'verified' && (!directProof.length || open.length)) fail(`${claim.id}: verified needs current direct proof and no open defect`)
      if (claim.status === 'partial' && (!directProof.length || !claim.excludes.length)) fail(`${claim.id}: partial needs current scoped evidence and exclusions`)
      if (claim.level === 'external-e2e' && ['verified', 'partial'].includes(claim.status)) fail(`${claim.id}: local Vitest evidence cannot establish external-e2e; an external execution evidence contract is required`)
      if (claim.status === 'failing' && (!open.length || !claim.evidence.some(e => e.kind === 'reproduction'))) fail(`${claim.id}: failing needs an open reproduced defect`)
    }
    for (const defect of registry.defects) {
      const claim = registry.claims.find(c => c.id === defect.claimId)
      if (!claim) fail(`${defect.id}: unknown claim`)
      if (!['open', 'fixed'].includes(defect.state) || !['P1', 'P2', 'P3'].includes(defect.priority)) fail(`${defect.id}: invalid state/priority`)
      if (!defect.closeCriteria || !defect.title || !fileExists(defect.report.split('#')[0]!)) fail(`${defect.id}: missing report or closeCriteria`)
      if (defect.state === 'fixed' && claim?.status !== 'verified') fail(`${defect.id}: fixed needs a verified regression claim`)
    }
  } catch (error) { fail(`Invalid verification data: ${error instanceof Error ? error.message : String(error)}`) }
  return errors
}

export function renderVerification(context: VerificationContext): string {
  const { registry, features, runs } = context
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const link = (file: string, label: string) => `[${label}](../../../${file})`
  const assessed = new Set(registry.claims.map(c => c.featureId))
  const lines = [
    '# 검증·리뷰 상태', '',
    '> Generated by `pnpm verification:report`. Edit registry.json and evidence artifacts; do not edit this file.', '',
    `기준: ${registry.updatedAt}. 기능별 테스트 소유 ${features.length}개 중 구체적인 보장 항목을 검토한 기능은 ${assessed.size}개이며, 나머지 ${features.length - assessed.size}개는 이 원장에서 미평가다. 미평가는 기능 미구현 또는 테스트 부재를 뜻하지 않는다.`, '',
    `결함: open ${registry.defects.filter(d => d.state === 'open').length}, fixed ${registry.defects.filter(d => d.state === 'fixed').length}. 검증 수준과 범위는 각 보장 항목에 한정한다.`, '',
    '## 실행 기록', '', '각 행은 별도 실행이다. 서로 더하지 않는다. 테스트 수로 기능 보장률을 계산하지 않는다.', '',
    '| 실행 ID | 직접 통과 | cache 통과 | 실패 | skip | 근거 |', '| --- | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const ref of registry.runs) {
    const run = runs.get(ref.id)!
    lines.push(`| ${ref.id} | ${run.executedPassed} | ${run.cachedPassed} | ${run.failed} | ${run.skipped} | ${link(ref.artifact, run.sourceBinding)} |`)
  }
  lines.push('', '## 보장 항목과 한계', '',
    '| 보장 ID · 기능 ID | 상태 · 수준 | 확인하는 내용 · 조건 | 제외 범위 | 근거 |', '| --- | --- | --- | --- | --- |')
  for (const c of registry.claims) {
    const evidence = c.evidence.map(e => e.kind === 'regression'
      ? `${link(e.file, 'test')} · ${e.runId}<br>${cell(e.assertion)}`
      : `${link(e.artifact!, 'reproduction')}<br>${cell(e.assertion)}`).join('<br>') || '근거 없음'
    lines.push(`| ${c.id}<br>${c.featureId} | ${c.status} · ${c.level} | ${cell(c.statement)}<br>${cell(c.scope)} | ${c.excludes.map(cell).join('; ')} | ${evidence} |`)
  }
  lines.push('', '## 결함 상태', '', '| ID | 우선순위 · 상태 | 문제 | 종료 조건 |', '| --- | --- | --- | --- |')
  for (const d of registry.defects) lines.push(`| ${link(d.report, d.id)} | ${d.priority} · ${d.state} | ${cell(d.title)} | ${cell(d.closeCriteria)} |`)
  lines.push('', '## 아직 보장 항목을 평가하지 않은 기능', '', '이 목록은 feature-test-matrix에서 자동 계산한다. broad glob이나 package test 통과만으로 verified로 올리지 않는다.', '')
  for (const f of features.filter(f => !assessed.has(f.id))) lines.push(`- \`${f.id}\` — ${cell(f.name)}`)
  return lines.join('\n') + '\n'
}
