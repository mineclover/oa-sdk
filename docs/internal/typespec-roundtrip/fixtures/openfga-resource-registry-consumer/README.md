# OpenFGA Resource Registry Consumer Fixture

이 fixture는 `/Users/junwoobang/workflow/openfga-resource-registry-demo/`의 실제 HTTP
consumer surface를 OA SDK 기본 스펙에 표현해보는 분석용 bundle이다. Production
`packages/schemas/typespec`에는 포함하지 않는다.

## 분석 대상

| Candidate surface | TypeSpec operation | 관찰 포인트 |
|---|---|---|
| `GET /health` | `getHealth` | generated response가 실제 release/model 식별자를 보존하는지 |
| `GET /resource-types` | `listResourceTypes` | catalog가 runtime에서 만드는 동적 object map을 스키마화할 수 있는지 |
| `POST /authorization/check` | `checkAuthorization` | `operationKey`가 catalog-owned dynamic value이고 allow/deny decision과 같은 403 정책 오류를 함께 표현하는지 |
| `POST /authorization/relationships` | `writeRelationships` | batch tuple, idempotency flag, 인증/role 오류를 한 계약으로 표현하는지 |
| `DELETE /authorization/relationships` | `deleteRelationships` | 같은 body shape를 가진 다른 HTTP method와 generated client parity |
| `POST /authorization/relationships/query` | `queryRelationships` | pagination, optional relation/subject filter, provider tuple projection |

현재 후보 구현은 OpenAPI/TypeSpec source 없이 `src/routes/*.ts`의 parser와 Fastify
`inject` 테스트가 HTTP 계약을 소유한다. 이 fixture는 그 계약을 OA SDK로 옮겼을 때
생성 client/router/mock이 실제 소비 흐름을 충분히 표현하는지 확인하기 위한 shadow contract다.

## 실행

```bash
corepack pnpm tsx docs/internal/typespec-roundtrip/fixtures/openfga-resource-registry-consumer/generate-operation-keys.ts \
  --catalog-dir /Users/junwoobang/workflow/openfga-resource-registry-demo/catalog \
  --output docs/internal/typespec-roundtrip/fixtures/openfga-resource-registry-consumer/catalog-operation-keys.tsp

pnpm typespec:bundle-check -- \
  --manifest docs/internal/typespec-roundtrip/fixtures/openfga-resource-registry-consumer/oa-sdk.typespec-bundle.json \
  --output /tmp/oa-sdk-openfga-registry.openapi.yaml \
  --report /tmp/oa-sdk-openfga-registry-report.json

pnpm schema:downstream-check -- \
  --spec /tmp/oa-sdk-openfga-registry.openapi.yaml \
  --skip-build
```

이 fixture의 목적은 production schema를 변경하는 것이 아니라, 후보 서비스의 수동
계약과 generated consumer 사이의 누락·불편·모순을 기록하는 것이다.

## 1차 분석 결과

### 해결한 차이: OAS 3.2 dynamic map

후보의 `resource-types` 응답은 `directRelations`를 relation name → binding object의
동적 map으로 반환한다. TypeSpec `Record<DirectRelationBinding>`는 OAS 3.2에서
`unevaluatedProperties`로 표현되므로 기존 typegen에서는 `Record<string, unknown>`으로
넓어졌다. OA SDK typegen이 이 형태를 `Record<string, DirectRelationBinding>`으로
보존하도록 개선했고, 회귀 테스트를 추가했다.

### 결정한 방식: 403 AuthorizationDecision + typed client error

후보의 `POST /authorization/check`는 권한 거부를 `403`으로 반환하면서 body에는
denied decision을 넣는다. 단, Keycloak actor mismatch나 tenant scope 실패도 같은
`403` status로 일반 `{ error, message }` body를 반환하므로, fixture는 실제 계약을
`AuthorizationDeniedDecision | Error`로 표현한다. deny를 200으로 바꾸지 않고,
generated client가 모든 non-2xx 응답을 `ClientError`로 throw하도록 정렬했다.

- `ClientError`는 `status`, 파싱된 `body`, 원본 `response`를 보존한다.
- typegen은 4xx/5xx/default의 JSON body를 모두 모아 operation error union을 생성한다.
  따라서 이 fixture의 `checkAuthorization`은 `Error | AuthorizationDecision`을 갖는다.
- 추가로 `CheckAuthorizationErrorByStatus[403]`을 `AuthorizationDeniedDecision | Error`로 생성하고,
  `CheckAuthorizationClientError`를 status별 `ClientError` union으로 구성한다.
- client generated surface에는 `CheckAuthorizationClientError` alias와
  `isCheckAuthorizationClientError` guard가 추가되어 catch 구문에서 해당 union을
  재사용할 수 있다.
- `isCheckAuthorizationErrorBody(body, 403)`와 `isCheckAuthorizationClientError(error, 403)`는
  status별 schema까지 runtime에서 확인하므로, 잘못된 body를 업무 오류로 잘못 좁히지 않는다.
- `ClientError`에는 `operationId`가 포함되어 동일 status를 사용하는 다른 operation의 오류가
  operation-specific guard를 통과하지 않는다.

호출자는 operation-specific error guard에 status를 함께 넘겨 denied decision과 access
error를 구분한다.

```ts
try {
  await client.checkAuthorization(request)
} catch (error) {
  if (isCheckAuthorizationClientError(error, 403)) {
    if ('allowed' in error.body) {
      console.log(error.body.reasonCode, error.body.trace)
    } else {
      console.log(error.body.error, error.body.message)
    }
  }
}
```

`config.validate: true`를 사용하면 required field, enum/const, 숫자·문자열 범위,
객체·배열 제약을 fetch 전에 검사한다. 5xx retry는 GET/HEAD/OPTIONS/DELETE만 기본
활성화되며, 읽기성 POST처럼 안전성이 확인된 operation만 `x-oa-sdk-retryable: true`로
명시한다.

### 아직 표현되지 않는 정책

- `Bearer` 인증은 security scheme으로 표현되지만 legacy token과 Keycloak OIDC의 선택 규칙은
  OpenAPI에 드러나지 않는다.
- `authorization-admin` role, tenant scope, 최초 tenant tuple 예외는 route security보다
  강한 runtime policy인데 generated router/client에는 전달되지 않는다.
- `operationKey`는 `catalog-operation-keys.tsp`의 union으로 관리한다. 현재 fixture는
  후보 catalog의 5개 key를 반영하므로 잘못된 operation key를 compile-time에 차단한다.
  catalog 변경 시 이 generated shadow alias를 갱신해야 한다.
- generated router는 path/body/type skeleton을 만들지만 후보의 OpenFGA runtime 호출,
  tenant scope, telemetry, idempotency 정책을 구현하지 않는다. 따라서 실제 Fastify route의
  대체물이 아니라 contract/type boundary로 사용해야 한다.

### Runtime parity decisions

- Request models use `Record<never>` intentionally. The consumer runtime rejects unknown
  request fields so the Fastify parser and generated contract have the same sealing rule.
- `RelationshipQueryResponse.continuationToken` is optional because the final page may omit
  a continuation token. Consumers should continue only when the field is present.

## 검증 결과

```text
candidate npm test                         pass
TypeSpec bundle-check                      pass
parser                                     6 operations, 21 schemas
codegen                                    255 typegen lines, 0 warnings
router/client generated consumer compile   pass
mock-server                                11 MSW handlers
```
