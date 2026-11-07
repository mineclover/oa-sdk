from __future__ import annotations
from datetime import timedelta
from enum import StrEnum
from pydantic import AwareDatetime, Base64Bytes, BaseModel, ConfigDict, Field


class Status(StrEnum):
    ACTIVE = "active"
    PENDING_REVIEW = "pending-review"


class Sample(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    created_at: AwareDatetime = Field(..., alias="createdAt")
    created_at_unix: int = Field(..., alias="createdAtUnix")
    modified_at: str = Field(..., alias="modifiedAt")
    payload: Base64Bytes
    status: Status
    token: str
    ttl: timedelta
    ttl_seconds: int = Field(..., alias="ttlSeconds", ge=-2147483648, le=2147483647)
