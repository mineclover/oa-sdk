# nestjs-ref

NestJS Swagger → oa-sdk governance 레퍼런스 구현. 외부 OpenAPI 산출물을 oa-sdk 기능별 artifact interface로 연결하는 표준 흐름의 작동하는 예제다.

상세 가이드: [docs/guides/use-cases/nestjs-swagger-governance.md](../../docs/guides/use-cases/nestjs-swagger-governance.md)
서비스 템플릿: [docs/guides/openapi-governance-service-template.md](../../docs/guides/openapi-governance-service-template.md)

## 구성

- `src/` — NestJS 10 + Swagger 7 앱(users, health 컨트롤러).
- `scripts/export-openapi.ts` — `SwaggerModule.createDocument()`로 `contracts/openapi.raw.{yaml,json}` 출력.
- `scripts/openapi-governance.sh` — `oa-gen scaffold-governance`가 생성한 표준 진입점.
- `openapi-governance.config.json` — artifact interface와 consumer 매핑(`oa-gen.openapi-governance.v1`).
- `openapi-governance.md` — 서비스별 governance 설정 문서.
- `contracts/v1.openapi.yaml` — 커밋된 baseline. 나머지 `contracts/openapi.{raw,normalized,upgraded}.{yaml,json}`과 `src/generated/`는 gitignore.

## 사용

```bash
pnpm install                    # 워크스페이스 루트에서 1회
pnpm --filter @oa-sdk/codegen build

# 작업 디렉토리: apps/nestjs-ref
pnpm export:openapi             # NestJS → contracts/openapi.raw.yaml
bash scripts/openapi-governance.sh all   # collect → check → review → typegen → validate-upgraded
bash scripts/openapi-governance.sh inventory
bash scripts/openapi-governance.sh drift              # 별도 터미널에서 pnpm dev로 서버 실행 중일 때
bash scripts/openapi-governance.sh update-baseline    # 의도된 변경 후 baseline 갱신
```

설치된 `oa-gen`을 쓰려면 `OA_GEN=oa-gen bash scripts/openapi-governance.sh all`. 첫 실행 시 baseline이 없으면 `update-baseline`을 가리키는 안내가 출력된다.

## 재생성

scaffold 출력을 다시 만들고 싶으면 워크스페이스 루트에서:

```bash
node packages/codegen/dist/cli/index.js scaffold-governance \
  --root apps/nestjs-ref \
  --service nestjs-ref \
  --profile nestjs-swagger \
  --source-command "pnpm export:openapi" \
  --runtime-openapi-url "http://localhost:3000/openapi.json" \
  --force
```
