import json
from collections.abc import Mapping
from dataclasses import dataclass
from json import JSONDecodeError
from pathlib import Path
from typing import Any, cast


@dataclass(frozen=True)
class OpenApiArtifactCheck:
    artifact: str
    fresh: bool
    summary: str
    expected_hash: str | None
    actual_hash: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "artifact": self.artifact,
            "fresh": self.fresh,
            "summary": self.summary,
            "expected_hash": self.expected_hash,
            "actual_hash": self.actual_hash,
        }


def load_openapi_artifact(path: str | Path) -> dict[str, Any]:
    artifact_path = Path(path)
    try:
        payload = json.loads(artifact_path.read_text())
    except JSONDecodeError as exc:
        raise ValueError(f"{artifact_path} is not valid JSON: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{artifact_path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def compare_openapi_documents(
    artifact: str | Path,
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
) -> OpenApiArtifactCheck:
    fresh = actual == expected
    return OpenApiArtifactCheck(
        artifact=str(artifact),
        fresh=fresh,
        summary="matches managed OpenAPI" if fresh else artifact_drift_summary(expected, actual),
        expected_hash=_document_contract_hash(expected),
        actual_hash=_document_contract_hash(actual),
    )


def artifact_drift_summary(
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
) -> str:
    parts: list[str] = []
    if _document_contract_hash(expected) != _document_contract_hash(actual):
        parts.append("hash mismatch")
    parts.extend(
        summary
        for summary in (
            _mapping_drift_summary(
                "paths",
                _object_map(expected, "paths"),
                _object_map(actual, "paths"),
            ),
            _mapping_drift_summary(
                "schemas",
                _component_map(expected, "schemas"),
                _component_map(actual, "schemas"),
            ),
            _mapping_drift_summary(
                "responses",
                _component_map(expected, "responses"),
                _component_map(actual, "responses"),
            ),
            _mapping_drift_summary(
                "securitySchemes",
                _component_map(expected, "securitySchemes"),
                _component_map(actual, "securitySchemes"),
            ),
        )
        if summary is not None
    )
    return "; ".join(parts) if parts else "content differs from managed OpenAPI"


def _mapping_drift_summary(
    label: str,
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
) -> str | None:
    expected_keys = set(expected)
    actual_keys = set(actual)
    missing = expected_keys - actual_keys
    extra = actual_keys - expected_keys
    changed = {
        key
        for key in expected_keys & actual_keys
        if expected[key] != actual[key]
    }
    if not missing and not extra and not changed:
        return None

    counts: list[str] = []
    if missing:
        counts.append(f"{len(missing)} missing")
    if extra:
        counts.append(f"{len(extra)} extra")
    if changed:
        counts.append(f"{len(changed)} changed")
    return f"{label}: {', '.join(counts)}"


def _object_map(document: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = document.get(key)
    if isinstance(value, Mapping):
        return cast(Mapping[str, Any], value)
    return {}


def _component_map(document: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    components = document.get("components")
    if not isinstance(components, Mapping):
        return {}
    value = components.get(key)
    if isinstance(value, Mapping):
        return cast(Mapping[str, Any], value)
    return {}


def _document_contract_hash(document: Mapping[str, Any]) -> str | None:
    value = document.get("x-oa-contract-hash")
    if isinstance(value, str):
        return value
    return None
