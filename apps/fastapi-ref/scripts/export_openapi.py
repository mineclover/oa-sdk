"""Emit FastAPI's OpenAPI document to contracts/openapi.raw.{yaml,json}."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.main import create_app  # noqa: E402


def main() -> None:
    app = create_app()
    spec = app.openapi()

    contracts_dir = Path(__file__).resolve().parent.parent / "contracts"
    contracts_dir.mkdir(parents=True, exist_ok=True)

    json_path = contracts_dir / "openapi.raw.json"
    yaml_path = contracts_dir / "openapi.raw.yaml"

    json_path.write_text(json.dumps(spec, indent=2, sort_keys=False) + "\n")
    yaml_path.write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True))

    print(f"✓ {json_path.relative_to(contracts_dir.parent)}")
    print(f"✓ {yaml_path.relative_to(contracts_dir.parent)}")


if __name__ == "__main__":
    main()
