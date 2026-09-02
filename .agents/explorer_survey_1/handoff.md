# Survey Report: Requirement R1 — Standalone Guards Splitting & Filtering

## 1. Observation

### 1.1 Existing Standalone Type Guard Generator Implementation
The standalone lightweight type guard generator in `@oa-sdk/codegen` is located in `packages/codegen/src/standalone-guards/`:
- **`packages/codegen/src/standalone-guards/generator.ts` (lines 61-202)**:
  - Initializes `Ajv2020` with `{ code: { source: true, esm: true }, strict: false, allErrors: false }` and registers formats via `ajv-formats`.
  - Discovers targets via `autoDiscoverGuards(schemaDocument)` (lines 15-55) from `$defs`, `definitions`, `components.schemas`, or document `title`.
  - Registers the root document schema (`$id: urn:oa-sdk:root`) and adds each target schema as `{ $ref: '<rootId>#/<path>' }` with key `guard.name`.
  - Calls `standaloneCode(ajv, mapping)` (line 124) where `mapping` contains all resolved guards (`{ isFoo: 'isFoo', isBar: 'isBar' }`).
  - Replaces `export const (\w+) = (\w+);` with `export function $1(data, ...args) {\n  return $2(data, ...args);\n}` (lines 127-130).
  - Emits monolithic files:
    - `guards.js` (lines 160-166): Contains all compiled validator functions.
    - `guards.d.ts` (lines 169-177): Contains all TypeScript type predicate declarations (`export declare function isFoo(data: unknown): data is Foo;`).
    - `index.js` (lines 180-187): Exports `export * from './guards.js';`.
    - `index.d.ts` (lines 190-199): Exports `export * from './guards.js';`.

- **`packages/codegen/src/standalone-guards/types.ts` (lines 8-45)**:
  ```typescript
  export interface StandaloneGuardTarget {
    name: string
    typeName?: string | undefined
    schema: Record<string, unknown> | string
  }

  export interface StandaloneGuardGeneratorOptions {
    schemaDocument: Record<string, unknown>
    outDir: string
    guards?: StandaloneGuardTarget[] | undefined
    typeImportSpecifier?: string | undefined
    generateDeclarations?: boolean | undefined
    moduleFormat?: 'esm' | undefined
  }

  export interface GeneratedGuardArtifact {
    filePath: string
    content: string
    kind: 'js' | 'dts'
  }
  ```

- **`packages/codegen/src/cli/commands/generate.ts` (lines 13-95)**:
  - Dispatches to `runStandaloneGuards(args)` when `target === 'standalone-guards'` or when `input` is provided without `drizzle-schema` or `config`.
  - Declared options in `generate.options` (lines 16-27): `target`, `input` (`-i`), `out-dir`, `type-import`, `module-format`, `config` (`-c`), `drizzle-schema` (`-d`), `output` (`-o`), `merge-into`, `schemas`.
  - In `runStandaloneGuards` (lines 49-95):
    - `input` is read and parsed (YAML or JSON).
    - `outDir` resolves to `optStr(args, 'out-dir') ?? optStr(args, 'output') ?? '.'`.
    - `typeImport` and `moduleFormat` are passed.
    - **Missing**: `split` is NOT in `generate.options` and NOT read in `runStandaloneGuards`.
    - **Missing**: `schemas` is declared in `generate.options` (for Drizzle), but `runStandaloneGuards` does NOT read or forward `optStr(args, 'schemas')`.

### 1.2 Ajv Standalone Code Compilation Behavior for Modular Targets
Through direct verification with Node.js and `ajv/dist/standalone`, we observed:
1. **Single-target mapping**: Calling `standaloneCode(ajv, { isUser: 'isUser' })` on an Ajv instance with multiple schemas registered emits code **only** for `isUser` and inlines any sub-schemas referenced via `$ref` (e.g. `Address`).
2. **Reusability**: Calling `standaloneCode` multiple times consecutively with different single-key mappings on the same configured `ajv` instance works deterministically with 0 side effects or AST corruption.
3. **Execution Invariants**: All generated JS modules execute cleanly in strict CSP environments (0 `eval()`, 0 `new Function()`, 0 external runtime imports).

