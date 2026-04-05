import type { OasSchema, OasMediaType } from '@oa-sdk/parser'
import { generator, type GenerateFolder } from './generate.js'

export type StreamOptions = {
  /** 생성할 이벤트 수 (기본: 3) */
  count?: number
  /** 스트림 종료 신호 포함 여부 (기본: true) */
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
    const { count = 3, includeTerminator = true } = options

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

// ─── 포맷 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * SSE 이벤트 포맷 (text/event-stream).
 * data: <payload>\n\n
 */
export function formatSseChunk(data: unknown): string {
  const payload = data === SSE_DONE ? SSE_DONE : JSON.stringify(data)
  return `data: ${payload}\n\n`
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
