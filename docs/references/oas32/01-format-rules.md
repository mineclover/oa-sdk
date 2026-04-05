<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Versions and Deprecation

The OpenAPI Specification is versioned using a `major`.`minor`.`patch` versioning scheme. The `major`.`minor` portion of the version string (for example `3.1`) SHALL designate the OAS feature set. _`.patch`_ versions address errors in, or provide clarifications to, this document, not the feature set. Tooling which supports OAS 3.1 SHOULD be compatible with all OAS 3.1.\* versions. The patch version SHOULD NOT be considered by tooling, making no distinction between `3.1.0` and `3.1.1` for example.

Certain fields or features may be marked **Deprecated**.
These fields and features remain part of the specification and can be used like any other field or feature.
However, OpenAPI Description authors should use newer fields and features documented to replace the deprecated ones whenever possible.

At this time, such elements are expected to remain part of the OAS until the next major version, although a future minor version of this specification may define a policy for later removal of deprecated elements.

Occasionally, non-backwards compatible changes may be made in `minor` versions of the OAS where impact is believed to be low relative to the benefit provided.

### Undefined and Implementation-Defined Behavior

This specification deems certain situations to have either _undefined_ or _implementation-defined_ behavior.

Behavior described as _undefined_ is likely, at least in some circumstances, to result in outcomes that contradict the specification.
This description is used when detecting the contradiction is impossible or impractical.
Implementations MAY support undefined scenarios for historical reasons, including ambiguous text in prior versions of the specification.
This support might produce correct outcomes in many cases, but relying on it is NOT RECOMMENDED as there is no guarantee that it will work across all tools or with future specification versions, even if those versions are otherwise strictly compatible with this one.

Behavior described as _implementation-defined_ allows implementations to choose which of several different-but-compliant approaches to a requirement to implement.
This documents ambiguous requirements that API description authors are RECOMMENDED to avoid in order to maximize interoperability.
Unlike undefined behavior, it is safe to rely on implementation-defined behavior if _and only if_ it can be guaranteed that all relevant tools support the same behavior.

### JSON and YAML Compatibility

In order to preserve the ability to round-trip between YAML and JSON formats, YAML version [1.2](https://yaml.org/spec/1.2/spec.html) is RECOMMENDED along with the additional constraints listed in [[!RFC9512]] [Section 3.4](https://www.rfc-editor.org/rfc/rfc9512.html#name-yaml-and-json).

The recommendation in previous versions of this specification to restrict YAML to its "JSON" [schema ruleset](https://yaml.org/spec/1.2/spec.html#id2803231) allowed for the inclusion of certain values that (despite the name) cannot be represented in JSON.
OAD authors SHOULD NOT rely on any such JSON-incompatible YAML values.

### Case Sensitivity

As most field names and values in the OpenAPI Specification are case-sensitive, this document endeavors to call out any case-insensitive names and values.
However, the case sensitivity of field names and values that map directly to HTTP concepts follow the case sensitivity rules of HTTP, even if this document does not make a note of every concept.

### Rich Text Formatting

Throughout the specification `description` fields are noted as supporting CommonMark markdown formatting.
Where OpenAPI tooling renders rich text it MUST support, at a minimum, markdown syntax as described by [CommonMark 0.27](https://spec.commonmark.org/0.27/). Tooling MAY choose to ignore some CommonMark or extension features to address security concerns.

While the framing of CommonMark 0.27 as a minimum requirement means that tooling MAY choose to implement extensions on top of it, note that any such extensions are by definition implementation-defined and will not be interoperable.
OpenAPI Description authors SHOULD consider how text using such extensions will be rendered by tools that offer only the minimum support.

---
← [index](./index.md)
