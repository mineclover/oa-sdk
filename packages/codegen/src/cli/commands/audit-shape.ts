import type { Command } from '../lib/types.js';
import { optStr, bool } from '../lib/args.js';
import { CliExitError } from '../lib/errors.js';

export const auditShapeCommand: Command = {
  name: 'audit:shape',
  description: 'TypeScript AST 타입 형태 분류 및 TypeSpec/OpenAPI 투영 가능성 진단 감사',
  options: {
    bundle: {
      type: 'string',
      short: 'b',
      description: '번들 디렉토리 또는 TypeScript 파일 경로',
    },
    source: {
      type: 'string',
      short: 's',
      description: '단일 검사 대상 TypeScript 소스 파일 경로',
    },
    'fail-on-unsupported': {
      type: 'boolean',
      description: 'unsupported 타입 발견 시 exit 1 종료 (기본값: true)',
    },
    'no-fail-on-unsupported': {
      type: 'boolean',
      description: 'unsupported 타입이 있어도 exit 1로 종료하지 않음',
    },
    json: {
      type: 'boolean',
      description: '결과를 JSON 포맷으로 출력',
    },
  },
  async run(args) {
    const targetPath = optStr(args, 'bundle') ?? optStr(args, 'source') ?? optStr(args, 'file');
    if (!targetPath) {
      throw new Error('Target path must be specified via --bundle or --source');
    }

    const isJson = bool(args, 'json');
    const noFail = bool(args, 'no-fail-on-unsupported');
    const failOnUnsupported = !noFail && args['fail-on-unsupported'] !== false && args['failOnUnsupported'] !== false;

    // TypeScript 컴파일러를 끌어오는 스캔 로직은 이 커맨드를 실행할 때만 불러온다.
    const { auditShapeFiles } = await import('../lib/audit-shape-files.js');
    const result = auditShapeFiles(targetPath);

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('━━━ TypeScript Shape Feasibility Audit ━━━');
      console.log(`Target: ${targetPath}`);

      for (const diag of result.diagnostics) {
        const icon = diag.severity === 'error' ? '❌' : '⚠️';
        console.log(`  ${icon} [${diag.code}] ${diag.message}`);
        console.log(`     at ${diag.file}:${diag.line}:${diag.column}`);
        if (diag.snippet) {
          console.log(`     > ${diag.snippet}`);
        }
      }

      console.log(`\n${result.summary}`);
    }

    if (!result.valid && failOnUnsupported) {
      throw new CliExitError(1);
    }
  },
};

export { auditShapeCommand as auditShape };
export default auditShapeCommand;
