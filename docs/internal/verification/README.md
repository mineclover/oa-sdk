# 검증 근거와 결함 관리

기능 선택, 테스트 소유, 실행 결과, 구체적인 보장, 결함 상태를 다음 자료로 관리한다. 현재 상태는 [자동 생성 현황](./status.md)에서 확인한다.

| 자료 | 소유하는 정보 | 판단에 쓰는 범위 |
| --- | --- | --- |
| [기능 지도](../../guides/feature-map.md) | 목적과 진입점 | 사용할 기능 선택 |
| [Feature Test Matrix JSON](../feature-test-matrix.json) | 안정적인 feature ID, 담당 package, 대표 test 경로·명령 | 어떤 테스트를 유지할지 찾기 |
| [registry.json](./registry.json) | 범위를 좁힌 보장 항목, 실행 근거 연결, 결함 상태·종료 조건 | 현재 평가와 수정 우선순위 |
| `docs/reports/*-evidence*.json` 및 registry의 run artifact | 한 실행의 파일별 결과·제목·출처·소스 hash | 그 실행에서 무엇을 확인했는지 감사 |
| 날짜별 기능 리뷰 | 당시 발견·재현·설계 설명 | 과거 판단의 맥락. 현재 상태는 registry 참조 |
| [status.md](./status.md) | 위 자료를 연결한 파생 현황 | 자동 생성하며 직접 고치지 않음 |

매트릭스의 test glob은 실행 결과나 assertion의 충분성을 증명하지 않는다. 테스트 수를 기능 수·보장률·배포 준비율로 환산하지 않는다. 같은 테스트가 여러 기능을 검사해도 실행 원장에는 파일당 한 번만 집계한다. 서로 다른 실행의 수는 별도 행으로 유지하며 합산하지 않는다.

## 보장 항목

한 feature에 여러 보장 항목을 둔다. 예를 들어 `session-history-only`는 JSON 이력 이동을, `domain-undo`는 실제 domain 복원을 평가한다. 전자가 통과해도 후자는 failing일 수 있다.

| 상태 | 의미 | 필요한 근거 |
| --- | --- | --- |
| `verified` | 명시한 조건과 범위의 assertion을 직접 실행으로 확인 | 직접 실행한 정확한 test 제목, assertion 설명, 현재 선언된 소스 hash 일치, 연결된 open 결함 없음 |
| `partial` | 한정된 fixture·조건의 확인만 있으며 제외 조건이 중요함 | 현재 소스에 대한 직접 실행 근거와 명시적 제외 범위 |
| `failing` | 기대 동작과 실제 동작이 다른 조건을 재현함 | open 결함, 재현 script·관측 artifact, 소스 hash |
| `unverified` | 해당 보장에 대해 실행·검토한 근거가 없음 | 예상 검증 범위와 제외 조건 기록 |

feature에 보장 항목이 없으면 현황에 **미평가**로 표시한다. 기존 테스트 부재·기능 미구현을 뜻하지 않는다. `unit`, `integration`, `local-e2e`, `external-e2e`는 조건의 구분이며 자동 승격되는 점수 체계가 아니다. 실제 외부 제품이나 계정을 쓰는 검증은 `external-e2e`로 별도 기록한다. 현재 importer는 로컬 Vitest 결과 전용이므로 external-e2e를 verified/partial로 올릴 수 없다. 향후 외부 실행용 근거 계약을 도입해야 하며, 표식만 바꿔 로컬 통과를 운영 검증으로 승격하지 않는다.

현재 8,188개 원장은 과거 Turbo 로그의 import다. 직접 6,002개와 cache 2,186개를 분리하고 skip 4개도 별도로 보존한다. 당시 source hash·개별 test 제목을 수집하지 않았으므로 `sourceBinding: unrecorded`이며 새로운 `verified`의 근거로 사용할 수 없다. 새 tools 102개·freshness 11개는 native reporter에서 별도 수집했다.

## 실행 기록 추가