### 1.3 Existing Test Baseline
- `test/standalone-guards/generator.test.ts`: 9 unit tests verifying primitive constraints, nested objects, polymorphic discriminators (`oneOf`), auto-discovery, zero eval/Function CSP sandbox invariants, and `.d.ts` generation.
- `test/standalone-guards/cli.test.ts`: 3 unit tests verifying CLI JSON/YAML parsing and missing input error handling.
- `test/e2e/standalone-guards.e2e.test.ts`: 27 tests covering Tiers 1-4.
- Full test suite passes: 87 test files, 985 tests passing.
- Monorepo typecheck is clean: 21 workspace packages pass `tsc --noEmit`.

---

## 2. Logic Chain

### Step 1: Motivation for Split Output (`--split`) and Filtering (`--schemas`)
- Monolithic `guards.js` bundles all schema validators into a single artifact. In large OpenAPI documents (e.g., 50+ schemas), client applications or Chrome Extension Manifest V3 scripts importing a single guard (`isSurfaceBlock`) are forced to evaluate and bundle unnecessary schema validators.
- `--split` allows modular file emission (`guards/<TypeName>.js` and `guards/<TypeName>.d.ts`), enabling fine-grained tree-shaking and module isolation.
- `--schemas` enables selective generation so developers can target only specific components or guard functions.

### Step 2: Architecture of Split Output (`--split`)
When `split: true` is enabled in `StandaloneGuardGeneratorOptions`:
1. **File Placement**:
   - Subdirectory: `path.join(outDir, 'guards')`.
   - File Base Name: `const fileBaseName = guard.typeName?.trim() || guard.name`.
   - Individual JavaScript: `outDir/guards/${fileBaseName}.js`.
   - Individual Declaration: `outDir/guards/${fileBaseName}.d.ts`.
2. **Barrel Entrypoint**:
   - Root `outDir/index.js`: Re-exports each modular guard file:
     ```javascript
     export * from './guards/SurfaceBlock.js';
     export * from './guards/SurfaceParam.js';
     ```
   - Root `outDir/index.d.ts`:
     ```typescript
     export * from './guards/SurfaceBlock.js';
     export * from './guards/SurfaceParam.js';
     ```
3. **Per-File Standalone Code Generation**:
   - For each target guard `guard`:
     - Compile: `standaloneCode(ajv, { [guard.name]: guard.name })`.
     - Transform: Wrap exports with explicit `export function ${guard.name}(data, ...args) { ... }`.
   - For each declaration:
     - If `typeImportSpecifier` and `guard.typeName`:
       `import type { ${guard.typeName} } from '${typeImportSpecifier}';\n\nexport declare function ${guard.name}(data: unknown): data is ${guard.typeName};\n`
     - If no `guard.typeName`:
       `export declare function ${guard.name}(data: unknown): data is unknown;\n`

### Step 3: Self-Contained $ref Dependency Handling
- Because `standaloneCode(ajv, { [guard.name]: guard.name })` resolves and inlines all `$ref` sub-validators directly into that file's scope, each `guards/<TypeName>.js` module is **100% self-contained** at runtime.
- There are no cross-file runtime imports between individual guard files (e.g., `guards/User.js` does not need to import from `guards/Address.js`), preventing circular reference runtime errors and keeping tree-shaking trivial.

### Step 4: Selective Filtering Algorithm (`--schemas`)
- The input filter string from CLI (e.g. `--schemas isSurfaceBlock,isSurfaceParam` or `--schemas SurfaceBlock,SurfaceParam`) is split by comma and trimmed: `['isSurfaceBlock', 'isSurfaceParam']`.
- Matching criteria for each candidate guard:
  A guard target matches if:
  1. Exact match on `guard.name === term` (e.g. `isSurfaceBlock` matches `isSurfaceBlock`).
  2. Exact match on `guard.typeName === term` (e.g. `SurfaceBlock` matches `SurfaceBlock`).
  3. Prefix-normalized match:
     - `term.startsWith('is') && guard.typeName === term.slice(2)` (`isSurfaceBlock` matches `SurfaceBlock`).
     - `!term.startsWith('is') && guard.name === 'is' + term` (`SurfaceBlock` matches `isSurfaceBlock`).
