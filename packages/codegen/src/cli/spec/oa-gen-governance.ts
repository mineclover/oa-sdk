import type { CliCommandManifest } from './ecs.js'

export const oaGenGovernanceManifest = {
  version: 1,
  namespace: 'oa-gen',
  commands: [
    {
      id: 'build-spec',
      kind: 'command',
      name: 'build-spec',
      summary: 'Definition Builder target OpenAPI artifact와 sidecar 생성',
      components: {
        options: [
          {
            name: 'target',
            type: 'string',
            short: 't',
            required: true,
            description: 'target config 파일 경로',
          },
          {
            name: 'fragments',
            type: 'string',
            description: 'definition fragments 디렉토리 (기본: target sibling ../fragments)',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: '빌드된 OpenAPI YAML 출력 파일 경로',
          },
          {
            name: 'diagnostics',
            type: 'string',
            description: 'builder diagnostics JSON 출력 파일 경로',
          },
          {
            name: 'collision-report',
            type: 'string',
            description: 'machine-readable output name collision report JSON 출력 파일 경로',
          },
          {
            name: 'composition-report',
            type: 'string',
            description: 'machine-readable target composition report JSON 출력 파일 경로',
          },
          {
            name: 'provenance',
            type: 'string',
            description: 'machine-readable output pointer provenance map JSON 출력 파일 경로',
          },
          {
            name: 'metadata-registry',
            type: 'string',
            description: 'machine-readable internal metadata registry JSON 출력 파일 경로',
          },
          {
            name: 'behavior-log',
            type: 'string',
            description: 'append-only behavior JSONL 출력 파일 경로',
          },
          {
            name: 'behavior-db',
            type: 'string',
            description: 'append-only behavior SQLite DB 파일 경로',
          },
        ],
        inputs: [
          { name: 'target', kind: 'definition-target', required: true, option: 'target' },
          { name: 'fragments', kind: 'definition-fragments', required: false, option: 'fragments' },
        ],
        checks: ['composition', 'metadata-registry'],
        reports: [
          { formats: ['human'], schema: 'oa-gen.build-spec.human.v1' },
          { formats: ['json'], schema: 'oa-gen.build-spec.diagnostics.v1' },
          { formats: ['json'], schema: 'oa-gen.build-spec.collision-report.v1' },
          { formats: ['json'], schema: 'oa-gen.composition-report.v1' },
          { formats: ['json'], schema: 'oa-gen.build-spec.provenance.v1' },
          { formats: ['json'], schema: 'oa-gen.metadata-registry.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'validate',
      kind: 'command',
      name: 'validate',
      summary: '종합 검증 (파싱 + 린트 + 3.1 호환)',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: 'OAS spec 파일 경로',
          },
          {
            name: 'require-32',
            type: 'boolean',
            description: '관리 대상 계약으로 OpenAPI 3.2.x 버전을 강제',
          },
          {
            name: 'incremental',
            type: 'boolean',
            description: 'SQLite workspace index를 사용해 변경 감지/무효화를 수행',
          },
          {
            name: 'cache-dir',
            type: 'string',
            description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
        ],
        checks: ['head-validation'],
        reports: [
          { formats: ['human'], schema: 'oa-gen.validate.human.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'normalize',
      kind: 'command',
      name: 'normalize',
      summary: '외부 OpenAPI 산출물 정규화',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: '정규화할 OpenAPI YAML/JSON 경로',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: '정규화된 OpenAPI YAML 출력 경로 (기본: stdout)',
          },
          {
            name: 'profile',
            type: 'string',
            description: 'generic | nestjs-swagger | fastapi (기본: generic)',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
        ],
        checks: [],
        reports: [
          { formats: ['human'], schema: 'oa-gen.normalize.human.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'upgrade',
      kind: 'command',
      name: 'upgrade',
      summary: 'OpenAPI 3.0/3.1 산출물을 OpenAPI 3.2 분석 artifact로 변환',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: '업그레이드할 OpenAPI YAML/JSON 경로',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: 'OpenAPI 3.2 YAML 출력 경로 (기본: stdout)',
          },
          {
            name: 'report',
            type: 'string',
            description: '변환 리포트 JSON 출력 경로',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
        ],
        checks: [],
        reports: [
          { formats: ['human'], schema: 'oa-gen.upgrade.human.v1' },
          { formats: ['json'], schema: 'oa-gen.openapi-upgrade-report.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'collect',
      kind: 'command',
      name: 'collect',
      summary: '외부 OpenAPI 산출물 수집 scaffold: raw 보존, normalize, 3.2 upgrade',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: '수집할 OpenAPI YAML/JSON 경로',
          },
          {
            name: 'raw',
            type: 'string',
            description: '원본 산출물 복사 경로',
          },
          {
            name: 'normalized',
            type: 'string',
            required: true,
            description: 'stable governance artifact 출력 경로',
          },
          {
            name: 'upgraded',
            type: 'string',
            required: true,
            description: 'OpenAPI 3.2 분석 artifact 출력 경로',
          },
          {
            name: 'report',
            type: 'string',
            description: '수집/변환 리포트 JSON 출력 경로',
          },
          {
            name: 'profile',
            type: 'string',
            description: 'generic | nestjs-swagger | fastapi (기본: generic)',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
        ],
        checks: [],
        reports: [
          { formats: ['human'], schema: 'oa-gen.collect.human.v1' },
          { formats: ['json'], schema: 'oa-gen.openapi-collect-report.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'tsp-export',
      kind: 'command',
      name: 'tsp-export',
      summary: 'OpenAPI artifact를 TypeSpec spike source와 diagnostics로 변환',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: 'TypeSpec으로 변환할 OpenAPI YAML/JSON 경로',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: '생성할 .tsp 파일 경로 (기본: stdout)',
          },
          {
            name: 'report',
            type: 'string',
            description: '변환 diagnostics JSON 출력 경로',
          },
          {
            name: 'sidecar',
            type: 'string',
            description: 'TypeSpec projection 밖에 남길 OA SDK compatibility sidecar JSON 출력 경로',
          },
          {
            name: 'bundle-manifest',
            type: 'string',
            description: '생성한 .tsp와 sidecar를 묶는 oa-sdk.typespec-bundle.v1 manifest JSON 출력 경로',
          },
          {
            name: 'bundle-expected-openapi',
            type: 'string',
            description: 'bundle manifest expectedOpenapi로 연결할 OpenAPI YAML 출력 경로',
          },
          {
            name: 'namespace',
            type: 'string',
            description: '생성할 TypeSpec namespace 이름',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
        ],
        checks: [],
        reports: [
          { formats: ['text'], schema: 'oa-gen.tsp-export.source.v1' },
          { formats: ['json'], schema: 'oa-gen.tsp-export-report.v1' },
          { formats: ['json'], schema: 'oa-sdk.typespec-compat-sidecar.v1' },
          { formats: ['json'], schema: 'oa-sdk.typespec-bundle.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'tsp-restore',
      kind: 'command',
      name: 'tsp-restore',
      summary: 'TypeSpec emitted OpenAPI artifact에 OA SDK compatibility sidecar를 재적용',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: 'sidecar를 적용할 TypeSpec emitted OpenAPI YAML/JSON 경로',
          },
          {
            name: 'sidecar',
            type: 'string',
            required: true,
            description: 'oa-sdk.typespec-compat-sidecar.v1 JSON 경로',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: '복원된 OpenAPI YAML 출력 경로 (기본: stdout)',
          },
          {
            name: 'report',
            type: 'string',
            description: 'sidecar restore report JSON 출력 경로',
          },
          {
            name: 'stability-report',
            type: 'string',
            description: '복원 후 재추출한 sidecar semantic stability report JSON 출력 경로',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
          { name: 'sidecar', kind: 'typespec-compatibility-sidecar', required: true, option: 'sidecar' },
        ],
        checks: ['typespec-sidecar-restore', 'typespec-sidecar-stability'],
        reports: [
          { formats: ['human'], schema: 'oa-gen.tsp-restore.human.v1' },
          { formats: ['json'], schema: 'oa-sdk.typespec-compat-restore-report.v1' },
          { formats: ['json'], schema: 'oa-sdk.typespec-compat-compare-report.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'tsp-bundle-check',
      kind: 'command',
      name: 'tsp-bundle-check',
      summary: 'TypeSpec bundle manifest를 compile/restore/validation/diff 루프로 검증',
      components: {
        options: [
          {
            name: 'project',
            type: 'string',
            description: 'TypeSpec bundle project directory (default: authored fixture or manifest directory)',
          },
          {
            name: 'manifest',
            type: 'string',
            description: 'oa-sdk.typespec-bundle.v1 manifest JSON path',
          },
          {
            name: 'sidecar',
            type: 'string',
            description: 'override oa-sdk.typespec-compat-sidecar.v1 JSON path',
          },
          {
            name: 'expected',
            type: 'string',
            description: 'override expected OpenAPI YAML/JSON path',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: 'restored OpenAPI YAML output path',
          },
          {
            name: 'report',
            type: 'string',
            description: 'bundle check report JSON output path',
          },
          {
            name: 'keep',
            type: 'boolean',
            description: 'keep temporary TypeSpec compile workspace',
          },
          {
            name: 'fail-on-breaking',
            type: 'boolean',
            description: 'fail when expected restored OpenAPI diff has breaking changes',
          },
        ],
        inputs: [
          { name: 'project', kind: 'typespec-project', required: false, option: 'project' },
          { name: 'manifest', kind: 'typespec-bundle-manifest', required: false, option: 'manifest' },
          { name: 'sidecar', kind: 'typespec-compatibility-sidecar', required: false, option: 'sidecar' },
          { name: 'expected', kind: 'openapi-document', required: false, option: 'expected' },
        ],
        checks: ['typespec-bundle-check', 'typespec-sidecar-restore', 'typespec-sidecar-stability', 'breaking-diff'],
        reports: [
          { formats: ['human'], schema: 'oa-gen.tsp-bundle-check.human.v1' },
          { formats: ['json'], schema: 'oa-sdk.typespec-bundle-check-report.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'scaffold-governance',
      kind: 'command',
      name: 'scaffold-governance',
      summary: '외부 OpenAPI 서비스용 governance interface/config/scripts scaffold 생성',
      components: {
        options: [
          {
            name: 'root',
            type: 'string',
            required: true,
            description: '스캐폴드를 생성할 서비스 루트 디렉토리',
          },
          {
            name: 'service',
            type: 'string',
            required: true,
            description: '서비스 이름',
          },
          {
            name: 'profile',
            type: 'string',
            description: 'generic | nestjs-swagger | fastapi (기본: generic)',
          },
          {
            name: 'source-command',
            type: 'string',
            description: 'raw OpenAPI artifact를 생성하는 명령. 예: pnpm export:openapi',
          },
          {
            name: 'runtime-openapi-url',
            type: 'string',
            description: 'runtime drift 확인용 OpenAPI URL',
          },
          {
            name: 'force',
            type: 'boolean',
            description: '기존 scaffold 파일 덮어쓰기',
          },
        ],
        inputs: [],
        checks: [],
        reports: [
          { formats: ['human'], schema: 'oa-gen.scaffold-governance.human.v1' },
          { formats: ['json'], schema: 'oa-gen.openapi-governance.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'inventory',
      kind: 'command',
      name: 'inventory',
      summary: 'OpenAPI path/component/security surface inventory 리포트',
      components: {
        options: [
          {
            name: 'spec',
            type: 'string',
            short: 's',
            required: true,
            description: 'inventory를 생성할 OpenAPI YAML/JSON 또는 target artifact 경로',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'markdown | json (기본: markdown)',
          },
        ],
        inputs: [
          { name: 'spec', kind: 'openapi-document', required: true, option: 'spec' },
        ],
        checks: ['inventory'],
        reports: [
          { formats: ['markdown', 'json'], schema: 'oa-gen.inventory.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'behavior-query',
      kind: 'command',
      name: 'behavior-query',
      summary: 'behavior SQLite projection 조회',
      components: {
        options: [
          {
            name: 'behavior-db',
            type: 'string',
            required: true,
            description: 'behavior SQLite DB 파일 경로',
          },
          {
            name: 'mode',
            type: 'string',
            required: true,
            description: 'recent | recent-failures | latest-failure-by-type | latest-by-type | latest-by-identity | latest-by-target | latest-by-decision-signal | latest-by-recommendation | summary-by-type | summary-by-status | summary-by-target-type | summary-by-behavior-status | summary-by-behavior-decision-signal | summary-by-decision-signal | summary-by-recommendation',
          },
          {
            name: 'behavior-type',
            type: 'string',
            description: 'latest-by-type 또는 latest-failure-by-type 조회용 behavior type',
          },
          {
            name: 'identity-key',
            type: 'string',
            description: 'latest-by-identity 조회용 identity key',
          },
          {
            name: 'target-type',
            type: 'string',
            description: 'latest-by-target 조회용 target type',
          },
          {
            name: 'target-key',
            type: 'string',
            description: 'latest-by-target 조회용 target key',
          },
          {
            name: 'decision-signal',
            type: 'string',
            description: 'latest-by-decision-signal 조회용 또는 exact match filter',
          },
          {
            name: 'recommendation',
            type: 'string',
            description: 'latest-by-recommendation 조회용 recommendation',
          },
          {
            name: 'status',
            type: 'string',
            description: 'recent/recent-failures filter 또는 status exact match',
          },
          {
            name: 'limit',
            type: 'string',
            description: 'recent / recent-failures 조회 개수 제한 (기본: 20)',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'markdown | json (기본: markdown)',
          },
        ],
        inputs: [
          { name: 'behavior-db', kind: 'behavior-store', required: true, option: 'behavior-db' },
        ],
        checks: ['behavior-query'],
        reports: [
          { formats: ['markdown', 'json'], schema: 'oa-gen.behavior-query.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'duplicate-review',
      kind: 'command',
      name: 'duplicate-review',
      summary: 'Definition fragments duplicate identity risk 리포트',
      components: {
        options: [
          {
            name: 'fragments',
            type: 'string',
            required: true,
            description: 'definition fragments 디렉토리',
          },
          {
            name: 'target',
            type: 'string',
            short: 't',
            description: 'target-local output name collision을 확인할 Definition Builder target config 경로',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'markdown | json (기본: markdown)',
          },
        ],
        inputs: [
          { name: 'fragments', kind: 'definition-fragments', required: true, option: 'fragments' },
          { name: 'target', kind: 'definition-target', required: false, option: 'target' },
        ],
        checks: ['duplicate-review'],
        reports: [
          { formats: ['markdown', 'json'], schema: 'oa-gen.duplicate-review.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'target-check',
      kind: 'command',
      name: 'target-check',
      summary: 'target OpenAPI path surface 포함/제외 assertion 검증',
      components: {
        options: [
          {
            name: 'target',
            type: 'string',
            short: 't',
            description: 'Definition Builder target config 경로',
          },
          {
            name: 'artifact',
            type: 'string',
            description: '검증할 generated OpenAPI artifact YAML/JSON 경로',
          },
          {
            name: 'fragments',
            type: 'string',
            description: 'definition fragments 디렉토리 (기본: target sibling ../fragments)',
          },
          {
            name: 'must-include-path',
            type: 'string',
            description: 'emitted OpenAPI paths에 반드시 포함되어야 하는 path assertion (반복 가능)',
          },
          {
            name: 'must-exclude-path',
            type: 'string',
            description: 'emitted OpenAPI paths에 포함되면 안 되는 path assertion (반복 가능)',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'markdown | json (기본: markdown)',
          },
        ],
        inputs: [
          { name: 'target', kind: 'definition-target', required: false, option: 'target' },
          { name: 'artifact', kind: 'openapi-artifact', required: false, option: 'artifact' },
          { name: 'fragments', kind: 'definition-fragments', required: false, option: 'fragments' },
        ],
        checks: ['target-coverage'],
        reports: [
          { formats: ['markdown', 'json'], schema: 'oa-gen.target-coverage.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'diff',
      kind: 'command',
      name: 'diff',
      summary: 'OpenAPI base/head endpoint 변경과 breaking change 분류',
      components: {
        options: [
          {
            name: 'base',
            type: 'string',
            required: true,
            description: 'base OpenAPI YAML/JSON 경로',
          },
          {
            name: 'head',
            type: 'string',
            required: true,
            description: 'head OpenAPI YAML/JSON 경로',
          },
          {
            name: 'fail-on-breaking',
            type: 'boolean',
            description: 'breaking change가 있으면 non-zero 종료',
          },
        ],
        inputs: [
          { name: 'base', kind: 'openapi-document', required: true, option: 'base' },
          { name: 'head', kind: 'openapi-document', required: true, option: 'head' },
        ],
        checks: ['breaking-diff'],
        reports: [
          { formats: ['markdown'], schema: 'oa-gen.diff.markdown.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'check-artifact',
      kind: 'command',
      name: 'check-artifact',
      summary: 'generated OpenAPI artifact freshness 확인',
      components: {
        options: [
          {
            name: 'head',
            type: 'string',
            required: true,
            description: 'head OpenAPI YAML/JSON 경로',
          },
          {
            name: 'artifact',
            type: 'string',
            required: true,
            description: 'head와 비교할 generated OpenAPI artifact 경로',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'human | json (기본: human)',
          },
          {
            name: 'target',
            type: 'string',
            description: 'Definition Builder target config 경로',
          },
          {
            name: 'fragments',
            type: 'string',
            description: 'definition fragments 디렉토리 (기본: target sibling ../fragments)',
          },
        ],
        inputs: [
          { name: 'head', kind: 'openapi-document', required: true, option: 'head' },
          { name: 'artifact', kind: 'openapi-artifact', required: true, option: 'artifact' },
        ],
        checks: ['artifact-freshness'],
        reports: [
          { formats: ['human', 'json'], schema: 'oa-gen.artifact-freshness.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'drift',
      kind: 'command',
      name: 'drift',
      summary: 'runtime OpenAPI와 managed OpenAPI drift 비교',
      components: {
        options: [
          {
            name: 'runtime-openapi',
            type: 'string',
            description: 'runtime OpenAPI YAML/JSON 경로',
          },
          {
            name: 'runtime-openapi-url',
            type: 'string',
            description: 'runtime OpenAPI YAML/JSON URL',
          },
          {
            name: 'runtime-header',
            type: 'string',
            description: 'runtime OpenAPI URL fetch에 추가할 HTTP header. 예: "Authorization: Bearer $TOKEN" (반복 가능)',
          },
          {
            name: 'managed-openapi',
            type: 'string',
            required: true,
            description: 'managed OpenAPI YAML/JSON 경로',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'text | json | markdown (기본: text)',
          },
          {
            name: 'behavior-log',
            type: 'string',
            description: 'append-only behavior JSONL 출력 파일 경로',
          },
          {
            name: 'behavior-db',
            type: 'string',
            description: 'append-only behavior SQLite DB 파일 경로',
          },
        ],
        inputs: [
          { name: 'runtime-openapi', kind: 'runtime-openapi', required: false, option: 'runtime-openapi' },
          { name: 'runtime-openapi-url', kind: 'runtime-openapi', required: false, option: 'runtime-openapi-url' },
          { name: 'managed-openapi', kind: 'openapi-document', required: true, option: 'managed-openapi' },
        ],
        checks: ['runtime-drift'],
        reports: [
          { formats: ['text', 'json', 'markdown'], schema: 'oa-gen.drift.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'review',
      kind: 'command',
      name: 'review',
      summary: 'OpenAPI 변경 리뷰 리포트 (diff + validate + artifact freshness)',
      components: {
        options: [
          {
            name: 'base',
            type: 'string',
            required: true,
            description: 'base OpenAPI YAML/JSON 경로',
          },
          {
            name: 'head',
            type: 'string',
            required: true,
            description: 'head OpenAPI YAML/JSON 경로',
          },
          {
            name: 'artifact',
            type: 'string',
            description: 'head와 비교할 generated OpenAPI artifact 경로',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'markdown | json (기본: markdown)',
          },
          {
            name: 'output',
            type: 'string',
            short: 'o',
            description: '리포트 출력 파일 경로 (기본: stdout)',
          },
          {
            name: 'target',
            type: 'string',
            description: 'Definition Builder target config 경로',
          },
          {
            name: 'fragments',
            type: 'string',
            description: 'definition fragments 디렉토리 (기본: target sibling ../fragments)',
          },
          {
            name: 'base-provenance',
            type: 'string',
            description: 'base OpenAPI provenance sidecar JSON 경로',
          },
          {
            name: 'head-provenance',
            type: 'string',
            description: 'head OpenAPI provenance sidecar JSON 경로',
          },
          {
            name: 'base-metadata-registry',
            type: 'string',
            description: 'base OpenAPI metadata registry sidecar JSON 경로',
          },
          {
            name: 'head-metadata-registry',
            type: 'string',
            description: 'head OpenAPI metadata registry sidecar JSON 경로',
          },
          {
            name: 'behavior-log',
            type: 'string',
            description: 'append-only behavior JSONL 출력 파일 경로',
          },
          {
            name: 'behavior-db',
            type: 'string',
            description: 'append-only behavior SQLite DB 파일 경로',
          },
        ],
        inputs: [
          { name: 'base', kind: 'openapi-document', required: true, option: 'base' },
          { name: 'head', kind: 'openapi-document', required: true, option: 'head' },
          { name: 'artifact', kind: 'openapi-artifact', required: false, option: 'artifact' },
          { name: 'base-provenance', kind: 'openapi-provenance', required: false, option: 'base-provenance' },
          { name: 'head-provenance', kind: 'openapi-provenance', required: false, option: 'head-provenance' },
          { name: 'base-metadata-registry', kind: 'metadata-registry-report', required: false, option: 'base-metadata-registry' },
          { name: 'head-metadata-registry', kind: 'metadata-registry-report', required: false, option: 'head-metadata-registry' },
        ],
        checks: ['breaking-diff', 'head-validation', 'artifact-freshness', 'metadata-registry'],
        reports: [
          { formats: ['markdown', 'json'], schema: 'oa-gen.review-report.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
    {
      id: 'review-bundle',
      kind: 'command',
      name: 'review-bundle',
      summary: 'PR용 OpenAPI review bundle 리포트',
      components: {
        options: [
          {
            name: 'base',
            type: 'string',
            required: true,
            description: 'base OpenAPI YAML/JSON 경로',
          },
          {
            name: 'head',
            type: 'string',
            required: true,
            description: 'head OpenAPI YAML/JSON 경로',
          },
          {
            name: 'artifact',
            type: 'string',
            required: true,
            description: 'head와 비교할 generated OpenAPI artifact 경로',
          },
          {
            name: 'inventory',
            type: 'boolean',
            description: 'head OpenAPI inventory section을 포함',
          },
          {
            name: 'runtime-drift',
            type: 'string',
            description: 'oa-gen drift --format json 출력 파일 경로',
          },
          {
            name: 'behavior-log',
            type: 'string',
            description: 'append-only behavior JSONL 출력 파일 경로',
          },
          {
            name: 'behavior-db',
            type: 'string',
            description: 'append-only behavior SQLite DB 파일 경로',
          },
          {
            name: 'base-provenance',
            type: 'string',
            description: 'base OpenAPI provenance sidecar JSON 경로',
          },
          {
            name: 'head-provenance',
            type: 'string',
            description: 'head OpenAPI provenance sidecar JSON 경로',
          },
          {
            name: 'composition-report',
            type: 'string',
            description: 'build-spec composition report JSON 경로',
          },
          {
            name: 'metadata-registry',
            type: 'string',
            description: 'build-spec metadata registry JSON 경로',
          },
          {
            name: 'base-metadata-registry',
            type: 'string',
            description: 'base OpenAPI metadata registry sidecar JSON 경로',
          },
          {
            name: 'head-metadata-registry',
            type: 'string',
            description: 'head OpenAPI metadata registry sidecar JSON 경로',
          },
          {
            name: 'duplicate-review',
            type: 'string',
            description: 'oa-gen duplicate-review --format json 출력 파일 경로',
          },
          {
            name: 'format',
            type: 'string',
            short: 'f',
            description: 'markdown | json (기본: markdown)',
          },
        ],
        inputs: [
          { name: 'base', kind: 'openapi-document', required: true, option: 'base' },
          { name: 'head', kind: 'openapi-document', required: true, option: 'head' },
          { name: 'artifact', kind: 'openapi-artifact', required: true, option: 'artifact' },
          { name: 'runtime-drift', kind: 'runtime-drift-report', required: false, option: 'runtime-drift' },
          { name: 'base-provenance', kind: 'openapi-provenance', required: false, option: 'base-provenance' },
          { name: 'head-provenance', kind: 'openapi-provenance', required: false, option: 'head-provenance' },
          { name: 'composition-report', kind: 'composition-report', required: false, option: 'composition-report' },
          { name: 'metadata-registry', kind: 'metadata-registry-report', required: false, option: 'metadata-registry' },
          { name: 'base-metadata-registry', kind: 'metadata-registry-report', required: false, option: 'base-metadata-registry' },
          { name: 'head-metadata-registry', kind: 'metadata-registry-report', required: false, option: 'head-metadata-registry' },
          { name: 'duplicate-review', kind: 'duplicate-review-report', required: false, option: 'duplicate-review' },
        ],
        checks: ['breaking-diff', 'artifact-freshness', 'runtime-drift', 'inventory', 'composition', 'metadata-registry', 'duplicate-review'],
        reports: [
          { formats: ['markdown', 'json'], schema: 'oa-gen.review-bundle.v1' },
        ],
        exitPolicy: {
          success: ['APPROVE', 'COMMENT'],
          failure: ['REQUEST_CHANGES'],
        },
      },
    },
  ],
} satisfies CliCommandManifest
