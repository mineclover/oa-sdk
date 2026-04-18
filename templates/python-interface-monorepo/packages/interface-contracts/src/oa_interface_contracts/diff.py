import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal, cast

from .spec import ContractEndpoint, ContractResponse, ContractSpec, JsonSchema

ChangeSeverity = Literal["breaking", "non-breaking"]
SchemaUsage = Literal["request", "response"]


@dataclass(frozen=True)
class BreakingChange:
    code: str
    endpoint: str
    detail: str


@dataclass(frozen=True)
class ContractChange:
    code: str
    endpoint: str
    detail: str
    severity: ChangeSeverity


@dataclass(frozen=True)
class ContractDiffResult:
    breaking: list[ContractChange]
    non_breaking: list[ContractChange]


@dataclass(frozen=True)
class _ResponseShape:
    status_code: str
    model: str | None


def diff_contracts(base: ContractSpec, head: ContractSpec) -> list[BreakingChange]:
    """Return breaking changes only for backwards-compatible callers."""

    result = diff_contract_changes(base, head)
    return [
        BreakingChange(code=change.code, endpoint=change.endpoint, detail=change.detail)
        for change in result.breaking
    ]


def diff_contract_changes(base: ContractSpec, head: ContractSpec) -> ContractDiffResult:
    changes: list[ContractChange] = []
    base_by_key = base.endpoint_by_key()
    head_by_key = head.endpoint_by_key()

    for key, endpoint in sorted(base_by_key.items()):
        if key not in head_by_key:
            changes.append(
                _breaking(
                    "endpoint-removed",
                    _label(endpoint),
                    "Endpoint was removed.",
                )
            )

    for key, endpoint in sorted(head_by_key.items()):
        if key not in base_by_key:
            changes.append(
                _non_breaking(
                    "endpoint-added",
                    _label(endpoint),
                    "Endpoint was added.",
                )
            )

    for key, base_endpoint in sorted(base_by_key.items()):
        head_endpoint = head_by_key.get(key)
        if head_endpoint is None:
            continue

        endpoint_label = _label(head_endpoint)
        changes.extend(_endpoint_changes(endpoint_label, base_endpoint, head_endpoint, base, head))

    changes.extend(_schema_changes(base, head))

    breaking = [change for change in changes if change.severity == "breaking"]
    non_breaking = [change for change in changes if change.severity == "non-breaking"]
    return ContractDiffResult(breaking=breaking, non_breaking=non_breaking)


def _endpoint_changes(
    endpoint_label: str,
    base_endpoint: ContractEndpoint,
    head_endpoint: ContractEndpoint,
    base: ContractSpec,
    head: ContractSpec,
) -> list[ContractChange]:
    changes: list[ContractChange] = []

    if base_endpoint.operation_id != head_endpoint.operation_id:
        changes.append(
            _breaking(
                "operation-id-changed",
                endpoint_label,
                (
                    f"operation_id changed from {base_endpoint.operation_id} "
                    f"to {head_endpoint.operation_id}."
                ),
            )
        )

    if base_endpoint.request_model != head_endpoint.request_model:
        changes.append(
            _breaking(
                "request-model-changed",
                endpoint_label,
                (
                    f"request_model changed from {_format_value(base_endpoint.request_model)} "
                    f"to {_format_value(head_endpoint.request_model)}."
                ),
            )
        )

    base_responses = _response_shapes(base_endpoint, base)
    head_responses = _response_shapes(head_endpoint, head)
    base_statuses = set(base_responses)
    head_statuses = set(head_responses)

    for status_code in sorted(base_statuses - head_statuses, key=_status_code_key):
        changes.append(
            _breaking(
                "status-code-removed",
                endpoint_label,
                f"Response status {status_code} was removed.",
            )
        )

    for status_code in sorted(head_statuses - base_statuses, key=_status_code_key):
        changes.append(
            _non_breaking(
                "status-code-added",
                endpoint_label,
                f"Response status {status_code} was added.",
            )
        )

    for status_code in sorted(base_statuses & head_statuses, key=_status_code_key):
        base_model = base_responses[status_code].model
        head_model = head_responses[status_code].model
        if base_model != head_model:
            changes.append(
                _breaking(
                    "response-model-changed",
                    endpoint_label,
                    (
                        f"Response {status_code} model changed from "
                        f"{_format_value(base_model)} to {_format_value(head_model)}."
                    ),
                )
            )

    if _security_strengthened(base_endpoint.security, head_endpoint.security):
        changes.append(
            _breaking(
                "security-requirement-strengthened",
                endpoint_label,
                "Security requirements were strengthened.",
            )
        )

    return changes


