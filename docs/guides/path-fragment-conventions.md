# Path Fragment Conventions

OpenAPI path를 모듈화할 때는 API URL, source identity, file path, JSON Pointer를 분리해서
관리한다. 이 규칙은 Definition Builder fragments, target-check, provenance, review feedback
모두에서 같은 좌표를 쓰기 위한 기준이다.

적용 범위:

- **Definition Builder로 계약을 조립하는 외부 서비스**: fragment가 주 원본이다. 명령은 `@oa-sdk/codegen`을 설치한 서비스에서 `oa-gen build-spec`, `oa-gen target-check`, `oa-gen duplicate-review`로 실행한다([OpenAPI Governance Service Template](./openapi-governance-service-template.md)).
- **이 저장소(oa-sdk)**: production 원본은 TypeSpec이고 `packages/schemas/src/fragments`는 rollback·참조 경로다([스키마 작성 가이드 3절](./schema-authoring.md#3-배포-환경-projection과-rollback-경로-저장소)). 저장소 루트에는 `oa-gen`이 PATH에 없으므로 `node packages/codegen/dist/cli/index.js <명령>`으로 실행한다. rollback 경로는 `pnpm schema:rollback-check`로 검증한다. `pnpm schema:validate:openapi`를 직접 실행하면 추적 중인 `packages/schemas/src/.merged.3.1.yaml`과 `.merged.3.1.meta.json`이 rollback 결과로 덮어써지므로, 커밋 전에 `pnpm schema:validate`를 다시 실행한다.

## 좌표 4종

| 좌표 | 예시 | 역할 |
|---|---|---|
| OpenAPI path key | `/books/{bookId}/notes/{noteId}` | 실제 API surface, target-check/diff 대상 |
| Canonical id | `path:public/book/BookNoteByIdPath` | source fragment identity |
| Filesystem path | `fragments/path/public/book/books/by-book-id/notes/by-note-id/BookNoteByIdPath.yaml` | 사람이 찾는 파일 위치 |
| JSON Pointer | `#/paths/~1books~1{bookId}~1notes~1{noteId}/get` | artifact/provenance/review 위치 |

이 네 가지를 서로 대체하지 않는다.

JSON Pointer는 손으로 escape하지 말고 `@oa-sdk/parser`의 RFC 6901 helper로 만든다. `formatJsonPointer`는
percent-encoding을 하지 않으므로 결과에 `#`를 붙이면 이 문서의 표기와 같다.

```typescript
import { formatJsonPointer } from '@oa-sdk/parser'

'#' + formatJsonPointer(['paths', '/books/{bookId}/notes/{noteId}', 'get'])
// → '#/paths/~1books~1{bookId}~1notes~1{noteId}/get'
```

나머지 helper(`appendJsonPointer`, `parseJsonPointer` 등)는 [SchemaAlgebra 문서](./schema-algebra.md#json-pointer-helper)에 있다.

## Folder Rule

Path fragment 파일은 URL hierarchy를 파일 시스템에 반영한다.

```txt
fragments/path/{scope}/{domain}/{url-tree}/{Name}Path.yaml
```

Path parameter segment는 `by-{param-name}` 폴더로 쓴다.

```txt
/books/{bookId}
→ books/by-book-id/

/books/{bookId}/notes/{noteId}
→ books/by-book-id/notes/by-note-id/

/books/{bookId}/notes/{noteId}/comments/{commentId}
→ books/by-book-id/notes/by-note-id/comments/by-comment-id/
```

camelCase parameter는 kebab-case로 바꾼다.

```txt
{bookId} -> by-book-id
{noteId} -> by-note-id
{organizationId} -> by-organization-id
```

`{bookId}` 같은 brace 폴더명은 쓰지 않는다. Shell/glob/tooling에서 special character로
취급될 수 있고, `by-book-id`가 "특정 book 아래"라는 의미를 더 명확히 드러낸다.

## Canonical Id Rule

파일 경로가 깊어져도 canonical id는 깊어지지 않는다.

```txt
path:public/book/BookNoteCommentsPath
```

다음처럼 URL tree를 canonical id segment에 넣지 않는다.

```txt
path:public/book/books/notes/comments/BookNoteCommentsPath
```

Canonical id 형식은 항상 다음이다.

```txt
kind:scope/domain/name
```

## metadata.path Rule

OpenAPI path 원문은 path fragment의 `metadata.path`에 둔다.

```yaml
id: path:public/book/BookNoteCommentByIdPath
metadata:
  path: /books/{bookId}/notes/{noteId}/comments/{commentId}
content:
  get:
    operationId: getBookNoteComment
    parameters:
      - $ref: oa://parameter/shared/common/BookId
      - $ref: oa://parameter/shared/common/NoteId
      - $ref: oa://parameter/shared/common/CommentId
    responses:
      "200":
        description: OK
```

`metadata.path`는 target selection의 exact match 대상이다. Trailing slash, parameter name,
case가 다르면 다른 path로 취급한다.

## File Naming Rule

파일명은 같은 폴더 안에서 의미가 분명해야 한다.

| API path | 파일명 |
|---|---|
| `/books` | `BooksPath.yaml` |
| `/books/{bookId}` | `BookByIdPath.yaml` |
| `/books/{bookId}/notes` | `BookNotesPath.yaml` |
| `/books/{bookId}/notes/{noteId}` | `BookNoteByIdPath.yaml` |
| `/books/{bookId}/notes/{noteId}/comments` | `BookNoteCommentsPath.yaml` |
| `/books/{bookId}/notes/{noteId}/comments/{commentId}` | `BookNoteCommentByIdPath.yaml` |

권장 구조:

```txt
packages/schemas/src/fragments/path/public/book/
  books/
    BooksPath.yaml
    by-book-id/
      BookByIdPath.yaml
      notes/
        BookNotesPath.yaml
        by-note-id/
          BookNoteByIdPath.yaml
          comments/
            BookNoteCommentsPath.yaml
            by-comment-id/
              BookNoteCommentByIdPath.yaml
```

## Component Folder Rule

Schema/response/parameter는 URL tree보다 domain model 기준으로 둔다.

```txt
fragments/schema/public/book/
  Book.yaml
  BookNote.yaml
  BookNoteComment.yaml

fragments/response/public/book/
  BookNoteCommentsResponse.yaml

fragments/parameter/shared/common/
  BookId.yaml
  NoteId.yaml
  CommentId.yaml
```

Path nesting이 깊어져도 component inclusion은 URL tree가 아니라 `oa://...` ref graph로 결정한다.

## Target Rule

Target config는 file path를 보지 않고 `metadata.path`를 exact match한다.

```yaml
includePaths:
  - /books
  - /books/{bookId}
  - /books/{bookId}/notes
  - /books/{bookId}/notes/{noteId}
  - /books/{bookId}/notes/{noteId}/comments
  - /books/{bookId}/notes/{noteId}/comments/{commentId}
```

Public target이 admin/internal path를 포함하지 않도록 `target-check`에서 gate를 둔다.
`--fragments`를 생략하면 target 파일 옆의 `../fragments`를 읽는다.

```bash
# 서비스 저장소
npx oa-gen target-check \
  --target contracts/targets/public-api.yaml \
  --fragments contracts/fragments \
  --must-include-path /books \
  --must-exclude-path /admin/books
```

```bash
# 이 저장소 (rollback 경로의 book-notebook target)
node packages/codegen/dist/cli/index.js target-check \
  --target packages/schemas/src/targets/book-notebook-api.yaml \
  --must-include-path "/books/{bookId}/notes" \
  --must-exclude-path /admin/books
```

assertion이 하나라도 실패하면 종료 코드 1이다.

## Feedback Coordinate Rule

Path 기반 feedback은 가능한 한 다음 순서로 좌표를 같이 남긴다.

1. OpenAPI path key: `/books/{bookId}/notes`
2. Operation: `GET /books/{bookId}/notes`
3. Output JSON Pointer: `#/paths/~1books~1{bookId}~1notes/get`
4. Canonical id: `path:public/book/BookNotesPath`
5. Source file: `fragments/path/public/book/books/by-book-id/notes/BookNotesPath.yaml`
6. Source pointer: `#/content/get`

Provenance sidecar는 이 좌표를 연결한다.

```json
{
  "#/paths/~1books~1{bookId}~1notes/get": {
    "canonicalId": "path:public/book/BookNotesPath",
    "kind": "path",
    "sourcePath": "packages/schemas/src/fragments/path/public/book/books/by-book-id/notes/BookNotesPath.yaml",
    "sourcePointer": "#/content/get",
    "contentHash": "sha256:..."
  }
}
```

## Collision Rule

같은 hierarchy에서 parameter 이름만 다른 path를 만들지 않는다.

```txt
/books/{bookId}
/books/{id}
```

둘은 같은 hierarchy로 취급될 수 있으므로 하나로 통일한다.

같은 emitted path를 여러 domain이 소유하지 않는다.

```txt
path:public/book/BookNotesPath
path:public/note/BookNotesPath
```

부모 resource가 ownership을 갖는 쪽으로 정한다. `/books/{bookId}/notes`는 보통 `book`
domain이 소유한다.

## Checklist

- [ ] Path fragment 파일은 URL tree를 따른다.
- [ ] Parameter folder는 `by-{param-name}`이고 camelCase는 kebab-case다.
- [ ] Canonical id는 `kind:scope/domain/name` 3단계다.
- [ ] OpenAPI path 원문은 `metadata.path`에 있다.
- [ ] Target `includePaths`는 `metadata.path`와 exact match한다.
- [ ] Path parameters는 operation 또는 path item에서 명시적으로 참조한다.
- [ ] Component fragments는 URL tree가 아니라 domain model 기준이다.
- [ ] Path feedback에는 OpenAPI path, pointer, canonical id, source file을 함께 남긴다.
