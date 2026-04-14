# Schema Annotations — 스키마 내부 어노테이션 컨벤션

> OAS 3.2의 Schema Object 확장 필드를 활용한 개발자 메타데이터 관리.

---

## 배경

JSON은 주석이 불가능하고, YAML `#` 주석은 merge/bundle 시 사라진다.
OAS 3.2 Schema Object는 `x-` 접두사 없이 커스텀 필드를 허용하므로,
`annotations` 객체와 `$comment` 필드로 개발자 내부 메모를 구조화한다.

---

## 3계층 문서화 모델

| 계층 | 필드 | 대상 | 보존 | typegen |
|------|------|------|------|---------|
| **표준** | `description` | API 소비자 | ✅ | JSDoc 출력 |
| **표준** | `$comment` | 스키마 작성자 | ✅ | **무시** |
| **어노테이션** | `annotations.*` | 개발팀 내부 | ✅ | **기본 무시**, 옵션으로 JSDoc |

### 예약어 안전

`$comment`는 JSON Schema 2020-12 표준 필드.
`annotations`는 JSON Schema/OAS 예약어 58개와 **충돌 없음**.

---

## annotations 필드 정의

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

필요에 따라 필드를 추가할 수 있다. `annotations` 내부는 자유 형식.

---

## 사용 예시

```yaml
components:
  schemas:
    User:
      type: object
      description: 사용자 정보
      $comment: 핵심 도메인 엔티티. 변경 시 identity-team 리뷰 필수.
      required: [id, email, name]
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

---

## typegen 출력

### 기본 (`includeAnnotations: false`)

```ts
/** 사용자 정보 */
export type User = {
  /** @format uuid */
  readonly id: string
  /**
   * 레거시 사용자 코드
   * @deprecated
   */
  legacyCode?: string
  /** @format email */
  email: string
  role?: 'admin' | 'user' | 'guest'
}
```

`$comment`와 `annotations`는 출력에 포함되지 않는다.

### 옵션 (`includeAnnotations: true`)

```ts
/** 사용자 정보 */
export type User = {
  /** @format uuid */
  readonly id: string
  /**
   * 레거시 사용자 코드
   * @deprecated
   * @note 외부 시스템 연동용으로 당분간 유지
   * @see "#/components/schemas/User/properties/id"
   */
  legacyCode?: string
  /**
   * @format email
   * @note OAuth 연동 시 이메일 변경 불가
   * @see https://wiki.internal/identity/email-policy
   */
  email: string
  /**
   * @note guest는 읽기 전용
   */
  role?: 'admin' | 'user' | 'guest'
}
```

`note`와 `see`만 JSDoc에 포함. `todo`, `fixme`, `owner`, `since`, `until`은 개발 프로세스용이라 코드에 노출하지 않는다.

---

## 규칙 요약

1. **소비자용 문서** → `description` (짧게)
2. **스키마 작성자 메모** → `$comment` (한 줄)
3. **구조화된 내부 메타데이터** → `annotations` 객체
4. **폐기 예정** → `deprecated: true` (OAS 표준)
5. **Schema Object 밖** → `x-` 접두사 필수 (OAS 규칙)
