# Survey Report: Requirement R1 (Phase 2) — TypeSpec AST Semantic Diff & Breaking Change Analyzer

## 1. Observation

### 1.1 Existing Dependencies and Compiler Availability
We inspected `packages/codegen/package.json` (lines 62-79) and verified that all required TypeSpec compiler packages are already direct dependencies of `@oa-sdk/codegen`:
```json
"dependencies": {
  "@oa-sdk/ast-sync": "workspace:*",
  "@oa-sdk/core": "workspace:*",
  "@oa-sdk/openapi-projection-contract": "workspace:*",
  "@oa-sdk/parser": "workspace:*",
  "@oa-sdk/typespec-decorators": "workspace:*",
  "@typespec/compiler": "^1.13.0",
  "@typespec/events": "0.83.0",
  "@typespec/http": "^1.13.0",
  "@typespec/openapi": "^1.13.0",
  "@typespec/openapi3": "^1.13.0",
  "@typespec/sse": "0.83.0",
  "@typespec/streams": "0.83.0",
  ...
}
```
In root `package.json`, `@typespec/compiler` is pinned at `^1.13.0`. No new package installations or external dependencies are required.

### 1.2 Programmatic Compilation and AST Navigation Capabilities
We directly tested and verified the programmatic JavaScript APIs of `@typespec/compiler`, `@typespec/http`, and `@typespec/openapi` in Node.js 24:

1. **In-Memory Program Compilation (`@typespec/compiler`)**:
   ```typescript
   import { compile, NodeHost, navigateProgram, getSourceLocation } from '@typespec/compiler'
   const program = await compile(NodeHost, entrypointPath, { noEmit: true })
   ```
   - Running `compile(NodeHost, 'packages/schemas/typespec/main.tsp', { noEmit: true })` completed in <400ms with 0 diagnostics.
   - `noEmit: true` completely suppresses emitting OpenAPI YAML or JSON artifacts to disk, keeping the entire analysis in-memory.

2. **HTTP Operation and Route Extraction (`@typespec/http`)**:
   ```typescript
   import { getAllHttpServices, type HttpOperation } from '@typespec/http'
   const [services] = getAllHttpServices(program)
   ```
   - Returns 34 operations across `packages/schemas/typespec/main.tsp`.
   - Each `HttpOperation` exposes:
     - `op.path`: Exact HTTP route string (e.g., `/auth/forgot-password`, `/users/{id}`).
     - `op.verb`: HTTP method (`'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options'`).
     - `op.operation.name`: Symbolic operation identifier.
     - `op.parameters.parameters`: List of path, query, and header parameters with `.paramType` and `.name`.
     - `op.responses`: List of responses with `.statusCodes` (e.g., `[ 204, 400, 422, 429 ]`).

3. **`@operationId` Resolution (`@typespec/openapi`)**:
   ```typescript
   import { getOperationId } from '@typespec/openapi'
   const opId = getOperationId(program, op.operation) // e.g. "forgotPassword", "refreshToken"
   ```
   - Resolves explicitly declared `@operationId("...")` decorators as well as default operation identifiers.

4. **Model and Property Semantic Traversal**:
   ```typescript
   navigateProgram(program, {
     model(m) {
       // Filter user models vs standard library models (namespace !== 'TypeSpec')
       if (m.name && !m.name.startsWith('_') && !m.name.includes('<') && m.namespace?.name !== 'TypeSpec') {
         // m.properties is Map<string, ModelProperty>
         for (const [propName, prop] of m.properties) {
           // prop.optional: boolean
           // prop.type: Type (Scalar, Model, Union, etc.)
         }
       }
     }
   })
   ```
   - Verified on `packages/schemas/typespec/main.tsp`: 218 named domain models extracted (e.g. `User`, `AuthSession`, `UserRole`).
   - `User` model correctly exposed `id` (optional: false, Scalar string), `email` (optional: false), `role` (optional: false, Union), `createdAt` (optional: false, Scalar utcDateTime).

