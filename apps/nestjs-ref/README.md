# nestjs-ref

NestJS Swagger → oa-sdk governance 레퍼런스 구현. 외부 OpenAPI 산출물을 oa-sdk 기능별 artifact interface로 연결하는 표준 흐름의 작동하는 예제다. FastAPI 변형은 [`apps/fastapi-ref/`](../fastapi-ref/) 참조 — 동일 파이프라인, `--profile fastapi`만 다름.

상세 가이드: [docs/guides/use-cases/nestjs-swagger-governance.md](../../docs/guides/use-cases/nestjs-swagger-governance.md) (NestJS / FastAPI 양쪽 다룸)
서비스 템플릿: [docs/guides/openapi-governance-service-template.md](../../docs/guides/openapi-governance-service-template.md)

## 구성

- `src/` — NestJS 10 + Swagger 7 앱(users, health 컨트롤러).
- `scripts/export-openapi.ts` — `SwaggerModule.createDocument()`로 `contracts/openapi.raw.{yaml,json}` 출력.
- `scripts/openapi-governance.sh` — `oa-gen scaffold-governance`가 생성한 표준 진입점.
- `openapi-governance.config.json` — artifact interface, consumer 매핑, 독립 CLI/CI baseline 정책(`oa-gen.openapi-governance.v2`).
- `openapi-governance.md` — 서비스별 governance 설정 문서. 실제 PR gate는 repository-root `.github/workflows/ci.yml`의 `governance-references` job이 소유한다(하위 앱 디렉터리의 workflow는 GitHub Actions가 실행하지 않음).
- `contracts/v1.openapi.yaml` — 커밋된 baseline. 나머지 `contracts/openapi.{raw,normalized,upgraded}.{yaml,json}`과 `src/generated/`는 gitignore.

## 사용

```bash
pnpm install                    # 워크스페이스 루트에서 1회
pnpm --filter @oa-sdk/codegen build

# 작업 디렉토리: apps/nestjs-ref
pnpm export:openapi             # NestJS → contracts/openapi.raw.yaml
bash scripts/openapi-governance.sh all          # collect → check → review → typegen → validate-upgraded
bash scripts/openapi-governance.sh review-bundle # PR comment용 단일 markdown(inventory 포함)
bash scripts/openapi-governance.sh inventory
bash scripts/openapi-governance.sh drift                                                  # localhost:3000 OpenAPI와 비교
bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"  # 인증된 runtime URL
bash scripts/openapi-governance.sh update-baseline                                        # 의도된 변경 후 baseline 갱신
bash scripts/openapi-governance.sh ci                                                     # review evidence artifact + strict validation
```

`drift` 케이스는 추가 인자를 그대로 `oa-gen drift`에 전달하므로 `--runtime-header`, `--behavior-log`, `--format json` 등을 자유롭게 붙일 수 있다.

`package.json`에는 셸 진입점을 1:1로 매핑한 npm alias가 있다.

| 스크립트 | 동작 |
|---|---|
| `pnpm governance:all` | `bash scripts/openapi-governance.sh all` |
| `pnpm governance:collect` | `... collect` |
| `pnpm governance:check` | `... check` (baseline freshness 단독) |
| `pnpm governance:review` | `... review` |
| `pnpm governance:review-bundle` | `... review-bundle` |
| `pnpm governance:ci` | CI target (review bundle + validation + typegen) |
| `pnpm governance:inventory` | `... inventory` |
| `pnpm governance:validate-upgraded` | `... validate-upgraded` |
| `pnpm governance:drift` | `... drift`(추가 인자 forwarding은 셸 직접 호출 사용) |
| `pnpm governance:update-baseline` | `... update-baseline` |
| `bash scripts/openapi-governance.sh ci` | review bundle을 `.oa-sdk/governance`에 남기는 CI target |

설치된 `oa-gen`을 쓰려면 `OA_GEN=oa-gen bash scripts/openapi-governance.sh all`. 첫 실행 시 baseline이 없으면 `update-baseline`을 가리키는 안내가 출력된다. 스크립트 헤더의 `# config fingerprint: <hash>` 라인이 현재 `openapi-governance.config.json`과 어긋나면 `--force` 재스캐폴드 신호다.

## 재생성

scaffold 출력을 다시 만들고 싶으면 워크스페이스 루트에서:

```bash
node packages/codegen/dist/cli/index.js scaffold-governance \
  --root apps/nestjs-ref \
  --service nestjs-ref \
  --profile nestjs-swagger \
  --source-command "pnpm export:openapi" \
  --runtime-openapi-url "http://localhost:3000/openapi.json" \
  --oa-gen-command "node ../../packages/codegen/dist/cli/index.js" \
  --oa-gen-setup-command "pnpm --filter @oa-sdk/codegen build" \
  --typegen-policy verify-only \
  --force
```
