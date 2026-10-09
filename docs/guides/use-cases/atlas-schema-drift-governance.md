# Ariga Atlas 물리 DB 스키마 드리프트 거버넌스 가이드

이 문서는 oa-sdk 생태계에서 **Ariga Atlas 선언적 데이터베이스 마이그레이션 도구**와 **TypeSpec/DPM 스키마 거버넌스**를 연계하여, DB 직접 변경 권한 없이 **읽기 전용 카탈로그 증거 기반으로 스키마 불일치(Drift)를 100% 정적 탐지**하는 실무 파이프라인을 다룹니다.

---

## 1. 아키텍처 원칙: DDL 비소유 불변식 (Non-DDL Invariant)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   1. Storage Tier (Physical) ── Ariga Atlas            │
│   • 산출물: db/schema.sql, atlas.hcl, migrations/*.sql                 │
│   • 책임: 테이블, 물리 컬럼, 인덱스, 파티셔닝, 방언 최적화, 마이그레이션 │
│   • 원칙: oa-sdk는 DDL을 일절 생성하지 않으며 DB를 직접 변경하지 않음  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ atlas schema inspect --format json
                                     ▼ (순수 읽기 전용 카탈로그 스냅샷 증거)
┌────────────────────────────────────────────────────────────────────────┐
│              2. Static Drift Gate ── oa-sdk DPM & @storageRef          │
│   • 입력: .schema-evidence.json + packages/schemas/**/*.tsp            │
│   • 검증: 누락된 물리 테이블, 누락된 컬럼, 타입 불일치 정적 검출         │
│   • 결과: 불일치 시 CI 종료 코드 1로 빌드 차단 (Zero DB Write)        │
└────────────────────────────────────────────────────────────────────────┘
```

### 왜 API 코드젠이 DDL을 소유하면 안 되는가?
1. **라이프사이클 불일치**: API DTO의 변경(예: 클라이언트용 필드 마스킹, DTO 평탄화)과 DB 물리 계층의 변경(예: 정규화, 인덱스 튜닝, 파티셔닝)은 서로 다른 배포 주기를 가집니다.
2. **방언(Dialect) 충돌**: PostgreSQL, SQLite, Cloudflare D1, MySQL 등 스토리지 엔진 고유의 최적화 문법을 단일 API 언어(TypeSpec)로 완벽히 표현하려 하면 스키마 오염이 발생합니다.
3. **배포 락(Lock) 충돌 방지**: API 코드 생성 시점에 DB에 직접 DDL을 날리면 CI 환경이나 개발자 로컬 머신에서 마이그레이션 상태가 꼬이고 복구 불가능한 장애가 발생합니다.

---

## 2. 3단계 정석 연계 파이프라인

### 1단계: 물리 스키마 정의 및 선언적 마이그레이션 (`Atlas` 소유)

개발자는 평소처럼 순수 SQL DDL 또는 Atlas HCL로 데이터베이스 스키마를 정의합니다:

```sql
-- db/schema.sql (물리 데이터베이스 정의)
CREATE TABLE users (
  user_id VARCHAR(64) PRIMARY KEY,
  email_address VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users (email_address);
```

새로운 변경 사항이 발생하면 Atlas CLI로 버전 관리된 마이그레이션을 생성합니다:

```bash
# 로컬 DB와 schema.sql의 차이(diff)를 마이그레이션 파일로 자동 생성
atlas migrate diff add_users_table --env local
```

---

### 2단계: 읽기 전용 카탈로그 스냅샷 추출 (`Atlas` ➔ JSON)

CI 빌드 파이프라인 또는 로컬 검증 스크립트에서 live DB 또는 로컬 dev DB의 물리 스키마를 JSON 형태로 덤프합니다:

```bash
# DB 물리 스키마를 읽기 전용 JSON 증거로 추출 (.schema-evidence.json)
atlas schema inspect --env local --format '{{ json . }}' > .schema-evidence.json
```

추출된 `.schema-evidence.json` 예시:

```json
{
  "tables": [
    {
      "name": "users",
      "columns": [
        { "name": "user_id", "type": "varchar(64)", "null": false },
        { "name": "email_address", "type": "varchar(255)", "null": false },
        { "name": "created_at", "type": "timestamp", "null": false }
      ],
      "primary_key": { "columns": ["user_id"] },
      "indexes": [
        { "name": "idx_users_email", "columns": ["email_address"] }
      ]
    }
  ]
}
```

---

### 3단계: TypeSpec 모델에 `@storageRef` 매핑 및 정적 드리프트 검증 (`oa-sdk` 소유)

TypeSpec 모델에서 목적별 서브패스 `@oa-sdk/typespec-decorators/storage`를 임포트하여 물리 컬럼과의 바인딩을 선언합니다:

```typespec
// models/users-storage.tsp
import "@oa-sdk/typespec-decorators/storage";

using OaSdkTypeSpec;

@storageCatalog("sqlite")
namespace UserDomain;

@storageRef("users")
model UserEntity {
  @storageRef("users.user_id")
  id: string;

  @storageRef("users.email_address")
  email: string;
}
```

CI 단계에서 정적 검증 스크립트가 실행되어, TypeSpec 모델의 `@storageRef`가 실제 `.schema-evidence.json`의 테이블/컬럼과 일치하는지 정적으로 검사합니다:

```typescript
// scripts/check-atlas-drift.ts (CI 실행 검증기)
import { readFileSync } from 'node:fs';
import { verifyAtlasSchemaDrift } from '@oa-sdk/typespec-decorators/storage-drift';

const evidence = JSON.parse(readFileSync('.schema-evidence.json', 'utf8'));
const mappings = [
  {
    entityName: 'UserEntity',
    tableName: 'users',
    columns: {
      id: { columnName: 'user_id', expectedType: 'string' },
      email: { columnName: 'email_address', expectedType: 'string' },
    },
  },
];

const result = verifyAtlasSchemaDrift(evidence, mappings);

if (!result.passed) {
  console.error('❌ Atlas physical DB schema drift detected:');
  for (const issue of result.issues) {
    console.error(`  [${issue.category}] ${issue.message}`);
  }
  process.exit(1);
}

console.log('✅ Atlas schema drift verification passed (0 errors).');
```

---

## 4. 탐지되는 3대 드리프트 오류 및 해결 가이드

| 드리프트 범주 | 발생 원인 | CI 진단 메시지 | 해결 방법 |
|---|---|---|---|
| **`missing-table`** | TypeSpec 모델이 참조하는 테이블이 물리 DB에 없음 | `Entity "UserEntity" references physical table "users", but it was not found.` | 1) `db/schema.sql`에 테이블 DDL 추가 후 마이그레이션 생성<br>2) 또는 TypeSpec의 `@storageRef` 테이블명 오타 수정 |
| **`missing-column`** | 물리 컬럼이 삭제/이름 변경되었으나 API 스키마가 갱신되지 않음 | `Property "UserEntity.email" references physical column "email_address", but column is missing.` | 1) DB 마이그레이션에서 컬럼 이름 변경 확인<br>2) TypeSpec의 `@storageRef("users.new_col")` 동기화 |
| **`type-mismatch`** | 논리 타입(예: number)과 물리 타입(예: varchar)의 호환성 어긋남 | `Property "Product.price" expects "number", but physical column has type "varchar(32)".` | 물리 컬럼을 적절한 수치 타입(`decimal`, `integer`)으로 변경하거나 DTO 타입 조정 |

---

## 5. CI/CD GitHub Actions 파이프라인 예시

```yaml
name: Schema Governance & Atlas Drift Gate

on:
  pull_request:
    paths:
      - 'db/**'
      - 'packages/schemas/**'

jobs:
  verify-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ariga/setup-atlas@v0
      - uses: pnpm/action-setup@v4

      # 1. Atlas 스키마 린트 (마이그레이션 안전성 검사)
      - name: Lint Database Migrations
        run: atlas migrate lint --env local

      # 2. 물리 스키마 스냅샷 덤프 (읽기 전용)
      - name: Extract Atlas Schema Evidence
        run: atlas schema inspect --env local --format '{{ json . }}' > .schema-evidence.json

      # 3. oa-sdk 정적 드리프트 게이트 실행
      - name: Verify Schema Drift
        run: pnpm exec tsx scripts/check-atlas-drift.ts --evidence .schema-evidence.json
```

---

## 6. 결론

1. **데이터베이스 쓰기 권한 격리**: oa-sdk 빌드 파이프라인에 DB 연결 계정이나 DDL 권한을 전혀 부여하지 않아도 됩니다.
2. **독립적인 배포 수명주기**: 데이터베이스는 Atlas 마이그레이션으로 정교하게 진화하고, API는 TypeSpec으로 엄격히 관리되며, 둘 사이의 정합성은 오직 **읽기 전용 JSON 증거 대조**를 통해 유지됩니다.
3. **100% 드리프트 사전 차단**: 물리 DB 컬럼 삭제나 이름 변경으로 인해 API 런타임에 500 에러가 발생하는 사고를 PR 리뷰 단계에서 완전히 방어합니다.
