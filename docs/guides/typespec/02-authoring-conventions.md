# TypeSpec 작성 규칙 및 컨벤션 표준 (TypeSpec Authoring Conventions)

이 문서의 내용은 [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)으로 합쳤습니다. oa-sdk 저장소의 production 계약(`packages/schemas/typespec/`)을 고칠 때 따르는 규칙은 그 문서가 정본입니다.

| 찾는 내용 | 정본 위치 |
|---|---|
| 파일 오너십, 새 모듈의 머리말(import, `using`, `namespace OaSdkApi;`) | [1. 파일 오너십](../typespec-authoring-conventions.md#1-파일-오너십-ownership) |
| operationId, 필수 메타데이터, DTO·열거형 이름 | [2. 이름 규칙](../typespec-authoring-conventions.md#2-이름-규칙) |
| `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`, `ErrorResponse<Status>` 사용법과 재사용 응답 연결 | [3. 응답 선언](../typespec-authoring-conventions.md#3-응답-선언) |
| `@format`, `@minLength`, `@minValue` 등 제약 | [4. 데이터 타입 제약](../typespec-authoring-conventions.md#4-데이터-타입-제약) |
| API 계약·패키지·artifact schema 버전 채널 | [6. 버전 채널](../typespec-authoring-conventions.md#6-버전-채널-versioning) |
| 변경·승인 절차 | [7. 계약 변경 절차](../typespec-authoring-conventions.md#7-계약-변경-절차-contract-change-workflow) |

다른 프로젝트에서 TypeSpec을 쓸 때의 표준 계약(`OaSdkTypeSpec` namespace)과 decorator는 [`@oa-sdk/typespec-decorators` README](../../../packages/typespec-decorators/README.md)를 봅니다.

## 다음 단계
- [TypeSpec 5분 퀵스타트 (저장소 기여자용)](./01-quickstart-5min.md)
- [TypeSpec 데코레이터 레퍼런스](./03-decorators-reference.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
- [생성물 배치 토폴로지와 아키텍처 규칙](./06-generation-topologies-and-rules.md)
