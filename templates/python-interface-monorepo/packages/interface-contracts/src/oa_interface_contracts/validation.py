import re
from collections import defaultdict
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Literal

from .spec import ContractEndpoint, ContractSpec

_COMPONENT_SCHEMA_REF_PREFIX = "#/components/schemas/"
_PATH_PARAM_PATTERN = re.compile(r"{([^}/]+)}")
_INTERNAL_ONLY_SCHEMA_EXTENSIONS = ("x-internal-only", "x-internal")
_MODEL_AUDIENCE_ORDER = {
    "public": 0,
    "admin": 1,
    "internal": 2,
}
_SCHEMA_AUDIENCE_EXTENSION = "x-oa-audience"
_SCHEMA_TARGETS_EXTENSION = "x-oa-targets"
_HTTP_METHOD_ORDER = {
    "get": 0,
    "post": 1,
    "put": 2,
    "patch": 3,
    "delete": 4,
    "head": 5,
    "options": 6,
    "trace": 7,
}
_SEVERITY_ORDER = {
    "error": 0,
    "warning": 1,
    "info": 2,
}

ValidationSeverity = Literal["error", "warning", "info"]


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    location: str
    detail: str
    severity: ValidationSeverity = "error"


class ContractValidationError(ValueError):
    def __init__(self, issues: list[ValidationIssue]) -> None:
        self.issues = issues
        issue_count = len(issues)
        label = "issue" if issue_count == 1 else "issues"
        super().__init__(f"Contract validation failed with {issue_count} {label}.")


