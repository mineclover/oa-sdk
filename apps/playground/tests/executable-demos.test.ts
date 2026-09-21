import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const playgroundDir = path.resolve(__dirname, '..')

describe('공식 실행 데모(Playground Demos) 회귀 방지 테스트', () => {
  it('demo:patterns (demo-typespec-patterns.ts) 정상 실행 및 출력 검증', async () => {
    const scriptPath = path.join(playgroundDir, 'examples/demo-typespec-patterns.ts')
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', scriptPath], {
      cwd: playgroundDir,
      env: { ...process.env },
    })

    expect(stdout).toContain('OA SDK 실전 코드 패턴 & 비디오 트랜지션 파라미터 다양화 데모')
    expect(stdout).toContain('FadeTransition')
    expect(stdout).toContain('WipeTransition')
    expect(stdout).toContain('GlTransition')
    expect(stdout).toContain('Read Projection')
    expect(stdout).toContain('RFC 9457 규격 422 에러 응답')
    expect(stdout).toContain('초당 처리량')
    expect(stdout).toContain('성공적으로 확인되었습니다')
  }, 15000)

  it('demo:guards (demo-standalone-guards.ts) 정상 실행 및 CSP/IPC 검증', async () => {
    const scriptPath = path.join(playgroundDir, 'examples/demo-standalone-guards.ts')
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', scriptPath], {
      cwd: playgroundDir,
      env: { ...process.env },
    })

    expect(stdout).toContain('OA SDK 제로-런타임 의존성 Standalone Guard & MV3 데모')
    expect(stdout).toContain('CSP 위반 시도 감지: 🛡️ 0건')
    expect(stdout).toContain('불량 액션 및 비정상 UUID 메시지 차단: 🛡️ 차단 완료')
    expect(stdout).toContain('성공적으로 완료되었습니다')
  }, 15000)

  it('demo:router (demo-router-contracts.ts) 정상 실행 및 Hono E2E 테스트 검증', async () => {
    const scriptPath = path.join(playgroundDir, 'examples/demo-router-contracts.ts')
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', scriptPath], {
      cwd: playgroundDir,
      env: { ...process.env },
    })

    expect(stdout).toContain('OA SDK 프레임워크 무의존 핸들러 계약 & 라우터 연동 데모')
    expect(stdout).toContain('Status: 200, User Name: Alice')
    expect(stdout).toContain('Status: 404, Error Title: User Not Found')
    expect(stdout).toContain('Status: 201')
    expect(stdout).toContain('Status: 422')
    expect(stdout).toContain('성공적으로 완료되었습니다')
  }, 15000)
})
