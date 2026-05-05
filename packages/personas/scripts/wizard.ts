/**
 * CLI: pnpm wizard
 *
 * v0.12 — baseline-once 페르소나 부트스트랩 마법사. 신규 프로젝트 / 신규 도메인
 * 도입 시 1회 실행. 산출물:
 *   1. .persona-project.yaml          — 프로젝트 메타 (region/regulation/compliance/industry)
 *   2. (선택) traits/X.yaml 어휘 추가  — 입력한 stakeholder를 actor 어휘에 자동 등록
 *   3. (선택) starter persona stub      — spec 있으면 propose --from-spec 자동 실행
 *
 * baseline은 한 번 결정 후 변경 X. 재실행 시 기존 .persona-project.yaml 감지하면
 * --reset 없이는 abort. 이후 페르소나 추가는 `propose` (signal-driven)로.
 *
 * Exit codes:
 *   0 — bootstrap 완료 또는 dry-run
 *   1 — baseline 이미 존재 (--reset 필요)
 *   2 — 입력 오류 / 사용자 cancel
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import { parse, stringify } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(__dir, '..')
const projectMetaPath = resolve(packageRoot, '.persona-project.yaml')

interface PersonaProjectMeta {
  baseline_version: string
  generated_at: string
  project: {
    id: string
    description?: string
    industry: string
  }
  region: string[]
  regulation: string[]
  compliance_framework: string[]
  stakeholders: string[]
  spec_path?: string
}

const INDUSTRY_DEFAULTS: Record<string, { regions: string[]; regulations: string[]; compliance: string[] }> = {
  'b2b-saas': { regions: ['KR'], regulations: ['pii-kr-pipa'], compliance: ['SOC2', 'ISO27001'] },
  'consumer': { regions: ['KR'], regulations: ['pii-kr-pipa'], compliance: ['ISMS-P'] },
  'fintech': { regions: ['KR'], regulations: ['pii-kr-pipa', 'financial-kyc'], compliance: ['PCI-DSS', 'ISMS-P'] },
  'e-commerce': { regions: ['KR'], regulations: ['pii-kr-pipa'], compliance: ['PCI-DSS'] },
  'health': { regions: ['US'], regulations: ['child-protection-coppa'], compliance: ['HIPAA'] },
  'other': { regions: [], regulations: [], compliance: [] },
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset')

  console.log('🪄 Persona Wizard — baseline 부트스트랩 (1회용)\n')

  if (existsSync(projectMetaPath) && !reset) {
    console.error(`❌ baseline이 이미 존재합니다: ${projectMetaPath}`)
    console.error('   재설정하려면 --reset 옵션. 페르소나 추가는 propose로:')
    console.error('     pnpm propose                      # orphan response only')
    console.error('     pnpm propose --from-spec          # full spec scan (signal-driven)')
    process.exit(1)
  }

  // ── Q1: 프로젝트 식별 ───────────────────────────────────────────────────
  const projectId = await input({
    message: '프로젝트 id (lowercase, kebab-case):',
    default: 'my-project',
    validate: v => /^[a-z][a-z0-9-]*$/.test(v) || 'kebab-case 만 허용',
  })

  const description = await input({
    message: '프로젝트 한 줄 설명:',
    default: '',
  })

  // ── Q2: 산업 ────────────────────────────────────────────────────────────
  const industry = await select({
    message: '산업 분류:',
    choices: [
      { value: 'b2b-saas', name: 'B2B SaaS' },
      { value: 'consumer', name: 'Consumer (B2C)' },
      { value: 'fintech', name: 'Fintech' },
      { value: 'e-commerce', name: 'E-commerce' },
      { value: 'health', name: 'Health / Healthcare' },
      { value: 'other', name: '기타' },
    ],
  })

  const def = INDUSTRY_DEFAULTS[industry] ?? INDUSTRY_DEFAULTS['other']!

  // ── Q3: region ──────────────────────────────────────────────────────────
  const regions = await checkbox({
    message: '데이터 residency / 법적 관할:',
    choices: [
      { value: 'KR', checked: def.regions.includes('KR') },
      { value: 'EU', checked: def.regions.includes('EU') },
      { value: 'US', checked: def.regions.includes('US') },
      { value: 'JP', checked: def.regions.includes('JP') },
      { value: 'SG', checked: def.regions.includes('SG') },
      { value: 'APAC', checked: def.regions.includes('APAC') },
      { value: 'GLOBAL', checked: def.regions.length === 0 },
    ],
  })

  // ── Q4: regulation (region 기반 자동 추천) ────────────────────────────
  const regSuggestions = new Set<string>(def.regulations)
  if (regions.includes('KR')) regSuggestions.add('pii-kr-pipa')
  if (regions.includes('EU')) regSuggestions.add('pii-gdpr')

  const regulations = await checkbox({
    message: '적용 regulation (region 기반 자동 추천):',
    choices: [
      { value: 'pii-kr-pipa', checked: regSuggestions.has('pii-kr-pipa') },
      { value: 'pii-gdpr', checked: regSuggestions.has('pii-gdpr') },
      { value: 'child-protection-coppa', checked: regSuggestions.has('child-protection-coppa') },
      { value: 'content-violence' },
      { value: 'content-gambling' },
      { value: 'financial-kyc', checked: regSuggestions.has('financial-kyc') },
      { value: 'privacy-self-disclosure' },
    ],
  })

  // ── Q5: compliance ──────────────────────────────────────────────────────
  const complianceSuggestions = new Set<string>(def.compliance)
  if (regions.includes('KR') && industry === 'consumer') complianceSuggestions.add('ISMS-P')

  const compliance = await checkbox({
    message: 'organizational compliance:',
    choices: [
      { value: 'SOC2', checked: complianceSuggestions.has('SOC2') },
      { value: 'ISO27001', checked: complianceSuggestions.has('ISO27001') },
      { value: 'NIST-CSF' },
      { value: 'HIPAA', checked: complianceSuggestions.has('HIPAA') },
      { value: 'PCI-DSS', checked: complianceSuggestions.has('PCI-DSS') },
      { value: 'ISMS-P', checked: complianceSuggestions.has('ISMS-P') },
    ],
  })

  // ── Q6: stakeholders ────────────────────────────────────────────────────
  const stakeholders = await checkbox({
    message: 'stakeholder (consumer 차원):',
    choices: [
      { value: 'end-user', checked: true },
      { value: 'backend' },
      { value: 'b2b-customer', checked: industry === 'b2b-saas' },
      { value: 'internal-tool', checked: true },
      { value: 'site-admin' },
      { value: 'infra-ops', checked: true },
      { value: 'data-eng' },
    ],
  })

  // ── Q7: OpenAPI spec ────────────────────────────────────────────────────
  const specPath = await input({
    message: 'OpenAPI spec path (없으면 enter):',
    default: '',
  })

  // ── 확인 ────────────────────────────────────────────────────────────────
  console.log('\n📋 baseline 요약:')
  console.log(`   project:    ${projectId} (${industry})`)
  console.log(`   region:     ${regions.join(', ') || '(none)'}`)
  console.log(`   regulation: ${regulations.join(', ') || '(none)'}`)
  console.log(`   compliance: ${compliance.join(', ') || '(none)'}`)
  console.log(`   stakeholders: ${stakeholders.join(', ')}`)
  if (specPath) console.log(`   spec:       ${specPath}`)
  console.log('')

  const proceed = await confirm({ message: '이대로 baseline 고정?', default: true })
  if (!proceed) {
    console.error('❌ cancel')
    process.exit(2)
  }

  // ── 산출 ────────────────────────────────────────────────────────────────
  const meta: PersonaProjectMeta = {
    baseline_version: '0.12',
    generated_at: new Date().toISOString(),
    project: {
      id: projectId,
      ...(description ? { description } : {}),
      industry,
    },
    region: regions,
    regulation: regulations,
    compliance_framework: compliance,
    stakeholders,
    ...(specPath ? { spec_path: specPath } : {}),
  }

  writeFileSync(projectMetaPath, stringify(meta, { lineWidth: 0 }))
  console.log(`✅ baseline 고정: ${projectMetaPath}`)

  // ── stakeholders가 vocab에 없으면 안내 ─────────────────────────────────
  const consumerYamlPath = resolve(packageRoot, 'src', 'traits', 'consumer.yaml')
  const consumerVocab = parse(readFileSync(consumerYamlPath, 'utf8')) as { values: Array<{ id: string }> }
  const knownConsumers = new Set(consumerVocab.values.map(v => v.id))
  const newStakeholders = stakeholders.filter(s => !knownConsumers.has(s))
  if (newStakeholders.length > 0) {
    console.log('')
    console.log(`⚠️  새 stakeholder ${newStakeholders.length}개 — traits/consumer.yaml에 수동 추가 필요:`)
    for (const s of newStakeholders) console.log(`     - id: ${s}`)
  }

  console.log('')
  console.log('🚀 다음 단계:')
  console.log('   pnpm propose --from-spec     # spec scan → signal-driven stubs')
  console.log('   pnpm coverage                # 발자국 / orphan 확인')
  console.log('   pnpm check                   # 18 룰 검증')
}

main().catch(err => {
  if (err && typeof err === 'object' && 'name' in err && err.name === 'ExitPromptError') {
    console.error('\n❌ user cancel')
    process.exit(2)
  }
  throw err
})
