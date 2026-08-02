import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { OpenApiCollectProfile } from './openapi-collect.js'

export type OpenApiGovernanceScaffoldOptions = {
  rootDir: string
  service: string
  profile: OpenApiCollectProfile
  sourceCommand?: string
  runtimeOpenApiUrl?: string
  /** Command on PATH, or a fully specified trusted command, that invokes oa-gen. */
  oaGenCommand?: string
  /** Optional trusted CI setup command that makes oaGenCommand available. */
  oaGenSetupCommand?: string
  /** Whether CI only verifies generation or also requires the generated file to be committed. */
  typegenPolicy?: OpenApiGovernanceTypegenPolicy
  force?: boolean
}

export type OpenApiGovernanceTypegenPolicy = 'verify-only' | 'commit-required'

export type OpenApiGovernanceScaffoldResult = {
  rootDir: string
  files: string[]
}

export type OpenApiGovernanceInterface = {
  schemaVersion: 'oa-gen.openapi-governance.v2'
  service: string
  profile: OpenApiCollectProfile
  source: {
    kind: 'external-openapi'
    command: string | null
    runtimeOpenApiUrl: string | null
  }
  artifacts: {
    raw: string
    normalized: string
    upgraded: string
    baseline: string
    collectReport: string
    typegen: string
  }
  consumers: {
    governance: string
    review: string
    typegen: string
    inventory: string
    validate: string
    driftManaged: string
  }
  tooling: {
    /** Default invocation; CI and local callers can still override it with OA_GEN. */
    oaGenCommand: string
    installation: 'path-command'
    /** Optional trusted service-specific install/build command used by generated CI. */
    setupCommand: string | null
  }
  automation: {
    /** Directory uploaded by the generated CI workflow. */
    artifactDirectory: string
    reviewBundle: string
    typegen: {
      /** Run generation only, or require a committed generated artifact. */
      policy: 'verify-only' | 'commit-required'
    }
    baseline: {
      source: 'artifacts.normalized'
      promotion: 'reviewed-commit'
    }
  }
}

const CONFIG_PATH = 'openapi-governance.config.json'
const SCRIPT_PATH = 'scripts/openapi-governance.sh'
const DOC_PATH = 'openapi-governance.md'
const CI_WORKFLOW_PATH = '.github/workflows/openapi-governance.yml'

export function createOpenApiGovernanceInterface(options: {
  service: string
  profile: OpenApiCollectProfile
  sourceCommand?: string
  runtimeOpenApiUrl?: string
  oaGenCommand?: string
  oaGenSetupCommand?: string
  typegenPolicy?: OpenApiGovernanceTypegenPolicy
}): OpenApiGovernanceInterface {
  const oaGenCommand = options.oaGenCommand ?? 'oa-gen'
  assertValidSingleLineCommand(oaGenCommand, '--oa-gen-command')
  if (options.oaGenSetupCommand !== undefined) assertValidSingleLineCommand(options.oaGenSetupCommand, '--oa-gen-setup-command')
  if (options.typegenPolicy !== undefined) assertValidTypegenPolicy(options.typegenPolicy)
  return {
    schemaVersion: 'oa-gen.openapi-governance.v2',
    service: options.service,
    profile: options.profile,
    source: {
      kind: 'external-openapi',
      command: options.sourceCommand ?? null,
      runtimeOpenApiUrl: options.runtimeOpenApiUrl ?? null,
    },
    artifacts: {
      raw: 'contracts/openapi.raw.yaml',
      normalized: 'contracts/openapi.normalized.yaml',
      upgraded: 'contracts/openapi.upgraded.yaml',
      baseline: 'contracts/v1.openapi.yaml',
      collectReport: 'contracts/openapi.collect-report.json',
      typegen: 'src/generated/api-types.ts',
    },
    consumers: {
      governance: 'artifacts.normalized',
      review: 'artifacts.normalized',
      typegen: 'artifacts.normalized',
      inventory: 'artifacts.upgraded',
      validate: 'artifacts.upgraded',
      driftManaged: 'artifacts.normalized',
    },
    tooling: {
      oaGenCommand,
      installation: 'path-command',
      setupCommand: options.oaGenSetupCommand ?? null,
    },
    automation: {
      artifactDirectory: '.oa-sdk/governance',
      reviewBundle: '.oa-sdk/governance/review-bundle.md',
      typegen: {
        policy: options.typegenPolicy ?? 'verify-only',
      },
      baseline: {
        source: 'artifacts.normalized',
        promotion: 'reviewed-commit',
      },
    },
  }
}

