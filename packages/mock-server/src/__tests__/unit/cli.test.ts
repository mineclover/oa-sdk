import { describe, expect, it, vi } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  CLI_HELP,
  loadAndValidateSpec,
  main,
  parsePort,
  type CliDependencies,
  type CliMockServer,
} from '../../cli/main.js'

const JSON_SPEC = JSON.stringify({
  openapi: '3.2.0',
  info: { title: 'CLI fixture', version: '1.0.0' },
  paths: {
    '/health': {
      get: {
        responses: { '200': { description: 'OK' } },
      },
    },
  },
})

const YAML_SPEC = `openapi: 3.2.0
info:
  title: CLI fixture
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
`

describe('oa-mock CLI', () => {
  it('--help는 스키마를 읽지 않고 사용법을 출력한다', async () => {
    const context = createContext()

    const exitCode = await main(['--help'], context.dependencies)

    expect(exitCode).toBe(0)
    expect(context.stdout()).toBe(CLI_HELP)
    expect(context.readTextFile).not.toHaveBeenCalled()
    expect(context.createServer).not.toHaveBeenCalled()
  })

  it('--spec를 반드시 지정해야 한다', async () => {
    const context = createContext()

    const exitCode = await main([], context.dependencies)

    expect(exitCode).toBe(2)
    expect(context.stderr()).toContain('--spec <path>가 필요합니다')
    expect(context.readTextFile).not.toHaveBeenCalled()
  })

  it.each(['-1', '1.5', 'abc', '65536'])(
    '잘못된 --port %s를 스키마 로드 전에 거부한다',
    async port => {
      const context = createContext()
      const portArgs = port.startsWith('-') ? [`--port=${port}`] : ['--port', port]

      const exitCode = await main(['--spec', 'openapi.json', ...portArgs], context.dependencies)

      expect(exitCode).toBe(2)
      expect(context.stderr()).toContain('--port는 0-65535 범위의 정수')
      expect(context.readTextFile).not.toHaveBeenCalled()
    },
  )

  it('JSON 스키마를 검증한 뒤 서버를 시작한다', async () => {
    const context = createContext(JSON_SPEC)

    const exitCode = await main(
      ['--spec', 'fixtures/openapi.json', '--port', '0'],
      context.dependencies,
    )

    expect(exitCode).toBe(0)
    expect(context.readTextFile).toHaveBeenCalledWith('/workspace/fixtures/openapi.json')
    expect(context.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ openapi: '3.2.0' }),
      0,
    )
    expect(context.server.start).toHaveBeenCalledOnce()
    expect(context.signals).toEqual(['SIGINT', 'SIGTERM'])
    expect(context.stdout()).toContain('Mock server: http://127.0.0.1:43123')
    expect(context.stdout()).toContain('spec: /workspace/fixtures/openapi.json')
  })

  it('YAML 스키마를 파싱하고 검증한다', async () => {
    const context = createContext(YAML_SPEC)

    const loaded = await loadAndValidateSpec('fixtures/openapi.yaml', context.dependencies)

    expect(loaded.path).toBe('/workspace/fixtures/openapi.yaml')
    expect(loaded.document.openapi).toBe('3.2.0')
    expect(loaded.document.info.title).toBe('CLI fixture')
  })

  it('구조적으로 무효한 스키마는 서버 생성 전에 거부한다', async () => {
    const context = createContext(JSON.stringify({ info: { title: 'Missing version' } }))

    const exitCode = await main(['--spec', 'invalid.json'], context.dependencies)

    expect(exitCode).toBe(1)
    expect(context.stderr()).toContain('스키마 검증 실패')
    expect(context.stderr()).toContain('/openapi [parse/version]')
    expect(context.createServer).not.toHaveBeenCalled()
  })

  it('깨진 YAML은 파싱 오류로 보고한다', async () => {
    const context = createContext('openapi: [')

    const exitCode = await main(['--spec', 'broken.yaml'], context.dependencies)

    expect(exitCode).toBe(1)
    expect(context.stderr()).toContain('스키마 파일을 파싱할 수 없습니다')
    expect(context.createServer).not.toHaveBeenCalled()
  })

  it('알 수 없는 플래그를 사용 오류로 처리한다', async () => {
    const context = createContext()

    const exitCode = await main(['--unknown'], context.dependencies)

    expect(exitCode).toBe(2)
    expect(context.stderr()).toContain('인자 오류')
  })
})

describe('parsePort', () => {
  it('default는 4010이고 0과 65535를 허용한다', () => {
    expect(parsePort(undefined)).toBe(4010)
    expect(parsePort('0')).toBe(0)
    expect(parsePort('65535')).toBe(65535)
  })
})

function createContext(source = JSON_SPEC) {
  let stdout = ''
  let stderr = ''
  const signals: NodeJS.Signals[] = []
  const readTextFile = vi.fn(async () => source)
  const server: CliMockServer = {
    url: 'http://127.0.0.1:43123',
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  }
  const createServer = vi.fn((_spec: OasDocument, _port: number) => server)
  const dependencies: CliDependencies = {
    cwd: () => '/workspace',
    readTextFile,
    createServer,
    stdout: { write: chunk => { stdout += chunk } },
    stderr: { write: chunk => { stderr += chunk } },
    onSignal: signal => { signals.push(signal) },
  }

  return {
    dependencies,
    readTextFile,
    createServer,
    server,
    signals,
    stdout: () => stdout,
    stderr: () => stderr,
  }
}
