# Traceability — 공식 스펙 ↔ 구현 매핑

> OAS 3.2 공식 스펙 → 구현 스펙(타입) → 코드의 추적 가능성을 보장합니다.
> 모든 공식 스펙 섹션이 최소 1개 타입 파일에 매핑되고,
> 모든 타입 파일이 최소 1개 구현 파일에서 사용됩니다.

---

## 공식 스펙 → 타입 파일 (1:N)

> 공식 스펙: `docs/references/oas32/`
> 타입 파일: `packages/parser/src/types/`

| OAS 3.2 섹션 | 공식 스펙 문서 | 타입 파일 | 정의 타입 |
|-------------|-------------|----------|----------|
| §4.8.1-4 Document/Info | [`03-document-structure.md`](../references/oas32/03-document-structure.md) | [`document.ts`](../../packages/parser/src/types/document.ts) | OasDocument, OasInfo, OasContact, OasLicense |
| §4.8.5-6 Server | [`04-server.md`](../references/oas32/04-server.md) | [`server.ts`](../../packages/parser/src/types/server.ts) | OasServer, OasServerVariable |
| §4.8.7-8 Components/Paths | [`05-components-paths.md`](../references/oas32/05-components-paths.md) | [`components.ts`](../../packages/parser/src/types/components.ts) | OasComponents, OasPaths |
| §4.8.9-11 Operations | [`06-operations.md`](../references/oas32/06-operations.md) | [`operations.ts`](../../packages/parser/src/types/operations.ts) | OasPathItem, OasOperation, OasExternalDocs |
| §4.8.12 Parameters | [`07-parameters.md`](../references/oas32/07-parameters.md) | [`parameters.ts`](../../packages/parser/src/types/parameters.ts) | OasParameter, OasParameterIn |
| §4.8.13-15 RequestBody/Media | [`08-request-body.md`](../references/oas32/08-request-body.md) | [`request-body.ts`](../../packages/parser/src/types/request-body.ts) | OasRequestBody, OasMediaType, OasEncoding |
| §4.8.16-18 Responses/Callback | [`09-responses.md`](../references/oas32/09-responses.md) | [`responses.ts`](../../packages/parser/src/types/responses.ts) | OasResponses, OasResponse, OasCallback |
| §4.8.19-20 Examples/Links | [`10-examples-links.md`](../references/oas32/10-examples-links.md) | [`examples.ts`](../../packages/parser/src/types/examples.ts) | OasExample, OasLink |
| §4.8.21-23 Headers/Tags/Ref | [`11-headers-tags-refs.md`](../references/oas32/11-headers-tags-refs.md) | [`headers-tags.ts`](../../packages/parser/src/types/headers-tags.ts), [`common.ts`](../../packages/parser/src/types/common.ts) | OasHeader, OasTag, OasReference |
| §4.8.24 Schema | [`12-schema.md`](../references/oas32/12-schema.md) | [`schema.ts`](../../packages/parser/src/types/schema.ts) | OasSchema, OasDiscriminator |
| §4.8.25 XML | [`13-xml.md`](../references/oas32/13-xml.md) | [`xml.ts`](../../packages/parser/src/types/xml.ts) | OasXml, OasXmlNodeType |
| §4.8.26-29 Security | [`14-security.md`](../references/oas32/14-security.md) | [`security.ts`](../../packages/parser/src/types/security.ts) | OasSecurityScheme, OasOAuthFlows |
| §2 Format Rules | [`01-format-rules.md`](../references/oas32/01-format-rules.md) | — | (규칙만) |
| §3 Extensions | [`02-extensions.md`](../references/oas32/02-extensions.md) | [`common.ts`](../../packages/parser/src/types/common.ts) | OasExtensions |

---

## 타입 파일 → 구현 파일 (1:N)