export function scaffoldOpenApiGovernance(
  options: OpenApiGovernanceScaffoldOptions,
): OpenApiGovernanceScaffoldResult {
  const rootDir = resolve(process.cwd(), options.rootDir)
  mkdirSync(rootDir, { recursive: true })

  if (options.runtimeOpenApiUrl !== undefined) {
    assertValidRuntimeUrl(options.runtimeOpenApiUrl)
  }

  const governance = createOpenApiGovernanceInterface({
    service: options.service,
    profile: options.profile,
    ...(options.sourceCommand ? { sourceCommand: options.sourceCommand } : {}),
    ...(options.runtimeOpenApiUrl ? { runtimeOpenApiUrl: options.runtimeOpenApiUrl } : {}),
    ...(options.oaGenCommand ? { oaGenCommand: options.oaGenCommand } : {}),
    ...(options.oaGenSetupCommand ? { oaGenSetupCommand: options.oaGenSetupCommand } : {}),
    ...(options.typegenPolicy ? { typegenPolicy: options.typegenPolicy } : {}),
  })

  const files: string[] = []
  writeScaffoldFile(rootDir, CONFIG_PATH, `${JSON.stringify(governance, null, 2)}\n`, options.force, files)
  writeScaffoldFile(rootDir, SCRIPT_PATH, renderGovernanceScript(governance), options.force, files)
  chmodSync(join(rootDir, SCRIPT_PATH), 0o755)
  writeScaffoldFile(rootDir, DOC_PATH, renderGovernanceDoc(governance), options.force, files)
  writeScaffoldFile(rootDir, CI_WORKFLOW_PATH, renderGovernanceCiWorkflow(governance), options.force, files)

  mkdirSync(join(rootDir, 'contracts'), { recursive: true })
  mkdirSync(join(rootDir, 'scripts'), { recursive: true })
  mkdirSync(join(rootDir, 'src/generated'), { recursive: true })

  return { rootDir, files }
}

type ConsumerKey = keyof OpenApiGovernanceInterface['consumers']

const CONSUMER_VAR: Record<keyof OpenApiGovernanceInterface['artifacts'], string> = {
  raw: 'RAW',
  normalized: 'NORMALIZED',
  upgraded: 'UPGRADED',
  baseline: 'BASELINE',
  collectReport: 'COLLECT_REPORT',
  typegen: 'TYPEGEN',
}

function resolveConsumerVar(config: OpenApiGovernanceInterface, consumer: ConsumerKey): string {
  const value = config.consumers[consumer]
  const match = value.match(/^artifacts\.(.+)$/)
  if (!match) {
    throw new Error(`unsupported consumer mapping for ${consumer}: ${value}. expected 'artifacts.<key>'.`)
  }
  const artifactKey = match[1] as keyof OpenApiGovernanceInterface['artifacts']
  if (!(artifactKey in CONSUMER_VAR)) {
    throw new Error(`unknown artifact key for ${consumer}: ${artifactKey}.`)
  }
  return CONSUMER_VAR[artifactKey]
}

