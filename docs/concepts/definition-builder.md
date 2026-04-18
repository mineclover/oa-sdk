# Definition Builder

Definition Builder는 OpenAPI document를 직접 편집하는 대신 canonical definition fragment를
선택하고 조립해 target-specific OpenAPI document를 만드는 흐름이다.

핵심 축은 다음과 같다.

- canonical id
- registry graph
- target selection
- output naming
- `$ref` rewrite
- collision report

구현 상세와 현재 상태는 [spec.md](../internal/spec.md#openapi-definition-builder-계획)와
[definition-builder-compatibility-gates.md](../internal/definition-builder-compatibility-gates.md)를
참조한다.
