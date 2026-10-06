# Cloudflare Forge 지원 범위

oa-sdk는 TypeSpec 원본을 Cloudflare Forge가 직접 읽도록 연결하지 않습니다. TypeSpec에서
생성한 OpenAPI 계약을 `@oa-sdk/parser`의 `ParsedDocument` IR로 읽고, `@oa-sdk/surface-ir`가
SDK·CLI 표면을 target-neutral IR로 만든 뒤 Forge용 OpenAPI projection과 Overlay를 생성합니다.
이 문서는 `@oa-sdk/codegen` 0.9.0과 `@oa-sdk/surface-ir` 0.1.1 기준입니다.

외부 프로젝트는 자기 OpenAPI 문서(또는 `.tsp`)를 `oa-gen surface`나 `@oa-sdk/surface-ir` API에
넘깁니다. 아래에서 `packages/schemas/...` 경로, 개수(34개 operation, 5개 command), Forge 연동
데모와 검증 절은 oa-sdk 저장소의 production 계약 기준이며 저장소 기여자용입니다.

```text
TypeSpec (.tsp)
  → OpenAPI 3.2 canonical artifact
  → OpenAPI 3.1 bundled JSON
  → ParsedDocument IR
  → Surface IR
  → Forge projection / OpenAPI Overlay
  → Forge CLI·SDK·문서 표면
```

## 현재 지원 수준

| 영역 | 지원 수준 | 설명 |
| --- | --- | --- |
| TypeSpec 계약 입력 | 지원 | `oa-gen surface --spec <file>.tsp`는 메모리에서 컴파일한 OpenAPI를 사용한다. |
| OpenAPI 3.1 bundle 입력 | 권장 | Forge target 입력으로 `$ref`를 모두 해석한 3.1 문서를 쓴다. 이 저장소에서는 `packages/schemas/dist/openapi.json`이다. |
| OpenAPI 3.2 canonical 입력 | 제한적 | Surface IR 생성과 Forge core resolver smoke test는 가능하지만 Fern 기반 전체 SDK 생성은 별도 검증이 필요하다. |
| Surface IR 생성 | 지원 | operation마다 contract, projection, runtime profile, provenance를 만든다. 이 저장소의 production 계약은 34개 operation이다. |
| Forge operation projection | 지원 | SDK group/method, availability, visibility, CLI override를 `x-fern-*`/`x-forge-*`로 투영한다. |
| Forge command catalog | 지원 | OpenAPI tag와 surface projection에서 command/group description과 method catalog를 생성한다. |
| Forge Overlay | 지원 | top-level command마다 하나의 OpenAPI Overlay를 생성한다. |
| Forge core 초기화 | 검증됨 | 이 저장소의 production artifact가 5개 command, 34개 method로 초기화된다. |
| Fern TypeScript SDK 전체 생성 | 조건부 | Docker, Fern generator, custom runtime, generated SDK typecheck가 필요하다. |
| SSE `itemSchema` | 제한적 | canonical OAS 3.2에는 보존되지만 3.1 downgrade artifact에서는 손실될 수 있다. |
| Cloudflare envelope runtime | 별도 profile 필요 | oa-sdk의 direct body/error/page 모델과 Cloudflare `result` envelope를 구분해야 한다. |

## Forge로 할 수 있는 것

현재 Surface IR과 Forge projection을 사용하면 다음 작업을 자동화할 수 있습니다.

1. **OpenAPI operation을 Forge SDK 주소로 매핑**

   `tag` 또는 별도 정책에서 `groupPath`를 만들고, `operationId` 또는 명시적 override에서
   SDK method 이름을 만듭니다.

   ```ts
   {
     operationId: 'listUsers',
     groupPath: ['users'],
     methodName: 'listUsers',
     availability: 'generally-available'
   }
   ```

2. **Forge CLI command hierarchy 생성**

   top-level group을 command로, 나머지 group path를 하위 group으로 투영합니다. OpenAPI
   tag description은 command 또는 group description의 기본값으로 사용합니다.

3. **operation lifecycle과 visibility 관리**

   `alpha`, `beta`, `preview`, `generally-available`, `deprecated`, `legacy`를 surface 정책으로
   보존하고, Forge 출력에서는 ignore/hidden/internal로 투영합니다.

