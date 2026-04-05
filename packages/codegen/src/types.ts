/**
 * codegen 패키지 공개 타입 — 단일 소스
 *
 * 모든 출력 관련 옵션, 스키마 엔트리 타입을 여기서 정의합니다.
 * generator.ts, drizzle/index.ts, config.ts, cli/index.ts가 공유합니다.
 */

/** YAML 출력 관련 공통 옵션 */
export type OutputOptions = {
  /** 생성된 YAML을 저장할 디렉토리 경로 */
  output: string
  /** 출력 방식: single(기본) = 하나의 파일, per-schema = 스키마별 파일 */
  grouping?: 'single' | 'per-schema'
  /** single 모드 시 파일 이름 (기본: 'components') */
  filename?: string
  /** true이면 output 대신 specPath에 병합 */
  mergeIntoSpec?: boolean
  /** mergeIntoSpec: true 시 대상 spec.yaml 경로 */
  specPath?: string
}

/** 이름이 부여된 OAS 스키마 — 패키지 전체 공용 */
export type NamedSchema = {
  name: string
  schema: Record<string, unknown>
}

/** 코드젠 결과 */
export type CodegenResult = {
  components: Array<NamedSchema & { sourceTable: string }>
  files: string[]
  warnings: string[]
}
