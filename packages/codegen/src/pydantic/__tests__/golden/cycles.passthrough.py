# ruff: noqa: E501
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


class Comment(BaseModel):
    model_config = ConfigDict(extra="allow")
    author: str
    content: str
    id: str
    replies: list[Comment] | None = None

    @field_validator("replies", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class TreeNode(BaseModel):
    model_config = ConfigDict(extra="allow")
    children: list[TreeNode] | None = None
    id: str
    label: str
    parent: TreeNode | None = None

    @field_validator("children", "parent", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


Comment.model_rebuild()
TreeNode.model_rebuild()
