#!/usr/bin/env tsx
/**
 * OA SDK 무경량 독립형 타입 가드 데모 (Non-HTTP / Chrome MV3 / Worker IPC)
 *
 * 실행: pnpm --filter @oa-sdk/playground run demo:guards
 */

import { generateStandaloneGuards } from '@oa-sdk/codegen'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🛡️ OA SDK 제로-런타임 의존성 Standalone Guard & MV3 데모')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// 1. 순수 데이터 모델 스키마 정의 (에디터 이벤트 및 텍스트 범위)
const editorEventSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    TextRange: {
      type: 'object',
      required: ['start', 'end'],
      properties: {
        start: { type: 'integer', minimum: 0 },
        end: { type: 'integer', minimum: 0 },
      },
    },
    EditorActivityEvent: {
      type: 'object',
      required: ['eventId', 'documentId', 'action', 'timestamp'],
      properties: {
        eventId: { type: 'string', format: 'uuid' },
        documentId: { type: 'string', minLength: 1 },
        action: { type: 'string', enum: ['insert', 'delete', 'format', 'undo', 'redo'] },
        timestamp: { type: 'string', format: 'date-time' },
        range: { $ref: '#/$defs/TextRange' },
        metadata: { type: 'object', additionalProperties: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
}

// 2. 가드 코드 생성
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-demo-guards-'))
console.log('📦 독립형 가드 컴파일 중 (외부 라이브러리 의존성: 0개)...')
const artifacts = await generateStandaloneGuards({
  schemaDocument: editorEventSchema,
  outDir: tempDir,
  guards: [
    { name: 'isEditorActivityEvent', typeName: 'EditorActivityEvent', schema: '#/$defs/EditorActivityEvent' },
    { name: 'isTextRange', typeName: 'TextRange', schema: '#/$defs/TextRange' },
  ],
})

const jsArtifact = artifacts.find(a => a.kind === 'js')!
const guardFile = path.join(tempDir, 'editor-guards.mjs')
await fs.writeFile(guardFile, jsArtifact.content, 'utf8')

// 3. Chrome MV3 엄격 CSP 샌드박스 시뮬레이션
console.log('🔒 Chrome Extension Manifest V3 Sandbox 활성화 (eval 및 Function 차단)...')
const originalFunction = globalThis.Function
const originalEval = globalThis.eval

let evalAttempted = false
;(globalThis as any).eval = () => {
  evalAttempted = true
  throw new Error('CSP VIOLATION: eval() is forbidden!')
}
;(globalThis as any).Function = () => {
  evalAttempted = true
  throw new Error('CSP VIOLATION: Function constructor is forbidden!')
}

try {
  const imported = await import(pathToFileURL(guardFile).href)

  console.log('\n━━━ [Test 1] 유효한 브라우저 확장프로그램 메시지 수신 ━━━')
  const validEvent = {
    eventId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    documentId: 'doc_editor_main',
    action: 'insert',
    timestamp: '2026-09-21T11:00:00.000Z',
    range: { start: 10, end: 25 },
    metadata: { client: 'chrome-mv3-devtools' },
  }

  const isValid = imported.isEditorActivityEvent(validEvent)
  console.log('메시지 검증 결과:', isValid ? '✅ 합격 (유효한 이벤트)' : '❌ 불합격')
  console.log('CSP 위반 시도 감지:', evalAttempted ? '⚠️ 위반 발생' : '🛡️ 0건 (완벽한 무경량 순수 함수)')

  console.log('\n━━━ [Test 2] 악의적/불량 메시지 차단 ━━━')
  const malformedEvent = {
    eventId: 'not-a-uuid',
    documentId: 'doc_main',
    action: 'hack_database', // enum 위반
    timestamp: 'invalid-time',
  }
  const isBlocked = !imported.isEditorActivityEvent(malformedEvent)
  console.log('불량 액션 및 비정상 UUID 메시지 차단:', isBlocked ? '🛡️ 차단 완료' : '❌ 누락')

  console.log('\n━━━ [Test 3] Node.js Worker IPC 고속 처리 성능 ━━━')
  const count = 50000
  const start = performance.now()
  for (let i = 0; i < count; i++) {
    imported.isEditorActivityEvent(validEvent)
  }
  const elapsed = performance.now() - start
  const throughput = Math.round((count / elapsed) * 1000)
  console.log(`50,000회 IPC 메시지 패킷 검증 시간: ${elapsed.toFixed(2)}ms`)
  console.log(`메시지 처리 속도:                 ${throughput.toLocaleString()} msg/sec`)
} finally {
  globalThis.Function = originalFunction
  globalThis.eval = originalEval
}

console.log('\n✨ Standalone Guard 데모가 성공적으로 완료되었습니다.')
