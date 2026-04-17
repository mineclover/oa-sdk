import json
from collections.abc import Mapping
from importlib import import_module, metadata
from json import JSONDecodeError
from os import PathLike
from pathlib import Path
from typing import Any, Literal, Protocol, cast, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from .registry import ContractRegistry
from .spec import ContractSpec

SNAPSHOT_FORMAT: Literal["oa-contract-snapshot"] = "oa-contract-snapshot"
SNAPSHOT_VERSION: Literal[1] = 1
_TOOLKIT_PACKAGES = ("oa-interface-cli", "oa-interface-contracts")


@runtime_checkable
class ContractFactory(Protocol):
    def to_contract(self) -> ContractSpec: ...


ContractInput = (
    str
    | PathLike[str]
    | ContractSpec
    | ContractRegistry
    | Mapping[str, Any]
    | ContractFactory
)


class ContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["oa-contract-snapshot"] = SNAPSHOT_FORMAT
    snapshot_version: Literal[1] = SNAPSHOT_VERSION
    toolkit: dict[str, str] = Field(default_factory=dict)
    contract: ContractSpec


def snapshot_contract(source: ContractInput) -> ContractSnapshot:
    return ContractSnapshot(
        toolkit=toolkit_version_metadata(),
        contract=load_contract_spec(source),
    )


def serialize_contract_snapshot(source: ContractInput) -> str:
    snapshot = snapshot_contract(source)
    return json.dumps(
        snapshot.model_dump(mode="json"),
        indent=2,
        sort_keys=True,
    )


def toolkit_version_metadata() -> dict[str, str]:
    return {
        package: _distribution_version(package)
        for package in _TOOLKIT_PACKAGES
    }


def load_contract_spec(source: ContractInput) -> ContractSpec:
    if isinstance(source, ContractSpec):
        return source
    if isinstance(source, ContractRegistry):
        return source.to_spec(validate=False)
    if isinstance(source, Mapping):
        return contract_spec_from_mapping(source)
    if isinstance(source, (str, PathLike)):
        text = str(source)
        path = Path(source)
        if path.exists():
            return load_contract_json(path)
        if isinstance(source, str) and ":" in source:
            return load_contract_spec(load_module_attr(source))
        raise ValueError(f"{text} is not a readable file or module:attr reference")
    if isinstance(source, ContractFactory):
        return source.to_contract()
    raise TypeError(
        "contract source must be ContractSpec, ContractRegistry, mapping, file, or module:attr"
    )


def load_contract_json(path: str | Path) -> ContractSpec:
    contract_path = Path(path)
    return contract_spec_from_json(contract_path.read_text(), label=str(contract_path))


def contract_spec_from_json(text: str, *, label: str = "contract JSON") -> ContractSpec:
    try:
        payload = json.loads(text)
    except JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON: {exc.msg}") from exc
    if not isinstance(payload, Mapping):
        raise ValueError(f"{label} must contain a JSON object")
    return contract_spec_from_mapping(cast(Mapping[str, Any], payload))


def contract_spec_from_mapping(payload: Mapping[str, Any]) -> ContractSpec:
    if payload.get("format") == SNAPSHOT_FORMAT:
        return ContractSnapshot.model_validate(payload).contract
    return ContractSpec.model_validate(payload)


def load_module_attr(reference: str) -> Any:
    module_name, separator, attr_path = reference.partition(":")
    if not separator or not module_name or not attr_path:
        raise ValueError("reference must use module:attribute syntax")

    value: Any = import_module(module_name)
    for attr in attr_path.split("."):
        value = getattr(value, attr)
    return value


def _distribution_version(package: str) -> str:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return "unknown"
