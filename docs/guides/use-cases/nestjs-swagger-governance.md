# Use Case: NestJS Swagger → oa-sdk Governance

NestJS Swagger(code-first)가 자동 생성한 OpenAPI spec을 oa-sdk 도구로 검증·추적·타입 생성하는 패턴. FastAPI 변형은 [`apps/fastapi-ref/`](../../../apps/fastapi-ref/)와 동일 파이프라인을 사용한다 — `oa-gen scaffold-governance --profile fastapi`만 다르고 나머지 흐름은 그대로다.

레퍼런스 구현: [`apps/nestjs-ref/`](../../../apps/nestjs-ref/), [`apps/fastapi-ref/`](../../../apps/fastapi-ref/)

---

## 역할 분리

NestJS는 데코레이터로 스펙을 **생성**하고, oa-sdk는 그 스펙을 **계약**으로 관리한다.

| 역할 | 담당 |
|---|---|
| API 구현 및 스펙 생성 | NestJS + `@nestjs/swagger` |
| 수집/정규화/3.2 파생 | `oa-gen collect --profile nestjs-swagger` |
| Baseline 관리·변경 추적 | `contracts/v1.openapi.yaml` (git 커밋, normalized 기준) |
| Breaking change 감지 | `oa-gen review` |
| Freshness 검증 | `oa-gen check-artifact` |
| 런타임 drift 검출 | `oa-gen drift` |
| TypeScript 타입 생성 | `oa-gen typegen` |

> **spec-lens 제외**: spec-lens는 Definition Builder fragment 기반으로 설계되어 단일 NestJS 스펙 파일에는 적용할 수 없다. NestJS 변경 이력 추적은 `contracts/` 디렉터리를 git으로 관리하고 PR마다 `oa-gen review`를 실행하는 방식으로 대체한다.

---

## 통합 구조

```
NestJS 앱 (code-first)
├── src/
│   ├── users/dto/user.dto.ts        @ApiProperty 데코레이터
│   ├── users/users.controller.ts    @ApiOperation, @ApiResponse
│   └── health/health.controller.ts
│
├── scripts/
│   ├── export-openapi.ts            ← NestJS 앱 컨텍스트로 스펙 추출
│   └── openapi-governance.sh        ← scaffold가 만든 collect/check/review/review-bundle/typegen/inventory/validate-upgraded/drift/update-baseline/ci/all 표준 진입점
│
└── contracts/
    ├── v1.openapi.yaml              ← committed baseline (git 관리)
    ├── openapi.raw.yaml             ← NestJS 원본 산출물 (gitignore 권장)
    ├── openapi.normalized.yaml      ← stable governance artifact (gitignore 권장)
    └── openapi.upgraded.yaml        ← OpenAPI 3.2 분석 artifact (gitignore 권장)
```

새 서비스는 이 구조를 직접 만들지 않고 스캐폴드 명령으로 생성한다.

```bash
oa-gen scaffold-governance \
  --root apps/nestjs-ref \
  --service nestjs-ref \
  --profile nestjs-swagger \
  --source-command "pnpm export:openapi" \
  --runtime-openapi-url http://localhost:3000/openapi.json
```

스캐폴드는 다음 파일을 만든다.