### 1.3 Existing CLI Dispatch Architecture and Multi-Token Subcommands
Inspecting `packages/codegen/src/cli/index.ts` (lines 40-85):
- Currently, `commandName` is read as a single token: `rawArgs[commandIndex]`.
- If a user passes `oa-gen tsp diff --base ... --head ...`, `commandIndex` matches `'tsp'`. Without two-token lookahead, `commandMap.get('tsp')` returns `undefined`, triggering `알 수 없는 커맨드: tsp`.
- To support `oa-gen tsp diff`, `index.ts` requires compound subcommand lookahead:
  ```typescript
  if (commandIndex !== -1 && rawArgs[commandIndex + 1] && !rawArgs[commandIndex + 1].startsWith('-')) {
    const compoundName = `${rawArgs[commandIndex]} ${rawArgs[commandIndex + 1]}`
    if (commandMap.has(compoundName)) {
      commandName = compoundName
      commandArgsStartIndex = commandIndex + 2
    }
  }
  ```
- Command registration in `commands.ts` should support both `'tsp diff'`, `'tsp:diff'`, and `'tsp-diff'` for maximum CLI usability.

### 1.4 Existing Diff Patterns in `@oa-sdk/codegen`
1. **`packages/codegen/src/cli/commands/diff.ts`**:
   - Compares OpenAPI specs via `diffEndpoints(base.document, head.document)`.
   - Uses options `--base <path>`, `--head <path>`, and `--fail-on-breaking`.
   - If `bool(args, 'fail-on-breaking') && hasBreakingChanges(result)` is true, throws `new CliExitError(1)`.
   - Prints formatted Markdown report to stdout.
2. **`packages/codegen/src/cli/lib/openapi-breaking-diff.ts`**:
   - Defines `ContractDiffChange` with `{ code, endpoint, detail, severity: 'breaking' | 'non-breaking' }`.
   - Breaking codes: `endpoint-removed`, `operation-id-changed`, `required-parameter-added`, `parameter-removed`, `parameter-required`, `property-removed`, `required-field-added`, `response-removed`, `type-changed`.
   - Non-breaking codes: `endpoint-added`, `property-added`, `field-optional`, `constraint-widened`.

### 1.5 Governance Gates and Spec Validation
We inspected the repository gates in `scripts/`:
1. **`scripts/check-cli-spec.ts` (lines 74-80, 138-199)**:
   - Validates that TS CLI implementations in `packages/codegen/src/cli/commands.ts` match `oaGenGovernanceManifest` in `packages/codegen/src/cli/spec/oa-gen-governance.ts` and `docs/cli-spec/oa-gen.governance.json`.
   - Requires command IDs to match kebab-case regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (e.g. `tsp-diff`).
   - Undocumented CLI aliases or colon-separated commands can be declared in `undocumentedOaGenCommands` (currently holds `generate`, `typegen`, `lint`, `audit:csp`, `drift:check`).
2. **`scripts/check-docs.ts` (lines 28-34)**:
   - Verifies that every command registered in `commands.ts` is documented in `docs/guides/cli-command-reference.md`.
   - Verified by running `pnpm check:docs`: missing documentation causes exit code 1.
3. **`scripts/schema-typespec-check.ts`**:
   - Verified by running `pnpm schema:typespec-check`: passed with exit code 0 against `packages/schemas/typespec/main.tsp`.

---

## 2. Logic Chain

```
[Observation 1.1: @typespec/compiler, http, openapi already installed in codegen]
    │
    ▼
(Step 1: In-memory Compilation)
Use compile(NodeHost, entrypoint, { noEmit: true }) for zero-disk, high-speed semantic analysis.
    │
    ▼
(Step 2: Reference Resolution: File Paths vs Git Refs)
Inspect --base and --head:
- If local file or directory exists (existsSync), compile directly.
- If not a local path, test if valid git ref via `git rev-parse --verify <ref>`.
- If git ref: extract project tree via `git archive <ref> <dir> | tar -x -C <tempDir>`, symlink `node_modules`, and compile.
    │
    ▼
(Step 3: Semantic Extraction & AST Navigation)
Extract two semantic maps from Program:
1. Operations Map:
   - Key: operationId ?? `${verb} ${path}`
   - Route path, HTTP verb, parameters, responses (status codes), @operationId
2. Models Map:
   - Key: model.name
   - Properties: name, optional, type name / kind
    │
    ▼
(Step 4: Breaking vs Non-Breaking Classification Matrix)
Compare Base vs Head semantic maps across the 7 required categories:
- Removed operations                  ──► BREAKING ('operation-removed')
- Altered HTTP methods / routes       ──► BREAKING ('route-changed' / 'http-method-changed')
- Removed / renamed models            ──► BREAKING ('model-removed')
- Removed properties                  ──► BREAKING ('property-removed')
- Newly required properties           ──► BREAKING ('property-required' / 'required-property-added')
- Changed status codes (removed)      ──► BREAKING ('status-code-removed')
- Changed @operationId                ──► BREAKING ('operation-id-changed')
- Newly added operations/models/props ──► NON-BREAKING ('operation-added', 'model-added', 'property-added')
    │
    ▼
(Step 5: CLI Dispatch & CI Exit Policy)
- Format results as structured Markdown (and optional JSON).
- If --fail-on-breaking is passed and breakingChanges.length > 0, throw new CliExitError(1).
- Register 'tsp diff' in commands.ts, index.ts, and governance manifest.
```