1. 해당 package에서 Vitest의 native JSON reporter로 실행한다. 원본 reporter 파일과 실제 실행 명령을 보관한다. 실행과 import 사이에 검사 대상 소스를 바꾸지 않는다. importer는 source mtime이 reporter의 실행 시작보다 뒤면 재실행을 요구한다.
2. 저장소 루트에서 `pnpm verification:record`로 import한다. 새로운 run ID와 출력 파일을 쓰며 기존 artifact를 덮어쓰지 않는다.
3. `registry.runs`에 artifact를 등록한다. 보장 항목에는 해당 run의 **정확한 full test 제목**, test 파일, 실제 assertion 설명과 `sourceFiles`를 연결한다.
4. `pnpm verification:report`로 현황을 생성하고 `pnpm test:verification`, `pnpm check:verification`을 실행한다.

예: tools package에서 다음과 같이 실행한다.

```bash
node ../../node_modules/vitest/vitest.mjs run --root . --reporter=json --outputFile=/tmp/tools-vitest.json
```

저장소 루트에서 새 ID/경로를 정해 import한다.

```bash
pnpm verification:record --run-id tools-new-review --input /tmp/tools-vitest.json --track core --source-dir packages/tools/src --source-dir packages/tools/test --command 'vitest run --root . --reporter=json (packages/tools)' --output docs/reports/tools-new-review.json
```

import 성공은 결과 기록의 성공이다. 실패한 test case도 failed로 기록한다. 모든 case가 성공한 것처럼 infra 실패를 기록하지 않으며, reporter 합계가 불완전하거나 모르는 status가 있으면 거부한다. `captured-after-execution`은 import 시 소스를 hash했다는 뜻이며, 실행 당시의 cryptographic attestation은 아니다. sourceFiles에는 보장에 영향을 주는 구현과 테스트를 포함한다. 의존성 전체를 자동 추론하지 않으므로 범위 선정은 리뷰 책임이다.

현재 보장의 source hash가 바뀌면 기존 결과를 그대로 사용해 verified를 유지할 수 없다. 재실행·재검토 후 새 artifact를 연결한다. 과거 원장에 기록한 파일은 이동·삭제되어도 과거 경로를 보존한다. 현재 보장이 참조하는 파일은 실제로 존재하고 해당 feature의 test 경로에 소유되어야 한다.

## 결함의 등록과 종료

- 결함은 stable ID, 보장 ID, 우선순위, `open`/`fixed`, 발견 보고서와 구체적인 종료 조건을 가진다.
- 고쳤다는 설명만으로 fixed로 바꾸지 않는다. 기대 동작을 검사하는 회귀를 추가·직접 실행하고 보장 항목의 근거를 갱신한 뒤 닫는다.
- 재현 artifact는 테스트 통과 원장에 넣지 않는다. 재현 script가 성공한 것은 알려진 문제가 발생했다는 뜻이다.
- 결함 재현에 연결된 소스가 바뀌면 재현을 다시 하거나, 회귀 근거를 만들어 결함 처리를 갱신한다. 이미 저장한 artifact는 보존하고 새 ID/파일을 사용한다.

현재 2차 tools 결함을 재현하려면 저장소 루트에서 존재하지 않는 출력 경로로 실행한다. 사용자 문서는 사용하지 않고 임시 파일·메모리만 사용한다.

```bash
node --import tsx scripts/review-probes/tools-round2.ts /tmp/tools-round2-new-observation.json
```

## 관리 검사

| 명령 | 확인하는 것 |
| --- | --- |
| `pnpm check:feature-tests` | feature ID와 test 경로·명령의 소유 관계 |
| `pnpm verification:report` | registry를 검증한 뒤 status.md 생성 |
| `pnpm check:verification` | 중복·집계 오류, 직접/cache/skip 분리, 정확한 test 제목, source hash, 결함·보장 모순, 현황 drift |
| `pnpm test:verification` | 잘못된 근거·집계·상태 전이를 거부하는 관리 코드의 자체 회귀 |

CI와 local-ci는 마지막 두 검사를 실행한다. 이 검사는 근거 구조의 일관성을 검증한다. test 본문이 assertion 설명을 충분히 보장하는지, 실제 제품 상호운용이 되는지는 코드 리뷰와 해당 수준의 실행으로 확인한다. **open 결함이 있다는 이유로 관리 gate를 실패시키지는 않는다.** 결함을 숨기거나 근거 없이 완료 처리하는 모순을 실패시킨다.
