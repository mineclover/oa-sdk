# ruff: noqa: E501
from __future__ import annotations

from typing import Annotated, Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator

Identifier: TypeAlias = Annotated[str, Field(min_length=1, max_length=128, pattern="^[A-Za-z_][A-Za-z0-9_.-]*$")]


Time: TypeAlias = Annotated[str, Field(pattern="^(?:(?:0|[1-9][0-9]*)f|(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,9})?(?:s|ms))$")]


class UiCue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str


class CallCue(UiCue):
    model_config = ConfigDict(extra="forbid")
    action: Literal["call"]  # pyright: ignore[reportIncompatibleVariableOverride]
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
    model_config = ConfigDict(extra="forbid")
    bytes: int = Field(..., ge=0, le=9007199254740991)
    sha256: str = Field(..., pattern="^[a-f0-9]{64}$")
    src: str = Field(..., min_length=1, max_length=2048)


class NextPointer(BaseModel):
    """청크 체인 다음 포인터 기본 모델"""
    model_config = ConfigDict(extra="forbid")
    state: str


PayloadFormat: TypeAlias = Annotated[str, Field(min_length=1, max_length=128, pattern="^[A-Za-z0-9_.-]+(@[A-Za-z0-9_.-]+)?$")]


class ResourceRef(BaseModel):
    """사전 준비 리소스 참조"""
    model_config = ConfigDict(extra="forbid")
    asset: Identifier
    id: Identifier
    prepare: Identifier


class ChunkHeader(BaseModel):
    """단일 청크 헤더 (Wire Transport Plane)"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    format: PayloadFormat | None = None
    from_: Time = Field(..., alias="from")
    id: Identifier
    next: NextPointerUnion
    payload_format: PayloadFormat | None = Field(None, alias="payloadFormat")
    previous: Identifier | None
    resources: list[ResourceRef] = Field(..., max_length=128)
    sequence: int = Field(..., ge=0, le=4095)
    source: ChunkSource
    to: Time

    @field_validator("format", "payload_format", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ChunkStreamItem(BaseModel):
    """다형성 단일 와이어 청크 바디 기본 모델"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    payload_format: str = Field(..., alias="payloadFormat")


class ClickCue(UiCue):
    model_config = ConfigDict(extra="forbid")
    action: Literal["click"]  # pyright: ignore[reportIncompatibleVariableOverride]
    at: Time
    id: Identifier
    target: Identifier


class CrdtMetadataVectorClock(BaseModel):
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, Annotated[int, Field(ge=-2147483648, le=2147483647)]] = Field(init=False)  # pyright: ignore[reportIncompatibleVariableOverride]


class CrdtMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    client_id: str = Field(..., alias="clientId")
    seq: int | None = Field(None, ge=-2147483648, le=2147483647)
    tombstone: bool | None = None
    updated_at: int = Field(..., alias="updatedAt", ge=0, le=9223372036854775807)
    vector_clock: CrdtMetadataVectorClock | None = Field(None, alias="vectorClock")

    @field_validator("seq", "tombstone", "vector_clock", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class CrdtCuePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    crdt: CrdtMetadata


class CrdtCue(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    from_frame: int = Field(..., alias="fromFrame", ge=0, le=2147483647)
    id: Identifier
    payload: CrdtCuePayload
    to_frame: int = Field(..., alias="toFrame", ge=0, le=2147483647)
    track_id: Identifier = Field(..., alias="trackId")


class CrdtDeltaBody(ChunkStreamItem):
    """CRDT Delta 복제 청크 바디"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    cues: list[CrdtCue] = Field(..., max_length=4096)
    horizon: int | None = Field(None, ge=-9223372036854775808, le=9223372036854775807)
    id: Identifier
    payload_format: Literal["crdt-delta@v1"] = Field(..., alias="payloadFormat")  # pyright: ignore[reportIncompatibleVariableOverride]
    revision: Identifier
    schema_version: Literal[1] = Field(..., alias="schemaVersion")
    stream_id: Identifier = Field(..., alias="streamId")
    type: Literal["crdt-delta"] | None = None

    @field_validator("horizon", "type", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class FallbackChunkState(BaseModel):
    """빈 청크 또는 실패 대체(Fallback) 상태 메타데이터"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    attempts: int = Field(..., ge=1, le=2147483647)
    empty: Literal[True]
    failed_at: int = Field(..., alias="failedAt", ge=0, le=9223372036854775807)
    fallback: Literal[True]
    last_error: str | None = Field(None, alias="lastError")
    synthetic: Literal[True]

    @field_validator("last_error", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class FocusCue(UiCue):
    model_config = ConfigDict(extra="forbid")
    action: Literal["focus"]  # pyright: ignore[reportIncompatibleVariableOverride]
    at: Time
    id: Identifier
    target: Identifier


class InputCue(UiCue):
    model_config = ConfigDict(extra="forbid")
    action: Literal["input"]  # pyright: ignore[reportIncompatibleVariableOverride]
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
    model_config = ConfigDict(extra="forbid")
    id: Identifier
    state: Literal["available"]  # pyright: ignore[reportIncompatibleVariableOverride]


class NextEnd(NextPointer):
    model_config = ConfigDict(extra="forbid")
    state: Literal["end"]  # pyright: ignore[reportIncompatibleVariableOverride]


class NextPending(NextPointer):
    model_config = ConfigDict(extra="forbid")
    id: Identifier
    state: Literal["pending"]  # pyright: ignore[reportIncompatibleVariableOverride]


class NextUnresolved(NextPointer):
    model_config = ConfigDict(extra="forbid")
    state: Literal["unresolved"]  # pyright: ignore[reportIncompatibleVariableOverride]


NextPointerUnion: TypeAlias = Annotated[NextAvailable | NextEnd | NextPending | NextUnresolved, Field(discriminator="state")]


class RuntimeChunkEnvelopeState(BaseModel):
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, Any] = Field(init=False)  # pyright: ignore[reportIncompatibleVariableOverride]


class RuntimeChunkEnvelope(BaseModel):
    """런타임 청크 엔벨로프 (RuntimeChunkEnvelope)"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    data: Any | None = None
    from_frame: int = Field(..., alias="fromFrame", ge=-2147483648, le=2147483647)
    id: str
    payload_format: str = Field(..., alias="payloadFormat")
    resident_bytes: int = Field(..., alias="residentBytes", ge=-2147483648, le=2147483647)
    resources: list[ResourceRef]
    sequence: int = Field(..., ge=-2147483648, le=2147483647)
    state: FallbackChunkState | RuntimeChunkEnvelopeState | None = None
    stream_id: str = Field(..., alias="streamId")
    to_frame: int = Field(..., alias="toFrame", ge=-2147483648, le=2147483647)

    @field_validator("data", "state", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class TimeSeriesSample(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at: Time
    values: list[float | str | bool | None]


class TimeSeriesBody(ChunkStreamItem):
    """다채널 시계열 청크 바디"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    channels: list[Identifier] = Field(..., min_length=1, max_length=64)
    id: Identifier
    payload_format: Literal["time-series@v1"] = Field(..., alias="payloadFormat")  # pyright: ignore[reportIncompatibleVariableOverride]
    revision: Identifier
    samples: list[TimeSeriesSample] = Field(..., max_length=4096)
    schema_version: Literal[1] = Field(..., alias="schemaVersion")
    stream_id: Identifier = Field(..., alias="streamId")
    type: Literal["time-series"]


class UiActionBodyTargets(BaseModel):
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, str] = Field(init=False)  # pyright: ignore[reportIncompatibleVariableOverride]


class UiActionBody(ChunkStreamItem):
    """UI Action 청크 바디"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    cues: list[UiCueUnion] = Field(..., max_length=4096)
    id: Identifier
    payload_format: Literal["ui-action@v1"] = Field(..., alias="payloadFormat")  # pyright: ignore[reportIncompatibleVariableOverride]
    revision: Identifier
    schema_version: Literal[1] = Field(..., alias="schemaVersion")
    stream_id: Identifier = Field(..., alias="streamId")
    targets: UiActionBodyTargets


ChunkStreamItemUnion: TypeAlias = Annotated[CrdtDeltaBody | TimeSeriesBody | UiActionBody, Field(discriminator="payload_format")]
