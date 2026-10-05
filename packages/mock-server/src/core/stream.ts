import type { OasSchema, OasMediaType } from '@oa-sdk/parser'
import { generatesAsBuiltin, generator, type GenerateFolder } from './generate.js'

export type StreamOptions = {
  /** 생성할 이벤트 수 (기본: 3) */
  count?: number
  /** 스트림 종료 신호 포함 여부 (기본: false; schema-driven adapters never emit an undocumented sentinel) */
  includeTerminator?: boolean
}

/** SSE 스트림 종료 신호 */
export const SSE_DONE = '[DONE]' as const

// ─── StreamFolder ─────────────────────────────────────────────────────────────

/**
 * StreamFolder — 스키마 기반 AsyncGenerator.
 *
 * GenerateFolder를 has-a로 보유.
 * 생성 로직 커스터마이징은 GenerateFolder 서브클래스로 주입:
 *
 * @example
 * const customStreamer = new StreamFolder(new MyGenerateFolder())
 *
 * OAS 3.2 itemSchema 지원:
 *   schema.itemSchema 가 있으면 각 이벤트의 스키마로 사용
 */
export class StreamFolder {
  constructor(private readonly folder: GenerateFolder = generator) {}

  /**
   * 스키마로부터 값 스트림 생성.
   * @param schema 이벤트 스키마 (또는 itemSchema 를 포함한 컨테이너 스키마)
   */
  async *generate(
    schema: OasSchema | OasMediaType,
    options: StreamOptions = {},
  ): AsyncGenerator<unknown> {
    const { count = 3, includeTerminator = false } = options

    // OAS 3.2 itemSchema — 스트림 내 각 아이템의 스키마
    const itemSchema = 'itemSchema' in schema ? schema.itemSchema : undefined
    const eventSchema = itemSchema ?? schema

    for (let i = 0; i < count; i++) {
      yield this.folder.fold(eventSchema)
    }

    if (includeTerminator) yield SSE_DONE
  }
}

/** StreamFolder 싱글턴 */
export const streamer = new StreamFolder()

/** 모듈 로드 시점의 내장 `StreamFolder.generate` — 공유 `streamer`가 바뀌었는지 판별하는 기준. */
const BUILTIN_STREAM_GENERATE = StreamFolder.prototype.generate

/**
 * mock 응답을 만드는 공유 생성기가 내장 그대로인지: 응답 본문·헤더 값과 스트림 검증
 * 값을 만드는 `generator`가 내장 생성기와 똑같이 생성하고(`generatesAsBuiltin`), 스트림
 * 이벤트를 만드는 `streamer`가 `generate`를 바꾸지 않은 채 그 `generator`로 이벤트를 만든다.
 *
 * 그렇다면 스키마에서 만든 응답은 스펙만의 순수 함수라서, 어댑터가 라우트마다 한 번 만든
 * 응답을 재사용해도 요청마다 만든 것과 같다(handler.ts `RouteResponses`). 핸들러 교체,
 * 메서드 대입, 프로토타입 패치, 다른 folder 주입 중 하나라도 있으면 false이고, 응답은
 * 요청마다 새로 만든다. 매 요청 호출되므로 참조 비교만 한다.
 */
export function sharedGenerationIsBuiltin(): boolean {
  return streamer.generate === BUILTIN_STREAM_GENERATE
    && streamer['folder'] === generator
    && generatesAsBuiltin(generator)
}

/**
 * Generate the value used to validate a stream response before an adapter
 * serializes it. Native SSE item schemas describe the wire envelope, while
 * their `data.contentSchema` describes the JSON payload carried by that
 * envelope.
 */
export function generateStreamValidationValue(schema: OasSchema): unknown {
  const nativeSseEvent = getNativeSseEvent(schema)
  if (!nativeSseEvent) return generator.fold(schema)
  return {
    event: nativeSseEvent.event,
    data: JSON.stringify(generator.fold(nativeSseEvent.dataSchema)),
  }
}

// ─── 공유 스트리밍 청크 생성기 ──────────────────────────────────────────────

/**
 * 스트리밍 응답의 청크들을 생성.
 * 어댑터는 이 결과를 자신의 방식으로 전송 (ReadableStream vs res.write).
 *
 * @param picked 응답 선택 결과 — stream 스키마 또는 body를 포함
 */
export async function* generateStreamChunks(
  picked: { contentType: string; body: unknown; stream?: OasSchema },
): AsyncGenerator<string> {
  const isSse = picked.contentType === 'text/event-stream'
  const formatChunk = isSse ? formatSseChunk : formatNdjsonLine

  if (picked.stream) {
    const nativeSseEvent = isSse ? getNativeSseEvent(picked.stream) : undefined
    if (nativeSseEvent) {
      for await (const item of streamer.generate(nativeSseEvent.dataSchema, { includeTerminator: false })) {
        yield formatSseChunk(item, nativeSseEvent.event)
      }
      return
    }
    // Closing the HTTP response ends a schema-driven stream. A bare [DONE]
    // frame is not part of a native OAS 3.2 itemSchema unless the contract
    // explicitly models it, so adapters must not synthesize one.
    for await (const item of streamer.generate(picked.stream, { includeTerminator: false })) {
      yield formatChunk(item)
    }
  } else {
    yield formatChunk(picked.body)
  }
}

// ─── 포맷 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * SSE 이벤트 포맷 (text/event-stream).
 * event: <event>\n
 * data: <payload>\n\n
 */
export function formatSseChunk(data: unknown, event?: string): string {
  const payload = data === SSE_DONE ? SSE_DONE : JSON.stringify(data)
  return event && data !== SSE_DONE
    ? `event: ${event}\ndata: ${payload}\n\n`
    : `data: ${payload}\n\n`
}

/**
 * NDJSON 라인 포맷 (application/x-ndjson, application/jsonl).
 * <json>\n
 */
export function formatNdjsonLine(data: unknown): string {
  return JSON.stringify(data) + '\n'
}

/** 스트리밍 content-type 판별 */
export function isStreamingContentType(contentType: string): boolean {
  return (
    contentType === 'text/event-stream' ||
    contentType === 'application/x-ndjson' ||
    contentType === 'application/jsonl'
  )
}

type NativeSseEvent = {
  event: string
  dataSchema: OasSchema
}

/**
 * TypeSpec's native SSE emitter represents named events as an OpenAPI 3.2
 * itemSchema with a oneOf branch containing `event: { const }` and
 * `data: { contentSchema }`. Legacy stream schemas remain on the generic path.
 */
function getNativeSseEvent(schema: OasSchema): NativeSseEvent | undefined {
  for (const variant of schema.oneOf ?? []) {
    const event = variant.properties?.event?.const
    const dataSchema = variant.properties?.data?.contentSchema
    if (typeof event === 'string' && dataSchema !== undefined) return { event, dataSchema }
  }
  return undefined
}
