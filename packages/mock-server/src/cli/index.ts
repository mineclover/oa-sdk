#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createNodeMockServer } from '../adapters/node-http.js'
import type { OasDocument } from '@oa-sdk/parser'

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const port = parseInt(getArg('--port') ?? '4010', 10)
const specPath = resolve(getArg('--spec') ?? 'node_modules/@oa-sdk/schemas/dist/openapi.json')

let spec: OasDocument
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8')) as OasDocument
} catch {
  console.error(`스펙 파일을 읽을 수 없습니다: ${specPath}`)
  console.error('pnpm schema:bundle 을 먼저 실행하거나 --spec 으로 경로를 지정하세요.')
  process.exit(1)
}

const server = createNodeMockServer(spec, { port })

process.on('SIGINT', async () => {
  await server.stop()
  process.exit(0)
})

server.start().then(() => {
  console.log(`Mock server: ${server.url}`)
  console.log(`spec: ${specPath}`)
}).catch((err: unknown) => {
  console.error('서버 시작 실패:', err)
  process.exit(1)
})
