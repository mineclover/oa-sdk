# TypeSpec origin graph semantic index

`oa-gen typegen`이 생성한 TypeScript 선언을 TypeSpec 원본 선언에 연결하는 sidecar(`oa-sdk.typespec-ts-graph-semantic.v1`)를 만드는 방법입니다. 생성된 TypeScript에는 출처 주석을 넣지 않고, 그래프 라우터나 코드 인텔리전스 도구가 "이 타입은 어느 `.tsp` 선언에서 나왔는가"를 별도 artifact로 읽게 합니다.

## 언제 쓰나

- 그래프 라우터의 `semanticIndex`에 생성 타입의 TypeSpec 출처를 등록할 때
- 생성 파일을 수정하지 않고 추적성(provenance)을 CI artifact로 유지할 때
- 생성 타입과 sidecar가 서로 어긋난(stale) 상태를 hash로 거절할 때

## 산출물

`hosts[]`의 각 항목이 생성 선언 하나와 TypeSpec evidence 하나를 묶습니다.

```json
{
  "version": 1,
  "originSchemaVersion": "oa-sdk.typespec-ts-graph-semantic.v1",
  "inputs": {
    "generatedTypesSha256": "…",
    "restoredOpenApiSha256": "…",
    "typeSpecProvenanceSha256": "…"
  },
  "hosts": [
    {
      "host": {
        "publicName": "User",
        "symbol": "type",
        "declaration": { "file": "src/generated/api.ts", "line": 12 }
      },
      "semanticTags": ["oa-sdk-typespec"],
      "evidence": [
        {
          "tag": "evidence",
          "target": "oa-sdk-typespec:model:user:#/components/schemas/User",
          "source": { "file": "users.tsp", "line": 8 }
        }
      ]
    }
  ]
}
```

- `generatedTypesSha256`은 생성 TypeScript 파일의 바이트 hash입니다. 파일을 고치면 sidecar는 stale이 됩니다.
- `restoredOpenApiSha256`은 typegen에 넘긴 OpenAPI 문서를 canonical JSON으로 직렬화한 hash입니다.
- `typeSpecProvenanceSha256`은 provenance JSON을 canonical JSON으로 직렬화한 hash입니다.

## 전제 조건

1. TypeSpec 번들 검사에서 **restored OpenAPI와 provenance를 같은 실행으로** 만듭니다.
2. provenance는 `oa-sdk.typespec-ref-provenance.v1`이고, `inputs.restoredOpenApiSha256`이 restored OpenAPI와 일치해야 합니다.
3. typegen에는 그 restored OpenAPI를 그대로 넘깁니다(다른 문서를 넘기면 hash 검사에서 실패합니다).

provenance artifact는 유지보수 경계(`schema-governance`)의 TypeSpec 번들 검사가 만들며, 공개 surface에서는 sidecar를 읽는 타입과 Zod 검증 스키마를 제공합니다.

## 1. provenance 생성

이 저장소의 TypeSpec 계약 파이프라인은 다음처럼 restored OpenAPI와 provenance를 함께 씁니다.

```bash
node --import tsx scripts/schema-typespec-check.ts \
  --output .oa-sdk/typespec/restored.openapi.yaml \
  --provenance .oa-sdk/typespec/declaration-ref-provenance.json
```

다른 프로젝트에서 같은 artifact를 만들 때도 **한 번의 TypeSpec 컴파일 결과**에서 restored OpenAPI와 provenance를 함께 내보내야 합니다. 둘을 따로 만들면 hash가 맞지 않습니다.

## 2. typegen으로 sidecar 생성

세 옵션을 함께 주고 `--output`을 지정합니다.

```bash
pnpm exec oa-gen typegen \
  --spec .oa-sdk/typespec/restored.openapi.yaml \
  --output src/generated/api.ts \
  --typespec-provenance .oa-sdk/typespec/declaration-ref-provenance.json \
  --graph-semantic-index .graph/oa-sdk-typespec.semantic.json \
  --graph-file src/generated/api.ts
```

- `--graph-file`은 그래프 라우터가 보는 **프로젝트 상대 경로**입니다. sidecar의 `host.declaration.file`에 그대로 기록됩니다.
- `--style interface`도 지원하며, `line`은 실제로 출력된 파일의 1-based 줄 번호입니다.
- 옵션 셋 중 하나라도 빠지면 명령은 아무 출력도 쓰지 않고 실패합니다.
- 중첩 schema에 자체 alias가 있으면 상위 schema의 owner를 따르고, 다른 문서에서 inline된 schema는 host를 만들지 않습니다.

