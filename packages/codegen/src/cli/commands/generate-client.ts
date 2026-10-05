import { resolve, dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Command, CommandContext } from '../lib/types.js'
import { optStr, bool, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { loadSpecDocumentAsync } from '../lib/load-spec.js'
import { companionImporterFrom, requireCompanion } from '../lib/companion-packages.js'
import { writeOutput } from '../lib/output.js'

export const generateClientCommand: Command = {
  name: 'generate:client',
  description: 'OpenAPI 3.1/3.2 또는 TypeSpec(.tsp)으로부터 타입 안전 fetch 클라이언트 SDK 생성',
  options: {
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: 'OpenAPI 3.1/3.2 또는 TypeSpec(.tsp) 스펙 파일 경로',
    },
    output: {
      type: 'string',
      short: 'o',
      description: '출력 파일 경로 (생략 시 stdout)',
    },
    'types-import': {
      type: 'string',
      description: '생성된 TypeScript 타입 import 지정자 (예: ./types.js)',
    },
    banner: {
      type: 'boolean',
      description: '생성 헤더 배너 포함 여부 (기본값: true)',
    },
    pack: {
      type: 'boolean',
      description: '배포 가능한 단독 0-런타임 의존성 클라이언트 SDK 패키지(dist/ 포함) 빌드',
    },
    name: {
      type: 'string',
      description: '패키지 명칭 (package.json name, 기본: 디렉터리 이름)',
    },
    'package-version': {
      type: 'string',
      description: '패키지 버전 (package.json version, 기본: 0.1.0)',
    },
    description: {
      type: 'string',
      description: '패키지 설명 (package.json description)',
    },
  },
  async run(args, context) {
    const specArg = optStr(args, 'spec')
    if (!specArg) {
      console.error('오류: --spec <파일 경로> 옵션이 필요합니다')
      throw new CliExitError(1)
    }

    const isPack = bool(args, 'pack')
    const { generateClient } = await requireCompanion(isPack ? 'pack:client' : 'generate:client', {
      output: isPack ? 'the client SDK package' : 'the client SDK',
      importer: companionImporterFrom(context),
    })

    let loadedSpec: Awaited<ReturnType<typeof loadSpecDocumentAsync>>
    try {
      loadedSpec = await loadSpecDocumentAsync(specArg)
    } catch (err) {
      console.error(`스펙 로드 오류: ${err instanceof Error ? err.message : String(err)}`)
      throw new CliExitError(1)
    }

    const outputPath = optStr(args, 'output')

    if (isPack) {
      const outDir = resolve(process.cwd(), outputPath ?? './packages/api-client')
      const packageName = optStr(args, 'name') ?? outDir.split(/[/\\]/).pop() ?? 'api-client'
      const packageVersion = optStr(args, 'package-version') ?? '0.1.0'
      const packageDesc = optStr(args, 'description') ?? 'Auto-generated typed API Client SDK from OpenAPI specification'

      const srcDir = resolve(outDir, 'src')
      const distDir = resolve(outDir, 'dist')
      await mkdir(srcDir, { recursive: true })
      await mkdir(distDir, { recursive: true })

      const { generateTypesFromSpec } = await import('../../typegen/index.js')
      const typesCode = generateTypesFromSpec(loadedSpec.document as any, { basePath: loadedSpec.path })

      const clientCode = generateClient(loadedSpec.document as any, {
        banner: true,
        typesImport: './types.js',
        basePath: loadedSpec.path,
      })

      const indexCode = `// Auto-generated standalone API Client package entrypoint. Do not edit.\nexport * from './types.js'\nexport * from './client.js'\n`

      const typesPath = resolve(srcDir, 'types.ts')
      const clientPath = resolve(srcDir, 'client.ts')
      const indexPath = resolve(srcDir, 'index.ts')

      await writeFile(typesPath, typesCode, 'utf8')
      await writeFile(clientPath, clientCode, 'utf8')
      await writeFile(indexPath, indexCode, 'utf8')

      // Compile to dist/ via TypeScript Compiler API (zero external bundler dependencies)
      const ts = (await import('typescript')).default
      const compilerOptions: any = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        declaration: true,
        emitDeclarationOnly: false,
        outDir: distDir,
        rootDir: srcDir,
        strict: false,
        skipLibCheck: true,
        esModuleInterop: true,
      }

      const program = ts.createProgram([typesPath, clientPath, indexPath], compilerOptions)
      const emitResult = program.emit()
      if (emitResult.diagnostics.length > 0) {
        const errors = emitResult.diagnostics
          .filter(d => d.category === ts.DiagnosticCategory.Error)
          .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        if (errors.length > 0) {
          console.warn(`[oa-gen pack:client] TypeScript compiler warnings:\n${errors.join('\n')}`)
        }
      }

      const packageJson = {
        name: packageName,
        version: packageVersion,
        description: packageDesc,
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
        files: ['dist', 'README.md'],
        sideEffects: false,
        dependencies: {},
      }

      await writeFile(resolve(outDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

      const readmeContent = `# ${packageName}\n\nAuto-generated type-safe API Client SDK powered by [oa-sdk](https://github.com/mineclover/oa-sdk).\n\n- **Zero runtime dependencies**: Pure native \`fetch\` with streaming, AbortSignal cancellation, and typed error handling.\n- **Zero build tooling needed in consumer repository**: Pre-compiled ESM & TypeScript definitions ready to import.\n\n## Installation\n\n\`\`\`bash\nnpm install ${packageName}\n\`\`\`\n\n## Usage\n\n\`\`\`ts\nimport { createClient } from '${packageName}'\n\nconst client = createClient({\n  baseUrl: 'https://api.example.com',\n})\n\`\`\`\n`
      await writeFile(resolve(outDir, 'README.md'), readmeContent, 'utf8')

      console.log(`📦 Client SDK 패키지 빌드 완료: ${outDir}`)
      console.log(`   - Name: ${packageName}@${packageVersion}`)
      console.log(`   - Output: dist/index.js, dist/index.d.ts (0 runtime dependencies)`)
      return
    }

    const typesImport = optStr(args, 'types-import')
    const banner = bool(args, 'banner') !== false

    const code = generateClient(loadedSpec.document as any, {
      banner,
      ...(typesImport ? { typesImport } : {}),
      basePath: loadedSpec.path,
    })

    if (outputPath) {
      const resolvedOutput = resolve(process.cwd(), outputPath)
      await mkdir(dirname(resolvedOutput), { recursive: true })
      await writeFile(resolvedOutput, code, 'utf8')
      console.log(`✅ Client SDK 생성 완료: ${outputPath}`)
    } else {
      writeOutput(undefined, code, 'Client SDK')
    }
  },
}

export const packClientCommand: Command = {
  name: 'pack:client',
  description: 'OpenAPI 3.1/3.2 또는 TypeSpec(.tsp)으로부터 배포 가능한 단독 0-런타임 의존성 클라이언트 SDK 패키지(dist/ 포함) 빌드',
  options: generateClientCommand.options,
  async run(args, context) {
    return generateClientCommand.run({ ...args, pack: true }, context)
  },
}