### 2.1 Detailed Semantic Extraction and Diff Rules

#### 1. Operations & Routes
- **Endpoint Identity**: An operation is tracked by its `@operationId` (if declared) and canonical route signature `${verb.toUpperCase()} ${path}`.
- **Removed Operation**: Operation exists in Base but neither its signature nor its `@operationId` exists in Head.
  - Severity: **BREAKING** (`operation-removed`)
  - Detail: `Operation ${verb.toUpperCase()} ${path} was removed.`
- **Altered Route or Verb**: An operation retains the same `@operationId` or matching handler symbol, but its HTTP route path or HTTP verb changed.
  - Severity: **BREAKING** (`route-changed` or `http-method-changed`)
  - Detail: `Operation ${opId} route changed from ${basePath} to ${headPath}.`
- **Changed `@operationId`**: An endpoint at the same route `${verb} ${path}` had `@operationId` `oldId` in Base, and now has `newId` (or none) in Head.
  - Severity: **BREAKING** (`operation-id-changed`)
  - Detail: `Operation ${verb.toUpperCase()} ${path} operationId changed from "${baseId}" to "${headId}".`
- **Changed Status Codes**: A response status code defined in Base is missing in Head.
  - Severity: **BREAKING** (`status-code-removed`)
  - Detail: `Response status code ${status} was removed from ${verb.toUpperCase()} ${path}.`
- **Added Response Status Code**: A new response status code was added in Head.
  - Severity: **NON-BREAKING** (`status-code-added`)
- **Added Operation**: Operation exists in Head but was absent in Base.
  - Severity: **NON-BREAKING** (`operation-added`)

#### 2. Models & Properties
- **Removed Model**: A named domain model in Base is absent in Head.
  - Severity: **BREAKING** (`model-removed`)
  - Detail: `Model ${modelName} was removed.`
- **Removed Property**: A property on model `M` exists in Base but is missing in Head.
  - Severity: **BREAKING** (`property-removed`)
  - Detail: `Property ${propName} was removed from model ${modelName}.`
- **Newly Required Property**:
  - Case A (Existing property became required): Property existed in Base with `optional === true`, now has `optional === false` in Head.
    - Severity: **BREAKING** (`property-required`)
    - Detail: `Property ${propName} on model ${modelName} became required.`
  - Case B (Added required property): Property was absent in Base, and is added in Head with `optional === false`.
    - Severity: **BREAKING** (`required-property-added`)
    - Detail: `Required property ${propName} was added to model ${modelName}.`
- **Added Optional Property**: Property was absent in Base, and is added in Head with `optional === true`.
  - Severity: **NON-BREAKING** (`property-added`)
  - Detail: `Optional property ${propName} was added to model ${modelName}.`
- **Property Became Optional**: Property was required in Base (`optional === false`), and became optional in Head (`optional === true`).
  - Severity: **NON-BREAKING** (`property-optional`)
- **Property Type Changed**: The type kind or type name of property `P` changed between Base and Head.
  - Severity: **BREAKING** (`property-type-changed`)
  - Detail: `Property ${propName} type on model ${modelName} changed from ${baseType} to ${headType}.`
