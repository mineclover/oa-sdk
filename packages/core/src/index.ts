/**
 * @oa-sdk/core — 패키지 간 공유 유틸리티
 *
 * 파싱, 코드젠, 어댑터 전체에서 공통으로 사용하는 함수.
 * 특정 패키지에 종속되지 않는 범용 로직만 포함합니다.
 */

// 문자열 변환
export { pascalCase, toTypeScriptIdentifier, createOperationTypeNameMap, toOperationMethodName, escapeKey, quoteTypeScriptString, toColonPath } from './strings.js'

// 코드 생성 유틸
export { collectTypeNames, hasGeneratedErrorType, getGeneratedErrorResponseKeys } from './codegen-utils.js'

// 코드 포매팅
export { formatGeneratedTs } from './format.js'

// 응답 유틸
export { pickDefaultStatus } from './response-utils.js'

// HTTP 서버 유틸
export { createHttpServer, writeJson, readRaw, readJsonBody } from './http.js'
export type { HttpServerOptions, HttpServerHandle, HttpHandler, ErrorEnvelope, ApiError, ApiErrorDetail } from './http.js'

// 프로젝트 루트 탐색 유틸
export {
  findProjectRoot,
  findProjectRootDetail,
  DEFAULT_CONFIG_FILES,
  DEFAULT_WORKSPACE_FILES,
  DEFAULT_VCS_DIRS,
  DEFAULT_ENV_VAR_NAME,
} from './root.js'
export type {
  FindProjectRootOptions,
  ProjectRootMarkers,
  ProjectRootDetail,
  RootResolutionReason,
} from './root.js'