def _schema_changes(base: ContractSpec, head: ContractSpec) -> list[ContractChange]:
    changes: list[ContractChange] = []
    base_request_models = _request_model_names(base)
    base_response_models = _response_model_names(base)

    for schema_name in sorted(base_request_models | base_response_models):
        base_schema = base.schemas.get(schema_name)
        head_schema = head.schemas.get(schema_name)
        if base_schema is None:
            continue
        if head_schema is None:
            changes.append(
                _breaking(
                    "schema-removed",
                    f"schema:{schema_name}",
                    f"Schema {schema_name} was removed.",
                )
            )
            continue

        if schema_name in base_request_models:
            changes.extend(
                _compare_schema(
                    schema_name,
                    "request",
                    base_schema,
                    head_schema,
                    base_schema,
                    head_schema,
                    base.schemas,
                    head.schemas,
                    (),
                )
            )
        if schema_name in base_response_models:
            changes.extend(
                _compare_schema(
                    schema_name,
                    "response",
                    base_schema,
                    head_schema,
                    base_schema,
                    head_schema,
                    base.schemas,
                    head.schemas,
                    (),
                )
            )

    return _dedupe_changes(changes)


def _compare_schema(
    schema_name: str,
    usage: SchemaUsage,
    base_schema: JsonSchema,
    head_schema: JsonSchema,
    base_root: JsonSchema,
    head_root: JsonSchema,
    base_components: Mapping[str, JsonSchema],
    head_components: Mapping[str, JsonSchema],
    path: tuple[str, ...],
) -> list[ContractChange]:
    base_schema = _resolve_schema(base_schema, base_root, base_components)
    head_schema = _resolve_schema(head_schema, head_root, head_components)
    changes: list[ContractChange] = []
    location = _schema_location(schema_name, path)

    changes.extend(_schema_constraint_changes(usage, location, base_schema, head_schema))
    changes.extend(
        _property_changes(
            schema_name,
            usage,
            base_schema,
            head_schema,
            base_root,
            head_root,
            base_components,
            head_components,
            path,
        )
    )

    base_items = _mapping_value(base_schema, "items")
    head_items = _mapping_value(head_schema, "items")
    if base_items is not None and head_items is not None:
        changes.extend(
            _compare_schema(
                schema_name,
                usage,
                base_items,
                head_items,
                base_root,
                head_root,
                base_components,
                head_components,
                (*path, "[]"),
            )
        )

    return changes


def _property_changes(
    schema_name: str,
    usage: SchemaUsage,
    base_schema: JsonSchema,
    head_schema: JsonSchema,
    base_root: JsonSchema,
    head_root: JsonSchema,
    base_components: Mapping[str, JsonSchema],
    head_components: Mapping[str, JsonSchema],
    path: tuple[str, ...],
) -> list[ContractChange]:
    changes: list[ContractChange] = []
    base_properties = _properties(base_schema)
    head_properties = _properties(head_schema)
    base_required = _required_fields(base_schema)
    head_required = _required_fields(head_schema)

    if usage == "request":
        for field in sorted(head_required - base_required):
            changes.append(
                _breaking(
                    "required-request-field-added",
                    _schema_location(schema_name, (*path, field)),
                    f"Required request field {_field_name((*path, field))} was added.",
                )
            )
        for field in sorted((set(head_properties) - set(base_properties)) - head_required):
            changes.append(
                _non_breaking(
                    "optional-request-field-added",
                    _schema_location(schema_name, (*path, field)),
                    f"Optional request field {_field_name((*path, field))} was added.",
                )
            )

    if usage == "response":
        for field in sorted(set(base_properties) - set(head_properties)):
            changes.append(
                _breaking(
                    "response-field-removed",
                    _schema_location(schema_name, (*path, field)),
                    f"Response field {_field_name((*path, field))} was removed.",
                )
            )
        for field in sorted(set(head_properties) - set(base_properties)):
            changes.append(
                _non_breaking(
                    "response-field-added",
                    _schema_location(schema_name, (*path, field)),
                    f"Response field {_field_name((*path, field))} was added.",
                )
            )

    for field in sorted(set(base_properties) & set(head_properties)):
        changes.extend(
            _compare_schema(
                schema_name,
                usage,
                base_properties[field],
                head_properties[field],
                base_root,
                head_root,
                base_components,
                head_components,
                (*path, field),
            )
        )

    return changes


