# spec-reference 관리 가이드

OpenAPI 공식 스펙 원문을 로컬에서 탐색하고 동기화하는 방법을 다룹니다.

## 구조

```
references/
└── OpenAPI-Specification/   ← git submodule (OAI 공식 레포, 읽기 전용)

docs/references/
└── oas32/                   ← split-spec 스크립트 생성물 (탐색용)
    ├── index.md             ← 진입점
    ├── 00~15-*.md           ← 의미 단위 분할본
    └── appendices/
```

원본 submodule → `pnpm split-spec` → 분할본 생성 흐름입니다.
분할본은 생성물이므로 직접 편집하지 않습니다.

---

## 분할본 탐색

```bash
# 인덱스에서 시작
cat docs/references/oas32/index.md

# 특정 기능 검색
grep -rn "itemSchema" docs/references/oas32/
grep -rn "deviceAuthorization" docs/references/oas32/14-security.md
grep -rn "dataValue" docs/references/oas32/10-examples-links.md

# 원본 전문 검색 (라인 번호 포함)
grep -n "itemSchema" references/OpenAPI-Specification/versions/3.2.0.md
```

---

## 분할본 재생성 (split 동기화)

submodule 버전을 올리거나 `split-spec.ts` 자체를 수정한 뒤 실행합니다.

```bash
pnpm --filter @oa-sdk/schemas run split-spec
```

분할 기준(섹션 그룹)을 바꾸려면 `packages/schemas/scripts/split-spec.ts`의
`OBJECTS_GROUPS` 배열을 수정한 뒤 재실행합니다.

---

## submodule 업데이트 (새 OAS 버전으로 올리기)

### 1. 최신 태그 확인

```bash
git -C references/OpenAPI-Specification fetch --tags
git -C references/OpenAPI-Specification tag | grep "^3\." | sort -V
```

현재 핀: `3.2.0`

### 2. 원하는 버전으로 체크아웃

```bash
git -C references/OpenAPI-Specification checkout <tag>
# 예: git -C references/OpenAPI-Specification checkout 3.2.1
```

### 3. 부모 레포에 핀 업데이트 반영

```bash
git add references/OpenAPI-Specification
```

> submodule은 특정 커밋을 가리키는 포인터입니다.
> `git add`로 부모 레포에 새 커밋 포인터를 스테이징해야
> 다른 사람이 클론할 때 같은 버전을 받습니다.

### 4. 분할본 재생성

```bash
pnpm --filter @oa-sdk/schemas run split-spec
```

### 5. schemas 버전 선언 업데이트

`packages/schemas/src/openapi.yaml`의 `openapi:` 필드를 새 버전으로 변경합니다.

---

## 레포 클론 후 submodule 초기화

이 레포를 처음 받은 경우 submodule이 비어있습니다.

```bash
# 클론과 동시에
git clone --recurse-submodules <repo-url>

# 이미 클론한 경우
git submodule update --init --recursive
```

초기화 후 `pnpm split-spec`을 실행해 분할본을 생성합니다.

---

## 현재 버전 확인

```bash
git -C references/OpenAPI-Specification describe --tags
# → 3.2.0
```