function assertValidRuntimeUrl(value: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`invalid --runtime-openapi-url: ${value}. expected http(s) URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`invalid --runtime-openapi-url protocol: ${parsed.protocol}. expected http: or https:.`)
  }
}

function assertValidSingleLineCommand(value: string, option: string): void {
  if (value.trim().length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`invalid ${option}: expected a non-empty single-line command.`)
  }
}

function assertValidTypegenPolicy(value: string): asserts value is OpenApiGovernanceTypegenPolicy {
  if (value !== 'verify-only' && value !== 'commit-required') {
    throw new Error(`invalid --typegen-policy: ${value}. expected verify-only or commit-required.`)
  }
}

function writeScaffoldFile(
  rootDir: string,
  filePath: string,
  content: string,
  force: boolean | undefined,
  files: string[],
): void {
  const absolutePath = join(rootDir, filePath)
  if (existsSync(absolutePath) && !force) {
    throw new Error(`refusing to overwrite existing scaffold file: ${absolutePath}. Pass --force to overwrite.`)
  }
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
  files.push(absolutePath)
}

export function fingerprintGovernanceConfig(config: OpenApiGovernanceInterface): string {
  const fingerprint = {
    schemaVersion: config.schemaVersion,
    profile: config.profile,
    source: config.source,
    artifacts: config.artifacts,
    consumers: config.consumers,
    tooling: config.tooling,
    automation: config.automation,
  }
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 16)
}

const CONFIG_FINGERPRINT_MARKER = '# config fingerprint:'

function renderGovernanceScript(config: OpenApiGovernanceInterface): string {
  const sourceCommand = config.source.command
  const runtimeUrl = config.source.runtimeOpenApiUrl
  const governanceArtifact = resolveConsumerVar(config, 'governance')
  const reviewArtifact = resolveConsumerVar(config, 'review')
  const typegenArtifact = resolveConsumerVar(config, 'typegen')
  const inventoryArtifact = resolveConsumerVar(config, 'inventory')
  const validateArtifact = resolveConsumerVar(config, 'validate')
  const driftArtifact = resolveConsumerVar(config, 'driftManaged')
  const fingerprint = fingerprintGovernanceConfig(config)
  return `#!/usr/bin/env bash
# Generated by 'oa-gen scaffold-governance'.
${CONFIG_FINGERPRINT_MARKER} ${fingerprint}
# When openapi-governance.config.json is hand-edited, this fingerprint
# diverges from the file. Re-run scaffold-governance --force to refresh
# the script (artifact paths, consumers map, profile, runtime URL).
# The default oa-gen command is stored in openapi-governance.config.json.
# Override it per invocation by setting OA_GEN, e.g.:
#   OA_GEN="pnpm exec oa-gen" bash scripts/openapi-governance.sh all
#   OA_GEN="node /custom/path/cli.js" bash scripts/openapi-governance.sh all
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# Split on whitespace without pathname expansion. Commands with shell quoting
# should be wrapped by a project script instead of placed in OA_GEN.
read -ra OA_GEN_CMD <<< "\${OA_GEN:-${config.tooling.oaGenCommand}}"

# Always resolve a relative OA_GEN command from the service root, not the
# caller's current directory. This keeps a root-level script invocation
# and an in-service invocation equivalent.
oa_gen() {
  (cd "$APP_DIR" && "\${OA_GEN_CMD[@]}" "$@")
}

RAW="$APP_DIR/${config.artifacts.raw}"
NORMALIZED="$APP_DIR/${config.artifacts.normalized}"
UPGRADED="$APP_DIR/${config.artifacts.upgraded}"
BASELINE="$APP_DIR/${config.artifacts.baseline}"
COLLECT_REPORT="$APP_DIR/${config.artifacts.collectReport}"
TYPEGEN="$APP_DIR/${config.artifacts.typegen}"
AUTOMATION_ARTIFACT_DIR="$APP_DIR/${config.automation.artifactDirectory}"
CI_REVIEW_BUNDLE="$APP_DIR/${config.automation.reviewBundle}"
RUNTIME_OPENAPI_URL="${runtimeUrl ?? ''}"

# source_openapi runs the --source-command captured at scaffold time as
# verbatim shell. Treat its body as trusted input from whoever ran scaffold;
# review changes here the same way you would review any committed shell
# script before running 'all'.
source_openapi() {
${sourceCommand ? `  (cd "$APP_DIR" && ${sourceCommand})` : '  test -f "$RAW" || { echo "missing raw OpenAPI artifact: $RAW"; exit 1; }'}
}

collect_openapi() {
  source_openapi
  oa_gen collect \\
    --spec "$RAW" \\
    --normalized "$NORMALIZED" \\
    --upgraded "$UPGRADED" \\
    --report "$COLLECT_REPORT" \\
    --profile ${config.profile}
}

require_baseline() {
  test -f "$BASELINE" || {
    echo "missing baseline: $BASELINE" >&2
    echo "hint: run '$0 update-baseline' after inspecting '$NORMALIZED'." >&2
    exit 1
  }
}

generate_types() {
  mkdir -p "$(dirname "$TYPEGEN")"
  oa_gen typegen --spec "\${${typegenArtifact}}" --output "$TYPEGEN"
${config.automation.typegen.policy === 'commit-required' ? `  git -C "$APP_DIR" ls-files --error-unmatch "${config.artifacts.typegen}" >/dev/null || {
    echo "typegen policy requires a tracked artifact: ${config.artifacts.typegen}" >&2
    exit 1
  }
  git -C "$APP_DIR" diff --exit-code -- "${config.artifacts.typegen}" || {
    echo "generated type artifact is stale: ${config.artifacts.typegen}" >&2
    exit 1
  }` : '  # verify-only: generation must succeed; generated output is not required to be committed.'}
}

case "\${1:-all}" in
  collect)
    collect_openapi
    ;;
  check)
    collect_openapi
    require_baseline
    oa_gen check-artifact --head "\${${governanceArtifact}}" --artifact "$BASELINE" --format human
    ;;
  review)
    collect_openapi
    require_baseline
    oa_gen review --base "$BASELINE" --head "\${${reviewArtifact}}" --artifact "$BASELINE" --format markdown
    ;;
  typegen)
    collect_openapi
    generate_types
    ;;
  inventory)
    collect_openapi
    oa_gen inventory --spec "\${${inventoryArtifact}}" --format markdown
    ;;
  validate-upgraded)
    collect_openapi
    oa_gen validate --spec "\${${validateArtifact}}"
    ;;
  drift)
    collect_openapi
    test -n "$RUNTIME_OPENAPI_URL" || { echo "runtimeOpenApiUrl is not configured" >&2; exit 1; }
    # Forward extra args after 'drift' so callers can pass --runtime-header,
    # e.g. bash $0 drift --runtime-header "Authorization: Bearer $TOKEN"
    shift || true
    oa_gen drift --runtime-openapi-url "$RUNTIME_OPENAPI_URL" --managed-openapi "\${${driftArtifact}}" --format markdown "$@"
    ;;
  review-bundle)
    collect_openapi
    require_baseline
    oa_gen review-bundle \\
      --base "$BASELINE" \\
      --head "\${${reviewArtifact}}" \\
      --artifact "$BASELINE" \\
      --inventory \\
      --format markdown
    ;;
  update-baseline)
    collect_openapi
    mkdir -p "$(dirname "$BASELINE")"
    cp "$NORMALIZED" "$BASELINE"
    echo "baseline updated: $BASELINE"
    echo "promotion policy: reviewed commit required before merging this baseline"
    ;;
  ci)
    collect_openapi
    require_baseline
    mkdir -p "$AUTOMATION_ARTIFACT_DIR" "$(dirname "$CI_REVIEW_BUNDLE")"
    oa_gen review-bundle \\
      --base "$BASELINE" \\
      --head "\${${reviewArtifact}}" \\
      --artifact "$BASELINE" \\
      --inventory \\
      --format markdown | tee "$CI_REVIEW_BUNDLE"
    oa_gen validate --spec "\${${validateArtifact}}"
    generate_types
    echo "CI artifacts: $AUTOMATION_ARTIFACT_DIR"
    ;;
  all)
    # 'review --artifact' already runs the freshness check, so 'all' skips
    # the standalone check-artifact step. Use the 'check' target if you
    # need the freshness gate alone (faster than running review).
    collect_openapi
    require_baseline
    oa_gen review --base "$BASELINE" --head "\${${reviewArtifact}}" --artifact "$BASELINE" --format markdown
    generate_types
    oa_gen validate --spec "\${${validateArtifact}}"
    ;;
  *)
    echo "usage: $0 [collect|check|review|review-bundle|typegen|inventory|validate-upgraded|drift|update-baseline|ci|all]" >&2
    exit 1
    ;;
