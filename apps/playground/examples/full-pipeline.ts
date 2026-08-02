#!/usr/bin/env tsx
/**
 * oa-sdk 풀 파이프라인 데모
 *
 * 실행: pnpm --filter @oa-sdk/playground run demo
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'yaml'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, createCoverageTracker } from '@oa-sdk/mock-server'
import { parseDocument, describeApi, findOperation } from '@oa-sdk/parser'
import type { OasDocument } from '@oa-sdk/parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const specPath = resolve(__dirname, '../../../packages/schemas/src/.merged.yaml')
const spec = parse(readFileSync(specPath, 'utf8')) as OasDocument

// ─── API 구조 요약 ───
console.log('━━━ API 구조 ━━━\n')
const doc = parseDocument(spec)
console.log(describeApi(doc))

// ─── Mock 서버 기동 ───
const tracker = createCoverageTracker()
const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)
const auth = { headers: { authorization: 'Bearer demo-token' } }

console.log(`\n━━━ Mock Server (${server.url}) ━━━\n`)

// 정상 요청
const health = await client.get('/health', auth)
console.log(`GET  /health           → ${health.status} ${JSON.stringify(health.json)}`)
tracker.onRequest({ operationId: 'getHealth' })

const list = await client.get('/users', auth)
console.log(`GET  /users            → ${list.status} items=${(list.json as any)?.items?.length}`)
tracker.onRequest({ operationId: 'listUsers' })

const create = await client.post('/users', { email: 'a@b.com', name: 'Alice', password: 'secure1234' }, auth)
console.log(`POST /users            → ${create.status}`)
tracker.onRequest({ operationId: 'createUser' })

const one = await client.get('/users/00000000-0000-0000-0000-000000000001', auth)
console.log(`GET  /users/:id        → ${one.status} name=${(one.json as any)?.name}`)
tracker.onRequest({ operationId: 'getUserById' })

const patch = await client.patch('/users/00000000-0000-0000-0000-000000000001', { name: 'Updated' }, auth)
console.log(`PATCH /users/:id       → ${patch.status}`)
tracker.onRequest({ operationId: 'updateUser' })

const del = await client.delete('/users/00000000-0000-0000-0000-000000000001', auth)
console.log(`DELETE /users/:id      → ${del.status}`)
tracker.onRequest({ operationId: 'deleteUser' })

// 에러 케이스
console.log('\n━━━ 에러 케이스 ━━━\n')

const noAuth = await client.get('/users')
console.log(`GET  /users (인증없음)  → ${noAuth.status} ${noAuth.json?.error?.details?.[0]?.code}`)

const badEmail = await client.post('/users', { email: 'x', name: 'B', password: '12345678' }, auth)
console.log(`POST /users (이메일위반) → ${badEmail.status} ${badEmail.json?.error?.details?.[0]?.code}`)

const missing = await client.post('/users', { name: 'C' }, auth)
console.log(`POST /users (필드누락)  → ${missing.status} ${missing.json?.error?.details?.[0]?.code}`)

const badUuid = await client.get('/users/not-uuid', auth)
console.log(`GET  /users/not-uuid   → ${badUuid.status} ${badUuid.json?.error?.details?.[0]?.code}`)

const notFound = await client.get('/nonexistent', auth)
console.log(`GET  /nonexistent      → ${notFound.status} ${notFound.json?.error?.code}`)

const method = await client.put('/users', {}, auth)
console.log(`PUT  /users            → ${method.status} Allow: ${method.headers['allow']}`)

// ─── 커버리지 ───
console.log('\n━━━ 커버리지 ━━━\n')
const allOps = doc.operations.map(o => o.operationId!).filter(Boolean)
const rate = Math.round(tracker.coverage(allOps) * 100)
console.log(`${rate}% (${tracker.called.size}/${allOps.length})`)
const uncalled = tracker.uncalled(allOps)
if (uncalled.length > 0) console.log(`미호출: ${uncalled.join(', ')}`)

await server.stop()
