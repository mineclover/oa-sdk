# OpenAPI 3.2 계약 관리

> 동작 기준: `@oa-sdk/codegen` 0.9.0. 명령은 `@oa-sdk/codegen`을 설치한 프로젝트에서 실행하는 형태입니다
> (설치는 [Quick Start](./quick-start.md)). 이 저장소 안에서는 `node packages/codegen/dist/cli/index.js <명령>`으로 실행합니다.

oa-sdk는 도메인 의도, 정규화된 정보 구조, 구현, 테스트, 운영 중 비교를 잇는 공개 API 계약을 관리합니다.

oa-sdk가 관리하는 계약 형식은 OpenAPI 3.2입니다. OpenAPI 3.x 문서는 모두 파싱할 수 있지만, OpenAPI 3.2 gate를
통과하기 전에는 oa-sdk가 관리하는 계약으로 보지 않습니다.

## 계층별 역할

- 데이터 모델: 우연한 저장 형태가 아니라 도메인 의도에 따라 필드를 정리합니다.
- 정보 구조: 이름, 참조, 스키마, operation, 공유 component를 정규화해 한 의미가 하나의 안정된 표현을 갖게 합니다.
- API 계약: 내부가 바뀌어도 요청, 응답, 오류, operation 의미를 안정적으로 유지해 같은 외부 기능을 제공합니다.
- 인프라: 계약 추출, 정규화, 검증, 리뷰, drift 확인을 반복 가능하게 만들어 데이터 흐름의 복잡도를 줄입니다.
- oa-sdk: 공개 API 계약을 관리하고, 문서·코드 생성·테스트·리뷰·운영 중 비교 전반에서 그 기록을 전달 가능하게 유지합니다.

## 기본 gate

배포하거나, 리뷰하거나, 클라이언트·핸들러 계약 생성의 입력으로 쓰는 생성물에는 OpenAPI 3.2 strict gate를 씁니다.

```bash
npx oa-gen validate --spec contracts/openapi.yaml --require-32
```

TypeSpec 원본은 같은 명령에 `.tsp`를 넘깁니다. codegen에 들어 있는 TypeSpec 컴파일러가 메모리에서 OpenAPI 3.2.0으로
컴파일한 뒤 검사합니다(필요한 패키지는 [Quick Start](./quick-start.md)). 이 저장소의 production 계약은
`pnpm schema:validate`로 같은 gate를 실행합니다([기본 스펙 사용 기준](./basic-spec-usage.md)).

```bash
npx oa-gen validate --spec typespec/main.tsp --require-32
```

strict gate는 OpenAPI 3.0·3.1 문서를 정보성 경고로 넘기지 않고 실패시킵니다(`parse/version-32` 오류, 종료 코드 1).
계약이 oa-sdk 관리에 들어오면 downstream 도구가 OpenAPI 3.2 의미를 가정할 수 있도록 하기 위해서입니다.

## 수집·이전 작업 (호환 모드)

3.2가 아닌 문서는 수집이나 이전 작업에서만 호환 모드로 다룹니다. `upgrade`는 3.2 분석용 문서를 따로 쓰고, `--report`로
변환 내역(`oa-gen.openapi-upgrade-report.v1`)을 남깁니다. 원본 문서는 고치지 않습니다.

```bash
npx oa-gen validate --spec contracts/openapi.raw.yaml
npx oa-gen upgrade --spec contracts/openapi.raw.yaml --output contracts/openapi.upgraded.yaml --report contracts/openapi.upgrade-report.json
npx oa-gen validate --spec contracts/openapi.upgraded.yaml --require-32
```

NestJS·FastAPI처럼 런타임이 문서를 내보내는 서비스는 `oa-gen collect`가 원본 보존, 정규화, 3.2 변환을 한 번에 하고,
`oa-gen scaffold-governance`가 서비스별 수집·검사 스크립트를 만듭니다. 절차는
[OpenAPI Governance Service Template](./openapi-governance-service-template.md)을 따릅니다.
