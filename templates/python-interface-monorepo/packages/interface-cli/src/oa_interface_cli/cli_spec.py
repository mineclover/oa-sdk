import json
from importlib.resources import files
from typing import Any


def load_cli_manifest() -> dict[str, Any]:
    manifest = files(__package__).joinpath("cli_spec.json").read_text()
    value = json.loads(manifest)
    if not isinstance(value, dict):
        raise TypeError("CLI manifest must be a JSON object.")
    return value


OA_CONTRACT_GOVERNANCE_MANIFEST = load_cli_manifest()
