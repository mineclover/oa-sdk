# OAS 3.2 기능 커버리지

> 파일 매핑: `packages/parser/src/types/` 디렉터리의 각 파일이 공식 스펙 섹션과 1:1 대응됩니다.
> 공식 스펙 → 타입 → 코드 전체 추적: [traceability.md](./traceability.md)

## 타입 파일 ↔ 스펙 섹션 매핑

| 타입 파일 | 스펙 섹션 | 스펙 문서 | 정의된 타입 |
|-----------|----------|----------|------------|
| `common.ts` | — | — | `Referenceable<T>`, `OasReference`, `OasExtensions` |
| `document.ts` | §4.8.1–4 | `03-document-structure.md` | `OasDocument`, `OasInfo`, `OasContact`, `OasLicense` |
| `server.ts` | §4.8.5–6 | `04-server.md` | `OasServer`, `OasServerVariable` |
| `components.ts` | §4.8.7–8 | `05-components-paths.md` | `OasComponents`, `OasPaths` |
| `operations.ts` | §4.8.9–11 | `06-operations.md` | `OasPathItem`, `OasOperation`, `OasExternalDocs` |
| `parameters.ts` | §4.8.12 | `07-parameters.md` | `OasParameter`, `OasParameterIn` |
| `request-body.ts` | §4.8.13–15 | `08-request-body.md` | `OasRequestBody`, `OasMediaType`, `OasEncoding` |
| `responses.ts` | §4.8.16–18 | `09-responses.md` | `OasResponses`, `OasResponse`, `OasCallback` |
| `examples.ts` | §4.8.19–20 | `10-examples-links.md` | `OasExample`, `OasLink` |
| `headers-tags.ts` | §4.8.21–22 | `11-headers-tags-refs.md` | `OasHeader`, `OasTag` |
| `schema.ts` | §4.8.24 | `12-schema.md` | `OasSchema`, `OasDiscriminator` |
| `xml.ts` | §4.8.25 | `13-xml.md` | `OasXml`, `OasXmlNodeType` |
| `security.ts` | §4.8.27 | `14-security.md` | `OasSecurityScheme`, `OasOAuthFlows`, `OasOAuthFlow`, `OasSecurityRequirement` |

## OAS 3.2 신규 필드 (`@since 3.2`)

| 타입 | 필드 | 설명 |
|------|------|------|
| `OasDocument` | `$self` | 문서 자기 참조 URI |
| `OasDocument` | `webhooks` | 인바운드 웹훅 |
| `OasInfo` | `summary` | API 요약 |
| `OasLicense` | `identifier` | SPDX 라이선스 |
| `OasServer` | `name` | 서버 이름 |
| `OasComponents` | `pathItems` | 재사용 PathItem |
| `OasComponents` | `mediaTypes` | 재사용 MediaType |
| `OasPathItem` | `query` | QUERY HTTP 메서드 |
| `OasPathItem` | `additionalOperations` | 커스텀 HTTP 메서드 |
| `OasMediaType` | `itemSchema` | SSE/NDJSON 아이템 스키마 |
| `OasMediaType` | `prefixEncoding` | 위치별 인코딩 |
| `OasMediaType` | `itemEncoding` | 배열 아이템 인코딩 |
| `OasResponse` | `summary` | 응답 요약 |
| `OasExample` | `dataValue` | 스키마 검증 대상 값 |
| `OasExample` | `serializedValue` | 와이어 포맷 |
| `OasTag` | `summary`, `parent`, `kind` | 태그 계층/분류 |
| `OasReference` | `summary`, `description` | 참조 시 오버라이드 |
| `OasDiscriminator` | `defaultMapping` | 기본 매핑 |
| `OasXml` | `nodeType` | XML 노드 타입 (attribute/wrapped 대체) |
| `OasSecurityScheme` | `oauth2MetadataUrl` | RFC 8414 |
| `OasOAuthFlows` | `deviceAuthorization` | RFC 8628 |
| `OasOAuthFlow` | `deviceAuthorizationUrl` | 디바이스 인증 URL |