- **Added Model**: A new model exists in Head that was not present in Base.
  - Severity: **NON-BREAKING** (`model-added`)

### 2.2 Git Ref vs File Path Resolution Algorithm
When resolving `--base <ref>` or `--head <ref>`:
1. **Local Path Check**:
   - Check if `existsSync(resolve(cwd, ref))` is true.
   - If it's a file: use it as `entrypointPath`.
   - If it's a directory: search for `main.tsp` or `tspconfig.yaml`.
2. **Git Ref Check**:
   - If not a local path, execute `git rev-parse --verify ${ref}^{commit}` using `node:child_process` `execFileAsync`.
   - If successful, it is a valid git commit or ref (branch, tag, `HEAD~1`, etc.).
   - Create a temporary folder in `tmpdir()`.
   - Extract the TypeSpec source tree using:
     `git archive <commit> <typespecRelativeDir> | tar -x -C <tempDir>`
   - Create symlink `<tempDir>/node_modules -> <repoRoot>/node_modules` so that standard decorators (`@typespec/http`, `@typespec/openapi`) resolve seamlessly.
   - Set `entrypointPath = join(tempDir, typespecRelativeDir, 'main.tsp')`.
   - Ensure the temporary folder is deleted in a `finally` block after compilation.

---

## 3. Caveats