def _schema_constraint_changes(
    usage: SchemaUsage,
    location: str,
    base_schema: JsonSchema,
    head_schema: JsonSchema,
) -> list[ContractChange]:
    changes: list[ContractChange] = []
    base_enum = _enum_values(base_schema)
    head_enum = _enum_values(head_schema)
    if base_enum is not None and head_enum is not None:
        removed = base_enum - head_enum
        added = head_enum - base_enum
        if removed:
            changes.append(
                _breaking(
                    "enum-value-removed",
                    location,
                    f"Enum values were removed: {_format_values(removed)}.",
                )
            )
        if added:
            changes.append(
                _non_breaking(
                    "enum-value-added",
                    location,
                    f"Enum values were added: {_format_values(added)}.",
                )
            )

    base_types = _schema_types(base_schema)
    head_types = _schema_types(head_schema)
    if base_types and head_types and "null" in base_types and "null" not in head_types:
        changes.append(
            _breaking(
                "nullable-removed",
                location,
                "Nullable value became non-nullable.",
            )
        )
        base_types = base_types - {"null"}

    if _type_change_is_breaking(usage, base_types, head_types):
        changes.append(
            _breaking(
                f"{usage}-field-type-narrowed",
                location,
                (
                    f"{usage.title()} field type changed from "
                    f"{_format_values(base_types)} to {_format_values(head_types)}."
                ),
            )
        )

    return changes


def _type_change_is_breaking(
    usage: SchemaUsage,
    base_types: set[str],
    head_types: set[str],
) -> bool:
    if not base_types or not head_types or base_types == head_types:
        return False
    if usage == "request":
        return not head_types.issuperset(base_types)
    return True


def _response_shapes(
    endpoint: ContractEndpoint,
    contract: ContractSpec,
) -> dict[str, _ResponseShape]:
    responses: dict[str, _ResponseShape] = {}
    if endpoint.response_model is not None:
        responses["200"] = _ResponseShape(status_code="200", model=endpoint.response_model)
    elif not endpoint.success_responses:
        responses["204"] = _ResponseShape(status_code="204", model=None)

    for response in endpoint.success_responses:
        responses[response.status_code] = _response_shape(response)

    for response_name in endpoint.error_responses:
        error_response = contract.standard_error_responses.get(response_name)
        if error_response is not None:
            responses[error_response.status_code] = _response_shape(error_response)

    return responses


def _response_shape(response: ContractResponse) -> _ResponseShape:
    return _ResponseShape(status_code=response.status_code, model=response.model)


def _request_model_names(contract: ContractSpec) -> set[str]:
    return {
        endpoint.request_model
        for endpoint in contract.endpoints
        if endpoint.request_model is not None
    }


def _response_model_names(contract: ContractSpec) -> set[str]:
    names: set[str] = set()
    for endpoint in contract.endpoints:
        for response in _response_shapes(endpoint, contract).values():
            if response.model is not None:
                names.add(response.model)
    return names


def _security_strengthened(
    base_security: list[dict[str, list[str]]],
    head_security: list[dict[str, list[str]]],
) -> bool:
    base_requirements = _normalized_security_requirements(base_security)
    head_requirements = _normalized_security_requirements(head_security)
    for base_requirement in base_requirements:
        if not any(
            _security_requirement_is_no_stronger(head_requirement, base_requirement)
            for head_requirement in head_requirements
        ):
            return True
    return False


def _normalized_security_requirements(
    requirements: list[dict[str, list[str]]],
) -> list[dict[str, frozenset[str]]]:
    if not requirements:
        return [{}]
    return [
        {
            scheme_name: frozenset(scopes)
            for scheme_name, scopes in requirement.items()
        }
        for requirement in requirements
    ]