- `openapi-governance.config.json`: oa-sdk 기능별 artifact interface.
- `scripts/openapi-governance.sh`: collect/check/review/review-bundle/typegen/inventory/validate-upgraded/drift/update-baseline/ci/all 실행 표준 스크립트.
- `openapi-governance.md`: 서비스별 governance 설정 문서.
- `.github/workflows/openapi-governance.yml`: `ci` 단계를 실행하는 GitHub Actions workflow 템플릿(아래 [CI 통합 예시](#ci-통합-예시)).

---

## Step 1: NestJS Swagger 설정

`src/main.ts`에서 `SwaggerModule`을 설정한다. `jsonDocumentUrl` 옵션으로 `/openapi.json` 엔드포인트를 노출한다.

```typescript
import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const config = new DocumentBuilder()
    .setTitle('My API')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',   // drift 명령의 --runtime-openapi-url 타겟
  })

  await app.listen(3000)
}
```

`PartialType`은 `@nestjs/swagger`에서 임포트해야 Swagger 스키마가 올바르게 생성된다.

```typescript
// update-user.dto.ts
import { PartialType } from '@nestjs/swagger'  // ← @nestjs/mapped-types 아님
import { CreateUserDto } from './create-user.dto'

export class UpdateUserDto extends PartialType(CreateUserDto) {}
```

---

## Step 2: 스펙 추출 스크립트

HTTP listen 없이 NestJS 앱 컨텍스트만 초기화하여 swagger 문서를 파일로 추출한다.

```typescript
// scripts/export-openapi.ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dump as yamlDump } from 'js-yaml'
import { AppModule } from '../src/app.module'

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false })

  const config = new DocumentBuilder()
    .setTitle('My API').setVersion('1.0').addBearerAuth().build()

  const document = SwaggerModule.createDocument(app, config)
  await app.close()   // HTTP listen 없이 컨텍스트 해제

  mkdirSync('contracts', { recursive: true })
  writeFileSync('contracts/openapi.raw.yaml', yamlDump(document, { indent: 2, noRefs: true }))
  writeFileSync('contracts/openapi.raw.json', JSON.stringify(document, null, 2))
}

main().catch(err => { console.error(err); process.exit(1) })
```

```bash
pnpm export:openapi
# ✓ contracts/openapi.raw.yaml
# ✓ contracts/openapi.raw.json
```

---

## Step 3: 수집 산출물 정규화/업그레이드

NestJS Swagger는 OpenAPI 3.0.0을 생성한다. oa-sdk의 3.2 중심 분석과 안정적인 diff를 위해 raw 산출물을 바로 baseline으로 쓰지 않고 collection layer를 통과시킨다.

```bash
oa-gen collect \
  --spec contracts/openapi.raw.yaml \
  --normalized contracts/openapi.normalized.yaml \
  --upgraded contracts/openapi.upgraded.yaml \
  --report contracts/openapi.collect-report.json \
  --profile nestjs-swagger
```

- `openapi.normalized.yaml`: 의미를 바꾸지 않는 stable governance artifact. baseline/review/typegen 기준.
- `openapi.upgraded.yaml`: OpenAPI 3.2 분석 artifact. `nullable` 같은 3.0 표현은 JSON Schema null union으로 변환한다.
- `openapi.collect-report.json`: pointer별 변환/경고 리포트.

`openapi-governance.config.json`의 `consumers` 필드는 oa-sdk 기능이 어떤 artifact를 읽어야 하는지 고정한다.

```json
{
  "consumers": {
    "governance": "artifacts.normalized",
    "review": "artifacts.normalized",
    "typegen": "artifacts.normalized",
    "inventory": "artifacts.upgraded",
    "validate": "artifacts.upgraded",
    "driftManaged": "artifacts.normalized"
  }
}
```

---

## Step 4: Baseline과 Freshness 비교

`contracts/v1.openapi.yaml`을 커밋된 baseline으로 두고 최신 생성 결과와 비교한다.

```bash
oa-gen check-artifact \
  --head contracts/openapi.normalized.yaml \
  --artifact contracts/v1.openapi.yaml \
  --format human
```

- 동일하면 0으로 종료.
- 차이가 있으면 non-zero — CI에서 "baseline 업데이트가 필요하다"는 신호로 사용.

---

## Step 5: Breaking Change 리뷰

```bash
oa-gen review \
  --base contracts/v1.openapi.yaml \
  --head contracts/openapi.normalized.yaml \
  --format markdown
```

`REQUEST_CHANGES` 권고가 나오면 팀 리뷰 후 baseline 갱신 또는 코드 롤백.

```bash
# 의도된 변경이면 baseline 갱신
cp contracts/openapi.normalized.yaml contracts/v1.openapi.yaml
git add contracts/v1.openapi.yaml
git commit -m "api: update openapi baseline to v1.1"
```

---

## Step 6: TypeScript 타입 생성

```bash
oa-gen typegen \
  --spec contracts/openapi.normalized.yaml \
  --output src/generated/api-types.ts
```

생성된 타입은 소비자(클라이언트, SDK)가 임포트해 사용한다. `src/generated/` 디렉터리는 gitignore하거나, CI에서 생성 후 artifact로 배포한다.

---

## Step 7: 런타임 Drift 확인

서버를 실행 중인 상태에서 실제 응답하는 OpenAPI와 baseline을 비교한다.

```bash
oa-gen drift \
  --runtime-openapi-url http://localhost:3000/openapi.json \
  --managed-openapi contracts/v1.openapi.yaml \
  --format markdown
```

Drift 발생 시나리오:
- 데코레이터를 추가했지만 baseline을 아직 업데이트하지 않은 상태
- 다른 팀이 데코레이터를 변경했지만 governance 파이프라인을 거치지 않은 경우

인증이 필요한 엔드포인트는 `--runtime-header` 옵션을 사용한다.

```bash
oa-gen drift \
  --runtime-openapi-url https://api.staging.example.com/openapi.json \
  --runtime-header "Authorization: Bearer $STAGING_TOKEN" \
  --managed-openapi contracts/v1.openapi.yaml
```

---

## 전체 파이프라인 스크립트

```bash
#!/usr/bin/env bash
set -euo pipefail

BASELINE="contracts/v1.openapi.yaml"
RAW="contracts/openapi.raw.yaml"
NORMALIZED="contracts/openapi.normalized.yaml"
UPGRADED="contracts/openapi.upgraded.yaml"

echo "▶ 1. Export"
pnpm export:openapi

echo "▶ 2. Collect"
oa-gen collect \
  --spec "$RAW" \
  --normalized "$NORMALIZED" \
  --upgraded "$UPGRADED" \
  --profile nestjs-swagger

echo "▶ 3. Freshness"
oa-gen check-artifact --head "$NORMALIZED" --artifact "$BASELINE" --format human

echo "▶ 4. Review"
oa-gen review --base "$BASELINE" --head "$NORMALIZED" --format markdown

echo "▶ 5. Typegen"
oa-gen typegen --spec "$NORMALIZED" --output src/generated/api-types.ts
```

레퍼런스 구현은 같은 파이프라인을 `apps/nestjs-ref/scripts/openapi-governance.sh`(scaffold 생성)로 제공한다. 일반적인 진입점:

```bash
bash apps/nestjs-ref/scripts/openapi-governance.sh all              # collect → check → review → typegen → validate-upgraded
bash apps/nestjs-ref/scripts/openapi-governance.sh review-bundle    # PR comment용 단일 markdown(--inventory 포함)
bash apps/nestjs-ref/scripts/openapi-governance.sh inventory        # 3.2 upgraded artifact 기준 inventory
bash apps/nestjs-ref/scripts/openapi-governance.sh drift             # runtime OpenAPI URL 비교
bash apps/nestjs-ref/scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"
bash apps/nestjs-ref/scripts/openapi-governance.sh update-baseline  # baseline 갱신
```

`drift` 케이스는 첫 인자 이후의 모든 인자를 그대로 `oa-gen drift`에 전달하므로 `--runtime-header`, `--behavior-log`, `--format json` 등을 추가로 붙일 수 있다.

### Profile Noise Removal Scope

`nestjs-swagger`/`fastapi` profile은 **빈 `info.contact`, 루트 `servers`, 루트 `tags`만** noise로 처리한다. 이들은 두 프레임워크 모두 사용자가 명시 설정하지 않으면 무조건 빈 값으로 emit하는 cosmetic field라 안전하게 제거할 수 있다. `generic` profile은 어떤 것도 제거하지 않는다 — 출처가 불명확한 빈 배열이 의도적일 수 있기 때문.

다음은 의도적으로 **보존**한다:

- **`operationId`**: FastAPI가 생성하는 `read_user_users__user_id__get` 같은 자동 ID. operationId rename은 클라이언트 측 breaking change이므로 baseline이 이를 감지하도록 유지.
- **422 ValidationError 응답**: FastAPI/Pydantic이 모든 검증 라우트에 자동 추가하는 응답. 클라이언트가 의존할 수 있는 contract signal로 본다.
- **`HTTPValidationError` schema 등 generated component**: 라이브러리가 만든 schema도 contract의 일부로 baseline에 포함.

이 정책 때문에 함수 이름을 바꾸면 `oa-gen review`가 breaking change로 잡는다 — 이는 의도된 동작이다.

### Config Source of Truth

`openapi-governance.config.json`이 artifact interface와 consumer 매핑의 단일 소스다. `scripts/openapi-governance.sh`는 scaffold time에 그 config를 기준으로 렌더링되며, 각 단계에 어떤 artifact를 넘길지 (NORMALIZED / UPGRADED / BASELINE)는 그때 고정된다. JSON을 hand-edit해도 스크립트는 자동 갱신되지 않으므로, `artifacts` 경로나 `consumers` 매핑이 바뀌면 `oa-gen scaffold-governance --root <서비스> --service <이름> --profile <profile> --force`를 다시 실행해야 한다. 렌더링된 스크립트 헤더의 `# config fingerprint: <hash>` 한 줄이 현재 config와 일치하지 않으면 동기화가 어긋났다는 신호다.

---

## CI 통합 예시

CI에서는 scaffold 스크립트의 `ci` 단계를 실행한다. `ci`는 수집(export → collect), baseline 확인,
`review-bundle`(`--inventory` 포함, `.oa-sdk/governance/review-bundle.md`에 저장), 3.2 분석본
`validate`, typegen을 차례로 실행한다.

스크립트는 `openapi-governance.config.json`의 `oaGenCommand`로 `oa-gen`을 호출한다. 이 값은 scaffold의
`--oa-gen-command`로 정하고(기본값 `oa-gen`), 실행할 때 `OA_GEN` 환경 변수로 덮어쓸 수 있다. 외부
서비스는 `@oa-sdk/codegen`을 서비스의 devDependency로 설치하고 패키지 매니저 경유 명령으로 scaffold한다.

```bash
pnpm add -D @oa-sdk/codegen
pnpm exec oa-gen scaffold-governance --root . --service my-api --profile nestjs-swagger \
  --source-command "pnpm export:openapi" --oa-gen-command "pnpm exec oa-gen"
```

scaffold는 `<root>/.github/workflows/openapi-governance.yml`도 만든다. 이 workflow는
`bash scripts/openapi-governance.sh ci`를 실행하고 `.oa-sdk/governance`를 artifact로 올린다. 의존성
설치 단계는 비워 두므로, checkout 다음에 서비스의 설치 단계를 추가한다.

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - name: OpenAPI governance
        run: bash scripts/openapi-governance.sh ci
```

`--root`가 저장소 루트가 아니면 workflow 파일도 그 아래에 생기므로, GitHub Actions가 읽는 저장소 루트의
`.github/workflows/`로 옮기고 `working-directory`를 서비스 경로로 지정한다.

oa-sdk 저장소의 레퍼런스 앱(`apps/nestjs-ref`)은 `@oa-sdk/codegen`을 의존하지 않으므로 앱 디렉터리에서
`oa-gen`이 PATH에 없다. 이 앱의 `oaGenCommand`는 저장소에서 빌드한 CLI(`node ../../packages/codegen/dist/cli/index.js`)이므로,
저장소에서는 codegen을 먼저 빌드한 뒤 package 스크립트를 실행한다(저장소 기여자용).

```bash
pnpm --filter @oa-sdk/codegen build
pnpm --filter @oa-sdk/nestjs-ref governance:ci
```

---

## .gitignore 권장

```gitignore
# apps/nestjs-ref
apps/nestjs-ref/contracts/openapi.raw.json
apps/nestjs-ref/contracts/openapi.raw.yaml
apps/nestjs-ref/contracts/openapi.normalized.yaml
apps/nestjs-ref/contracts/openapi.upgraded.yaml
apps/nestjs-ref/contracts/openapi.collect-report.json
apps/nestjs-ref/src/generated/
apps/nestjs-ref/dist/
```

`contracts/v1.openapi.yaml`(baseline)은 반드시 git으로 관리한다.

---

## 관련 문서

- [NestJS 레퍼런스 구현](../../../apps/nestjs-ref/)
- [FastAPI 레퍼런스 구현](../../../apps/fastapi-ref/)
- [OpenAPI Governance Workflow](./openapi-governance-workflow.md)
- [OpenAPI Governance Service Template](../openapi-governance-service-template.md)
- [CLI 세팅](../cli-setup.md)
