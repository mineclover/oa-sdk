import * as path from 'node:path'

/**
 * 실제 사용처 픽스처로 쓰는 외부 저장소 browser-studio의 체크아웃 위치.
 * 이 경로가 없으면 browser-studio 기반 테스트는 건너뛴다.
 */
export const BROWSER_STUDIO_ROOT = '/Users/junwoobang/workflow/browser-studio'

/**
 * browser-studio가 빌드한 독립형 가드 번들 디렉터리.
 * 이미 컴파일된 순수 ESM(`"type": "module"`, 런타임 import 없음)이며 파일 264개, 약 73 MB다.
 */
export const BROWSER_STUDIO_GUARDS_DIR = path.join(BROWSER_STUDIO_ROOT, 'dist/guards')

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * vitest가 변환하지 않고 Node가 직접 import해야 하는 모듈 경로 패턴(`test.server.deps.external`).
 *
 * 가드 번들을 테스트 프로세스 안에서 import하면 vitest 모듈 러너가 23 MB짜리 파일들을 SSR 변환한다.
 * 이미 순수 ESM이라 변환할 것이 없는데도 변환 비용이 부하에 비례해 커진다. challenger-m4-guards
 * Section 2 단독 실행, 1분 부하 평균 22~69에서 번갈아 측정: 변환 대상일 때 23.4~58.6초(transform 14~42초),
 * 부하가 37에서 173으로 오른 실행에서는 transform 107초로 60초 훅이 시간 초과됐다.
 * Node가 직접 불러오면 같은 조건에서 1.7~2.8초(transform 0.2~0.3초)다.
 */
export const BROWSER_STUDIO_PREBUILT_MODULES = new RegExp(`${escapeRegExp(BROWSER_STUDIO_GUARDS_DIR)}/`)