def _security_requirement_is_no_stronger(
    head_requirement: dict[str, frozenset[str]],
    base_requirement: dict[str, frozenset[str]],
) -> bool:
    for scheme_name, head_scopes in head_requirement.items():
        base_scopes = base_requirement.get(scheme_name)
        if base_scopes is None:
            return False
        if not head_scopes.issubset(base_scopes):
            return False
    return True


def _resolve_schema(
    schema: JsonSchema,
    root: JsonSchema,
    components: Mapping[str, JsonSchema],
    seen_refs: frozenset[str] = frozenset(),
) -> JsonSchema:
    ref = schema.get("$ref")
    if not isinstance(ref, str) or ref in seen_refs:
        return schema

    target = _resolve_ref(ref, root, components)
    if target is None:
        return schema
    return _resolve_schema(target, root, components, seen_refs | {ref})


def _resolve_ref(
    ref: str,
    root: JsonSchema,
    components: Mapping[str, JsonSchema],
) -> JsonSchema | None:
    if ref.startswith("#/$defs/"):
        return _resolve_json_pointer(root, ref[1:])
    if ref.startswith("#/components/schemas/"):
        schema_name = ref.removeprefix("#/components/schemas/")
        return components.get(schema_name)
    return None


def _resolve_json_pointer(document: JsonSchema, pointer: str) -> JsonSchema | None:
    current: object = document
    for raw_part in pointer.strip("/").split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    if isinstance(current, dict):
        return cast(JsonSchema, current)
    return None


def _properties(schema: JsonSchema) -> dict[str, JsonSchema]:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return {}

    result: dict[str, JsonSchema] = {}
    for key, value in properties.items():
        if isinstance(key, str) and isinstance(value, dict):
            result[key] = cast(JsonSchema, value)
    return result


def _required_fields(schema: JsonSchema) -> set[str]:
    required = schema.get("required")
    if not isinstance(required, list):
        return set()
    return {item for item in required if isinstance(item, str)}


def _mapping_value(schema: JsonSchema, key: str) -> JsonSchema | None:
    value = schema.get(key)
    if isinstance(value, dict):
        return cast(JsonSchema, value)
    return None


def _enum_values(schema: JsonSchema) -> set[str] | None:
    values = schema.get("enum")
    if not isinstance(values, list):
        return None
    return {json.dumps(value, sort_keys=True) for value in values}


def _schema_types(schema: JsonSchema) -> set[str]:
    direct_types = _schema_type_value(schema.get("type"))
    if direct_types:
        return direct_types

    combined: set[str] = set()
    for key in ("anyOf", "oneOf"):
        branches = schema.get(key)
        if not isinstance(branches, list):
            continue
        for branch in branches:
            if isinstance(branch, dict):
                combined.update(_schema_types(cast(JsonSchema, branch)))
    return combined


def _schema_type_value(value: object) -> set[str]:
    if isinstance(value, str):
        return {value}
    if isinstance(value, list):
        return {item for item in value if isinstance(item, str)}
    return set()


def _dedupe_changes(changes: list[ContractChange]) -> list[ContractChange]:
    seen: set[tuple[str, str, str, str]] = set()
    deduped: list[ContractChange] = []
    for change in changes:
        key = (change.severity, change.code, change.endpoint, change.detail)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(change)
    return deduped


def _label(endpoint: ContractEndpoint) -> str:
    return f"{endpoint.method.upper()} {endpoint.path}"


def _schema_location(schema_name: str, path: tuple[str, ...]) -> str:
    if not path:
        return f"schema:{schema_name}"
    return f"schema:{schema_name}.{_field_name(path)}"


def _field_name(path: tuple[str, ...]) -> str:
    return ".".join(path)


def _breaking(code: str, endpoint: str, detail: str) -> ContractChange:
    return ContractChange(code=code, endpoint=endpoint, detail=detail, severity="breaking")


def _non_breaking(code: str, endpoint: str, detail: str) -> ContractChange:
    return ContractChange(code=code, endpoint=endpoint, detail=detail, severity="non-breaking")


def _format_value(value: object) -> str:
    if value is None:
        return "none"
    return str(value)


def _format_values(values: Iterable[object]) -> str:
    return ", ".join(str(value) for value in sorted(values, key=str))


def _status_code_key(status_code: str) -> tuple[int, str]:
    if status_code == "default":
        return (1000, status_code)
    return (int(status_code), status_code)