| 타입 파일 | 사용하는 구현 파일 |
|----------|------------------|
| `types/document.ts` | `parser/parse.ts`, `parser/schema-loader.ts`, `parser/lint.ts` |
| `types/server.ts` | `parser/parse.ts`, `parser/types.ts` (IR) |
| `types/components.ts` | `parser/parse.ts` |
| `types/operations.ts` | `parser/parse.ts`, `parser/schema-loader.ts`, `parser/lint.ts` |
| `types/parameters.ts` | `parser/parse.ts`, `parser/schema-loader.ts`, `mock-server/request-validator.ts`, `parser/lint.ts` |
| `types/request-body.ts` | `parser/parse.ts`, `mock-server/request-validator.ts`, `mock-server/response-picker.ts` |
| `types/responses.ts` | `parser/parse.ts`, `mock-server/response-picker.ts` |
| `types/examples.ts` | `parser/parse.ts`, `mock-server/response-picker.ts` |
| `types/headers-tags.ts` | `parser/parse.ts`, `mock-server/response-picker.ts`, `parser/types.ts` |
| `types/common.ts` | 모든 타입 파일 (Referenceable\<T>) |
| `types/schema.ts` | `parser/fold.ts`, `mock-server/generate.ts`, `mock-server/stream.ts`, `codegen/zod-to-schema.ts`, `codegen/typegen/schema-to-ts.ts` |
| `types/xml.ts` | `types/schema.ts`, `mock-server/core/xml.ts` (application/xml 최소 element-only parse/serialize scope) |
| `types/security.ts` | `parser/parse.ts`, `mock-server/request-validator.ts`, `parser/lint.ts` |

---

## 구현 파일 → 공식 스펙 역추적

| 구현 파일 | 관련 스펙 섹션 |
|----------|--------------|
| **parser** | |
| `parse.ts` | §4.8.1 (Document), §4.8.7 (Components), §4.8.9 (Operations), §4.8.27 (Security) |
| `schema-loader.ts` | §4.8.8 (Paths), §4.8.9 (PathItem), §4.8.12 (Parameters) |
| `deref.ts` | §4.8.23 (Reference Object, $ref) |
| `ref-graph.ts` | §4.8.23 (Reference Object, $ref), §4.8.24 (Schema Object 참조 그래프) |
| `fold.ts` | §4.8.24 (Schema Object) |
| `lint.ts` | §4.8.1 (Document), §4.8.10 (Operation), §4.8.12 (Parameters), §4.8.23 ($ref), §4.8.27 (Security) |
| `query.ts` | §4.8.10 (Operation), §4.8.22 (Tags) |
| **mock-server** | |
| `request-validator.ts` | §4.8.12 (Parameters), §4.8.13 (RequestBody), §4.8.24 (Schema), §4.8.27 (Security) |
| `response-picker.ts` | §4.8.16 (Responses), §4.8.19 (Examples), §4.8.21 (Headers) |
| `generate.ts` | §4.8.24 (Schema — format, type 기반 값 생성) |
| `stream.ts` | §4.8.14 (MediaType — itemSchema, SSE) |
| **codegen** | |
| `zod-to-schema.ts` | §4.8.24 (Schema Object — Zod → OAS 변환) |
| `typegen/schema-to-ts.ts` | §4.8.24 (Schema Object — OAS → TS 변환) |
| `typegen/generate-types.ts` | §4.8.10 (Operation), §4.8.12 (Parameters), §4.8.16 (Responses) |
| **router** | |
| `generate-router.ts` | §4.8.9 (PathItem), §4.8.10 (Operation) |
| **client** | |
| `generate-client.ts` | §4.8.10 (Operation), §4.8.14 (MediaType — SSE stream) |

---

## 미매핑 스펙 섹션

| 스펙 섹션 | 상태 | 이유 |
|----------|------|------|
| `00-overview.md` | 참조 문서 | 타입 정의 불필요 |
| `01-format-rules.md` | 참조 문서 | 규칙만 (타입 없음) |
| `15-security-considerations.md` | 참조 문서 | 보안 고려사항 (구현 대상 아님) |
| `appendices/` | 참조 문서 | RFC 직렬화 규칙 등 (참조용) |

---

## 검증 규칙

1. **공식 스펙 → 타입**: 모든 §4.8.x 섹션이 최소 1개 `types/*.ts` 파일에 매핑됨 ✅
2. **타입 → 구현**: 모든 `types/*.ts` 파일이 최소 1개 구현 파일에서 import됨 ✅
3. **구현 → 스펙**: 모든 구현 파일이 최소 1개 스펙 섹션에 역추적 가능 ✅
4. **미매핑**: overview/format-rules/security-considerations/appendices만 — 참조 문서로 구현 대상 아님 ✅
