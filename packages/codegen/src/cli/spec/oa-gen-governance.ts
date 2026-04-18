import type { CliCommandManifest } from './ecs.js'

export const oaGenGovernanceManifest = {
  version: 1,
  namespace: 'oa-gen',
  commands: [
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
        ],
        inputs: [
          { name: 'base', kind: 'openapi-document', required: true, option: 'base' },
          { name: 'head', kind: 'openapi-document', required: true, option: 'head' },
          { name: 'artifact', kind: 'openapi-artifact', required: false, option: 'artifact' },
          { name: 'base-provenance', kind: 'openapi-provenance', required: false, option: 'base-provenance' },
          { name: 'head-provenance', kind: 'openapi-provenance', required: false, option: 'head-provenance' },
        ],
        checks: ['breaking-diff', 'head-validation', 'artifact-freshness'],
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
            name: 'composition-report',
            type: 'string',
            description: 'build-spec composition report JSON 경로',
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
          { name: 'composition-report', kind: 'composition-report', required: false, option: 'composition-report' },
          { name: 'duplicate-review', kind: 'duplicate-review-report', required: false, option: 'duplicate-review' },
        ],
        checks: ['breaking-diff', 'artifact-freshness', 'runtime-drift', 'inventory', 'composition', 'duplicate-review'],
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