## 런타임 지원 현황

| 기능 영역 | 타입 정의 | parser IR | mock-server | codegen | router | client |
|-----------|----------|-----------|-------------|---------|--------|--------|
| Document / Info | ✅ | ✅ | — | — | — | — |
| Server / Variables | ✅ | ✅ (추출+상속) | — (고정 포트) | — | — | ✅ (baseUrl) |
| Tags / 계층 | ✅ | ✅ (인덱싱) | — | — | — | — |
| Paths / Operations | ✅ | ✅ (RouteIndex) | ✅ | — | ✅ (라우트) | ✅ (메서드) |
| Parameters (path/query/querystring/header/cookie) | ✅ | ✅ (병합 + querystring content/배타성 검증) | ✅ (AJV; querystring form/JSON, 기타 media는 opaque) | ✅ (path/query/querystring/header types; cookie 제외) | ✅ (path/query/raw querystring) | ✅ (path/query/raw querystring/header; cookie 제외) |
| Parameter style/explode | ✅ | — | ✅ (역직렬화) | — | — | △ query array만: form 기본 explode=true, form explode=false, space/pipe-delimited; object/deepObject/allowReserved는 미지원 |
| Request Body | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Media Type / itemSchema | ✅ | ✅ | ✅ (SSE/NDJSON) | — | — | — |
| Responses / 상태 코드 | ✅ | ✅ | ✅ (6단계 폴백) | — | ✅ (status) | ✅ |
| Response headers | ✅ | — | ✅ (전달) | — | — | — |
| Examples (dataValue) | ✅ | ✅ | ✅ | — | — | — |
| Schema (JSON Schema 2020-12) | ✅ | ✅ ($ref) | ✅ (AJV) | ✅ (typegen) | — | — |
| Discriminator | ✅ | — | — | ✅ (생성) | — | — |
| Security Schemes | ✅ | ✅ (인덱싱) | ✅ (검증) | — | — | — |
| OAuth2 / deviceAuthorization | ✅ | ✅ | ✅ (bearer 확인) | — | — | — |
| Links | ✅ | ✅ (추출) | ✅ (응답 메타데이터) | ✅ (typegen) | — | — |
| Callbacks | ✅ | ✅ (추출) | ✅ (POST simulation) | — | — | — |
| Webhooks | ✅ | ✅ (추출) | ✅ (MSW/Node inbound routes) | ✅ (payload types) | ✅ (handler stubs) | ✅ (payload types, no methods) |
| Encoding | ✅ | ✅ (requestBody/media 보존) | ✅ (multipart field-level handling) | — | ✅ (multipart body parsing hints) | — |
| XML | ✅ | — | ✅ (`application/xml` element-only parse/serialize) | — | — | — |
| Extensions (x-*) | ✅ | ✅ (보존) | — | — | — | — |

### 범례

- **✅ 타입 정의**: `parser/src/types/` 에 TypeScript 타입 존재
- **✅ parser IR**: `parseDocument()`가 추출/인덱싱
- **✅ mock-server**: 런타임 검증/생성에 사용
- **✅ codegen**: typegen (OAS→TS) 또는 Zod→OAS 변환에 사용
- **✅ router**: 라우터 스텁 코드 생성에 사용
- **✅ client**: 클라이언트 SDK 코드 생성에 사용
- **—**: 타입은 정의되었으나 해당 패키지에서 미사용

## 보강 근거

- Webhooks parser extraction: `packages/parser/src/__tests__/parse-document.test.ts`, `packages/parser/src/__tests__/parse-edge-cases.test.ts`
- Webhooks mock routes: `packages/mock-server/src/__tests__/integration/msw.test.ts`, `packages/mock-server/src/__tests__/integration/node-http.test.ts`
- Webhooks router/client generation: `packages/router/src/__tests__/generate-router.test.ts`, `packages/client/src/__tests__/generate-client.test.ts`
- Encoding multipart handling: `packages/mock-server/src/__tests__/unit/validator-body.test.ts`
- Router multipart body hints: `packages/router/src/__tests__/generate-router.test.ts`
