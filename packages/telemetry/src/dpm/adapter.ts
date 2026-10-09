import type { PiiLevel } from '../symbols/types.js';
import type { DpmTelemetryAdapter, DpmTelemetryAdapterOptions } from './types.js';

const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'creditcard',
  'cardnumber',
  'cvc',
  'ssn',
  'authorization',
  'authtoken',
];

const PSEUDONYMIZED_CANDIDATE_KEYS = [
  'userid',
  'user_id',
  'customerid',
  'customer_id',
  'orderid',
  'order_id',
  'accountid',
  'account_id',
  'email',
];

/**
 * 환경 비의존적 32비트 FNV-1a 결정론적 해시 계산
 */
function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createDpmTelemetryAdapter(options: DpmTelemetryAdapterOptions = {}): DpmTelemetryAdapter {
  const tokenKey = options.tokenKey || 'oa-dpm-telemetry-default-salt';
  const sensitiveKeys = options.sensitiveKeys || DEFAULT_SENSITIVE_KEYS;

  function tokenize(namespace: string, value: string): string {
    if (options.customTokenizer) {
      return options.customTokenizer(namespace, value);
    }
    const digest = fnv1a32(`${tokenKey}:${namespace}:${value}`);
    const cleanNs = namespace.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `dpm_tok_${cleanNs}_${digest}`;
  }

  function isSensitive(key: string): boolean {
    const lower = key.toLowerCase().replace(/[-_]/g, '');
    return sensitiveKeys.some((s) => lower.includes(s));
  }

  function isPseudoCandidate(key: string): boolean {
    const lower = key.toLowerCase();
    return PSEUDONYMIZED_CANDIDATE_KEYS.includes(lower);
  }

  function sanitizeRecursive(obj: any, piiLevel: PiiLevel, namespace: string): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeRecursive(item, piiLevel, namespace));
    }

    const result: Record<string, any> = {};

    for (const [key, val] of Object.entries(obj)) {
      // 1. 민감 키 원천 마스킹
      if (isSensitive(key)) {
        result[key] = '***MASKED***';
        continue;
      }

      // 2. 가명화 대상 필드 처리 (pseudonymized 모드일 때)
      if (piiLevel === 'pseudonymized' && typeof val === 'string' && isPseudoCandidate(key)) {
        result[key] = tokenize(namespace, val);
        continue;
      }

      // 3. 재귀 객체 처리
      if (typeof val === 'object' && val !== null) {
        result[key] = sanitizeRecursive(val, piiLevel, namespace);
      } else {
        result[key] = val;
      }
    }

    return result;
  }

  return {
    tokenize,
    sanitize<T extends Record<string, unknown>>(
      payload: T,
      piiLevel: PiiLevel = 'none',
      namespace: string = 'global',
    ): T | null {
      // 1. restricted 등급은 즉시 Drop
      if (piiLevel === 'restricted') {
        return null;
      }

      return sanitizeRecursive(payload, piiLevel, namespace);
    },
  };
}
