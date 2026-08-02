# fastapi-ref

FastAPI → oa-sdk governance 레퍼런스 구현. 외부 OpenAPI 산출물을 oa-sdk 기능별 artifact interface로 연결하는 표준 흐름의 작동하는 예제(Python/FastAPI 변형). NestJS Swagger 변형은 [`apps/nestjs-ref/`](../nestjs-ref/) 참조.

상세 가이드: [docs/guides/use-cases/nestjs-swagger-governance.md](../../docs/guides/use-cases/nestjs-swagger-governance.md) (FastAPI도 동일 파이프라인을 사용한다 — `--profile fastapi`만 다름).

서비스 템플릿: [docs/guides/openapi-governance-service-template.md](../../docs/guides/openapi-governance-service-template.md)

## 구성

- `src/` — FastAPI 0.115 + Pydantic 2 앱(users, health 라우트).
- `scripts/export_openapi.py` — `app.openapi()`로 `contracts/openapi.raw.{yaml,json}` 출력.
- `scripts/openapi-governance.sh` — `oa-gen scaffold-governance --profile fastapi`가 생성한 표준 진입점.
- `openapi-governance.config.json` — artifact interface, consumer 매핑, 독립 CLI/CI baseline 정책(`oa-gen.openapi-governance.v2`).
- `openapi-governance.md` — 서비스별 governance 설정 문서. 실제 PR gate는 repository-root `.github/workflows/ci.yml`의 `governance-references` job이 소유한다(하위 앱 디렉터리의 workflow는 GitHub Actions가 실행하지 않음).
- `contracts/v1.openapi.yaml` — 커밋된 baseline. 나머지 `contracts/openapi.{raw,normalized,upgraded}.{yaml,json}`과 `src/generated/`는 gitignore.

## 사용

```bash
# 워크스페이스 루트에서 codegen 빌드 (1회)
pnpm --filter @oa-sdk/codegen build

# 작업 디렉토리: apps/fastapi-ref
uv sync                                              # Python 의존성 설치 (한번)
uv run python scripts/export_openapi.py              # FastAPI → contracts/openapi.raw.yaml
bash scripts/openapi-governance.sh all               # collect → check → review → typegen → validate-upgraded
bash scripts/openapi-governance.sh review-bundle     # PR comment용 단일 markdown
bash scripts/openapi-governance.sh inventory
bash scripts/openapi-governance.sh drift                                                  # localhost:8000 OpenAPI와 비교
bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"  # 인증된 runtime URL
bash scripts/openapi-governance.sh update-baseline                                        # 의도된 변경 후 baseline 갱신
bash scripts/openapi-governance.sh ci                                                     # review evidence artifact + strict validation
```

`drift` 케이스는 추가 인자를 그대로 `oa-gen drift`에 전달한다. 첫 실행 시 baseline이 없으면 `update-baseline`을 가리키는 안내가 출력된다. 스크립트 헤더의 `# config fingerprint: <hash>` 라인이 현재 `openapi-governance.config.json`과 어긋나면 `--force` 재스캐폴드 신호다.

## 재생성

scaffold 출력을 다시 만들고 싶으면 워크스페이스 루트에서:

```bash
node packages/codegen/dist/cli/index.js scaffold-governance \
  --root apps/fastapi-ref \
  --service fastapi-ref \
  --profile fastapi \
  --source-command "uv run python scripts/export_openapi.py" \
  --runtime-openapi-url "http://localhost:8000/openapi.json" \
  --oa-gen-command "node ../../packages/codegen/dist/cli/index.js" \
  --oa-gen-setup-command "pnpm --filter @oa-sdk/codegen build" \
  --typegen-policy verify-only \
  --force
```

## NestJS 변형과의 차이

|  | nestjs-ref | fastapi-ref |
|---|---|---|
| 언어/프레임워크 | TypeScript / NestJS 10 + Swagger 7 | Python / FastAPI 0.115 + Pydantic 2 |
| 의존성 매니저 | pnpm | uv |
| Source command | `pnpm export:openapi` | `uv run python scripts/export_openapi.py` |
| Profile | `nestjs-swagger` | `fastapi` |
| Runtime URL | `http://localhost:3000/openapi.json` | `http://localhost:8000/openapi.json` |
| Source OpenAPI | 3.0.0 | 3.1.0 |

두 profile 모두 빈 `info.contact` / 루트 `servers` / 루트 `tags` noise 제거 동작을 공유한다.
