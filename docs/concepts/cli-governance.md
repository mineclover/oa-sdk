# CLI Governance

## CLI Governance Manifest

CLI governance manifest는 `oa-gen`과 `oa-contract` governance command를 command entity와
components로 정의하는 language-neutral manifest다.

구성 요소는 다음과 같다.

- `options`: CLI flags와 positional arguments
- `inputs`: OpenAPI document, contract document, module reference, artifact 같은 semantic input
- `checks`: validation, breaking diff, runtime drift, artifact freshness 같은 reusable system
- `reports`: human/json/markdown output과 report schema id
- `exitPolicy`: recommendation과 exit code policy

Manifest drift는 `pnpm check:cli-spec`가 검증한다.

Manifest 파일과 schema는 [CLI Spec](../cli-spec/README.md)을 참조한다.
