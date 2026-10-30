# FTP artifact expansion proposal

This directory contains a review-only proposal derived from the Functional Test Platform portable contract and current FTP model sources.

It is deliberately **not a canonical declaration**:

- no provider `ExactRef` or `$id` is assigned;
- the files are not exported by `@oa-sdk/ftp-contract`;
- the files are not included in the package `files` list;
- no FTP wire conformance or validator support is claimed.

The proposal exists so the oa-sdk owner can review the required field shapes before assigning a declaration namespace, revision, null policy, extension policy, validator and semantic mapping.

Sources reviewed: FTP `docs/portable-contract-v0.1.md`, `src/core/model.ts`, `src/core/references.ts`, and `src/core/prepare.ts`.