4. **CLI argument surface 생성**

   path/query/body parameter를 자동 파생하거나, `x-forge-args`, `x-forge-params`,
   `x-forge-globals` override를 통해 positional argument, enum, file input, hidden parameter,
   confirmation prompt를 정의할 수 있습니다.

5. **parameter와 body property 이름 분리**

   wire 이름과 SDK/CLI 이름을 분리해 `x-fern-parameter-name`과 `x-fern-property-name`으로
   내보낼 수 있습니다.

6. **여러 SDK projection 생성**

   하나의 HTTP operation을 여러 SDK group/method 주소로 노출하는 alias projection을 지원할
   수 있습니다. 원본 operation은 유지하고 target별 alias만 별도 artifact에 기록합니다.

7. **pagination 표면 진단**

   `items`, `total`, `page`, `limit`, `cursor` 구조를 Surface IR에 기록해 Forge pagination
   metadata가 필요한 operation을 식별합니다. oa-sdk의 `PageResult<T>`와 Cloudflare
   `result_info` 모델 차이도 target diagnostic으로 남길 수 있습니다.

8. **streaming capability 진단**

   SSE/NDJSON media type과 OAS 3.2 `itemSchema` 보유 여부를 IR에 기록합니다. Forge target이
   해당 정보를 보존하지 못하면 생성 전에 warning/error로 보고합니다.

9. **Forge Overlay를 통한 비파괴 target projection**

   TypeSpec source, approved snapshot, canonical OpenAPI artifact를 수정하지 않고 Forge용
   metadata를 Overlay로 추가합니다. target-specific metadata는 TypeSpec 원본에 섞이지 않습니다.

10. **Forge method parity 검증**

   Surface IR의 operation 수·operation ID·command·method map을 Forge 초기화 결과와 비교해
   누락되거나 중복된 SDK surface를 CI에서 차단할 수 있습니다.

11. **target별 runtime profile 검증**

   direct body, Cloudflare envelope, status-body error, Cloudflare error envelope, pagination,
   streaming profile을 operation 단위로 기록해 generated runtime과 wire contract의 불일치를
   조기에 찾을 수 있습니다.

## 현재 API

```bash
npm install @oa-sdk/surface-ir @oa-sdk/parser
```

`@oa-sdk/surface-ir`는 Node.js 22 이상에서 동작합니다. `@oa-sdk/codegen` 0.9.0 릴리스에서 처음
npm에 배포되므로, 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은
[변경 이력](../changelog.md)에서 확인합니다. `oa-gen surface`만 쓴다면 `@oa-sdk/codegen`이 이
패키지를 런타임 의존성으로 함께 설치하므로 따로 설치하지 않아도 됩니다.

```ts
import { parseDocument } from '@oa-sdk/parser'
import {
  buildSurfaceIr,
  emitForgeOverlays,
  toForgeProjection,
} from '@oa-sdk/surface-ir'

const parsed = parseDocument(openapiDocument)
const surface = buildSurfaceIr(parsed, { target: 'forge' })
const projection = toForgeProjection(surface, parsed)
const overlays = emitForgeOverlays(surface, parsed)
```

- `buildSurfaceIr()` 옵션: `target`(`generic` 기본, `forge`), `defaultAvailability`,
  `operationOverrides`(operationId별 `groupPath`, `methodName`, `availability`, `visibility`,
  `aliases`, `cli`), `groupForOperation`, `methodForOperation`, `defaultEnvelope`, `defaultErrors`.
- 문제는 예외가 아니라 `surface.diagnostics`로 보고합니다(참조 미해결 문서, operationId 없음,
  group/method 충돌, Forge의 `QUERY` 메서드 등).
- `emitForgeOverlays()`는 Forge의 command 단위 overlay 해석 방식에 맞춰 command마다 하나의
  Overlay를 반환합니다. 모든 operation을 Overlay 하나에 담으려면 `emitForgeOverlay()`를 씁니다.

옵션과 진단 코드 전체는 [`@oa-sdk/surface-ir` README](../../packages/surface-ir/README.md)를 봅니다.

## `oa-gen surface`

