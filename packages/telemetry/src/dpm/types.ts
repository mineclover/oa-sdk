import type { PiiLevel } from '../symbols/types.js';

export interface DpmTokenOptions {
  namespace?: string;
  salt?: string;
}

export interface DpmTelemetryAdapterOptions {
  /**
   * 결정론적 가명화에 사용할 비밀 솔트/키
   */
  tokenKey?: string;
  /**
   * 기본 마스킹 키 목록
   */
  sensitiveKeys?: string[];
  /**
   * 커스텀 토크나이저 함수 (DPM 컴파일 플랜 연동 시 사용)
   */
  customTokenizer?: (namespace: string, rawValue: string) => string;
}

export interface DpmTelemetryAdapter {
  /**
   * 주어진 페이로드와 PII 레벨에 따라 데이터를 가명화/마스킹합니다.
   */
  sanitize<T extends Record<string, unknown>>(
    payload: T,
    piiLevel?: PiiLevel,
    namespace?: string,
  ): T | null;

  /**
   * 단일 값을 결정론적 가명 토큰으로 변환합니다.
   */
  tokenize(namespace: string, value: string): string;
}
