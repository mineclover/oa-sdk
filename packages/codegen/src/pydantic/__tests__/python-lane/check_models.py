"""Validate one generated Pydantic module and print lane counters."""
import importlib.util
import importlib
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError


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