def validate_contract_spec(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    issues.extend(_duplicate_operation_id_issues(contract.endpoints))
    issues.extend(_duplicate_method_path_issues(contract.endpoints))
    issues.extend(_path_parameter_issues(contract.endpoints))
    issues.extend(_missing_model_reference_issues(contract))
    issues.extend(_missing_security_scheme_reference_issues(contract))
    issues.extend(_missing_error_response_reference_issues(contract))
    issues.extend(_missing_required_error_response_issues(contract))
    issues.extend(_missing_example_reference_issues(contract))
    issues.extend(_unknown_target_reference_issues(contract))
    issues.extend(_public_target_leakage_issues(contract))
    issues.extend(_target_schema_audience_issues(contract))
    return _sorted_issues(issues)


def validate_endpoint_path_params(
    endpoint: ContractEndpoint,
    declared_path_params: Collection[str] | None = None,
) -> list[ValidationIssue]:
    declared_source = endpoint.path_params if declared_path_params is None else declared_path_params
    if declared_source is None:
        return []

    issues: list[ValidationIssue] = []
    location = _endpoint_label(endpoint)
    declared = list(declared_source)
    path_params = _extract_path_params(endpoint.path)
    path_param_set = set(path_params)
    declared_set = set(declared)

    for name in sorted(_duplicate_values(declared)):
        issues.append(
            ValidationIssue(
                code="duplicate-path-parameter",
                location=location,
                detail=f"Path parameter {name} is declared more than once.",
            )
        )

    for name in sorted(path_param_set - declared_set):
        issues.append(
            ValidationIssue(
                code="missing-path-parameter",
                location=location,
                detail=f"Path parameter {name} appears in the path but is not declared.",
            )
        )

    for name in sorted(declared_set - path_param_set):
        issues.append(
            ValidationIssue(
                code="unknown-path-parameter",
                location=location,
                detail=f"Path parameter {name} is declared but does not appear in the path.",
            )
        )

    return _sorted_issues(issues)


def _path_parameter_issues(endpoints: list[ContractEndpoint]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for endpoint in sorted(endpoints, key=_endpoint_key):
        issues.extend(validate_endpoint_path_params(endpoint))
    return issues


def _duplicate_operation_id_issues(endpoints: list[ContractEndpoint]) -> list[ValidationIssue]:
    by_operation_id: dict[str, list[ContractEndpoint]] = defaultdict(list)
    for endpoint in endpoints:
        by_operation_id[endpoint.operation_id].append(endpoint)

    issues: list[ValidationIssue] = []
    for operation_id, matches in sorted(by_operation_id.items()):
        if len(matches) < 2:
            continue
        labels = ", ".join(
            _endpoint_label(endpoint) for endpoint in sorted(matches, key=_endpoint_key)
        )
        issues.append(
            ValidationIssue(
                code="duplicate-operation-id",
                location=f"operation:{operation_id}",
                detail=f"operation_id {operation_id} is used by {labels}.",
            )
        )
    return issues


def _duplicate_method_path_issues(endpoints: list[ContractEndpoint]) -> list[ValidationIssue]:
    by_method_path: dict[tuple[str, str], list[ContractEndpoint]] = defaultdict(list)
    for endpoint in endpoints:
        by_method_path[(endpoint.method, endpoint.path)].append(endpoint)

    issues: list[ValidationIssue] = []
    for key, matches in sorted(by_method_path.items(), key=lambda item: _method_path_key(item[0])):
        if len(matches) < 2:
            continue
        method, path = key
        operation_ids = ", ".join(
            endpoint.operation_id for endpoint in sorted(matches, key=_endpoint_key)
        )
        issues.append(
            ValidationIssue(
                code="duplicate-method-path",
                location=f"{method.upper()} {path}",
                detail=f"{method.upper()} {path} is registered by {operation_ids}.",
            )
        )
    return issues


def _missing_model_reference_issues(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    schema_names = set(contract.schemas)

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        if endpoint.request_model is not None and endpoint.request_model not in schema_names:
            issues.append(
                ValidationIssue(
                    code="missing-request-model",
                    location=location,
                    detail=f"request_model {endpoint.request_model} is not registered.",
                )
            )
        if endpoint.response_model is not None and endpoint.response_model not in schema_names:
            issues.append(
                ValidationIssue(
                    code="missing-response-model",
                    location=location,
                    detail=f"response_model {endpoint.response_model} is not registered.",
                )
            )
        for response in endpoint.success_responses:
            if response.model is not None and response.model not in schema_names:
                issues.append(
                    ValidationIssue(
                        code="missing-response-model",
                        location=f"{location} response:{response.status_code}",
                        detail=f"response model {response.model} is not registered.",
                    )
                )

    for response_name, response in sorted(contract.standard_error_responses.items()):
        if response.model is not None and response.model not in schema_names:
            issues.append(
                ValidationIssue(
                    code="missing-response-model",
                    location=f"response:{response_name}",
                    detail=f"response model {response.model} is not registered.",
                )
            )
    return issues


def _missing_security_scheme_reference_issues(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    scheme_names = set(contract.security_schemes)

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        for requirement in endpoint.security:
            for scheme_name in sorted(requirement):
                if scheme_name not in scheme_names:
                    issues.append(
                        ValidationIssue(
                            code="missing-security-scheme",
                            location=location,
                            detail=f"security scheme {scheme_name} is not registered.",
                        )
                    )
    return issues


def _missing_error_response_reference_issues(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    response_names = set(contract.standard_error_responses)

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        for response_name in sorted(endpoint.error_responses):
            if response_name not in response_names:
                issues.append(
                    ValidationIssue(
                        code="missing-error-response",
                        location=location,
                        detail=f"error response {response_name} is not registered.",
                    )
                )
    return issues


def _missing_required_error_response_issues(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    response_names = set(contract.standard_error_responses)
    targets_by_name = {target.name: target for target in contract.targets}

    for target_name, target in sorted(targets_by_name.items()):
        for response_name in sorted(target.required_error_responses):
            if response_name not in response_names:
                issues.append(
                    ValidationIssue(
                        code="missing-error-response",
                        location=f"target:{target_name}",
                        detail=(
                            f"target required error response {response_name} "
                            "is not registered."
                        ),
                    )
                )

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        endpoint_responses = set(endpoint.error_responses)
        for target_name in sorted(set(endpoint.targets)):
            target_policy = targets_by_name.get(target_name)
            if target_policy is None:
                continue
            for response_name in sorted(
                set(target_policy.required_error_responses) - endpoint_responses
            ):
                issues.append(
                    ValidationIssue(
                        code="missing-required-error-response",
                        location=location,
                        detail=(
                            f"target {target_name} requires error response "
                            f"{response_name}."
                        ),
                    )
                )

    return issues


def _missing_example_reference_issues(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    example_names = set(contract.examples)

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        for example_name in sorted(endpoint.request_examples):
            if example_name not in example_names:
                issues.append(
                    ValidationIssue(
                        code="missing-request-example",
                        location=location,
                        detail=f"request example {example_name} is not registered.",
                    )
                )
        for example_name in sorted(endpoint.response_examples):
            if example_name not in example_names:
                issues.append(
                    ValidationIssue(
                        code="missing-response-example",
                        location=location,
                        detail=f"response example {example_name} is not registered.",
                    )
                )
        for response in endpoint.success_responses:
            for example_name in sorted(response.examples):
                if example_name not in example_names:
                    issues.append(
                        ValidationIssue(
                            code="missing-response-example",
                            location=f"{location} response:{response.status_code}",
                            detail=f"response example {example_name} is not registered.",
                        )
                    )

    for response_name, response in sorted(contract.standard_error_responses.items()):
        for example_name in sorted(response.examples):
            if example_name not in example_names:
                issues.append(
                    ValidationIssue(
                        code="missing-response-example",
                        location=f"response:{response_name}",
                        detail=f"response example {example_name} is not registered.",
                    )
                )
    return issues


def _unknown_target_reference_issues(contract: ContractSpec) -> list[ValidationIssue]:
    if not contract.targets:
        return []

    issues: list[ValidationIssue] = []
    target_names = {target.name for target in contract.targets}
    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        for target_name in sorted(endpoint.targets):
            if target_name not in target_names:
                issues.append(
                    ValidationIssue(
                        code="unknown-target",
                        location=location,
                        detail=f"target {target_name} is not registered.",
                    )
                )
    return issues


def _public_target_leakage_issues(contract: ContractSpec) -> list[ValidationIssue]:
    public_targets = _public_target_names(contract)
    if not public_targets:
        return []

    issues: list[ValidationIssue] = []
    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        endpoint_public_targets = sorted(public_targets & set(endpoint.targets))
        if not endpoint_public_targets:
            continue

        location = _endpoint_label(endpoint)
        public_target_label = ", ".join(endpoint_public_targets)
        if endpoint.internal_only:
            issues.append(
                ValidationIssue(
                    code="public-internal-endpoint",
                    location=location,
                    detail=(
                        "internal-only endpoint targets public target(s): "
                        f"{public_target_label}."
                    ),
                )
            )

        for model_name in _endpoint_reachable_model_names(endpoint, contract):
            schema = contract.schemas.get(model_name)
            if schema is not None and _schema_internal_only(schema):
                issues.append(
                    ValidationIssue(
                        code="public-internal-model",
                        location=location,
                        detail=(
                            f"public target(s) {public_target_label} reference "
                            f"internal-only model {model_name}."
                        ),
                    )
                )

    return issues


def _target_schema_audience_issues(contract: ContractSpec) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    public_targets = _public_target_names(contract)

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        location = _endpoint_label(endpoint)
        for target_name in sorted(set(endpoint.targets)):
            for model_name in _endpoint_reachable_model_names(endpoint, contract):
                schema = contract.schemas.get(model_name)
                if schema is None or _schema_allowed_for_target(schema, target_name):
                    continue
                if target_name in public_targets and _schema_internal_only(schema):
                    continue
                issues.append(
                    ValidationIssue(
                        code="target-schema-audience",
                        location=location,
                        detail=(
                            f"target {target_name} cannot reference "
                            f"{_schema_target_label(schema)} model {model_name}."
                        ),
                    )
                )

    return issues


def _public_target_names(contract: ContractSpec) -> set[str]:
    public_targets = {target.name for target in contract.targets if target.public}
    if any(target.name == "public" for target in contract.targets):
        public_targets.add("public")
    if any("public" in endpoint.targets for endpoint in contract.endpoints):
        public_targets.add("public")
    return public_targets


def _endpoint_model_names(endpoint: ContractEndpoint, contract: ContractSpec) -> list[str]:
    names: set[str] = set()
    if endpoint.request_model is not None:
        names.add(endpoint.request_model)
    if endpoint.response_model is not None:
        names.add(endpoint.response_model)
    for response in endpoint.success_responses:
        if response.model is not None:
            names.add(response.model)
    for response_name in endpoint.error_responses:
        error_response = contract.standard_error_responses.get(response_name)
        if error_response is not None and error_response.model is not None:
            names.add(error_response.model)
    return sorted(names)


def _endpoint_reachable_model_names(
    endpoint: ContractEndpoint,
    contract: ContractSpec,
) -> list[str]:
    reachable = {
        name for name in _endpoint_model_names(endpoint, contract) if name in contract.schemas
    }
    pending = list(reachable)
    while pending:
        schema_name = pending.pop()
        schema = contract.schemas.get(schema_name)
        if schema is None:
            continue
        for ref_name in sorted(_schema_ref_names(schema)):
            if ref_name not in contract.schemas or ref_name in reachable:
                continue
            reachable.add(ref_name)
            pending.append(ref_name)
    return sorted(reachable)


def _schema_ref_names(value: object) -> set[str]:
    names: set[str] = set()
    if isinstance(value, Mapping):
        ref = value.get("$ref")
        if isinstance(ref, str):
            name = _component_schema_name_from_ref(ref)
            if name is not None:
                names.add(name)
        for item in value.values():
            names.update(_schema_ref_names(item))
    elif isinstance(value, list):
        for item in value:
            names.update(_schema_ref_names(item))
    return names


def _component_schema_name_from_ref(ref: str) -> str | None:
    if not ref.startswith(_COMPONENT_SCHEMA_REF_PREFIX):
        return None
    pointer = ref[len(_COMPONENT_SCHEMA_REF_PREFIX):]
    encoded_name = pointer.split("/", 1)[0]
    return encoded_name.replace("~1", "/").replace("~0", "~")


def _schema_allowed_for_target(schema: Mapping[str, object], target: str) -> bool:
    if _schema_internal_only(schema):
        return target == "internal"

    schema_targets = _schema_target_names(schema)
    if schema_targets is not None:
        return target in schema_targets

    audience = schema.get(_SCHEMA_AUDIENCE_EXTENSION)
    if audience is None or audience == "shared":
        return True
    if not isinstance(audience, str):
        return True
    return _audience_allowed_for_target(audience, target)


def _schema_target_names(schema: Mapping[str, object]) -> set[str] | None:
    raw_targets = schema.get(_SCHEMA_TARGETS_EXTENSION)
    if raw_targets is None:
        return None
    if isinstance(raw_targets, list) and all(isinstance(item, str) for item in raw_targets):
        return set(raw_targets)
    return None


def _audience_allowed_for_target(audience: str, target: str) -> bool:
    audience_order = _MODEL_AUDIENCE_ORDER.get(audience)
    target_order = _MODEL_AUDIENCE_ORDER.get(target)
    if audience_order is None or target_order is None:
        return audience == target
    return target_order >= audience_order


def _schema_target_label(schema: Mapping[str, object]) -> str:
    schema_targets = _schema_target_names(schema)
    if schema_targets is not None:
        return "/".join(sorted(schema_targets))
    audience = schema.get(_SCHEMA_AUDIENCE_EXTENSION)
    if isinstance(audience, str):
        return audience
    if _schema_internal_only(schema):
        return "internal"
    return "restricted"


def _schema_internal_only(schema: object) -> bool:
    if not isinstance(schema, dict):
        return False
    return any(schema.get(extension) is True for extension in _INTERNAL_ONLY_SCHEMA_EXTENSIONS)


def _extract_path_params(path: str) -> list[str]:
    return _PATH_PARAM_PATTERN.findall(path)


def _duplicate_values(values: list[str]) -> set[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return duplicates


def _endpoint_label(endpoint: ContractEndpoint) -> str:
    return f"{endpoint.method.upper()} {endpoint.path}"


def _endpoint_key(endpoint: ContractEndpoint) -> tuple[str, int, str, str]:
    return (
        endpoint.path,
        _HTTP_METHOD_ORDER[endpoint.method],
        endpoint.method,
        endpoint.operation_id,
    )


def _method_path_key(method_path: tuple[str, str]) -> tuple[str, int, str]:
    method, path = method_path
    return (path, _HTTP_METHOD_ORDER[method], method)


def _sorted_issues(issues: list[ValidationIssue]) -> list[ValidationIssue]:
    return sorted(issues, key=_issue_key)


def _issue_key(issue: ValidationIssue) -> tuple[int, str, str, str]:
    return (
        _SEVERITY_ORDER[issue.severity],
        issue.location,
        issue.code,
        issue.detail,
    )
