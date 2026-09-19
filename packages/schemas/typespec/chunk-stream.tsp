import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi.ChunkStream;

@doc("시간 표현 규격: 정수 프레임(예: 30f), 초(예: 1.5s), 밀리초(예: 500ms)")
@pattern("^(?:(?:0|[1-9][0-9]*)f|(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,9})?(?:s|ms))$")
scalar Time extends string;

@doc("보안 식별자 (프로토타입 오염 방지)")
@pattern("^[A-Za-z_][A-Za-z0-9_.-]*$")
@minLength(1)
@maxLength(128)
scalar Identifier extends string;

@doc("페이로드 포맷 식별자 (예: ui-action@v1, time-series@v1, crdt-delta@v1)")
@pattern("^[A-Za-z0-9_.-]+(@[A-Za-z0-9_.-]+)?$")
@minLength(1)
@maxLength(128)
scalar PayloadFormat extends string;

@doc("L3 원격 또는 번들 소스 디스크립터")
model ChunkSource {
  @minLength(1)
  @maxLength(2048)
  src: string;

  @minValue(0)
  @maxValue(9007199254740991)
  bytes: safeint;

  @pattern("^[a-f0-9]{64}$")
  sha256: string;
}

@doc("사전 준비 리소스 참조")
model ResourceRef {
  id: Identifier;
  asset: Identifier;
  prepare: Identifier;
}

@doc("청크 체인 다음 포인터 기본 모델")
@discriminator("state")
model NextPointer {
  state: string;
}

model NextAvailable extends NextPointer {
  state: "available";
  id: Identifier;
}

model NextPending extends NextPointer {
  state: "pending";
  id: Identifier;
}

model NextUnresolved extends NextPointer {
  state: "unresolved";
}

model NextEnd extends NextPointer {
  state: "end";
}

@doc("단일 청크 헤더 (Wire Transport Plane)")
model ChunkHeader {
  id: Identifier;

  @minValue(0)
  @maxValue(4095)
  sequence: int32;

  from: Time;
  to: Time;
  previous: Identifier | null;
  source: ChunkSource;
  next: NextPointer;

  @maxItems(128)
  resources: ResourceRef[];

  payloadFormat?: PayloadFormat;
  format?: PayloadFormat;
}

// ============================================================================
// Cues & Atomic Payload Operations
// ============================================================================

@discriminator("action")
model UiCue {
  action: string;
}

model FocusCue extends UiCue {
  id: Identifier;
  at: Time;
  action: "focus";
  target: Identifier;
}

model ClickCue extends UiCue {
  id: Identifier;
  at: Time;
  action: "click";
  target: Identifier;
}

model InputCue extends UiCue {
  id: Identifier;
  at: Time;
  action: "input";
  target: Identifier;
  value: string;
  commit?: boolean;
}

model CallCue extends UiCue {
  id: Identifier;
  at: Time;
  action: "call";
  name: Identifier;
  args?: unknown;
}

model TimeSeriesSample {
  at: Time;
  values: (float64 | string | boolean | null)[];
}

model CrdtMetadata {
  @minValue(0)
  updatedAt: int64;
  clientId: string;
  tombstone?: boolean;
  seq?: int32;
  vectorClock?: Record<int32>;
}

model CrdtCue {
  id: Identifier;
  trackId: Identifier;
  @minValue(0)
  fromFrame: int32;
  @minValue(0)
  toFrame: int32;
  payload: {
    crdt: CrdtMetadata;
  };
}

// ============================================================================
// Chunk Bodies (Single Wire Schema Draft 2020-12, schemaVersion: 1)
// ============================================================================

@doc("다형성 단일 와이어 청크 바디 기본 모델")
@discriminator("payloadFormat")
model ChunkStreamItem {
  payloadFormat: string;
}

@doc("UI Action 청크 바디")
model UiActionBody extends ChunkStreamItem {
  schemaVersion: 1;
  streamId: Identifier;
  revision: Identifier;
  id: Identifier;
  payloadFormat: "ui-action@v1";
  targets: Record<string>;
  @maxItems(4096)
  cues: UiCue[];
}

@doc("다채널 시계열 청크 바디")
model TimeSeriesBody extends ChunkStreamItem {
  schemaVersion: 1;
  streamId: Identifier;
  revision: Identifier;
  id: Identifier;
  type: "time-series";
  payloadFormat: "time-series@v1";
  @minItems(1)
  @maxItems(64)
  channels: Identifier[];
  @maxItems(4096)
  samples: TimeSeriesSample[];
}

@doc("CRDT Delta 복제 청크 바디")
model CrdtDeltaBody extends ChunkStreamItem {
  schemaVersion: 1;
  streamId: Identifier;
  revision: Identifier;
  id: Identifier;
  type?: "crdt-delta";
  payloadFormat: "crdt-delta@v1";
  @maxItems(4096)
  cues: CrdtCue[];
  horizon?: int64;
}

// ============================================================================
// Playback Runtime Plane Representation
// ============================================================================

@doc("빈 청크 또는 실패 대체(Fallback) 상태 메타데이터")
model FallbackChunkState {
  empty: true;
  synthetic: true;
  fallback: true;
  @minValue(1)
  attempts: int32;
  lastError?: string;
  @minValue(0)
  failedAt: int64;
}

@doc("런타임 청크 엔벨로프 (RuntimeChunkEnvelope)")
model RuntimeChunkEnvelope {
  id: string;
  sequence: int32;
  streamId: string;
  fromFrame: int32;
  toFrame: int32;
  payloadFormat: string;
  data?: unknown;
  state?: FallbackChunkState | Record<unknown>;
  resources: ResourceRef[];
  residentBytes: int32;
}
