import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import { main } from '../../cli/main.js'
import { MULTI_FILE_SPEC, MULTI_FILE_SPEC_ENTRY, writeSpecFiles } from '../fixtures/multi-file-spec.js'

describe('oa-mock CLI — 여러 파일로 나눈 스펙 서빙', () => {
  let root: string
  let servers: NodeMockServer[]
  let stdout: string
  let stderr: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oa-mock-multi-file-'))
    servers = []
    stdout = ''
    stderr = ''
  })

  afterEach(async () => {
    await Promise.all(servers.map(server => server.stop()))
    rmSync(root, { recursive: true, force: true })
  })

  /** Runs `oa-mock` from `root` on a Node mock server the test stops afterwards. */
  const runCli = (argv: string[]) => main(argv, {
    cwd: () => root,
    createServer: (spec, port) => {
      const server = createNodeMockServer(spec, { port })
      servers.push(server)
      return server
    },
    stdout: { write: chunk => { stdout += chunk } },
    stderr: { write: chunk => { stderr += chunk } },
    onSignal: () => {},
  })

  it('다른 파일의 path item에 정의된 operation과 다른 파일의 스키마를 서빙한다', async () => {
    writeSpecFiles(root, MULTI_FILE_SPEC)

    const exitCode = await runCli(['--spec', MULTI_FILE_SPEC_ENTRY, '--port', '0'])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(servers).toHaveLength(1)
    const url = servers[0]!.url
    expect(stdout).toContain(`Mock server: ${url}`)

    const user = await fetch(`${url}/users/u1`)
    expect(user.status).toBe(200)
    const userBody = await user.json() as { id?: unknown }
    expect(typeof userBody.id).toBe('string')

    const deleted = await fetch(`${url}/users/u1`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)

    const health = await fetch(`${url}/health`)
    expect(health.status).toBe(200)
    const healthBody = await health.json() as { ok?: unknown }
    expect(typeof healthBody.ok).toBe('boolean')
  })
})