## 3. 그래프 라우터에 등록

```jsonc
{
  "semanticIndex": ".graph/oa-sdk-typespec.semantic.json"
}
```

라우터는 `inputs.generatedTypesSha256`이 현재 생성 파일과 다르면 sidecar를 거절합니다. typegen을 다시 실행해 sidecar까지 갱신하세요.

## 4. incremental과 CI

```bash
pnpm exec oa-gen typegen \
  --spec .oa-sdk/typespec/restored.openapi.yaml \
  --output src/generated/api.ts \
  --typespec-provenance .oa-sdk/typespec/declaration-ref-provenance.json \
  --graph-semantic-index .graph/oa-sdk-typespec.semantic.json \
  --graph-file src/generated/api.ts \
  --incremental --cache-dir ./.oa-cache
```

- 타입과 sidecar는 **함께 재사용되거나 함께 다시 생성**됩니다. sidecar는 방금 생성한 선언 목록이 필요하므로, sidecar만 바뀌어도 타입을 다시 생성합니다.
- provenance 경로/내용, `--graph-file`, `--style`, 출력 파일 상태가 바뀌면 두 대상이 모두 다시 생성됩니다.
- 정상 출력 예:

```text
incremental: typegen up to date, regeneration skipped (src/generated/api.ts)
incremental: typegen:graph-semantic-index up to date, regeneration skipped (.graph/oa-sdk-typespec.semantic.json)
```

provenance만 바뀐 경우:

```text
incremental: typegen regenerating (the graph semantic index needs the generated source)
incremental: typegen:graph-semantic-index regenerating (input changed: .oa-sdk/typespec/declaration-ref-provenance.json)
```

CI에서는 `src/generated/api.ts`와 `.graph/oa-sdk-typespec.semantic.json`을 함께 commit하고, 둘 중 하나만 바뀐 PR은 typegen을 다시 실행해 둘을 맞춥니다.

## 5. 실패 진단

| 메시지 | 원인 | 해결 |
|---|---|---|
| `restoredOpenApiSha256 does not match the typegen input document` | provenance와 typegen spec이 다른 TypeSpec 컴파일 결과 | 같은 실행에서 만든 restored OpenAPI와 provenance를 함께 넘김 |
| `Generated declaration … has no TypeSpec provenance owner for …` | 그 OpenAPI pointer를 소유한 TypeSpec `emits`/`restores` edge가 없음 | provenance의 declarations/edges와 TypeSpec 모델을 확인. 소유자를 만들 수 없으면 해당 선언은 sidecar 대상에서 빠지도록 spec을 조정 |
| `requires oa-sdk.typespec-ref-provenance.v1` | 다른 schema version의 JSON | TypeSpec 번들 검사 산출물을 사용 |
| `edges.0.kind` 같은 Zod 오류 | 알 수 없는 edge kind나 필드 누락 | producer 출력 형식을 확인 |
| `--typespec-provenance`, `--graph-semantic-index`, `--graph-file` `must be given together` | 옵션 일부 누락, 또는 `--output` 없음 | 셋 다 + `--output` 지정 |
| 그래프 라우터가 sidecar를 거절 | 생성 파일이 바뀌어 hash가 다름 | `oa-gen typegen`을 다시 실행해 sidecar 갱신 |

## 6. 제약

- TypeSpec에서 복원한 OpenAPI에만 적용됩니다. 일반 OpenAPI 문서에는 TypeSpec provenance가 없습니다.
- `typeSpecGraphProvenanceSchema`(Zod)는 패키지 root entry에서만 제공됩니다. `@oa-sdk/codegen/typegen` sub-entry는 Zod를 불러오지 않습니다.
- 생성 파일을 손으로 고치면 sidecar가 stale이 됩니다. 생성 파일은 항상 typegen으로 다시 만드세요.

## 관련 문서

- [CLI 명령 레퍼런스 — `oa-gen typegen`](./cli-command-reference.md)
- [TypeSpec Builder Platform](./typespec-builder-platform.md)
- [`@oa-sdk/codegen` README](../../packages/codegen/README.md#typespec-origin-in-a-graph-semantic-index)