- If `--schemas` is specified, `resolvedGuards` is filtered using this rule prior to file generation.
- Combined usage: `--split` and `--schemas` work together seamlessly (e.g. `--split --schemas SurfaceBlock` emits only `guards/SurfaceBlock.js`, `guards/SurfaceBlock.d.ts`, and `index.js`/`index.d.ts` re-exporting `SurfaceBlock.js`).

### Step 5: CLI Options & Routing Integration
- In `packages/codegen/src/cli/commands/generate.ts`:
  - Add `split: { type: 'boolean', description: '개별 가드 모듈 분할 생성 (guards/<TypeName>.js)' }` to `generate.options`.
  - Update `generate.options.schemas.description` to describe guard filtering.
  - In `runStandaloneGuards`:
    - `const split = bool(args, 'split')`
    - `const schemasRaw = optStr(args, 'schemas')`
    - `const schemas = schemasRaw ? schemasRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined`
    - Pass `split` and `schemas` to `generateStandaloneGuards`.

---

## 3. Caveats

1. **Schema Name Sanitization**:
   - If schema keys contain characters invalid in filenames (e.g., `/` or `:`), `typeName` or `name` should be sanitized (e.g., replacing invalid characters) to avoid directory traversal. However, in standard OpenAPI 3.1 / JSON Schema components, names are valid identifiers (PascalCase or camelCase).
2. **Anonymous Inline Schemas**:
   - When a schema has no `typeName` (e.g. root document without title), `typeName` is empty and `guard.name` defaults to `isRoot`. In split mode, the file becomes `guards/isRoot.js` and `guards/isRoot.d.ts` with `data is unknown`.
3. **Empty Filter Match**:
   - If `--schemas` specifies names that do not exist in the document, `resolvedGuards` will be empty. The generator should return an empty array `[]` (or emit a friendly warning in CLI) and avoid creating empty barrel files.

---

## 4. Conclusion & Proposed Implementation Blueprint

### 4.1 Type Definitions (`packages/codegen/src/standalone-guards/types.ts`)
```typescript
export interface StandaloneGuardGeneratorOptions {
  /** Input OpenAPI 3.1 or JSON Schema Draft 2020-12 document */
  schemaDocument: Record<string, unknown>
  /** Output directory where guards will be written */
  outDir: string
  /** Explicit list of guard targets. If omitted, discovered automatically from schemaDocument */
  guards?: StandaloneGuardTarget[] | undefined
  /** Filter generation to only the requested schema type names or guard function names */
  schemas?: string[] | undefined
  /** Whether to output individual modular files per schema in guards/ alongside root index.js */
  split?: boolean | undefined
  /** Optional module/package specifier for TypeScript type imports (e.g., '@oa-sdk/models' or './types.js') */
  typeImportSpecifier?: string | undefined
  /** Whether to generate TypeScript declaration (.d.ts) files. Defaults to true. */
  generateDeclarations?: boolean | undefined
  /** Target module format. Defaults to 'esm'. */
  moduleFormat?: 'esm' | undefined
}
```

