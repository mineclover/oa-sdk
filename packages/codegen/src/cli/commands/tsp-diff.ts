import type { Command, CommandContext } from '../lib/types.js'
import { bool, optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'

export const tspDiff: Command = {
  name: 'tsp diff',
  description: 'TypeSpec AST semantic diff and breaking change analyzer',
  options: {
    base: {
      type: 'string',
      required: true,
      description: 'Base TypeSpec source: .tsp file, directory, git ref, or <ref>:<path> '
        + '(e.g. origin/main, HEAD~1:main.tsp, path/to/main.tsp)',
    },
    head: {
      type: 'string',
      required: true,
      description: 'Head TypeSpec source, same forms as --base (e.g. path/to/main.tsp for the working tree, '
        + 'HEAD, HEAD:main.tsp). A git ref without a path, on either side, reads the other side\'s '
        + 'repository-relative entry point from its own commit',
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

    // TypeSpec 컴파일러(@typespec/*)는 이 커맨드에서만 쓰므로 실행할 때 불러온다.
    // 정적 import로 두면 oa-gen의 모든 커맨드 기동에 그 모듈 그래프 로드 비용이 붙는다.
    const [{ resolveTypeSpecDiffSources }, {
      diffTypeSpecPrograms,
      formatTypeSpecDiffMarkdown,
      formatTypeSpecDiffJson,
      hasBreakingChanges,
    }] = await Promise.all([
      import('../lib/typespec-ref-resolver.js'),
      import('../lib/typespec-ast-diff.js'),
    ])

    // 경로 없는 git ref(`--head HEAD`)는 반대쪽 진입점의 저장소 기준 경로를 자기 커밋에서 읽는다.
    // runCommand가 projectRoot로 chdir하므로, 상대 경로는 호출 디렉터리(context.cwd)부터 찾는다.
    const sources = await resolveTypeSpecDiffSources(baseRef, headRef, {
      projectRoot: rootDir,
      cwd: context?.cwd ?? process.cwd(),
    })

    try {
      // 같은 원본끼리 비교하면 결과는 항상 "변경 없음"이므로 조용히 통과시키지 않고 알린다.
      // stdout은 리포트(JSON 포함)만 담도록 stderr에 쓴다.
      if (sources.sameSourceNotice) {
        console.error(sources.sameSourceNotice)
      }

      const result = diffTypeSpecPrograms(sources.base.program, sources.head.program, {
        baseRef,
        headRef,
      })

      if (format === 'json') {
        console.log(formatTypeSpecDiffJson(result))
      } else {
        console.log(formatTypeSpecDiffMarkdown(result))
      }

      if (failOnBreaking && hasBreakingChanges(result)) {
        throw new CliExitError(1)
      }
    } finally {
      await sources.cleanup()
    }
  },
}

export default tspDiff
