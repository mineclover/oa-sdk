export interface TelemetryIdentity {
  userId: string;
  email?: string;
  role?: string;
  tenantId?: string;
  pseudonymToken?: string;
}

let currentIdentity: TelemetryIdentity | null = null;
const listeners = new Set<(identity: TelemetryIdentity | null) => void>();

/**
 * 전역 텔레메트리 사용자 식별자를 설정합니다.
 */
export function setGlobalTelemetryIdentity(identity: TelemetryIdentity | null): void {
  currentIdentity = identity ? { ...identity } : null;
  for (const listener of listeners) {
    try {
      listener(currentIdentity);
    } catch {
      // 리스너 실패 무시
    }
  }
}

/**
 * 현재 설정된 텔레메트리 사용자 식별자를 반환합니다.
 */
export function getGlobalTelemetryIdentity(): TelemetryIdentity | null {
  return currentIdentity ? { ...currentIdentity } : null;
}

/**
 * 전역 텔레메트리 사용자 식별자를 초기화합니다 (로그아웃 시).
 */
export function clearGlobalTelemetryIdentity(): void {
  setGlobalTelemetryIdentity(null);
}

/**
 * 식별자 변경 리스너를 등록합니다.
 */
export function subscribeTelemetryIdentity(listener: (identity: TelemetryIdentity | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
