from importlib import import_module
from typing import Any


def load_module_attr(reference: str) -> Any:
    module_name, separator, attr_path = reference.partition(":")
    if not separator or not module_name or not attr_path:
        raise ValueError("reference must use module:attribute syntax")

    value: Any = import_module(module_name)
    for attr in attr_path.split("."):
        value = getattr(value, attr)
    return value
