from dataclasses import dataclass

from .spec import ContractEndpoint, ContractSpec


@dataclass(frozen=True)
class BreakingChange:
    code: str
    endpoint: str
    detail: str


def diff_contracts(base: ContractSpec, head: ContractSpec) -> list[BreakingChange]:
    changes: list[BreakingChange] = []
    base_by_key = base.endpoint_by_key()
    head_by_key = head.endpoint_by_key()

    for key, endpoint in sorted(base_by_key.items()):
        if key not in head_by_key:
            changes.append(
                BreakingChange(
                    code="endpoint-removed",
                    endpoint=_label(endpoint),
                    detail="Endpoint was removed.",
                )
            )

    for key, base_endpoint in sorted(base_by_key.items()):
        head_endpoint = head_by_key.get(key)
        if head_endpoint is None:
            continue
        endpoint_label = _label(head_endpoint)

        if base_endpoint.operation_id != head_endpoint.operation_id:
            changes.append(
                BreakingChange(
                    code="operation-id-changed",
                    endpoint=endpoint_label,
                    detail=(
                        f"operation_id changed from {base_endpoint.operation_id} "
                        f"to {head_endpoint.operation_id}."
                    ),
                )
            )

        if base_endpoint.request_model != head_endpoint.request_model:
            changes.append(
                BreakingChange(
                    code="request-model-changed",
                    endpoint=endpoint_label,
                    detail=(
                        f"request_model changed from {base_endpoint.request_model} "
                        f"to {head_endpoint.request_model}."
                    ),
                )
            )

        if base_endpoint.response_model != head_endpoint.response_model:
            changes.append(
                BreakingChange(
                    code="response-model-changed",
                    endpoint=endpoint_label,
                    detail=(
                        f"response_model changed from {base_endpoint.response_model} "
                        f"to {head_endpoint.response_model}."
                    ),
                )
            )

    for schema_name, base_schema in sorted(base.schemas.items()):
        head_schema = head.schemas.get(schema_name)
        if head_schema is None:
            changes.append(
                BreakingChange(
                    code="schema-removed",
                    endpoint=f"schema:{schema_name}",
                    detail=f"Schema {schema_name} was removed.",
                )
            )
            continue
        added_required = _required_fields(head_schema) - _required_fields(base_schema)
        for field in sorted(added_required):
            changes.append(
                BreakingChange(
                    code="required-field-added",
                    endpoint=f"schema:{schema_name}",
                    detail=f"Required field {field} was added.",
                )
            )

    return changes


def _label(endpoint: ContractEndpoint) -> str:
    return f"{endpoint.method.upper()} {endpoint.path}"


def _required_fields(schema: dict[str, object]) -> set[str]:
    required = schema.get("required")
    if not isinstance(required, list):
        return set()
    return {item for item in required if isinstance(item, str)}
