<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Version 3.2.0

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [BCP 14](https://tools.ietf.org/html/bcp14) [RFC2119](https://tools.ietf.org/html/rfc2119) [RFC8174](https://tools.ietf.org/html/rfc8174) when, and only when, they appear in all capitals, as shown here.

This document is licensed under [The Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.html).

## Introduction

The OpenAPI Specification (OAS) defines a standard, language-agnostic interface to HTTP APIs which allows both humans and computers to discover and understand the capabilities of the service without access to source code, documentation, or through network traffic inspection. When properly defined, a consumer can understand and interact with the remote service by [parsing and serializing](#parsing-and-serializing) HTTP messages to and from a [data model](#data-types) with a minimal amount of implementation logic.

An [OpenAPI Description](#openapi-description-structure) (OAD) can then be used by documentation generation tools to display the API, code generation tools to generate servers and clients in various programming languages, testing tools, and many other use cases.

For examples of OpenAPI usage and additional documentation, please visit [[?OpenAPI-Learn]].

For extension registries and other specifications published by the OpenAPI Initiative, as well as the authoritative rendering of this specification, please visit [spec.openapis.org](https://spec.openapis.org/).

## Format

An OpenAPI document that conforms to the OpenAPI Specification is itself a JSON object, which may be represented either in [[RFC8259|JSON]] or [[YAML|YAML]] format.
Examples in this specification will be shown in YAML for brevity.

All field names in the specification are **case-sensitive**.
This includes all fields that are used as keys in a map, except where explicitly noted that keys are **case-insensitive**.

OAS [Objects](#objects-and-fields) expose two types of fields: _fixed fields_, which have a declared name, and _patterned fields_, which have a declared pattern for the field name.

Patterned fields MUST have unique names within the containing object.

**Note:** While APIs may be described by OpenAPI Descriptions in either YAML or JSON format, the API request and response bodies and other content are not required to be JSON or YAML.

---
← [index](./index.md)
