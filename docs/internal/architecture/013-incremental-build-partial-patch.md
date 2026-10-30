# ADR-013 Review — Incremental Build and Partial Patch Boundary

## 상태

**Proposed design review** — 구현 결정을 확정하기 전 검토 문서다.

## 검토 질문

OpenAPI/TypeSpec 계약의 작은 변경이 있을 때 전체 parser·codegen·package build를 다시 수행하지
않고, 영향받은 산출물만 재생성하거나 안전하게 부분 패치할 수 있는가?

## 현재 근거

- ADR-006의 `WorkspaceIndex`는 파일 hash, component, `$ref`, diagnostic, source location,
  type alias를 저장하고 변경·삭제 파일에서 reverse ref로 dirty 파일을 계산한다.
- Definition Builder adapter는 fragment → fragment → target의 영향 target을 계산한다.
- `oa-gen validate --incremental`과 `typegen --incremental`은 input/options/output fingerprint가
  같을 때 재사용하고, 변경 시 현재 입력을 다시 parse/build한다.
- `.oa-manifest.json`은 generated artifact의 owner/hash/pruning 기록이다. Source-level patch
  dependency graph나 semantic diff를 제공하지 않는다.
- `ast-sync`의 `patch()`는 TypeScript/Zod/Typia source의 trivia-preserving text edit API다.
  이는 generated output invalidation과 다른 경계다.
- Turbo는 package task 단위 cache를 제공한다. 현재 `build` cache는 package output `dist/**`를
  단위로 관리하며 source file 하나만 바뀐 경우 package 내부 산출물의 일부만 재사용하지 않는다.

## 결론 초안

“부분 패치”를 하나의 기능으로 취급하지 않는다. 다음 두 capability를 분리한다.

1. **Impact-scoped regeneration**: WorkspaceIndex가 계산한 영향 산출물만 다시 생성한다. 생성
   파일은 text patch하지 않고 generation unit 단위로 재생성한다.
2. **Ownership-scoped source patch**: 사용자가 소유한 TypeScript/Zod source 파일에만 AST
   adapter patch를 적용한다. generated OpenAPI/TS/router/client 파일에는 적용하지 않는다.

1단계를 먼저 채택할 것을 권고한다. 2단계는 명시적 source ownership, precondition hash,
semantic diff, 충돌 시 중단이 모두 갖춰진 뒤 별도 승인을 받는다.

## 영향 단위 모델

부분 재생성은 파일보다 semantic generation unit을 기준으로 한다.

```ts
type GenerationUnit = {
  unitId: string
  producer: 'typegen' | 'zodgen' | 'guard' | 'router' | 'client' | 'mock' | 'surface'
  sourcePointers: string[]
  outputFiles: string[]
  inputHashes: Record<string, string>
  dependencyUnitIds: string[]
}

type ImpactSet = {
  changedFiles: string[]
  dirtyFiles: string[]
  dirtyUnits: GenerationUnit[]
  preservedFiles: string[]
  reason: 'source-change' | 'ref-change' | 'config-change' | 'cache-miss' | 'fallback'
}
```

`WorkspaceIndex`와 generation manifest가 `GenerationUnit`을 연결한다. 하나의 operation이나
component가 여러 output file에 투영되면 그 file 목록을 같은 unit에 기록해 일부 파일만 갱신한
뒤 다른 파일과 불일치하는 상태를 만들지 않는다.

## 권장 실행 흐름

1. 입력·config·generator version hash를 계산한다.
2. WorkspaceIndex에서 changed/deleted files와 reverse `$ref` 영향을 계산한다.
3. source pointer를 generation unit으로 확장하고 transitive dependency를 닫는다.
4. dirty unit만 현재 parser/codegen 경로로 재생성한다.
5. preserved output은 byte-for-byte 유지하고 dirty output은 새 hash를 계산한다.
6. `.oa-manifest.json`과 generation metadata를 한 번에 atomic write한다.
7. unit precondition 또는 index가 불확실하면 전체 재생성으로 fallback한다.
8. partial 결과와 full rebuild는 같은 canonical output을 생성해야 한다.

이 흐름은 TypeSpec promotion에도 동일하게 적용한다. `.merged.yaml`이나 approved snapshot을
직접 패치하지 않고 TypeSpec bundle/approval gate를 다시 수행한다. 외부 OpenAPI input은
producer artifact를 기준으로 영향도를 계산하고, 해당 producer source의 소유권은 유지한다.

## Source patch 경계

AST patch를 허용할 수 있는 파일은 다음 조건을 모두 만족해야 한다.

- manifest가 해당 파일을 `source-owned`로 표시한다.
- 현재 파일 hash가 patch plan의 precondition hash와 같다.
- AST adapter가 target declaration의 stable identity를 찾는다.
- semantic diff가 허용된 변경 범위 안에 있다.
- patch 후 TypeScript/parser/codegen 검증이 통과한다.

generated 파일, `.merged*.yaml`, `dist/`, graph sidecar, 외부 producer artifact에는 source
patch를 적용하지 않는다. generated output은 generation unit 재생성만 허용한다. precondition이
다르면 patch를 시도하지 않고 conflict report와 full rebuild 안내를 반환한다.

## 선택지 비교

| 선택지 | 이점 | 위험 | 판정 |
|---|---|---|---|
| Full rebuild + Turbo cache | 가장 단순하고 현재 correctness가 강함 | 작은 변경에도 package 단위 비용 | 기본 fallback으로 유지 |
| Impact-scoped regeneration | 변경 범위에 비례한 codegen 비용, generated output 정합성 유지 | unit dependency graph와 atomic manifest 필요 | 1단계 권장 |
| Generated text patch | 빠른 write 가능 | stale output, import/ordering/manifest drift, semantic loss | 채택하지 않음 |
| Source AST patch | 사용자 코드 trivia 보존, 작은 편집 가능 | ownership·conflict·semantic validation 필요 | 별도 2단계 검토 |
| Turbo task 분할 | package build cache hit 증가 | task graph와 output boundary 복잡도 | impact model 이후 보완 |

## 성능 검증

구현 전후에 같은 fixture로 cold full build, warm no-op incremental run, 단일 leaf component
변경, high-fanout shared component 변경, 외부 `$ref` 변경, TypeSpec decorator/provenance-only
변경, config/generator version fallback을 측정한다.

parse, impact analysis, generation, write, test, cache hit, regenerated unit/file 수와 output
byte 수를 기록한다. 목표는 단일 leaf 변경에서 전체 output 재생성을 피하는 것이며, high-fanout
변경을 억지로 작게 보이는 결과로 분할하지 않는다.

## 완료 조건

- 영향도 계산 결과와 full rebuild 결과의 dirty output이 byte/semantic 기준으로 일치한다.
- 영향받지 않은 output과 manifest entry는 byte-for-byte 유지된다.
- stale precondition, index corruption, generator/config mismatch는 안전하게 full fallback한다.
- TypeSpec promotion, external OpenAPI intake, router/client/mock generation에 source patch가
  유입되지 않는다.
- leaf/high-fanout/ref/config fixture의 timing과 regenerated unit 증거가 기록된다.

이 조건을 만족하기 전에는 `partial patch`를 public CLI promise로 문서화하지 않는다.

## 현재 검증 evidence

Target bundle incremental reuse는 실제 CLI에서 확인했다: [2026-10-30 실행 리포트](../../reports/generate-incremental-20261030.md).
이 검증은 `generate`의 OpenAPI target을 대상으로 하며, TypeSpec compiler observation을 포함한
전체 generation input graph와 source AST patch의 완료를 의미하지 않는다.
