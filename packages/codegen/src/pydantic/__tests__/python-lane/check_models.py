"""Validate one generated Pydantic module and print lane counters."""
import importlib.util
import importlib
import inspect
import json
import sys
from pathlib import Path
from typing import Any

try:
    from pydantic import BaseModel, TypeAdapter, ValidationError
except ModuleNotFoundError:  # The stdlib-only normalizer unit branch remains runnable in this sandbox.
    BaseModel = object  # type: ignore[assignment,misc]
    TypeAdapter = None  # type: ignore[assignment]
    ValidationError = Exception  # type: ignore[assignment,misc]


COUNTER_NAMES = (
    "examples", "aliasByWire", "aliasByAttribute", "dumpByAlias", "omitOptional",
    "rejectNull", "taggedUnion", "uniqueItems",
)


def load_module(path: str):
    """Import the generated module from a temporary path."""
    module_path = Path(path)
    if module_path.name != "models.py" and (module_path.parent / "__init__.py").exists():
        sys.path.insert(0, str(module_path.parent.parent))
        return importlib.import_module(f"{module_path.parent.name}.{module_path.stem}")
    spec = importlib.util.spec_from_file_location("generated_models", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    for value in vars(module).values():
        if isinstance(value, type) and issubclass(value, BaseModel):
            if value.__module__ == module.__name__:
                value.model_rebuild()
    return module


def validate_examples(module: Any, payload: dict[str, Any], counters: dict[str, int]) -> None:
    """Validate every fixture example against its generated declaration."""
    for item in payload["examples"]:
        cls = getattr(module, item["pyName"])
        if item["alias"]:
            cls.model_validate(item["value"])
        else:
            TypeAdapter(cls).validate_python(item["value"])
        counters["examples"] += 1


def validate_aliases(module: Any, payload: dict[str, Any], counters: dict[str, int]) -> None:
    """Validate model examples by wire and attribute names and inspect aliases."""
    for item in payload["modelCases"]:
        cls = getattr(module, item["pyName"])
        wire_data = item["value"]
        attribute_data = {
            field["attribute"]: wire_data[field["wire"]]
            for field in item["fields"]
            if field["wire"] in wire_data
        }
        cls.model_validate(wire_data)
        counters["aliasByWire"] += 1
        cls.model_validate(attribute_data)
        counters["aliasByAttribute"] += 1
        dumped = cls.model_validate(wire_data).model_dump(by_alias=True)
        if all(field["wire"] in dumped for field in item["fields"] if field["wire"] in wire_data):
            counters["dumpByAlias"] += 1


def validate_extra(module: Any, payload: dict[str, Any]) -> None:
    """Check the configured extra policy on an open model example."""
    options = payload["options"]
    open_cases = [item for item in payload["modelCases"] if item.get("open")]
    if not open_cases:
        return
    item = open_cases[0]
    cls = getattr(module, item["pyName"])
    value = dict(item["value"])
    value["__lane_unknown__"] = True
    if options["extra"] == "ignore":
        assert "__lane_unknown__" not in (cls.model_validate(value).model_extra or {})
    elif options["extra"] == "allow":
        assert cls.model_validate(value).model_extra["__lane_unknown__"] is True
    else:
        try:
            cls.model_validate(value)
        except ValidationError:
            return
        raise AssertionError("extra field was accepted")


def validate_tagged_union(module: Any, payload: dict[str, Any], counters: dict[str, int]) -> None:
    """Validate each NextPointer discriminator variant."""
    if payload["fixture"] != "chunk-stream":
        return
    adapter = TypeAdapter(module.NextPointerUnion)
    variants = {
        "available": "NextAvailable", "pending": "NextPending",
        "unresolved": "NextUnresolved", "end": "NextEnd",
    }
    for state, expected in variants.items():
        value = {"state": state}
        if state in {"available", "pending"}:
            value["id"] = "lane"
        result = adapter.validate_python(value)
        assert result.__class__.__name__ == expected, (result.__class__.__name__, expected)
        counters["taggedUnion"] += 1


def validate_unique(module: Any, payload: dict[str, Any], counters: dict[str, int]) -> None:
    """Reject duplicate list items and accept a unique list."""
    case = payload.get("uniqueCase")
    if case is None:
        return
    cls = getattr(module, case["class"])
    try:
        cls.model_validate({case["field"]: ["x", "x"]})
    except ValidationError:
        counters["uniqueItems"] += 1
    else:
        raise AssertionError("duplicate items were accepted")
    cls.model_validate({case["field"]: ["x", "y"]})
    counters["uniqueItems"] += 1


def validate_semantic(module: Any, payload: dict[str, Any]) -> dict[str, int]:
    """Run deterministic semantic checks against the inline test document."""
    options = payload["options"]
    person = module.Person
    locked = module.Locked
    tags = module.Tags
    counters: dict[str, int] = {}
    person.model_validate({"personId": "p"})
    counters["omitNickName"] = 1
    try:
        person.model_validate({"personId": "p", "nickName": None})
    except ValidationError:
        counters["rejectNickNameNull"] = 1
    else:
        counters["acceptNickNameNull"] = 1
    person.model_validate({"personId": "p", "note": None})
    counters["acceptNoteNull"] = 1
    if options["optionalStyle"] == "plain":
        assert "acceptNickNameNull" in counters
        counters.pop("omitNickName", None)
        counters.pop("rejectNickNameNull", None)
    elif options["naming"] != "preserve":
        counters["wireInput"] = 1
        person.model_validate({"person_id": "p", "nick_name": "n", "note": "x"})
        counters["attributeInput"] = 1
        dumped = person.model_validate({"personId": "p", "nickName": "n"}).model_dump(by_alias=True)
        assert set(dumped) == {"personId", "nickName", "note", "_meta", "from", "json"}, dumped
        counters["dumpByAlias"] = 1
    if options["extra"] == "ignore":
        assert "zzz" not in (person.model_validate({"personId": "p", "zzz": 1}).model_extra or {})
        counters["ignoreExtra"] = 1
    elif options["extra"] == "allow":
        actual = person.model_validate({"personId": "p", "zzz": 1}).model_extra
        assert actual == {"zzz": 1}, actual
        counters["allowExtra"] = 1
    else:
        try:
            person.model_validate({"personId": "p", "zzz": 1})
        except ValidationError:
            counters["forbidExtra"] = 1
        else:
            raise AssertionError("Person accepted an extra field")
    try:
        locked.model_validate({"id": "x", "zzz": 1})
    except ValidationError:
        counters["lockedReject"] = 1
    else:
        raise AssertionError("Locked accepted an extra field")
    try:
        tags.model_validate({"values": ["x", "x"]})
    except ValidationError:
        counters["duplicateReject"] = 1
    else:
        raise AssertionError("duplicate tags accepted")
    tags.model_validate({"values": ["x", "y"]})
    counters["uniqueAccept"] = 1
    if options["naming"] == "preserve":
        for wire, attribute in (("personId", "personId"), ("nickName", "nickName"), ("note", "note")):
            assert wire == attribute and wire in person.model_fields, (wire, attribute, person.model_fields)
        counters["preserveNames"] = 3
        for wire, attribute in (("_meta", "meta"), ("from", "from_"), ("json", "json_")):
            field = person.model_fields[attribute]
            assert wire != attribute and field.alias == wire, (wire, attribute, field.alias)
            person.model_validate({"personId": "p", wire: "x"})
        counters["preserveAliases"] = 3
    if options["naming"] == "preserve":
        return {key: counters[key] for key in ("preserveNames", "preserveAliases")}
    if options["optionalStyle"] == "plain":
        return {key: counters[key] for key in ("acceptNickNameNull", "acceptNoteNull")}
    if options["extra"] == "allow":
        return {key: counters[key] for key in ("allowExtra", "lockedReject")}
    if options["extra"] == "forbid":
        return {"forbidExtra": counters["forbidExtra"]}
    return {key: counters[key] for key in (
        "omitNickName", "rejectNickNameNull", "acceptNoteNull", "wireInput", "attributeInput",
        "dumpByAlias", "ignoreExtra", "lockedReject", "duplicateReject", "uniqueAccept",
    )}


def validate_encoding(module: Any, counters: dict[str, int]) -> None:
    """Check decoded @encode values and their original JSON wire forms."""
    from datetime import datetime, timezone

    value = module.Encoded.model_validate({
        "unix": 784111777,
        "httpDate": "Sun, 06 Nov 1994 08:49:37 GMT",
        "token": "AQID",
    })
    assert value.unix == datetime(1994, 11, 6, 8, 49, 37, tzinfo=timezone.utc), value.unix
    counters["decodeUnix"] = 1
    assert value.http_date == datetime(1994, 11, 6, 8, 49, 37, tzinfo=timezone.utc), value.http_date
    counters["decodeHttpDate"] = 1
    assert value.token == b"\x01\x02\x03", value.token
    counters["decodeBase64Url"] = 1
    actual = value.model_dump(mode="json", by_alias=True)
    assert actual == {
        "unix": 784111777, "httpDate": "Sun, 06 Nov 1994 08:49:37 GMT", "token": "AQID",
    }, actual
    counters["dumpWire"] = 1
    actual = module.Encoded.model_json_schema()["x-lane-model"]
    assert actual == "encoded", actual
    counters["modelExtension"] = 1


def validate_encoding_naive(module: Any, counters: dict[str, int]) -> None:
    from datetime import datetime

    value = module.Encoded.model_validate({
        "unix": 784111777,
        "httpDate": "Sun, 06 Nov 1994 08:49:37 GMT",
        "token": "AQID",
    })
    assert value.unix == datetime(1994, 11, 6, 8, 49, 37), value.unix
    counters["decodeUnixNaive"] = 1
    assert value.http_date == datetime(1994, 11, 6, 8, 49, 37), value.http_date
    counters["decodeHttpDateNaive"] = 1
    actual = value.model_dump(mode="json", by_alias=True)
    assert actual == {
        "unix": 784111777, "httpDate": "Sun, 06 Nov 1994 08:49:37 GMT", "token": "AQID",
    }, actual
    counters["dumpWireNaive"] = 1


def validate_encoding_python(module: Any, counters: dict[str, int]) -> None:
    from datetime import datetime, timezone

    value = module.Encoded(
        unix=datetime(1994, 11, 6, 8, 49, 37, tzinfo=timezone.utc),
        httpDate=datetime(1994, 11, 6, 8, 49, 37, tzinfo=timezone.utc),
        token="AQID",
    )
    actual = value.model_dump(mode="json", by_alias=True)
    assert actual == {
        "unix": 784111777, "httpDate": "Sun, 06 Nov 1994 08:49:37 GMT", "token": "AQID",
    }, actual
    counters["pythonValues"] = 1


def validate_recursive_alias(module: Any, counters: dict[str, int]) -> None:
    value = module.Node.model_validate({"value": "root", "children": [{"value": "leaf", "children": []}]})
    assert value.children[0].value == "leaf", value.children[0].value
    counters["recursiveAlias"] = 1


def validate_operations(module: Any, payload: dict[str, Any]) -> dict[str, int]:
    """Validate operation request/response/error models and metadata."""
    counters: dict[str, int] = {}
    path = module.ReadItemPathParams.model_validate({"id": 1})
    assert path.model_dump(by_alias=True) == {"id": 1}
    query = module.ReadItemQueryParams.model_validate({})
    assert query.model_dump(by_alias=True) == {"q": None}
    header = module.ReadItemHeaderParams.model_validate({"X-Request-Id": "lane"})
    assert header.model_dump(by_alias=True) == {"X-Request-Id": "lane"}
    counters["requestModels"] = 1
    body = TypeAdapter(module.ReadItemBody).validate_python({"name": "thing"})
    assert body.name == "thing"
    counters["bodyAlias"] = 1
    response = TypeAdapter(module.ReadItemResponse).validate_python({"accepted": True})
    assert response.accepted is True
    counters["responseUnion"] = 1
    error = TypeAdapter(module.ReadItemError).validate_python({"code": "NOT_FOUND"})
    assert isinstance(error, module.NotFound)
    assert error.code == "NOT_FOUND"
    counters["error404"] = 1
    default_error = TypeAdapter(module.ReadItemError).validate_python({"message": "unexpected"})
    assert isinstance(default_error, module.Error)
    assert default_error.message == "unexpected"
    assert module.OPERATIONS["ReadItem"].responses["404"] is module.NotFound
    counters["metadata404"] = 1
    return counters


def validate_exact(module: Any) -> dict[str, int]:
    """Exact discriminator-less oneOf rejects ambiguous and unmatched payloads."""
    counters: dict[str, int] = {}
    adapter = TypeAdapter(module.Choice)
    for value, key in [({"x": "x", "y": "y"}, "exactAmbiguous"), ({"z": 1}, "exactNone")]:
        try:
            adapter.validate_python(value)
        except ValidationError:
            counters[key] = 1
        else:
            raise AssertionError(f"exact oneOf accepted {value}")
    assert adapter.validate_python({"x": "x"}).x == "x"
    counters["exactOne"] = 1
    envelope = module.Envelope.model_validate({"choice": {"x": "x"}, "either": 1})
    assert envelope.either == 1
    counters["anyOfOverlap"] = 1
    return counters


def validate_smart(module: Any) -> dict[str, int]:
    """Smart mode accepts a payload matching both oneOf branches."""
    value = TypeAdapter(module.Choice).validate_python({"x": "x", "y": "y"})
    assert value is not None
    return {"smartAmbiguous": 1}


def validate_body_types(module: Any) -> dict[str, int]:
    """Validate multipart bytes, text/binary aliases, stream items and envelopes."""
    body = module.UploadBody.model_validate({"file": b"one", "files": [b"two", b"three"]})
    assert body.file == b"one" and body.files == [b"two", b"three"]
    counters = {"multipartBytes": 1}
    assert TypeAdapter(module.UploadBodyText).validate_python("hello") == "hello"
    counters["textAlias"] = 1
    assert TypeAdapter(module.UploadResponseJsonlItem).validate_python("line") == "line"
    assert TypeAdapter(module.UploadResponseEventStreamItem).validate_python("event") == "event"
    counters["streamItems"] = 2
    pet = TypeAdapter(module.Pet)
    assert pet.validate_python({"kind": "cat", "value": {"name": "c", "meow": 2}}).value.name == "c"
    assert pet.validate_python({"kind": "dog", "value": {"name": "d", "bark": "woof"}}).value.name == "d"
    pet2 = TypeAdapter(module.Pet2)
    assert pet2.validate_python({"type": "cat", "data": {"name": "c", "meow": 2}}).data.name == "c"
    counters["envelopeVariants"] = 1
    try:
        pet.validate_python({"kind": "unknown", "value": 1})
    except ValidationError:
        counters["envelopeUnknownReject"] = 1
    else:
        raise AssertionError("unknown envelope tag accepted")
    assert TypeAdapter(module.RawBody).validate_python("hello") == "hello"
    assert TypeAdapter(module.RawResponse).validate_python(b"bytes") == b"bytes"
    counters["schemaLessText"] = 1
    counters["schemaLessBytes"] = 1
    return counters


def _resolve_refs(
    value: Any,
    defs: dict[str, Any],
    components: dict[str, Any] | None = None,
    stack: tuple[str, ...] = (),
    aliases: dict[str, str] | None = None,
    expand_polymorphic: bool = True,
) -> Any:
    components = components or {}
    aliases = aliases or {}
    if isinstance(value, dict) and isinstance(value.get("$ref"), str):
        ref = value["$ref"]
        target = ref.rsplit("/", 1)[-1]
        source = defs.get(target) if ref.startswith("#/$defs/") else components.get(target)
        canonical = aliases.get(target, target) if ref.startswith("#/$defs/") else target
        siblings = {name: item for name, item in value.items() if name != "$ref"}
        if source is None or canonical in stack:
            return {"$ref": canonical, **siblings}
        if not ref.startswith("#/$defs/") and isinstance(source, dict) \
            and source.get("type") not in {"object", "array", "boolean", "integer", "number", "null"} \
            and not any(name in source for name in ("properties", "allOf", "oneOf", "anyOf")):
            source = {name: item for name, item in source.items() if name not in {"description", "title", "example", "examples"}}
        if expand_polymorphic and isinstance(source, dict) and isinstance(source.get("discriminator"), dict) \
            and isinstance(source["discriminator"].get("mapping"), dict) \
            and "oneOf" not in source:
            mapping = source["discriminator"]["mapping"]
            source = {
                "oneOf": [{"$ref": target_ref} for target_ref in mapping.values()],
                "discriminator": source["discriminator"],
            }
        resolved = _resolve_refs(source, defs, components, (*stack, canonical), aliases, expand_polymorphic)
        if siblings and isinstance(resolved, dict):
            resolved = {**resolved, **_resolve_refs(siblings, defs, components, stack, aliases, expand_polymorphic)}
        return resolved
    if isinstance(value, dict):
        return {key: _resolve_refs(item, defs, components, stack, aliases, expand_polymorphic) for key, item in value.items() if key not in {"$defs", "definitions"}}
    if isinstance(value, list):
        return [_resolve_refs(item, defs, components, stack, aliases, expand_polymorphic) for item in value]
    return value


def _source_nullable(source: Any) -> bool:
    if not isinstance(source, dict):
        return False
    if source.get("nullable") is True:
        return True
    if isinstance(source.get("type"), list) and "null" in source["type"]:
        return True
    return any(isinstance(branch, dict) and branch.get("type") == "null" for key in ("anyOf", "oneOf") for branch in source.get(key, []))


def _flatten_allof(value: Any, defs: dict[str, Any], components: dict[str, Any], aliases: dict[str, str] | None = None) -> Any:
    if not isinstance(value, dict) or not isinstance(value.get("allOf"), list):
        return value
    flattened: dict[str, Any] = {}
    properties: dict[str, Any] = {}
    required: list[str] = []
    for branch in value["allOf"]:
        branch_value = _flatten_allof(branch, defs, components, aliases)
        if isinstance(branch_value, dict):
            properties.update(branch_value.get("properties", {}))
            required.extend(branch_value.get("required", []))
            # A polymorphic base may carry its own union/discriminator.  Those
            # keywords describe the base, not each concrete allOf variant.
            for name in ("type", "additionalProperties", "unevaluatedProperties"):
                if name in branch_value:
                    flattened.setdefault(name, branch_value[name])
    current = {name: item for name, item in value.items() if name != "allOf"}
    properties.update(current.pop("properties", {}))
    required.extend(current.pop("required", []))
    flattened.update(current)
    if properties:
        flattened["properties"] = properties
    if required:
        flattened["required"] = sorted(set(required))
    return flattened


def _normalize_schema(
    value: Any,
    source: Any,
    defs: dict[str, Any],
    components: dict[str, Any],
    optional_non_nullable: bool = False,
    aliases: dict[str, str] | None = None,
) -> Any:
    aliases = aliases or {}
    # References are resolved once by validate_parity. Re-resolving children would restart the
    # cycle stack and expand a back-edge forever.
    if isinstance(value, list):
        source_list = source if isinstance(source, list) else []
        return [_normalize_schema(item, source_list[index] if index < len(source_list) else {}, defs, components, aliases=aliases) for index, item in enumerate(value)]
    if not isinstance(value, dict):
        return value
    source_record = _flatten_allof(source if isinstance(source, dict) else {}, {}, components)
    value_record = _flatten_allof(value, defs, components, aliases)
    if optional_non_nullable and isinstance(value_record.get("anyOf"), list) and not _source_nullable(source_record):
        non_null = [branch for branch in value_record["anyOf"] if not (isinstance(branch, dict) and branch.get("type") == "null")]
        if len(non_null) == 1 and isinstance(non_null[0], dict):
            outer = {name: item for name, item in value_record.items() if name != "anyOf"}
            value_record = {**non_null[0], **outer}
    value = value_record
    result: dict[str, Any] = {}
    source_required = set(source_record.get("required", [])) if isinstance(source_record.get("required"), list) else set()
    for key, item in value.items():
        if key in {"$defs", "definitions", "example", "examples", "deprecated", "readOnly", "writeOnly", "x-oa-sdk-original-pattern"}:
            continue
        if key == "contentEncoding":
            continue
        if key == "contentMediaType" and (
            value_record.get("contentEncoding") in {"base64", "base64url"}
            or value_record.get("format") in {"byte", "base64", "base64url"}
        ):
            continue
        if key == "format" and item in {
            "int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "safeint",
            "unixtime", "http-date", "base64url", "base64", "byte", "decimal", "decimal128",
            "float", "double",
        }:
            continue
        if key == "title" and not isinstance(source_record.get("title"), str):
            continue
        if key == "default" and "default" not in source_record and item is None:
            continue
        if key == "additionalProperties" and item is True:
            continue
        if key == "unevaluatedProperties":
            continue
        if key == "nullable":
            continue
        if key == "description" and isinstance(item, str):
            result[key] = inspect.cleandoc(item)
            continue
        if key == "required":
            if item:
                result[key] = sorted(item)
            continue
        if key == "properties" and isinstance(item, dict):
            source_properties = source_record.get("properties", {}) if isinstance(source_record.get("properties"), dict) else {}
            result[key] = {
                name: _normalize_schema(
                    child,
                    source_properties.get(name, {}),
                    defs,
                    components,
                    name not in source_required and not _source_nullable(source_properties.get(name, {})),
                    aliases=aliases,
                )
                for name, child in sorted(item.items())
            }
            continue
        if key == "discriminator" and isinstance(item, dict):
            if "oneOf" not in value_record and "anyOf" not in value_record:
                continue
            discriminator = {name: child for name, child in item.items() if name != "mapping"}
            mapping = item.get("mapping")
            if isinstance(mapping, dict):
                discriminator["mapping"] = {
                    name: target.rsplit("/", 1)[-1] if isinstance(target, str) else target
                    for name, target in sorted(mapping.items())
                }
            result[key] = discriminator
            continue
        if key == "anyOf" and optional_non_nullable and isinstance(item, list) and not _source_nullable(source_record):
            item = [branch for branch in item if not (isinstance(branch, dict) and branch.get("type") == "null")]
            if len(item) == 1:
                branch = _normalize_schema(item[0], source_record, defs, components, aliases=aliases)
                siblings = {name: child for name, child in result.items() if name != "anyOf"}
                if isinstance(branch, dict):
                    return {**branch, **siblings}
                return branch
        result[key] = _normalize_schema(item, source_record.get(key, {}), defs, components, aliases=aliases)
    value_type = value_record.get("type")
    if isinstance(value_type, list) and "null" in value_type:
        non_null = [item for item in value_type if item != "null"]
        result.pop("type", None)
        result["anyOf"] = [{"type": item} for item in non_null] + [{"type": "null"}]
    value_additional = value_record.get("additionalProperties", value_record.get("unevaluatedProperties"))
    if value_additional is False or (isinstance(value_additional, dict) and value_additional.get("not") == {}):
        result["additionalProperties"] = False
    elif isinstance(value_additional, dict) and value_additional != {}:
        result["additionalProperties"] = _normalize_schema(value_additional, {}, defs, components, aliases=aliases)
    if "const" in result:
        result["enum"] = [result.pop("const")]
    elif isinstance(result.get("enum"), list) and len(result["enum"]) == 1:
        result["enum"] = [result["enum"][0]]
    enum_values = result.get("enum")
    if isinstance(enum_values, list) and enum_values:
        # An enum fixes the JSON type of its values; integer values satisfy both `integer` and `number`.
        json_types = [_enum_json_types(item) for item in enum_values]
        shared = set.intersection(*json_types)
        if result.get("type") in shared:
            result.pop("type", None)
    # Drop empty `properties` before deciding on `type: object`, so an empty generated model and an
    # open source object normalize the same way.
    if result.get("properties") == {}:
        result.pop("properties", None)
    if "properties" in result and result.get("type") == "object":
        result.pop("type", None)
    bounds = {
        "int8": (-128, 127), "int16": (-32768, 32767), "int32": (-2147483648, 2147483647),
        "int64": (-9223372036854775808, 9223372036854775807), "uint8": (0, 255),
        "uint16": (0, 65535), "uint32": (0, 4294967295), "uint64": (0, 18446744073709551615),
        "safeint": (-(2**53 - 1), 2**53 - 1),
    }
    if value_record.get("format") in bounds:
        lower, upper = bounds[value_record["format"]]
        result.setdefault("minimum", lower)
        result.setdefault("maximum", upper)
    for union_key in ("anyOf", "oneOf"):
        if union_key in result:
            result[union_key] = sorted(result[union_key], key=lambda item: json.dumps(item, sort_keys=True))
    return result


def _enum_json_types(value: Any) -> set[str]:
    if isinstance(value, bool):
        return {"boolean"}
    if isinstance(value, int):
        return {"integer", "number"}
    if isinstance(value, float):
        return {"number"}
    if isinstance(value, str):
        return {"string"}
    return {"null"} if value is None else set()


def _root_stack(root: str | None) -> tuple[str, ...]:
    return (root,) if root else ()


def _diff_schema(expected: Any, actual: Any, pointer: str = "") -> list[tuple[str, Any, Any]]:
    if isinstance(expected, dict) and isinstance(actual, dict):
        diffs: list[tuple[str, Any, Any]] = []
        for key in sorted(set(expected) | set(actual)):
            child = f"{pointer}/{key.replace('~', '~0').replace('/', '~1')}"
            if key not in expected or key not in actual:
                diffs.append((child, expected.get(key), actual.get(key)))
            else:
                diffs.extend(_diff_schema(expected[key], actual[key], child))
        return diffs
    if isinstance(expected, list) and isinstance(actual, list):
        diffs: list[tuple[str, Any, Any]] = []
        for index in range(max(len(expected), len(actual))):
            child = f"{pointer}/{index}"
            if index >= len(expected) or index >= len(actual):
                diffs.append((child, expected[index] if index < len(expected) else None, actual[index] if index < len(actual) else None))
            else:
                diffs.extend(_diff_schema(expected[index], actual[index], child))
        return diffs
    return [] if expected == actual else [(pointer, expected, actual)]


def validate_parity(module: Any, payload: dict[str, Any]) -> dict[str, int]:
    """Compare generated validation schemas with source schemas after documented normalization."""
    compared = 0
    allowed = 0
    new: list[tuple[str, Any, Any]] = []
    used: set[str] = set()
    allow_entries = payload.get("allowList", [])
    allow_by_pointer = {entry["pointer"]: entry for entry in allow_entries}
    assert len(allow_by_pointer) == len(allow_entries), "parity allow-list has duplicate pointers"
    components = payload.get("components", {})
    ref_map = payload.get("refMap", {})
    for py_name, source in payload["modelMap"].items():
        generated = getattr(module, source).model_json_schema(by_alias=True, mode="validation")
        # Both sides must expand a recursive back-edge to the root model the same number of times.
        # The source schema is the component body itself, so the root is already "entered"; the
        # generated schema of a recursive model is a `$ref` to its own `$defs` entry, which enters
        # the root on resolution.
        root = ref_map.get(py_name)
        source_schema = _resolve_refs(payload["sourceSchemas"][py_name], {}, components, _root_stack(root))
        generated_stack = () if isinstance(generated.get("$ref"), str) else _root_stack(root)
        generated_schema = _resolve_refs(generated, generated.get("$defs", {}), components, generated_stack, aliases=ref_map)
        expected = _normalize_schema(source_schema, source_schema, {}, components)
        actual = _normalize_schema(generated_schema, source_schema, generated.get("$defs", {}), components, aliases=ref_map)
        differences = _diff_schema(expected, actual, f"/{py_name}")
        for pointer, source_value, generated_value in differences:
            if pointer in allow_by_pointer:
                allowed += 1
                used.add(pointer)
            else:
                new.append((pointer, source_value, generated_value))
        compared += 1
    assert not new, "schema parity differences (pointer, source, generated):\n" + "\n".join(
        f"  {pointer}: {json.dumps(source_value, sort_keys=True)} != {json.dumps(generated_value, sort_keys=True)}"
        for pointer, source_value, generated_value in new
    )
    unused = sorted(set(allow_by_pointer) - used)
    assert not unused, f"unused parity allow-list entries: {unused}"
    return {"comparedModels": compared, "allowListedDifferences": allowed, "newDifferences": len(new)}


def validate_normalizer_cases() -> dict[str, int]:
    """Exercise parity normalization with stdlib-only JSON-shaped values."""
    optional_generated = {
        "anyOf": [{"type": "string"}, {"type": "null"}], "default": None,
        "description": "D", "format": "uri", "title": "Downloadurl",
    }
    optional_source = {"type": "string", "format": "uri", "description": "D"}
    assert _diff_schema(
        _normalize_schema(optional_source, optional_source, {}, {}),
        _normalize_schema(optional_generated, optional_source, {}, {}, True),
    ) == []

    cycle = {"type": "object", "properties": {"next": {"$ref": "#/components/schemas/Node"}}}
    resolved_cycle = _resolve_refs({"$ref": "#/components/schemas/Node"}, {}, {"Node": cycle})
    assert _diff_schema(_normalize_schema(resolved_cycle, resolved_cycle, {}, {}), _normalize_schema(resolved_cycle, resolved_cycle, {}, {})) == []

    polymorphic = {
        "allOf": [{"type": "object", "properties": {"base": {"type": "string"}},
                   "oneOf": [{"type": "object"}], "discriminator": {"propertyName": "kind"}}],
        "type": "object", "properties": {"child": {"type": "string"}},
    }
    flattened_variant = {"type": "object", "properties": {"base": {"type": "string"}, "child": {"type": "string"}}}
    assert _diff_schema(_normalize_schema(polymorphic, polymorphic, {}, {}), _normalize_schema(flattened_variant, polymorphic, {}, {})) == []

    alias_components = {"Time": {"type": "string", "description": "alias docs", "title": "Time", "examples": ["x"]}}
    alias_source = _resolve_refs({"$ref": "#/components/schemas/Time"}, {}, alias_components)
    alias_generated = {"type": "string", "pattern": "^T"}
    assert _diff_schema(_normalize_schema(alias_source, alias_source, {}, alias_components), _normalize_schema(alias_generated, alias_source, {}, alias_components)) == [("/pattern", None, "^T")]

    source_map = {"type": "object", "properties": {}, "unevaluatedProperties": {"type": "string"}}
    generated_map = {"type": "object", "properties": {}, "additionalProperties": {"type": "string"}}
    assert _diff_schema(_normalize_schema(source_map, source_map, {}, {}), _normalize_schema(generated_map, source_map, {}, {})) == []

    described = {"type": "object", "description": "  line one\n    line two\n"}
    assert _diff_schema(_normalize_schema(described, described, {}, {}), _normalize_schema({"type": "object", "description": "line one\n  line two"}, described, {}, {})) == []

    literal_source = {"enum": ["cat"]}
    literal_generated = {"type": "string", "const": "cat", "enum": ["cat"]}
    assert _diff_schema(_normalize_schema(literal_source, literal_source, {}, {}), _normalize_schema(literal_generated, literal_source, {}, {})) == []

    integer_const_source = {"const": 1}
    integer_const_generated = {"type": "integer", "const": 1}
    assert _diff_schema(
        _normalize_schema(integer_const_source, integer_const_source, {}, {}),
        _normalize_schema(integer_const_generated, integer_const_source, {}, {}),
    ) == []

    open_source = {"type": "object"}
    empty_model = {"type": "object", "properties": {}, "additionalProperties": True}
    assert _diff_schema(_normalize_schema(open_source, open_source, {}, {}), _normalize_schema(empty_model, open_source, {}, {})) == []

    node = {"type": "object", "properties": {"next": {"$ref": "#/components/schemas/Node"}}}
    source_node = _resolve_refs(node, {}, {"Node": node}, _root_stack("Node"))
    generated_node = _resolve_refs(
        {"$ref": "#/$defs/Node"}, {"Node": {"type": "object", "properties": {"next": {"$ref": "#/$defs/Node"}}}},
        {"Node": node}, (), aliases={"Node": "Node"},
    )
    assert _diff_schema(_normalize_schema(source_node, source_node, {}, {}), _normalize_schema(generated_node, source_node, {}, {})) == []
    return {"normalizerUnit": 1}


def validate_metadata(module: Any, counters: dict[str, int]) -> None:
    """Assert title, translated/source pattern, and URI metadata are visible in JSON Schema."""
    schema = module.Profile.model_json_schema(by_alias=True, mode="validation")
    assert schema["title"] == "Profile title"
    counters["modelTitle"] = 1
    assert schema["properties"]["displayName"]["title"] == "Display name"
    counters["fieldTitle"] = 1
    code = schema["properties"]["code"]
    assert code["pattern"] == "[0-9]+"
    assert code["x-oa-sdk-original-pattern"] == r"\d+"
    counters["originalPattern"] = 1
    assert schema["properties"]["homepage"]["format"] == "uri"
    counters["uriFormat"] = 1


def validate_frozen(module: Any, counters: dict[str, int]) -> None:
    """Check ConfigDict(frozen=True) assignment behavior."""
    value = module.Person(personId="p")
    try:
        value.person_id = "q"
    except ValidationError:
        counters["frozenReject"] = 1
    else:
        raise AssertionError("frozen model accepted assignment")


def main() -> None:
    """Run all checks and emit one machine-readable counter line."""
    payload = json.loads(Path(sys.argv[1]).read_text())
    if payload.get("normalizerUnit"):
        print(json.dumps(validate_normalizer_cases(), separators=(",", ":")))
        return
    if payload.get("encoding"):
        counters: dict[str, int] = {}
        validate_encoding(load_module(payload["module"]), counters)
        print(json.dumps(counters, separators=(",", ":")))
        return
    if payload.get("encodingNaive"):
        counters = {}
        validate_encoding_naive(load_module(payload["module"]), counters)
        print(json.dumps(counters, separators=(",", ":")))
        return
    if payload.get("encodingPython"):
        counters = {}
        validate_encoding_python(load_module(payload["module"]), counters)
        print(json.dumps(counters, separators=(",", ":")))
        return
    if payload.get("frozen"):
        counters = {}
        validate_frozen(load_module(payload["module"]), counters)
        print(json.dumps(counters, separators=(",", ":")))
        return
    if payload.get("recursiveAlias"):
        counters = {}
        validate_recursive_alias(load_module(payload["module"]), counters)
        print(json.dumps(counters, separators=(",", ":")))
        return
    if payload.get("operations"):
        print(json.dumps(validate_operations(load_module(payload["module"]), payload), separators=(",", ":")))
        return
    if payload.get("exact"):
        print(json.dumps(validate_exact(load_module(payload["module"])), separators=(",", ":")))
        return
    if payload.get("bodyTypes"):
        print(json.dumps(validate_body_types(load_module(payload["module"])), separators=(",", ":")))
        return
    if payload.get("parity"):
        module = load_module(payload["module"])
        counters = validate_parity(module, payload)
        if payload.get("metadata"):
            validate_metadata(module, counters)
        print(json.dumps(counters, separators=(",", ":")))
        return
    if payload.get("smart"):
        print(json.dumps(validate_smart(load_module(payload["module"])), separators=(",", ":")))
        return
    if payload.get("semantic"):
        print(json.dumps(validate_semantic(load_module(payload["module"]), payload), separators=(",", ":")))
        return
    counters = {name: 0 for name in COUNTER_NAMES}
    module = load_module(payload["module"])
    validate_examples(module, payload, counters)
    validate_aliases(module, payload, counters)
    validate_tagged_union(module, payload, counters)
    validate_unique(module, payload, counters)
    print(json.dumps(counters, separators=(",", ":")))


if __name__ == "__main__":
    main()
