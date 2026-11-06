from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Annotated, Any, Literal, TypeAlias


Identifier: TypeAlias = Annotated[str, Field(min_length=1, max_length=128, pattern="^[A-Za-z_][A-Za-z0-9_.-]*$")]


Time: TypeAlias = Annotated[str, Field(pattern="^(?:(?:0|[1-9][0-9]*)f|(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,9})?(?:s|ms))$")]


class UiCue(BaseModel):
    model_config = ConfigDict(extra="allow")
    action: str


class CallCue(UiCue):
    model_config = ConfigDict(extra="allow")
    action: Literal["call"]
    args: Any | None = None
    at: Time
    id: Identifier
    name: Identifier

    @field_validator("args", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ChunkSource(BaseModel):
    """L3 원격 또는 번들 소스 디스크립터"""
    model_config = ConfigDict(extra="allow")
    bytes: int = Field(..., ge=0, le=9007199254740991)
    sha256: str = Field(..., pattern="^[a-f0-9]{64}$")
    src: str = Field(..., min_length=1, max_length=2048)


class NextPointer(BaseModel):
    """청크 체인 다음 포인터 기본 모델"""
    model_config = ConfigDict(extra="allow")
    state: str


PayloadFormat: TypeAlias = Annotated[str, Field(min_length=1, max_length=128, pattern="^[A-Za-z0-9_.-]+(@[A-Za-z0-9_.-]+)?$")]


class ResourceRef(BaseModel):
    """사전 준비 리소스 참조"""
    model_config = ConfigDict(extra="allow")
    asset: Identifier
    id: Identifier
    prepare: Identifier


class ChunkHeader(BaseModel):
    """단일 청크 헤더 (Wire Transport Plane)"""
    model_config = ConfigDict(extra="allow", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    format: PayloadFormat | None = None
    from_: Time = Field(..., alias="from")
    id: Identifier
    next: "NextPointerUnion"
    payloadFormat: PayloadFormat | None = None
    previous: Identifier | None
    resources: list[ResourceRef] = Field(..., max_length=128)
    sequence: int = Field(..., ge=0, le=4095)
    source: ChunkSource
    to: Time

    @field_validator("format", "payloadFormat", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ChunkStreamItem(BaseModel):
    """다형성 단일 와이어 청크 바디 기본 모델"""
    model_config = ConfigDict(extra="allow")
    payloadFormat: str


class ClickCue(UiCue):
    model_config = ConfigDict(extra="allow")
    action: Literal["click"]
    at: Time
    id: Identifier
    target: Identifier


class CrdtMetadataVectorClock(BaseModel):
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, Annotated[int, Field(ge=-2147483648, le=2147483647)]] = Field(init=False)


class CrdtMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")
    clientId: str
    seq: int | None = Field(None, ge=-2147483648, le=2147483647)
    tombstone: bool | None = None
    updatedAt: int = Field(..., ge=0, le=9223372036854775807)
    vectorClock: CrdtMetadataVectorClock | None = None

    @field_validator("seq", "tombstone", "vectorClock", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class CrdtCuePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    crdt: CrdtMetadata


class CrdtCue(BaseModel):
    model_config = ConfigDict(extra="allow")
    fromFrame: int = Field(..., ge=0, le=2147483647)
    id: Identifier
    payload: CrdtCuePayload
    toFrame: int = Field(..., ge=0, le=2147483647)
    trackId: Identifier


class CrdtDeltaBody(ChunkStreamItem):
    """CRDT Delta 복제 청크 바디"""
    model_config = ConfigDict(extra="allow")
    cues: list[CrdtCue] = Field(..., max_length=4096)
    horizon: int | None = Field(None, ge=-9223372036854775808, le=9223372036854775807)
    id: Identifier
    payloadFormat: Literal["crdt-delta@v1"]
    revision: Identifier
    schemaVersion: Literal[1]
    streamId: Identifier
    type: Literal["crdt-delta"] | None = None

    @field_validator("horizon", "type", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class FallbackChunkState(BaseModel):
    """빈 청크 또는 실패 대체(Fallback) 상태 메타데이터"""
    model_config = ConfigDict(extra="allow")
    attempts: int = Field(..., ge=1, le=2147483647)
    empty: Literal[True]
    failedAt: int = Field(..., ge=0, le=9223372036854775807)
    fallback: Literal[True]
    lastError: str | None = None
    synthetic: Literal[True]

    @field_validator("lastError", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class FocusCue(UiCue):
    model_config = ConfigDict(extra="allow")
    action: Literal["focus"]
    at: Time
    id: Identifier
    target: Identifier


class InputCue(UiCue):
    model_config = ConfigDict(extra="allow")
    action: Literal["input"]
    at: Time
    commit: bool | None = None
    id: Identifier
    target: Identifier
    value: str

    @field_validator("commit", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


UiCueUnion: TypeAlias = Annotated[CallCue | ClickCue | FocusCue | InputCue, Field(discriminator="action")]


class NextAvailable(NextPointer):
    model_config = ConfigDict(extra="allow")
    id: Identifier
    state: Literal["available"]


class NextEnd(NextPointer):
    model_config = ConfigDict(extra="allow")
    state: Literal["end"]


class NextPending(NextPointer):
    model_config = ConfigDict(extra="allow")
    id: Identifier
    state: Literal["pending"]


class NextUnresolved(NextPointer):
    model_config = ConfigDict(extra="allow")
    state: Literal["unresolved"]


NextPointerUnion: TypeAlias = Annotated[NextAvailable | NextEnd | NextPending | NextUnresolved, Field(discriminator="state")]


class RuntimeChunkEnvelopeState(BaseModel):
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, Any] = Field(init=False)


class RuntimeChunkEnvelope(BaseModel):
    """런타임 청크 엔벨로프 (RuntimeChunkEnvelope)"""
    model_config = ConfigDict(extra="allow")
    data: Any | None = None
    fromFrame: int = Field(..., ge=-2147483648, le=2147483647)
    id: str
    payloadFormat: str
    residentBytes: int = Field(..., ge=-2147483648, le=2147483647)
    resources: list[ResourceRef]
    sequence: int = Field(..., ge=-2147483648, le=2147483647)
    state: FallbackChunkState | RuntimeChunkEnvelopeState | None = None
    streamId: str
    toFrame: int = Field(..., ge=-2147483648, le=2147483647)

    @field_validator("data", "state", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class TimeSeriesSample(BaseModel):
    model_config = ConfigDict(extra="allow")
    at: Time
    values: list[float | str | bool | None]


class TimeSeriesBody(ChunkStreamItem):
    """다채널 시계열 청크 바디"""
    model_config = ConfigDict(extra="allow")
    channels: list[Identifier] = Field(..., min_length=1, max_length=64)
    id: Identifier
    payloadFormat: Literal["time-series@v1"]
    revision: Identifier
    samples: list[TimeSeriesSample] = Field(..., max_length=4096)
    schemaVersion: Literal[1]
    streamId: Identifier
    type: Literal["time-series"]


class UiActionBodyTargets(BaseModel):
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, str] = Field(init=False)


class UiActionBody(ChunkStreamItem):
    """UI Action 청크 바디"""
    model_config = ConfigDict(extra="allow")
    cues: list[UiCueUnion] = Field(..., max_length=4096)
    id: Identifier
    payloadFormat: Literal["ui-action@v1"]
    revision: Identifier
    schemaVersion: Literal[1]
    streamId: Identifier
    targets: UiActionBodyTargets


ChunkStreamItemUnion: TypeAlias = Annotated[CrdtDeltaBody | TimeSeriesBody | UiActionBody, Field(discriminator="payloadFormat")]
