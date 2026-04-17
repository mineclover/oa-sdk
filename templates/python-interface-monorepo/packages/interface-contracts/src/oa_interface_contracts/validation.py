import re
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass

from .spec import ContractEndpoint, ContractSpec

_PATH_PARAM_PATTERN = re.compile(r"{([^}/]+)}")
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


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    location: str
    detail: str


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
    issues.extend(_missing_model_reference_issues(contract))
    issues.extend(_missing_security_scheme_reference_issues(contract))
    issues.extend(_missing_error_response_reference_issues(contract))
    issues.extend(_missing_example_reference_issues(contract))
    issues.extend(_unknown_target_reference_issues(contract))
    return _sorted_issues(issues)


def validate_endpoint_path_params(
    endpoint: ContractEndpoint,
    declared_path_params: Collection[str] | None,
) -> list[ValidationIssue]:
    if declared_path_params is None:
        return []

    issues: list[ValidationIssue] = []
    location = _endpoint_label(endpoint)
    declared = list(declared_path_params)
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
    return sorted(issues, key=lambda issue: (issue.location, issue.code, issue.detail))
