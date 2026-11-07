from __future__ import annotations
from datetime import timedelta
from enum import StrEnum
from pydantic import AwareDatetime, Base64Bytes, BaseModel, ConfigDict, Field


class Status(StrEnum):
    ACTIVE = "active"
    PENDING_REVIEW = "pending-review"


class Sample(BaseModel):
    model_config = ConfigDict(extra="allow")
    createdAt: AwareDatetime
    createdAtUnix: int
    modifiedAt: str
    payload: Base64Bytes
    status: Status
    token: str
    ttl: timedelta
    ttlSeconds: int = Field(..., ge=-2147483648, le=2147483647)
