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

호출자는 operation-specific error alias를 사용해 `error.status`를 먼저 좁힌 뒤,
403에서는 `error.body`에 `allowed`가 있는지 확인해 denied decision과 access error를
구분한 뒤 `reasonCode`, `trace`를 처리한다.
HTTP status별 body 자체를 runtime에서 검증하는 것은 별도 validation 옵션의 책임으로 남긴다.

### 아직 표현되지 않는 정책

- `Bearer` 인증은 security scheme으로 표현되지만 legacy token과 Keycloak OIDC의 선택 규칙은
  OpenAPI에 드러나지 않는다.
- `authorization-admin` role, tenant scope, 최초 tenant tuple 예외는 route security보다
  강한 runtime policy인데 generated router/client에는 전달되지 않는다.
- `operationKey`는 catalog가 소유하는 동적 문자열이다. 현재 fixture에서는 `string`으로
  두었으므로 catalog 변경과 API client 타입이 자동으로 연결되지 않는다.
- generated router는 path/body/type skeleton을 만들지만 후보의 OpenFGA runtime 호출,
  tenant scope, telemetry, idempotency 정책을 구현하지 않는다. 따라서 실제 Fastify route의
  대체물이 아니라 contract/type boundary로 사용해야 한다.

## 검증 결과

```text
candidate npm test                         pass
TypeSpec bundle-check                      pass
parser                                     6 operations, 21 schemas
codegen                                    255 typegen lines, 0 warnings
router/client generated consumer compile   pass
mock-server                                11 MSW handlers
```
