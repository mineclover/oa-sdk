# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), 중장기 방향은 [plan.md](./plan.md)를 참조하세요.

---

## 우선 (파싱됨 → 런타임 연결)

### [ ] Tags 계층 (parent/kind) — describeApi 계층 표현
파싱+인덱싱은 완료. describeApi에서 parent 관계 트리 출력 필요.
AI/사용자에게 API 구조를 계층적으로 제공하는 핵심 기능.

### [ ] Server variables URL 치환
파싱은 되지만 mock-server에서 고정 포트 사용. `{version}` → default 치환.
parseDocument → servers[].variables 사용. mock-server에서 동적 baseUrl 지원.

### [ ] Response headers — parser IR 추출
mock-server response-picker가 직접 처리 중. ParsedDocument IR에 정식 추출하여
typegen에서 응답 헤더 타입 생성, client에서 헤더 접근 지원.

### [ ] Discriminator — mock-server 검증
codegen에서 생성됨. mock-server AJV에서 discriminator 기반 다형성 검증.
현재 oneOf로 대체 동작하지만, discriminator.propertyName으로 빠른 분기 가능.

---

## 단기 (의도적 미구현 → 필요 시 구현)

### [ ] Encoding (multipart 필드별 인코딩)
타입 정의 완료. multipart/form-data 요청에서 필드별 contentType/style 지원.
현재 JSON/form-urlencoded/text만 처리.

### [ ] Links (HATEOAS 응답 관계)
타입+파싱 완료. mock-server 응답에 Link 헤더 또는 _links 필드 포함.
typegen에서 Link 타입 생성.

### [ ] Callbacks (아웃바운드 웹훅)
타입+파싱 완료. mock-server에서 callback URL로 요청 발송 시뮬레이션.

### [ ] Webhooks (인바운드 웹훅 핸들러)
타입+파싱 완료. router에서 webhook 핸들러 스텁 생성.

### [ ] XML 직렬화
타입 정의 완료. JSON 전용 시스템에서 XML content-type 지원.
우선순위 가장 낮음.

---

## 완료 항목

<details>
<summary>접기 (60+개)</summary>

(이전 60+개 생략)

</details>
