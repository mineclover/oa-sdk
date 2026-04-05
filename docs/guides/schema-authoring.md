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

### examples — dataValue / serializedValue 사용

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

## operationId 컨벤션

- 필수 (없으면 Spectral 오류)
- camelCase (없으면 Spectral 경고)
- 패턴: `{동사}{리소스}` — `listUsers`, `createOrder`, `getItemById`
