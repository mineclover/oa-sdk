# 스키마 작성 가이드

## 새 도메인 추가

1. `packages/schemas/src/domains/{name}/spec.yaml` 생성
2. 부분 OpenAPI 스펙 형식으로 작성 (아래 템플릿 참고)
3. `pnpm schema:validate`로 검증

```yaml
# domains/{name}/spec.yaml
tags:
  - name: my-domain
    description: 도메인 설명

paths:
  /my-resource:
    get:
      tags: [my-domain]
      operationId: listMyResource
      summary: 목록 조회
      responses:
        "200":
          description: 성공
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MyResource"

components:
  schemas:
    MyResource:
      type: object
      required: [id, name]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
```

## OAS 3.2 문법 규칙

### Example Object examples — dataValue / serializedValue 사용

```yaml
# ✅ OAS 3.2 방식
examples:
  default:
    dataValue:
      id: "123e4567-e89b-12d3-a456-426614174000"
      name: "예시 이름"
    serializedValue: '{"id":"123e4567-...","name":"예시 이름"}'

# ❌ OAS 3.1 방식 — 사용 금지
examples:
  default:
    value:
      id: "..."
```

### Schema Object examples — JSON Schema 배열 사용

Schema Object의 `examples`는 JSON Schema 2020-12 키워드이므로 배열로 작성합니다.
`dataValue` / `serializedValue`는 Media Type, Parameter, Response Header 등의 Example Object에서 사용합니다.

```yaml
components:
  schemas:
    User:
      type: object
      examples:
        - id: "123e4567-e89b-12d3-a456-426614174000"
          name: "예시 이름"
```

### SSE 엔드포인트

```yaml
/events:
  get:
    operationId: streamEvents
    responses:
      "200":
        content:
          text/event-stream:
            schema:
              type: string
            itemSchema:           # OAS 3.2 전용
              $ref: "#/components/schemas/EventPayload"
```

### parameters — dataValue / serializedValue

```yaml
parameters:
  - name: page
    in: query
    schema:
      type: integer
      default: 1
    examples:
      default:
        dataValue: 1
        serializedValue: "page=1"
```

## 공통 컴포넌트 재사용

`common` 도메인이 전체 공유 컴포넌트를 제공합니다.  
아래 항목은 모든 도메인에서 `$ref`로 바로 사용 가능합니다.

| $ref | 내용 |
|---|---|
| `#/components/schemas/Error` | 표준 에러 응답 |
| `#/components/schemas/ValidationError` | 필드 검증 에러 |
| `#/components/responses/BadRequest` | 400 공통 응답 |
| `#/components/responses/Unauthorized` | 401 공통 응답 |
| `#/components/responses/Forbidden` | 403 공통 응답 |
| `#/components/responses/NotFound` | 404 공통 응답 |
| `#/components/responses/UnprocessableEntity` | 422 공통 응답 |
| `#/components/responses/InternalServerError` | 500 공통 응답 |
| `#/components/parameters/Page` | 페이지 번호 쿼리 파라미터 |
| `#/components/parameters/Limit` | 페이지 크기 쿼리 파라미터 |
| `#/components/securitySchemes/bearerAuth` | JWT Bearer 인증 |
| `#/components/securitySchemes/oauth2` | OAuth 2.0 인증 |

## `$ref` 작성 규칙

### 내부 `$ref`

내부 참조는 `#/components/...` 형태를 기본으로 사용합니다. 누락된 내부 참조는 `oa-gen lint`와 `oa-gen validate`에서 `refs/valid-ref` 오류로 보고됩니다.

```yaml
schema:
  $ref: "#/components/schemas/User"
```

### 외부 YAML/JSON `$ref`

상대 경로 외부 참조를 사용할 수 있습니다. CLI는 spec 파일 경로를 기준으로 외부 파일을 해소합니다.

```yaml
schema:
  $ref: "./shared.yaml#/components/schemas/User"
```

외부 파일 누락, 포인터 누락, 순환 참조는 `filePath#pointer` 형태의 source와 함께 출력됩니다.

### `$ref` sibling 보존

`description`, `readOnly`, `annotations`, `properties`, `required` 같은 sibling 구조 정보는 `$ref` 해소 후에도 보존됩니다.

```yaml
id:
  $ref: "#/components/schemas/Uuid"
  readOnly: true
  description: 서버가 발급하는 ID
```

### 순환 `$ref`

기본 deref 동작은 순환 지점을 빈 스키마로 끊어 기존 mock/typegen 호환성을 유지합니다. 구조 손실을 줄여야 하는 파서 소비자는 `cycleStrategy: preserve-ref`를 사용할 수 있습니다.

### 외부 schema 이름 충돌

외부 파일에서 같은 schema 이름이 들어오면 typegen은 파일명 기반 타입명으로 rename하고 경고를 출력합니다.

```yaml
# ./billing.yaml#/components/schemas/User → BillingUser
# ./identity.yaml#/components/schemas/User → IdentityUser
```

로컬 component와 외부 schema 이름이 충돌해도 외부 schema는 파일명 기반 타입명으로 생성됩니다.

## Component 이름 충돌

도메인 병합 시 같은 `components.<section>.<name>`은 기본 오류입니다. 임시 호환이 필요한 경우에만 명시적으로 허용합니다.

```bash
ALLOW_COMPONENT_OVERRIDES=1 pnpm --filter @oa-sdk/schemas run merge
ALLOW_COMPONENT_OVERRIDE_KEYS=schemas.LegacyUser pnpm --filter @oa-sdk/schemas run merge
```

## operationId 컨벤션

- 필수 (없으면 Spectral 오류)
- camelCase (없으면 Spectral 경고)
- 패턴: `{동사}{리소스}` — `listUsers`, `createOrder`, `getItemById`