esac
`
}

function renderGovernanceCiWorkflow(config: OpenApiGovernanceInterface): string {
  const setupStep = config.tooling.setupCommand === null
    ? `      # Add the service's normal dependency installation step here when oa-gen
      # is not already available on PATH. Keeping it explicit avoids coupling
      # this reusable template to npm, pnpm, uv, or another package manager.`
    : `      # setupCommand is captured from trusted scaffold input and is reviewed
      # as repository shell code, just like source.command.
      - name: Prepare oa-gen
        run: |
          ${config.tooling.setupCommand}`
  return `# Generated by 'oa-gen scaffold-governance'.
# Ensure '${config.tooling.oaGenCommand}' is available on PATH before this workflow runs,
# or set OA_GEN below to the repository's package-manager invocation.
name: OpenAPI governance

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  governance:
    name: ${config.service} OpenAPI contract
    runs-on: ubuntu-latest
    env:
      OA_GEN: ${yamlSingleQuoted(config.tooling.oaGenCommand)}
    steps:
      - uses: actions/checkout@v4

${setupStep}
      - name: OpenAPI governance
        run: bash scripts/openapi-governance.sh ci

      - name: Upload governance review evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ${config.service}-openapi-governance
          path: ${config.automation.artifactDirectory}
          if-no-files-found: warn
`
}

function yamlSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function renderGovernanceDoc(config: OpenApiGovernanceInterface): string {
  const runtime = config.source.runtimeOpenApiUrl ?? '(not configured)'
  const source = config.source.command ?? 'write raw OpenAPI to contracts/openapi.raw.yaml before running governance'
  return `# OpenAPI Governance — ${config.service}

Generated by \`oa-gen scaffold-governance\`.

## Interface

| Field | Value |
|---|---|
| Service | \`${config.service}\` |
| Profile | \`${config.profile}\` |
| Source command | \`${source}\` |
| Runtime OpenAPI URL | \`${runtime}\` |
| Raw artifact | \`${config.artifacts.raw}\` |
| Normalized governance artifact | \`${config.artifacts.normalized}\` |
| OpenAPI 3.2 analysis artifact | \`${config.artifacts.upgraded}\` |
| Baseline | \`${config.artifacts.baseline}\` |
| Default CLI command | \`${config.tooling.oaGenCommand}\` |
| CI evidence directory | \`${config.automation.artifactDirectory}\` |

## Commands

\`\`\`bash
bash scripts/openapi-governance.sh collect
bash scripts/openapi-governance.sh check
bash scripts/openapi-governance.sh review
bash scripts/openapi-governance.sh review-bundle
bash scripts/openapi-governance.sh typegen
bash scripts/openapi-governance.sh inventory
bash scripts/openapi-governance.sh validate-upgraded
bash scripts/openapi-governance.sh drift
bash scripts/openapi-governance.sh update-baseline
bash scripts/openapi-governance.sh ci
bash scripts/openapi-governance.sh all
\`\`\`

\`all\` runs the PR gate pipeline: collect → review (포함 freshness check) → typegen → validate-upgraded. 빠른 freshness 단독 검사가 필요하면 \`check\` 타깃을 사용한다. \`inventory\`(read-only summary), \`review-bundle\`(PR comment용 단일 markdown), \`drift\`(runtime 서버 필요)는 의도적으로 분리되어 있으니 필요할 때 별도로 실행한다.

## Artifact Policy

- Use \`${config.artifacts.normalized}\` for governance, review, typegen, and runtime drift.
- Use \`${config.artifacts.upgraded}\` for OpenAPI 3.2 validation, inventory, and analysis.
- Commit \`${config.artifacts.baseline}\`.
- Promote the baseline only in a reviewed commit; \`update-baseline\` is deliberately a local write step, not an approval mechanism.
- Ignore raw, normalized, upgraded, reports, and generated types unless the service deliberately publishes them.
- Type generation policy is \`${config.automation.typegen.policy}\`: ${config.automation.typegen.policy === 'commit-required' ? 'CI requires the generated TypeScript artifact to be tracked and unchanged after generation.' : 'CI proves generation succeeds but does not require the generated TypeScript artifact to be committed.'}

## Installation And CI

The scaffold does not assume this repository's monorepo layout. It invokes
\`${config.tooling.oaGenCommand}\` by default and permits a per-run \`OA_GEN\` override. Install the
CLI through the service's own dependency manager, or set \`OA_GEN\` to its package-manager command.
When \`tooling.setupCommand\` is populated (via \`--oa-gen-setup-command\`), the generated CI
workflow runs that reviewed service-specific setup command before governance. It must include the
service's dependency bootstrap (and any runtime setup such as Node, pnpm/Corepack, Python, or uv)
as well as making \`${config.tooling.oaGenCommand}\` available.

\`.github/workflows/openapi-governance.yml\` is an install-manager-neutral template. Add the
service's normal dependency-install step before the governance step, then make the selected
\`OA_GEN\` command available on \`PATH\`. The \`ci\` target writes the review bundle under
\`${config.automation.artifactDirectory}\` and uploads it even when the gate fails.

## Source of Truth

\`openapi-governance.config.json\` is the source of truth for the artifact interface, consumer mapping, CLI command, and CI automation policy. \`scripts/openapi-governance.sh\` is rendered from that config at scaffold time and bakes the resolved artifact paths into each step. **Hand-editing the JSON does not retroactively change the rendered script or workflow.** After updating \`artifacts\` paths, \`consumers\` mapping, \`tooling\`, \`automation\`, profile, source command, or runtime URL, re-run:

\`\`\`bash
oa-gen scaffold-governance \\
  --root <service-root> \\
  --service ${config.service} \\
  --profile ${config.profile} \\
  --oa-gen-command "${config.tooling.oaGenCommand}" \\
${config.tooling.setupCommand === null ? '' : `  --oa-gen-setup-command "${config.tooling.setupCommand}" \\
`}  --force
\`\`\`

The shell script's first line includes a config fingerprint comment so divergence between the rendered script and the current config can be detected at a glance.
`
}

export function formatScaffoldResult(result: OpenApiGovernanceScaffoldResult): string {
  const lines = [
    `OpenAPI governance scaffold created: ${result.rootDir}`,
    ...result.files.map(file => `- ${relative(result.rootDir, file)}`),
  ]
  return lines.join('\n')
}