### 4.2 Generator Implementation (`packages/codegen/src/standalone-guards/generator.ts`)
```typescript
// 1. Filter resolved guards if schemas option is supplied
let resolvedGuards = options.guards && options.guards.length > 0
  ? options.guards
  : autoDiscoverGuards(schemaDocument)

if (options.schemas && options.schemas.length > 0) {
  const filterList = options.schemas
  resolvedGuards = resolvedGuards.filter(guard => {
    return filterList.some(term => {
      if (guard.name === term) return true
      if (guard.typeName && guard.typeName === term) return true
      if (term.startsWith('is') && guard.typeName && guard.typeName === term.slice(2)) return true
      if (!term.startsWith('is') && guard.name === `is${term}`) return true
      return false
    })
  })
}

if (resolvedGuards.length === 0) {
  return []
}

// 2. Branch between split mode and monolithic mode
if (options.split) {
  const guardsDir = path.join(outDir, 'guards')
  await fs.mkdir(guardsDir, { recursive: true })

  const indexJsLines: string[] = []
  const indexDtsLines: string[] = []

  for (const guard of resolvedGuards) {
    const fileBase = guard.typeName?.trim() || guard.name
    const rawJs: string = standaloneCodeFn(ajv, { [guard.name]: guard.name })
    const jsContent = rawJs.replace(
      /export const (\w+) = (\w+);/g,
      'export function $1(data, ...args) {\n  return $2(data, ...args);\n}',
    )

    const jsFilePath = path.join(guardsDir, `${fileBase}.js`)
    await fs.writeFile(jsFilePath, jsContent, 'utf8')
    artifacts.push({ filePath: jsFilePath, content: jsContent, kind: 'js' })

    if (generateDeclarations) {
      const dtsLines: string[] = []
      const tName = guard.typeName?.trim()
      if (tName && typeImportSpecifier) {
        dtsLines.push(`import type { ${tName} } from '${typeImportSpecifier}';\n`)
      }
      if (tName) {
        dtsLines.push(`export declare function ${guard.name}(data: unknown): data is ${tName};`)
      } else {
        dtsLines.push(`export declare function ${guard.name}(data: unknown): data is unknown;`)
      }
      const dtsContent = dtsLines.join('\n') + '\n'
      const dtsFilePath = path.join(guardsDir, `${fileBase}.d.ts`)
      await fs.writeFile(dtsFilePath, dtsContent, 'utf8')
      artifacts.push({ filePath: dtsFilePath, content: dtsContent, kind: 'dts' })
    }

    indexJsLines.push(`export * from './guards/${fileBase}.js';`)
    indexDtsLines.push(`export * from './guards/${fileBase}.js';`)
  }

  // Root barrel exports
  const indexJsPath = path.join(outDir, 'index.js')
  const indexJsContent = indexJsLines.join('\n') + '\n'
  await fs.writeFile(indexJsPath, indexJsContent, 'utf8')
  artifacts.push({ filePath: indexJsPath, content: indexJsContent, kind: 'js' })

  if (generateDeclarations) {
    const indexDtsPath = path.join(outDir, 'index.d.ts')
    const indexDtsContent = indexDtsLines.join('\n') + '\n'
    await fs.writeFile(indexDtsPath, indexDtsContent, 'utf8')
    artifacts.push({ filePath: indexDtsPath, content: indexDtsContent, kind: 'dts' })
  }

  return artifacts
}
```

### 4.3 CLI Command Update (`packages/codegen/src/cli/commands/generate.ts`)
- Add `split: { type: 'boolean', description: '개별 파일 분할 생성' }` to `generate.options`.
- In `runStandaloneGuards`:
  ```typescript
  const split = bool(args, 'split')
  const schemasRaw = optStr(args, 'schemas')
  const schemas = schemasRaw ? schemasRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined

  const generatorOptions: StandaloneGuardGeneratorOptions = {
    schemaDocument,
    outDir: resolve(process.cwd(), outDir),
    moduleFormat: moduleFormat ?? 'esm',
    split,
    schemas,
  }
  ```

---

## 5. Verification Method

### 5.1 Project Test Commands
1. **Targeted Standalone Guards Unit Tests**:
   ```bash
   pnpm --filter @oa-sdk/codegen test test/standalone-guards/
   ```
2. **E2E Standalone Guards Suite**:
   ```bash
   pnpm --filter @oa-sdk/codegen test test/e2e/standalone-guards.e2e.test.ts
   ```
3. **Full Codegen Package Tests**:
   ```bash
   pnpm --filter @oa-sdk/codegen test
   ```
4. **Monorepo Typecheck**:
   ```bash
   pnpm -r typecheck
   ```

### 5.2 Verification Checklist for Acceptance Criteria
- [ ] `oa-codegen generate --target standalone-guards --input <spec> --out-dir <dir> --split` produces `guards/<TypeName>.js` and `guards/<TypeName>.d.ts` for each component schema, plus root `index.js` and `index.d.ts` barrels.
- [ ] Direct dynamic import of individual split module (e.g. `guards/UserProfile.js`) executes standalone type validation with 0 missing dependency errors.
- [ ] `oa-codegen generate --target standalone-guards --input <spec> --out-dir <dir> --schemas isSurfaceBlock,isSurfaceParam` emits only `isSurfaceBlock` and `isSurfaceParam`.
- [ ] `oa-codegen generate --target standalone-guards --input <spec> --out-dir <dir> --split --schemas SurfaceBlock` emits only `guards/SurfaceBlock.js`, `guards/SurfaceBlock.d.ts`, and root `index.js`.
- [ ] Zero eval, zero new Function, zero runtime dependency invariants verified across all split `.js` files.
