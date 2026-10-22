# Schema Annotations — 스키마 안의 작성자 메모 규칙

> OpenAPI 3.2 Schema Object에 `$comment`와 `annotations`로 개발자용 메모를 남기는 규칙입니다.
> OpenAPI 문서를 원본으로 쓰는 프로젝트와 TypeSpec 원본(`@extension`) 모두에 적용됩니다.
> 동작 기준: `@oa-sdk/codegen` 0.10.0.

---

## 배경

JSON에는 주석을 쓸 수 없고, YAML `#` 주석은 병합·번들 과정에서 사라집니다. OpenAPI 3.2의 Schema Object는
JSON Schema 2020-12이므로 알 수 없는 키워드를 annotation으로 허용합니다. 그래서 작성자 메모를 `$comment`와
`annotations` 객체로 구조화합니다. `oa-gen validate`는 이 두 필드를 오류로 보지 않습니다.

---

## 3계층 문서화 모델

| 계층 | 필드 | 대상 | 생성물에 보존 | typegen |
|------|------|------|------|---------|
| **표준** | `description` | API 소비자 | ✅ | JSDoc 본문 |
| **표준** | `$comment` | 스키마 작성자 | ✅ | 출력하지 않음 |
| **어노테이션** | `annotations.*` | 개발팀 내부 | ✅ | 기본은 출력하지 않음. 옵션을 켜면 `note`·`see`만 JSDoc |

`$comment`는 JSON Schema 2020-12 표준 키워드입니다. `annotations`는 JSON Schema·OpenAPI 예약어와 겹치지 않는 이름입니다.

---

## annotations 필드

```yaml
annotations:
  # ── 문서화 ────────────────────
  note: string       # 구현 메모, 설계 이유
  todo: string       # 미완성 항목
  fixme: string      # 수정 필요 항목

  # ── 수명주기 ──────────────────
  since: string      # 도입 시점 ("2024-01", "v2.1")
  until: string      # 제거 예정 시점
  replaces: string   # 이전 필드/스키마 참조
  replacedBy: string # 대체 필드/스키마 참조

  # ── 소유/책임 ──────────────────
  owner: string      # 담당 팀/개인

  # ── 관계 ────────────────────
  see: string | string[]  # 관련 스키마/문서 참조
```

필요하면 필드를 더할 수 있습니다. `annotations` 안은 자유 형식입니다.

---

## 사용 예시

### OpenAPI 문서

```yaml
components:
  schemas:
    User:
      type: object
      description: 사용자 정보
      $comment: 핵심 도메인 엔티티. 변경 시 identity-team 리뷰 필수.
      required: [id, email]
      properties:
        id:
          type: string
          format: uuid
          readOnly: true
          $comment: PK. 자동 생성.
        legacyCode:
          type: string
          deprecated: true
          description: 레거시 사용자 코드
          annotations:
            replacedBy: "#/components/schemas/User/properties/id"
            until: "v3.0"
            note: 외부 시스템 연동용으로 당분간 유지
            owner: migration-team
        email:
          type: string
          format: email
          annotations:
            note: OAuth 연동 시 이메일 변경 불가
            see: "https://wiki.internal/identity/email-policy"
        role:
          type: string
          enum: [admin, user, guest]
          annotations:
            since: "2024-06"
            note: guest는 읽기 전용
```

### TypeSpec

TypeSpec에서는 `@extension`으로 같은 필드를 붙입니다. 생성된 OpenAPI의 Schema Object에 `annotations`와
`$comment`가 그대로 들어갑니다. 이 저장소의 production 모듈에 쓸 때는 승인 후보 diff에서 결과를 확인합니다
([기본 스펙 사용 기준 3절](./basic-spec-usage.md#3-계약-변경-작업-순서)).

```typespec
@doc("사용자 정보")
@extension("$comment", "핵심 도메인 엔티티. 변경 시 identity-team 리뷰 필수.")
model User {
  @extension("$comment", "PK. 자동 생성.")
  @format("uuid")
  @visibility(Lifecycle.Read)
  id: string;

  #deprecated "use id"
  @doc("레거시 사용자 코드")
  @extension("annotations", #{
    replacedBy: "#/components/schemas/User/properties/id",
    until: "v3.0",
    note: "외부 시스템 연동용으로 당분간 유지",
    owner: "migration-team",
  })
  legacyCode?: string;
}
```

(`@extension`은 `import "@typespec/openapi"; using OpenAPI;`가 필요합니다. `#deprecated`는 property에 `deprecated: true`를 만듭니다.)

---

## typegen 출력

### 기본 (`oa-gen typegen`)

`oa-gen typegen`은 `$comment`와 `annotations`를 출력하지 않습니다. 위 OpenAPI 예시의 출력은 다음과 같습니다
(property는 이름순으로 정렬됩니다).

```ts
/** 사용자 정보 */
export type User = {
  /** @format email */
  email: string
  /** @format uuid */
  readonly id: string
  /**
  * 레거시 사용자 코드
  * @deprecated
  */
  legacyCode?: string
  role?: 'admin' | 'user' | 'guest'
}
```

### `includeAnnotations: true`

`annotations`를 JSDoc에 넣는 옵션은 CLI 플래그가 아니라 `@oa-sdk/codegen/typegen` API 옵션입니다
(`oa-gen typegen`에는 이 옵션이 없습니다). `generateTypesFromSpec()`이나 `generateTypes()`에 넘깁니다.

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'

const spec = parse(readFileSync('./openapi.yaml', 'utf8'))
writeFileSync('./src/types.ts', generateTypesFromSpec(spec, { includeAnnotations: true }))
```

```ts
/** 사용자 정보 */
export type User = {
  /**
  * @format email
  * @note OAuth 연동 시 이메일 변경 불가
  * @see https://wiki.internal/identity/email-policy
  */
  email: string
  /** @format uuid */
  readonly id: string
  /**
  * 레거시 사용자 코드
  * @deprecated
  * @note 외부 시스템 연동용으로 당분간 유지
  */
  legacyCode?: string
  /** @note guest는 읽기 전용 */
  role?: 'admin' | 'user' | 'guest'
}
```

JSDoc에는 `note`와 `see`만 들어갑니다. `todo`, `fixme`, `owner`, `since`, `until`, `replaces`, `replacedBy`는 개발
과정용이라 코드에 노출하지 않습니다.

---

## 규칙 요약

1. **소비자용 문서** → `description` (짧게)
2. **스키마 작성자 메모** → `$comment` (한 줄)
3. **구조화된 내부 metadata** → `annotations` 객체
4. **폐기 예정** → `deprecated: true` (OpenAPI 표준, TypeSpec은 `#deprecated`)
5. **Schema Object 밖** → `x-` 접두사 필수 (OpenAPI 규칙)