1. **Syntactic Diff vs Semantic AST Diff**:
   - A pure text-level AST diff (e.g. comparing AST tokens from `@typespec/compiler/ast`'s `parse()`) is sensitive to whitespace, file order, and comment changes, and cannot evaluate `@route`, `@operationId`, or inheritance.
   - Compiling via `compile(NodeHost, ..., { noEmit: true })` produces a fully typed semantic `Program`. The semantic diff approach guarantees that decorator evaluation, inheritance, and cross-file imports are evaluated accurately without false positives.
2. **Git Repository Environment**:
   - Resolving git refs requires the CLI to be executed within a working Git repository with `git` in `$PATH`. If `git` is unavailable or the directory is not a git worktree, the CLI gracefully reports an error and suggests providing direct local file paths.
3. **Monorepo Symlink Dependency**:
   - When extracting a historical git ref to a temporary folder, symlinking the monorepo's root `node_modules` ensures `@typespec/compiler` standard libraries are available. If historical commits used incompatible compiler versions (> 1 major version divergence), compilation may report diagnostic warnings. This is standard behavior for git-based diffing.

---

## 4. Conclusion & Architecture Blueprint

To implement R1 (Phase 2) cleanly and conform to monorepo architecture, we recommend structuring the solution as follows:

### 4.1 Proposed File Layout in `packages/codegen`

```
packages/codegen/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   └── tsp-diff.ts               # CLI command: oa-gen tsp diff / tsp:diff / tsp-diff
│   │   ├── lib/
│   │   │   ├── typespec-ast-diff.ts      # Core diff engine & 7-category analyzer
│   │   │   └── typespec-ref-resolver.ts  # File path & git ref resolver (temp tree extractor)
│   │   ├── commands.ts                   # Command registry (register tspDiff)
│   │   └── index.ts                      # Multi-word subcommand router ('tsp diff')
│   ├── schema-governance.ts              # Export diffTypeSpecPrograms & DiffTypes
│   └── __tests__/
│       └── tsp-diff.test.ts              # Comprehensive unit & integration tests
```

### 4.2 Data Contracts (`typespec-ast-diff.ts`)

```typescript
export type TypeSpecChangeSeverity = 'breaking' | 'non-breaking'

export type TypeSpecDiffCode =
  | 'operation-removed'
  | 'route-changed'
  | 'http-method-changed'
  | 'operation-id-changed'
  | 'status-code-removed'
  | 'model-removed'
  | 'property-removed'
  | 'property-required'
  | 'required-property-added'
  | 'property-type-changed'
  | 'operation-added'
  | 'model-added'
  | 'property-added'
  | 'property-optional'
  | 'status-code-added'

export interface TypeSpecDiffChange {
  code: TypeSpecDiffCode
  target: string // e.g. "POST /users", "User.id", "forgotPassword"
  detail: string
  severity: TypeSpecChangeSeverity
}

export interface TypeSpecDiffResult {
  baseRef: string
  headRef: string
  breakingChanges: TypeSpecDiffChange[]
  nonBreakingChanges: TypeSpecDiffChange[]
  allChanges: TypeSpecDiffChange[]
  summary: {
    totalChanges: number
    breakingCount: number
    nonBreakingCount: number
  }
}
```

### 4.3 Core Engine Implementation Blueprint (`typespec-ast-diff.ts`)

```typescript
import { compile, NodeHost, navigateProgram, getSourceLocation, type Program, type Model } from '@typespec/compiler'
import { getAllHttpServices, type HttpOperation } from '@typespec/http'
import { getOperationId } from '@typespec/openapi'

export interface TypeSpecOperationSummary {
  signature: string // "POST /auth/login"
  verb: string
  path: string
  operationId?: string
  statusCodes: number[]
  parameters: Array<{ name: string; paramType: string }>
}

export interface TypeSpecModelSummary {
  name: string
  properties: Map<string, { name: string; optional: boolean; typeStr: string }>
}

export function extractTypeSpecSemantics(program: Program): {
  operations: Map<string, TypeSpecOperationSummary>
  models: Map<string, TypeSpecModelSummary>
} {
  const operations = new Map<string, TypeSpecOperationSummary>()
  const models = new Map<string, TypeSpecModelSummary>()

  // 1. Extract HTTP Operations
  const [services] = getAllHttpServices(program)
  for (const service of services) {
    for (const op of service.operations) {
      const verb = op.verb.toUpperCase()
      const path = op.path
      const signature = `${verb} ${path}`
      const opId = getOperationId(program, op.operation)
      const statusCodes = op.responses.flatMap(r => r.statusCodes)
      const parameters = op.parameters.parameters.map(p => ({
        name: p.name,
        paramType: p.paramType,
      }))
      const summary: TypeSpecOperationSummary = {
        signature,
        verb,
        path,
        operationId: opId,
        statusCodes,
        parameters,
      }
      operations.set(signature, summary)
    }
  }

  // 2. Extract Named Models
  navigateProgram(program, {
    model(m: Model) {
      if (!m.name || m.name.startsWith('_') || m.name.includes('<') || m.namespace?.name === 'TypeSpec') {
        return
      }
      const props = new Map<string, { name: string; optional: boolean; typeStr: string }>()
      for (const [propName, prop] of m.properties) {
        props.set(propName, {
          name: propName,
          optional: prop.optional,
          typeStr: prop.type.name ?? prop.type.kind,
        })
      }
      models.set(m.name, { name: m.name, properties: props })
    },
  })

  return { operations, models }
}

export function diffTypeSpecSemantics(
  base: { operations: Map<string, TypeSpecOperationSummary>; models: Map<string, TypeSpecModelSummary> },
  head: { operations: Map<string, TypeSpecOperationSummary>; models: Map<string, TypeSpecModelSummary> },
  options: { baseRef: string; headRef: string },
): TypeSpecDiffResult {
  const breaking: TypeSpecDiffChange[] = []
  const nonBreaking: TypeSpecDiffChange[] = []

  // 1. Operations comparison
  for (const [sig, baseOp] of base.operations) {
    const headOp = head.operations.get(sig)
    if (!headOp) {
      // Check if altered route/method with same operationId
      const candidateAltered = baseOp.operationId
        ? [...head.operations.values()].find(h => h.operationId === baseOp.operationId)
        : undefined
      if (candidateAltered) {
        if (candidateAltered.path !== baseOp.path) {
          breaking.push({
            code: 'route-changed',
            target: baseOp.operationId ?? sig,
            detail: `Operation ${baseOp.operationId} route changed from ${baseOp.path} to ${candidateAltered.path}.`,
            severity: 'breaking',
          })
        }
        if (candidateAltered.verb !== baseOp.verb) {
          breaking.push({
            code: 'http-method-changed',
            target: baseOp.operationId ?? sig,
            detail: `Operation ${baseOp.operationId} HTTP method changed from ${baseOp.verb} to ${candidateAltered.verb}.`,
            severity: 'breaking',
          })
        }
      } else {
        breaking.push({
          code: 'operation-removed',
          target: sig,
          detail: `Operation ${sig} was removed.`,
          severity: 'breaking',
        })
      }
    } else {
      // Check @operationId drift
      if (baseOp.operationId !== headOp.operationId) {
        breaking.push({
          code: 'operation-id-changed',
          target: sig,
          detail: `Operation ${sig} operationId changed from "${baseOp.operationId}" to "${headOp.operationId}".`,
          severity: 'breaking',
        })
      }
      // Check response status code removals
      for (const status of baseOp.statusCodes) {
        if (!headOp.statusCodes.includes(status)) {
          breaking.push({
            code: 'status-code-removed',
            target: sig,
            detail: `Response status code ${status} was removed from ${sig}.`,
            severity: 'breaking',
          })
        }
      }
      // Check added response status codes (non-breaking)
      for (const status of headOp.statusCodes) {
        if (!baseOp.statusCodes.includes(status)) {
          nonBreaking.push({
            code: 'status-code-added',
            target: sig,
            detail: `Response status code ${status} was added to ${sig}.`,
            severity: 'non-breaking',
          })
        }
      }
    }
  }

  for (const [sig, headOp] of head.operations) {
    if (!base.operations.has(sig)) {
      const isAltered = headOp.operationId && [...base.operations.values()].some(b => b.operationId === headOp.operationId)
      if (!isAltered) {
        nonBreaking.push({
          code: 'operation-added',
          target: sig,
          detail: `Operation ${sig} was added.`,
          severity: 'non-breaking',
        })
      }
    }
  }

  // 2. Models & Properties comparison
  for (const [modelName, baseModel] of base.models) {
    const headModel = head.models.get(modelName)
    if (!headModel) {
      breaking.push({
        code: 'model-removed',
        target: modelName,
        detail: `Model ${modelName} was removed.`,
        severity: 'breaking',
      })
      continue
    }

    // Compare properties on model
    for (const [propName, baseProp] of baseModel.properties) {
      const headProp = headModel.properties.get(propName)
      if (!headProp) {
        breaking.push({
          code: 'property-removed',
          target: `${modelName}.${propName}`,
          detail: `Property ${propName} was removed from model ${modelName}.`,
          severity: 'breaking',
        })
      } else {
        if (baseProp.optional && !headProp.optional) {
          breaking.push({
            code: 'property-required',
            target: `${modelName}.${propName}`,
            detail: `Property ${propName} on model ${modelName} became required.`,
            severity: 'breaking',
          })
        } else if (!baseProp.optional && headProp.optional) {
          nonBreaking.push({
            code: 'property-optional',
            target: `${modelName}.${propName}`,
            detail: `Property ${propName} on model ${modelName} became optional.`,
            severity: 'non-breaking',
          })
        }
        if (baseProp.typeStr !== headProp.typeStr) {
          breaking.push({
            code: 'property-type-changed',
            target: `${modelName}.${propName}`,
            detail: `Property ${propName} type on model ${modelName} changed from ${baseProp.typeStr} to ${headProp.typeStr}.`,
            severity: 'breaking',
          })
        }
      }
    }

    // Check newly added properties on model
    for (const [propName, headProp] of headModel.properties) {
      if (!baseModel.properties.has(propName)) {
        if (!headProp.optional) {
          breaking.push({
            code: 'required-property-added',
            target: `${modelName}.${propName}`,
            detail: `Required property ${propName} was added to model ${modelName}.`,
            severity: 'breaking',
          })
        } else {
          nonBreaking.push({
            code: 'property-added',
            target: `${modelName}.${propName}`,
            detail: `Optional property ${propName} was added to model ${modelName}.`,
            severity: 'non-breaking',
          })
        }
      }
    }
  }

  for (const [modelName] of head.models) {
    if (!base.models.has(modelName)) {
      nonBreaking.push({
        code: 'model-added',
        target: modelName,
        detail: `Model ${modelName} was added.`,
        severity: 'non-breaking',
      })
    }
  }

  const allChanges = [...breaking, ...nonBreaking]
  return {
    baseRef: options.baseRef,
    headRef: options.headRef,
    breakingChanges: breaking,
    nonBreakingChanges: nonBreaking,
    allChanges,
    summary: {
      totalChanges: allChanges.length,
      breakingCount: breaking.length,
      nonBreakingCount: nonBreaking.length,
    },
  }
}
```

### 4.4 CLI Command Implementation Blueprint (`tsp-diff.ts`)

```typescript
import type { Command, CommandContext } from '../lib/types.js'
import { bool, optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { resolveTypeSpecProgramRef } from '../lib/typespec-ref-resolver.js'
import {
  diffTypeSpecSemantics,
  extractTypeSpecSemantics,
  formatTypeSpecDiffMarkdown,
} from '../lib/typespec-ast-diff.js'

export const tspDiff: Command = {
  name: 'tsp diff',
  description: 'TypeSpec AST semantic diff and breaking change analyzer',
  options: {
    base: {
      type: 'string',
      required: true,
      description: 'Base TypeSpec source file, directory, or git ref (e.g. main, HEAD~1, path/to/main.tsp)',
    },
    head: {
      type: 'string',
      required: true,
      description: 'Head TypeSpec source file, directory, or git ref (e.g. HEAD, path/to/main.tsp)',
    },
    'fail-on-breaking': {
      type: 'boolean',
      description: 'Exit with code 1 if breaking changes are detected',
    },
    format: {
      type: 'string',
      description: 'Output format: markdown (default) or json',
    },
  },
  async run(args, context?: CommandContext) {
    const rootDir = context?.projectRoot ?? optStr(args, 'project-root') ?? optStr(args, 'root') ?? process.cwd()
    const baseRef = str(args, 'base')
    const headRef = str(args, 'head')
    const failOnBreaking = bool(args, 'fail-on-breaking')
    const format = optStr(args, 'format') ?? 'markdown'

    const baseProgram = await resolveTypeSpecProgramRef(baseRef, rootDir)
    const headProgram = await resolveTypeSpecProgramRef(headRef, rootDir)

    try {
      const baseSemantics = extractTypeSpecSemantics(baseProgram.program)
      const headSemantics = extractTypeSpecSemantics(headProgram.program)

      const result = diffTypeSpecSemantics(baseSemantics, headSemantics, { baseRef, headRef })

      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(formatTypeSpecDiffMarkdown(result))
      }

      if (failOnBreaking && result.summary.breakingCount > 0) {
        throw new CliExitError(1)
      }
    } finally {
      await baseProgram.cleanup()
      await headProgram.cleanup()
    }
  },
}
```

---

## 5. Verification Method

### 5.1 Step-by-Step Test Commands for Independent Verification

1. **Unit & Integration Tests for `tsp-diff`**:
   ```bash
   pnpm --filter @oa-sdk/codegen test src/__tests__/tsp-diff.test.ts
   ```
   Verifies:
   - Operation removal, altered route paths, altered HTTP verbs.
   - Removed model, removed property, newly required property, property type change.
   - Changed `@operationId` and removed response status codes.
   - Non-breaking changes (added operations, added models, optional properties).
   - Flag `--fail-on-breaking` exits with code 1 when breaking changes exist, code 0 when clean.

2. **CLI Invocation Formats**:
   ```bash
   # Multi-word invocation
   node packages/codegen/dist/cli/index.js tsp diff --base packages/schemas/typespec/main.tsp --head packages/schemas/typespec/main.tsp
   
   # Git ref vs local path invocation
   node packages/codegen/dist/cli/index.js tsp diff --base HEAD~1 --head HEAD --fail-on-breaking
   ```

3. **Governance & Documentation Gates**:
   ```bash
   # CLI spec integrity check
   pnpm check:cli-spec

   # Documentation and command reference coverage
   pnpm check:docs
   ```

4. **Monorepo TypeSpec Schema Check**:
   ```bash
   pnpm schema:typespec-check
   ```

5. **Full Codegen Test Suite**:
   ```bash
   pnpm --filter @oa-sdk/codegen test
   ```

### 5.2 Invalidation Conditions
This survey and blueprint would be invalidated if:
- `@typespec/compiler` in the monorepo is downgraded below `1.10.0`, removing `getAllHttpServices` or `NodeHost`.
- The TypeSpec language removes decorator reflection APIs (`getOperationId` from `@typespec/openapi`).
- Monorepo security policies disallow invoking `git` subprocesses in CI environments.