공식 CLI 진입점은 `surface`입니다. `--spec`에는 OpenAPI YAML/JSON이나 TypeSpec `.tsp`를 줍니다.
여러 파일로 나뉜 OpenAPI 스펙은 다른 파일을 가리키는 `$ref`를 스펙 파일의 위치에서 풀어 읽습니다([풀 수 없는 `$ref`와 Overlay 적용](./cli-command-reference.md#surface-옵션-및-인수-명세)).

```bash
npx oa-gen surface \
  --spec ./openapi.json \
  --target forge \
  --out-dir artifacts/surface/forge
```

`--out-dir`(기본값 `artifacts/surface/forge`)에 다음 파일을 씁니다.

| 파일 | 내용 |
| --- | --- |
| `surface-ir.json` | Surface IR (`oa-sdk.surface-ir.v1`) |
| `forge-projection.json` | operation별 `x-fern-*`/`x-forge-*` metadata와 command catalog |
| `forge.<command>.overlay.yaml` | top-level command마다 하나의 OpenAPI Overlay |
| `surface-manifest.json` | 입력 artifact hash, Surface IR version hash, operation/command 수, diagnostic 수, Overlay 경로 |

이 저장소의 production 계약은 `--spec packages/schemas/dist/openapi.json`으로 실행합니다(저장소 기여자용).

operation별 SDK 이름과 lifecycle을 별도 mapping 파일로 관리할 수 있습니다.

```yaml
defaultAvailability: generally-available
operations:
  listUsers:
    groupPath: [accounts, users]
    methodName: list
    availability: preview
    cli:
      args:
        - name: format
          type: enum
          values: [json, csv]
          required: true
```

```bash
npx oa-gen surface \
  --spec ./openapi.json \
  --target forge \
  --mapping config/forge-surface.yaml \
  --out-dir artifacts/surface/forge
```

error diagnostic이 있으면 종료 코드 1로 실패합니다. warning까지 CI에서 차단하려면
`--fail-on-warning`을 사용합니다.

## Forge 연동 데모 (저장소 기여자용)

oa-sdk 저장소 checkout에서 실행합니다. `scripts/forge-surface-demo.ts`는 배포 패키지에 들어 있지
않습니다. Forge checkout을 준비한 뒤 demo script를 실행하면 이 저장소의 production artifact를
실제 Forge `init()`에 넣어 command/method parity를 확인할 수 있습니다.

```bash
git clone --depth 1 https://github.com/cloudflare/forge.git /tmp/cloudflare-forge
pnpm --dir /tmp/cloudflare-forge install --filter @cloudflare/forge --ignore-scripts --frozen-lockfile
pnpm --filter @oa-sdk/parser build
pnpm --filter @oa-sdk/surface-ir build

node --import tsx scripts/forge-surface-demo.ts \
  --forge-root /tmp/cloudflare-forge
```

성공 시 다음 조건을 JSON으로 출력합니다.

```json
{
  "sourceOperations": 34,
  "surfaceErrors": 0,
  "forgeMethods": 34,
  "forgeOperations": 34,
  "parity": { "operations": true, "methods": true }
}
```

이 데모는 Forge core projection과 operation parity를 검증합니다. Docker/Fern 기반 전체
TypeScript SDK 생성과 generated runtime 동작은 별도 downstream test입니다.

## 지원 경계

- Forge가 요구하는 `x-fern-*`/`x-forge-*` metadata는 generated TypeSpec artifact에 수기로
  추가하지 않습니다.
- 3.1 bundle에서 제거되는 OAS 3.2 `itemSchema`, `query`, device authorization metadata는
  Forge target diagnostic을 거쳐야 합니다.
- Forge core projection 성공은 Fern TypeScript SDK 전체 생성 성공을 의미하지 않습니다.
- Cloudflare custom runtime의 `success/result/result_info` envelope는 oa-sdk의 direct
  response/error/page 계약과 별도 wire profile로 검증해야 합니다.
- generated SDK의 Docker/Fern 실행, custom fetcher, binary/multipart, SSE runtime 동작은
  별도의 downstream integration test가 필요합니다.

## 검증 (저장소 기여자용)

```bash
pnpm --filter @oa-sdk/parser typecheck
pnpm --filter @oa-sdk/surface-ir test:ci
pnpm turbo run build --filter=@oa-sdk/surface-ir...
pnpm schema:bundle
```

Forge main source에 현재 production artifact와 생성된 overlays를 적용한 smoke test는 34개
operation, 5개 command, 34개 method parity를 확인합니다.
