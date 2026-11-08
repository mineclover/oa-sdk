# ruff: noqa: E501
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Error(BaseModel):
    model_config = ConfigDict(extra="allow")
    message: str


class Thing(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: int = Field(..., ge=-9223372036854775808, le=9223372036854775807)
    name: str
